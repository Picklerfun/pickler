import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { localStudyDatabase } from "./database-env.js";
import { PilotError } from "@pickler/core";
import { PostgresResearchStore, PostgresPerpsStudyStore } from "@pickler/infrastructure";
import { createPriorityPerplStudyData } from "@pickler/agent-runtime/plugins/perps-paper";
import {
  assertPerpsStudyConfig,
  canonicalAudit,
  startLeaseHeartbeat,
  type PerpsSmaReentryConfig,
  type LeaseDiagnostic,
} from "@pickler/trading/evaluation";
import { validatePaperFrame, transientPerpsData } from "@pickler/trading/perps";
import { createHash } from "node:crypto";
import { keepAwake } from "../paper-study/comparison-host.js";
import { closeProfileResources } from "./profiles-resources.js";

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
  const diagnosticOnly = input.diagnosticOnly === true;
  if (diagnosticOnly && config.acquisitionPolicy !== "rest-universe-coherent-20s-v2") {
    throw new PilotError(
      "INVALID_INPUT",
      "Reader check requires the explicitly selected v2 reader",
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
  const data = createPriorityPerplStudyData(research, {
    acquisitionPolicy: config.acquisitionPolicy ?? "rest-universe-20s-v1",
    onDiagnostic: (value) => requests.push(value),
    onAcquisition: (value) => acquisition.push(value),
    onTickerRead: (value) => tickerReads.push(value),
  });
  const id = `${diagnosticOnly ? "readercheck7" : "stability7"}-${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 18)}`;
  let releaseAwake = () => {};
  let lease: Awaited<ReturnType<typeof study.claim>> | undefined;
  let scope: Awaited<ReturnType<typeof study.initializeDiagnostic>> | undefined;
  let heartbeat: ReturnType<typeof startLeaseHeartbeat> | undefined;
  let released = false;
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
    const valid = cycles.filter((c) => c.valid).length;
    const failedOwnership =
      renewals.filter((r) => r.kind !== "renewed").length +
      (error &&
      ["LEASE_LOST", "PROCESS_INTERRUPTED", "PERMISSION_DENIED", "CONFIG_CHANGED"].includes(error)
        ? 1
        : 0);
    const result = {
      version: 2,
      protocol: diagnosticOnly ? "perpl-reader-check-v1" : "perps-universe-stability-v1",
      qualification: diagnosticOnly ? "DIAGNOSTIC_ONLY_NOT_ACCEPTANCE" : "CAPTURE_ONLY",
      commit,
      configurationHash: createHash("sha256").update(canonicalAudit(config)).digest("hex"),
      acquisitionPolicy: config.acquisitionPolicy ?? "rest-universe-20s-v1",
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
      passed:
        !diagnosticOnly &&
        cycles.length === 30 &&
        valid >= 29 &&
        failedOwnership === 0 &&
        released &&
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
      diagnosticOnly ? config : undefined,
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
          for (const f of frames) {
            validatePaperFrame(f, config.network, f.snapshot.market.symbol, reference);
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
      const valid = !code && frames.length === 11;
      const markets = config.markets.map((m) => {
        const f = frames.find((x) => x.snapshot.market.symbol === m.symbol);
        let validMarket = false;
        if (f) {
          try {
            validatePaperFrame(f, config.network, m.symbol, validatedAt);
            validMarket = true;
          } catch {
            // Preserve the original cycle failure; presence alone does not prove validity.
          }
        }
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
        frames,
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
    error = failure instanceof PilotError ? failure.code : "STABILITY_FAILED";
  } finally {
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
      } catch {
        error ??= "LEASE_RELEASE_UNVERIFIABLE";
      }
    }
    const failures = await closeProfileResources([
      () => data.close(),
      () => releaseAwake(),
      () => research.close(),
    ]);
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
        markets: config.markets.map((m) => ({ ...m, valid: false })),
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
