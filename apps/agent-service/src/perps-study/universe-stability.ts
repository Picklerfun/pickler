import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { localStudyDatabase } from "./database-env.js";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPerpsStudyStore,
  PERPL_UNIVERSE_STREAM_VERSION,
} from "@pickler/infrastructure";
import { createPriorityPerplStudyData } from "@pickler/agent-runtime/plugins/perps-paper";
import {
  assertPerpsStudyConfig,
  canonicalAudit,
  startLeaseHeartbeat,
  type PerpsSmaReentryConfig,
  type LeaseDiagnostic,
} from "@pickler/trading/evaluation";
import {
  validatePaperFrame,
  validatePaperFrameComponents,
  transientPerpsData,
  validateUniverseStream,
  universeStreamValidation,
  UNIVERSE_COMPONENT_STREAM_POLICY,
  type UniverseStreamBuffer,
} from "@pickler/trading/perps";
import { createHash } from "node:crypto";
import { keepAwake } from "../paper-study/comparison-host.js";
import { closeProfileResources } from "./profiles-resources.js";
import { createStreamCapture, publicMarketCsv, PUBLIC_CAPTURE_LIMIT } from "./stream-capture.js";

/** Node timer cancellation wraps the original reason; retain the admitted failure code. */
export function captureFailureCode(failure: unknown, signal?: AbortSignal): string {
  const cause = signal?.aborted ? signal.reason : failure;
  if (signal?.aborted && cause instanceof DOMException && cause.name === "AbortError") {
    return "CANCELLED";
  }
  return cause instanceof PilotError ? cause.code : "STABILITY_FAILED";
}

/** Capture only: fixed qualification or three diagnostic reads, never accounts or models. */
export async function runUniverseStability(
  input: {
    configPath: string;
    envFile?: string;
    output?: string;
    allowPaid?: boolean;
    diagnosticOnly?: boolean;
  },
  parent: AbortSignal,
) {
  if (input.allowPaid || !input.envFile || !input.output) {
    throw new PilotError(
      "INVALID_INPUT",
      "Public stability requires local environment and new output; paid calls forbidden",
    );
  }
  const config = JSON.parse(
    await readFile(resolve(input.configPath), "utf8"),
  ) as PerpsSmaReentryConfig;
  assertPerpsStudyConfig(config);
  if (config.version !== 7) {
    throw new PilotError("INVALID_INPUT", "Eleven-market v7 required");
  }
  if (config.acquisitionPolicy === "stream-universe-component-paper-20s-v1") {
    throw new PilotError(
      "INVALID_INPUT",
      "Paper policy adopts its explicitly pinned capture; it is not a capture selector",
    );
  }
  const diagnosticOnly = input.diagnosticOnly === true;
  const componentStream = config.acquisitionPolicy === UNIVERSE_COMPONENT_STREAM_POLICY;
  const streaming = config.acquisitionPolicy === "stream-universe-20s-v1" || componentStream;
  const validateCapturedFrame = componentStream ? validatePaperFrameComponents : validatePaperFrame;
  if (
    diagnosticOnly &&
    ![
      "rest-universe-coherent-20s-v2",
      "stream-universe-20s-v1",
      UNIVERSE_COMPONENT_STREAM_POLICY,
    ].includes(config.acquisitionPolicy ?? "")
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Reader check requires the explicitly selected coherent REST or universe stream reader",
    );
  }
  const expectedCycles = diagnosticOnly ? 3 : 30;
  const intervalMs = diagnosticOnly ? 25000 : 60000;
  const url = await localStudyDatabase(resolve(input.envFile));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
    throw new PilotError("DIRTY_CHECKOUT", "Commit tested code before public qualification");
  }
  const output = resolve(input.output);
  await mkdir(output, { recursive: false, mode: 0o700 });
  await writeFile(join(output, "STARTED"), commit + "\n", { flag: "wx", mode: 0o600 });
  const research = new PostgresResearchStore(url);
  const study = new PostgresPerpsStudyStore(research.pool);
  const controller = new AbortController();
  const renewals: LeaseDiagnostic[] = [];
  const requests: unknown[] = [];
  const acquisition: unknown[] = [];
  const tickerReads: unknown[] = [];
  const buffers: UniverseStreamBuffer[] = [];
  const capture = streaming
    ? await createStreamCapture(
        output,
        PUBLIC_CAPTURE_LIMIT,
        config.markets.map((m) => m.marketId),
      )
    : undefined;
  const data = createPriorityPerplStudyData(research, {
    acquisitionPolicy: config.acquisitionPolicy ?? "rest-universe-20s-v1",
    onDiagnostic: (value) => requests.push(value),
    onAcquisition: (value) => acquisition.push(value),
    onTickerRead: (value) => tickerReads.push(value),
    ...(streaming
      ? {
          onBuffer: (buffer: UniverseStreamBuffer) => {
            buffers.splice(0, buffers.length, buffer);
          },
        }
      : {}),
    ...(capture
      ? {
          onStream: (event: Parameters<typeof capture.record>[0]) => {
            capture.record(event);
            if (event.kind === "error") {
              controller.abort(
                new PilotError(event.code ?? "PERPL_STREAM_MESSAGE", "Public reader stopped"),
              );
            }
          },
        }
      : {}),
  });
  const id = `${diagnosticOnly ? "readercheck7" : "stability7"}-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 18)}`;
  let releaseAwake = () => {};
  let lease: Awaited<ReturnType<typeof study.claim>> | undefined;
  let scope: Awaited<ReturnType<typeof study.initializeDiagnostic>> | undefined;
  let heartbeat: ReturnType<typeof startLeaseHeartbeat> | undefined;
  let operationSignal: AbortSignal | undefined;
  let released = false;
  let readerClosed = false;
  let isolationProof: { accounts: number; decisionRounds: number } | null = null;
  let error: string | null = null;
  const cycles: {
    slot: number;
    scheduledAt: number;
    at: number;
    valid: boolean;
    missed: boolean;
    durationMs: number;
    validatedAt: number;
    code: string | null;
    markets: unknown[];
    frames: unknown[];
    requests: unknown[];
    acquisition: unknown[];
    tickerReads: unknown[];
  }[] = [];
  const startedAt = Math.floor(Date.now() / 60000) * 60000 + 60000;
  const end = startedAt + expectedCycles * intervalMs;
  const render = async () => {
    await capture?.flush();
    const stream = capture?.summary();
    const valid = cycles.filter((c) => c.valid).length;
    const failedOwnership =
      renewals.filter((r) => r.kind !== "renewed").length +
      (error &&
      ["LEASE_LOST", "PROCESS_INTERRUPTED", "PERMISSION_DENIED", "CONFIG_CHANGED"].includes(error)
        ? 1
        : 0);
    const result = {
      version: componentStream ? 4 : streaming ? 3 : 2,
      protocol: diagnosticOnly ? "perpl-reader-check-v1" : "perps-universe-stability-v1",
      qualification: diagnosticOnly ? "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE" : "CAPTURE_ONLY",
      commit,
      ...(streaming
        ? {
            adapterVersion: PERPL_UNIVERSE_STREAM_VERSION,
            exporterCommit: commit,
            diagnosticSessionId: id,
            sourceSessionId: config.sessionId,
            catalogHash: createHash("sha256").update(canonicalAudit(config.markets)).digest("hex"),
            readerClosed,
            stream,
            reconstructionErrors:
              stream?.errors.filter((e) => e.code.startsWith("PERPL_STREAM_")).length ?? 0,
          }
        : {}),
      configurationHash: createHash("sha256").update(canonicalAudit(config)).digest("hex"),
      acquisitionPolicy: config.acquisitionPolicy ?? "rest-universe-20s-v1",
      ...(componentStream
        ? {
            dataValidation: universeStreamValidation(UNIVERSE_COMPONENT_STREAM_POLICY),
            strictValidCycles: cycles.filter(
              (c) => "strictJointValid" in c && c.strictJointValid === true,
            ).length,
          }
        : {}),
      config,
      startedAt,
      endsAt: end,
      expectedCycles,
      requiredValid: diagnosticOnly ? null : 29,
      validCycles: valid,
      ownershipFailures: failedOwnership,
      leaseReleased: released,
      error,
      modelCalls: 0,
      modelCostUSD: "0",
      ...(streaming ? { modelTokens: 0, modelReservationsUSD: "0", isolationProof } : {}),
      passed:
        !diagnosticOnly &&
        cycles.length === 30 &&
        valid >= 29 &&
        failedOwnership === 0 &&
        released &&
        (!streaming ||
          (readerClosed && stream?.socketClosed === true && stream.errors.length === 0)) &&
        (!streaming || (isolationProof?.accounts === 0 && isolationProof.decisionRounds === 0)) &&
        error === null,
      limitation:
        "Flat public capture validates acquisition, not mandatory exits or profitability.",
      cycles,
      renewals,
    };
    const headers = [
      "slot",
      "scheduledAt",
      "at",
      "valid",
      "missed",
      "durationMs",
      "code",
      "markets",
    ] as const;
    const csv =
      [
        headers.join(","),
        ...cycles.map((c) =>
          headers
            .map(
              (h) =>
                '"' +
                String(typeof c[h] === "object" ? JSON.stringify(c[h]) : (c[h] ?? "")).replaceAll(
                  '"',
                  '""',
                ) +
                '"',
            )
            .join(","),
        ),
      ].join("\n") + "\n";
    for (const [name, content] of Object.entries({
      "report.json": JSON.stringify(result, null, 2) + "\n",
      "report.csv": csv,
      ...(streaming ? { "markets.csv": publicMarketCsv(cycles) } : {}),
      "report.html": `<!doctype html><html lang="en"><meta charset="utf-8"><title>Eleven-market reader evidence</title><body><h1>${diagnosticOnly ? "Three public reader checks; not qualification" : "Public acquisition qualification"}</h1><p>${valid}/${expectedCycles} joint valid cycles; lease released: ${released}; accepted: ${result.passed}. No trading or models.</p><pre>${JSON.stringify(result, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></body></html>`,
    })) {
      await writeFile(join(output, name + ".tmp"), content, { mode: 0o600 });
      await rename(join(output, name + ".tmp"), join(output, name));
    }
    return result;
  };
  try {
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    scope = await study.initializeDiagnostic(
      config,
      id,
      {
        commit,
        acquisitionPolicy: config.acquisitionPolicy ?? "rest-universe-20s-v1",
        qualification: diagnosticOnly ? "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE" : "CAPTURE_ONLY",
      },
      diagnosticOnly || streaming ? config : undefined,
    );
    lease = await study.claim(scope);
    heartbeat = startLeaseHeartbeat({
      lease,
      monotonic: () => performance.now(),
      renew: () => study.renew(scope!, lease!),
      diagnostic: (value) => renewals.push(value),
    });
    lease.assertActive = heartbeat.assertActive;
    const signal = AbortSignal.any([parent, controller.signal, heartbeat.signal]);
    operationSignal = signal;
    const guard = async () => {
      signal.throwIfAborted();
      heartbeat!.assertActive();
      await study.guard(scope!, lease!);
    };
    const record = (await study.view(scope)).record;
    for (let slot = 0; slot < expectedCycles; slot++) {
      const scheduledAt = startedAt + slot * intervalMs;
      await wait(Math.max(1, scheduledAt - Date.now()), undefined, { signal });
      await guard();
      requests.length = 0;
      acquisition.length = 0;
      tickerReads.length = 0;
      buffers.length = 0;
      const at = Date.now(),
        mono = performance.now();
      const missed = at - scheduledAt > (diagnosticOnly ? 5000 : 30000);
      let code: string | null = missed ? "WINDOW_MISSED" : null;
      let validatedAt = Date.now();
      let fatal: unknown;
      let frames: Awaited<ReturnType<typeof data.observe>>["frames"] = [];
      if (!missed) {
        try {
          frames = (await data.observe(record, signal, guard)).frames;
          const reference = Date.now();
          validatedAt = reference;
          if (componentStream && frames.length) {
            const buffer = buffers.at(-1);
            if (
              !buffer ||
              validateUniverseStream({
                network: config.network,
                markets: config.markets,
                buffer,
                now: reference,
                policy: UNIVERSE_COMPONENT_STREAM_POLICY,
                hash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
              }).excluded.length
            ) {
              throw new PilotError(
                "DATA_UNAVAILABLE",
                "Final stream continuity or components expired",
              );
            }
          }
          for (const f of frames) {
            validateCapturedFrame(f, config.network, f.snapshot.market.symbol, reference);
          }
        } catch (failure) {
          const cause = signal.aborted ? signal.reason : failure;
          code = cause instanceof PilotError ? cause.code : "PUBLIC_CAPTURE_FAILED";
          if (signal.aborted || !transientPerpsData(failure)) {
            // Keep interrupted request traces locally before leaving; never write this cycle
            // to PostgreSQL after cancellation or loss of ownership.
            fatal = cause;
          }
        }
      }
      if (!frames.length || code) {
        validatedAt = Date.now();
      }
      const valid = !code && frames.length === 11;
      const observedBuffer = buffers.at(-1);
      const componentValidation =
        componentStream && observedBuffer
          ? validateUniverseStream({
              markets: config.markets,
              network: config.network,
              buffer: observedBuffer,
              now: validatedAt,
              policy: UNIVERSE_COMPONENT_STREAM_POLICY,
              hash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
            })
          : undefined;
      let evidenceFrames = frames;
      if (streaming && !frames.length && observedBuffer) {
        // Diagnostic evidence only: a partial in-window copy never upgrades the joint outcome.
        evidenceFrames = validateUniverseStream({
          markets: config.markets,
          network: config.network,
          buffer: observedBuffer,
          now: validatedAt,
          ...(componentStream ? { policy: UNIVERSE_COMPONENT_STREAM_POLICY } : {}),
          hash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
        }).frames;
      }
      const markets = config.markets.map((m) => {
        const f = evidenceFrames.find((x) => x.snapshot.market.symbol === m.symbol);
        const pair = observedBuffer?.components.find((c) => c.symbol === m.symbol);
        const tickerEvidence = f?.snapshot.ticker.provenance ?? pair?.snapshot?.ticker.provenance;
        const bookEvidence = f?.book.provenance ?? pair?.book?.provenance;
        let validMarket = false;
        let strictValid = false;
        if (f) {
          try {
            validateCapturedFrame(f, config.network, m.symbol, validatedAt);
            validMarket =
              !componentStream ||
              componentValidation?.frames.some(
                (frame) => frame.snapshot.market.symbol === m.symbol,
              ) === true;
          } catch {
            // Preserve the original cycle failure; presence alone does not prove validity.
          }
          try {
            validatePaperFrame(f, config.network, m.symbol, validatedAt);
            strictValid = true;
          } catch {
            // The legacy financial rule remains a separate diagnostic, never an upgraded pass.
          }
        }
        const traces = acquisition as {
          symbol: string;
          tickerAt: number | null;
          bookAt: number | null;
          skewMs: number | null;
          code: string | null;
          at: number;
        }[];
        const first = traces.find((t) => t.symbol === m.symbol);
        const last = traces.filter((t) => t.symbol === m.symbol).at(-1);
        const firstValid = traces.find((t) => t.symbol === m.symbol && t.code === null);
        const component = capture?.summary().components.filter((c) => c.marketId === m.marketId);
        return {
          ...m,
          valid: validMarket,
          tickerAt: f?.snapshot.ticker.provenance.providerTimestamp ?? null,
          bookAt: f?.book.provenance.providerTimestamp ?? null,
          hash: f?.hash ?? null,
          skewMs: f
            ? Math.abs(
                f.snapshot.ticker.provenance.providerTimestamp! -
                  f.book.provenance.providerTimestamp!,
              )
            : null,
          ...(streaming
            ? {
                tickerAt: f?.snapshot.ticker.provenance.providerTimestamp ?? last?.tickerAt ?? null,
                bookAt: f?.book.provenance.providerTimestamp ?? last?.bookAt ?? null,
                tickerBlock: tickerEvidence?.block ?? null,
                bookBlock: bookEvidence?.block ?? null,
                tickerReceivedAt: tickerEvidence?.receivedAt ?? null,
                bookReceivedAt: bookEvidence?.receivedAt ?? null,
                tickerAgeMs:
                  tickerEvidence?.providerTimestamp !== null &&
                  tickerEvidence?.providerTimestamp !== undefined
                    ? validatedAt - tickerEvidence.providerTimestamp
                    : null,
                bookAgeMs:
                  bookEvidence?.providerTimestamp !== null &&
                  bookEvidence?.providerTimestamp !== undefined
                    ? validatedAt - bookEvidence.providerTimestamp
                    : null,
                initialSkewMs: first?.skewMs ?? null,
                skewMs: f
                  ? Math.abs(
                      f.snapshot.ticker.provenance.providerTimestamp! -
                        f.book.provenance.providerTimestamp!,
                    )
                  : (last?.skewMs ?? null),
                firstValidMs: firstValid ? firstValid.at - at : null,
                acquisitionMs: performance.now() - mono,
                checks: traces.filter((t) => t.symbol === m.symbol).length,
                componentCounters: JSON.stringify(component ?? []),
                code: validMarket ? null : (last?.code ?? code ?? "DATA_UNAVAILABLE"),
                ...(componentStream ? { strictValid } : {}),
              }
            : {}),
        };
      });
      const cycle = {
        slot,
        scheduledAt,
        at,
        valid,
        missed,
        durationMs: performance.now() - mono,
        validatedAt,
        code: code ?? (valid ? null : "DATA_UNAVAILABLE"),
        markets,
        frames: evidenceFrames,
        ...(streaming
          ? {
              bufferGeneration: observedBuffer?.generation ?? null,
              bufferCopiedAt: observedBuffer?.observedAt ?? null,
              executableJoint: componentStream ? false : valid,
              ...(componentStream
                ? {
                    bufferContinuity: observedBuffer?.continuity ?? null,
                    capturedJointValid: valid,
                    strictJointValid:
                      valid && markets.every((m) => "strictValid" in m && m.strictValid === true),
                    financialExecutable: false,
                  }
                : {}),
            }
          : {}),
        requests: requests.map((value, requestId) => ({
          ...(value as object),
          cycle: `capture-${slot}`,
          requestId,
        })),
        acquisition: [...acquisition],
        tickerReads: [...tickerReads],
      };
      cycles.push(cycle);
      if (fatal) {
        throw fatal;
      }
      await study.event(scope, lease, `diagnostic-${slot}`, "capture-cycle", cycle);
      await render();
    }
    await wait(Math.max(1, end - Date.now()), undefined, { signal });
    await study.complete(scope, lease);
  } catch (failure) {
    error = captureFailureCode(failure, operationSignal);
  } finally {
    try {
      await data.close();
      readerClosed = true;
    } catch {
      error ??= "READER_CLEANUP_FAILED";
    }
    await heartbeat?.stop().catch(() => {
      error ??= "RENEWAL_CLEANUP_FAILED";
    });
    if (scope && lease) {
      await study.release(scope, lease, error ?? undefined).catch(() => {
        error ??= "LEASE_RELEASE_FAILED";
      });
      try {
        const state = await research.pool.query(
          "SELECT owner,expires_at FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
          [scope.tenantId, scope.sessionId, scope.network],
        );
        released =
          state.rows.length === 1 &&
          state.rows[0].owner === null &&
          state.rows[0].expires_at === null;
        if (streaming) {
          const counts = await research.pool.query(
            `SELECT (SELECT count(*)::int FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND session_id=$2 AND network=$3) AS accounts,
              (SELECT count(*)::int FROM pickler.perps_study_rounds r JOIN pickler.perps_studies s ON s.id=r.study_id WHERE s.tenant_id=$1 AND s.session_id=$2 AND s.network=$3) AS decision_rounds`,
            [scope.tenantId, scope.sessionId, scope.network],
          );
          isolationProof = {
            accounts: counts.rows[0].accounts,
            decisionRounds: counts.rows[0].decision_rounds,
          };
        }
      } catch {
        error ??= "LEASE_RELEASE_UNVERIFIABLE";
      }
    }
    const failures = await closeProfileResources([() => releaseAwake(), () => research.close()]);
    if (failures.length) {
      error ??= "RESOURCE_CLEANUP_FAILED";
    }
    while (cycles.length < expectedCycles) {
      const slot = cycles.length;
      cycles.push({
        slot,
        scheduledAt: startedAt + slot * intervalMs,
        at: Date.now(),
        validatedAt: Date.now(),
        valid: false,
        missed: true,
        durationMs: 0,
        code: "NOT_ADMITTED_AFTER_INTERRUPTION",
        markets: config.markets.map((m) => ({
          ...m,
          valid: false,
          code: "NOT_ADMITTED_AFTER_INTERRUPTION",
          ...(componentStream ? { strictValid: false } : {}),
        })),
        ...(componentStream ? { strictJointValid: false, financialExecutable: false } : {}),
        frames: [],
        requests: [],
        acquisition: [],
        tickerReads: [],
      });
    }
    const result = await render();
    console.log(
      JSON.stringify({
        output,
        validCycles: result.validCycles,
        passed: result.passed,
        leaseReleased: released,
        error,
      }),
    );
    if (diagnosticOnly && (error || !released || result.ownershipFailures > 0)) {
      throw new PilotError(
        error ?? "READER_CHECK_FAILED",
        "Reader diagnostic did not close safely",
      );
    }
    if (!diagnosticOnly && !result.passed) {
      throw new PilotError(
        "STABILITY_NOT_ACCEPTED",
        "One qualification completed without meeting acceptance; no automatic repeat",
      );
    }
  }
}
