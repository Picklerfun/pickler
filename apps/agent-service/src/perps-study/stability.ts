import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { parse } from "dotenv";
import { perpsStudyConfigSchema } from "@pickler/api-schema";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPerpsStudyStore,
  PerplRequestSchedule,
  checkPublicConnectivity,
  type ConnectivityControl,
  type PerplRequestDiagnostic,
} from "@pickler/infrastructure";
import { createPerplAcquisitionReader } from "@pickler/agent-runtime/plugins/perps-paper";
import { startLeaseHeartbeat, type LeaseDiagnostic } from "@pickler/trading/evaluation";
import {
  choosePerplTransport,
  validatePaperFrame,
  type AcquisitionDiagnostic,
  type PerpsPaperFrame,
  type PerpsDataPolicy,
} from "@pickler/trading/perps";
import { summarizePerplCapture, readPerplTransportChoice } from "./transport-report.js";
import { keepAwake } from "../paper-study/comparison-host.js";

const safeCode = (error: unknown) =>
  error instanceof PilotError ? error.code : "STABILITY_FAILED";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export async function runPerpsStability(
  input: {
    configPath: string;
    envFile?: string;
    output?: string;
    allowPaid?: boolean;
    diagnostic?: boolean;
    acquisitionChoice?: string;
  },
  parent: AbortSignal,
) {
  if (input.allowPaid) {
    throw new PilotError("INVALID_INPUT", "Stability never authorizes paid calls");
  }
  const config = perpsStudyConfigSchema.parse(
    JSON.parse(await readFile(resolve(input.configPath), "utf8")),
  );
  // Parse only the database setting. Do not load model/trading credentials into process.env.
  const url = input.envFile
    ? parse(await readFile(resolve(input.envFile), "utf8")).DATABASE_URL
    : process.env.DATABASE_URL;
  if (!url) {
    throw new PilotError("INVALID_INPUT", "DATABASE_URL required");
  }
  const endpoint = new URL(url);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new PilotError("INVALID_INPUT", "Public diagnostics require explicit local PostgreSQL");
  }
  const diagnostic = input.diagnostic ?? false;
  const count = diagnostic ? 10 : 30;
  let policy: PerpsDataPolicy = diagnostic ? "coherent-20s-v1" : "rest-paced-20s-v1";
  const configHash = createHash("sha256").update(JSON.stringify(config)).digest("hex");
  if (!diagnostic) {
    if (!input.acquisitionChoice) {
      throw new PilotError(
        "INVALID_INPUT",
        "Stability requires the frozen --acquisition-choice from data-diagnostic",
      );
    }
    const choice = await readPerplTransportChoice(resolve(input.acquisitionChoice), configHash);
    policy = choice.policy;
  }
  const id = `${diagnostic ? "transport" : "stability"}-${new Date().toISOString().replace(/[-:.]/g, "")}`;
  const output = resolve(input.output ?? `.data/perps-studies/${id}`);
  await mkdir(output, { recursive: true });
  const lock = join(output, "STARTED");
  await writeFile(lock, id, { flag: "wx", mode: 0o600 });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = !!execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    encoding: "utf8",
  }).trim();
  if (dirty) {
    throw new PilotError(
      "DIRTY_CHECKOUT",
      "Commit the tested implementation before stability acceptance",
    );
  }
  let releaseAwake = () => {};
  let readers: ReturnType<typeof createPerplAcquisitionReader>[] = [];
  let streamBytes = 0;
  let captureTruncated = false;
  const streamEvents: Array<{ kind: string; receivedAt: number; code?: string }> = [];
  let databaseReleased = false;
  let readerClosed = false;
  const research = new PostgresResearchStore(url);
  const study = new PostgresPerpsStudyStore(research.pool);
  const cycles: Array<{
    slot: number;
    at: number;
    durationMs: number;
    valid: boolean;
    code: string | null;
    diagnostics: AcquisitionDiagnostic[];
    requests: PerplRequestDiagnostic[];
    connectivityControl: ConnectivityControl | null;
    transports: Record<
      string,
      {
        valid: boolean;
        code: string | null;
        firstValidMs: number | null;
        frames: PerpsPaperFrame[];
        diagnostics: AcquisitionDiagnostic[];
      }
    >;
  }> = [];
  const renewals: LeaseDiagnostic[] = [];
  let writes: Promise<void> = Promise.resolve();
  let heartbeat: ReturnType<typeof startLeaseHeartbeat> | undefined;
  let lease: Awaited<ReturnType<typeof study.claim>> | undefined;
  let scope: typeof config | undefined;
  let startedAt = Date.now();
  let error: string | null = null;
  let completed = false;
  const recordLocal = (event: unknown) => {
    writes = writes.then(() =>
      appendFile(join(output, "events.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 }),
    );
    void writes.catch(() => {});
  };
  const render = async () => {
    await writes;
    const validCycles = cycles.filter((cycle) => cycle.valid).length;
    const marketRows = cycles.flatMap((cycle) =>
      Object.entries(cycle.transports).flatMap(([transport, result]) =>
        (["BTC", "ETH"] as const).map((symbol) => {
          const events = result.diagnostics.filter((e) => e.symbol === symbol),
            initial = events[0],
            final = events.at(-1);
          const frame = result.frames.find((f) => f.snapshot.market.symbol === symbol);
          const reference = cycle.at + cycle.durationMs;
          return {
            slot: cycle.slot,
            transport,
            symbol,
            jointValid: result.valid,
            code: result.code,
            valid:
              !!final &&
              final.code === null &&
              final.tickerAt !== null &&
              final.bookAt !== null &&
              reference - final.tickerAt <= 30000 &&
              reference - final.bookAt <= 30000 &&
              final.tickerAt <= reference + 5000 &&
              final.bookAt <= reference + 5000 &&
              Math.abs(final.tickerAt - final.bookAt) <= 5000,
            initialSkewMs: initial?.skewMs ?? null,
            finalSkewMs: final?.skewMs ?? null,
            tickerAt: final?.tickerAt ?? null,
            bookAt: final?.bookAt ?? null,
            tickerBlock: frame?.snapshot.ticker.provenance.block ?? null,
            bookBlock: frame?.book.provenance.block ?? null,
            tickerReceivedAt: frame?.snapshot.ticker.provenance.receivedAt ?? null,
            bookReceivedAt: frame?.book.provenance.receivedAt ?? null,
            firstValidMs: result.firstValidMs,
            acquisitionMs: cycle.durationMs,
            attempts: events.length,
          };
        }),
      ),
    );
    const cadence = await summarizePerplCapture(join(output, "events.jsonl")).catch(() => ({
      heartbeatMessages: 0,
      components: [],
    }));
    const report = {
      cadence,
      version: 3,
      kind: diagnostic ? "perpl-transport-diagnostic" : "perpl-public-stability",
      id,
      commit,
      config,
      dataPolicy: policy,
      transport: policy === "stream-20s-v1" ? "websocket" : "rest",
      configHash,
      adapterVersion: "public-stream-v1",
      streamEvents,
      captureTruncated,
      databaseReleased,
      readerClosed,
      startedAt,
      finishedAt: Date.now(),
      cycles,
      marketRows,
      renewals,
      validCycles,
      totalCycles: count,
      paidCalls: 0,
      fills: 0,
      error,
      diagnosticCompleted: diagnostic && completed && !error,
      accepted:
        !diagnostic &&
        completed &&
        cycles.length === count &&
        validCycles >= (diagnostic ? 0 : 29) &&
        !error &&
        databaseReleased &&
        readerClosed &&
        !renewals.some((r) => r.kind !== "renewed"),
    };
    if (diagnostic && completed && !error && cycles.length === 10) {
      const choice = choosePerplTransport({
        opportunities: 10,
        restValid: cycles.filter((c) => c.transports.rest?.valid).length,
        websocketValid: cycles.filter((c) => c.transports.websocket?.valid).length,
        reconstructionErrors: streamEvents.filter(
          (e) => e.kind === "error" && /^PERPL_STREAM_/.test(e.code ?? ""),
        ).length,
        ownershipErrors: renewals.filter((e) => e.kind !== "renewed").length,
      });
      await writeFile(
        join(output, "choice.json"),
        JSON.stringify({ ...choice, commit, configHash, diagnosticCompleted: true }, null, 2) +
          "\n",
      );
    }
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    const csv = [
      "slot,transport,symbol,joint_valid,market_valid,code,initial_skew_ms,final_skew_ms,ticker_at,book_at,ticker_block,book_block,ticker_received_at,book_received_at,first_valid_ms,duration_ms,attempts",
      ...marketRows.map((c) =>
        [
          c.slot,
          c.transport,
          c.symbol,
          c.jointValid,
          c.valid,
          c.code ?? "",
          c.initialSkewMs ?? "",
          c.finalSkewMs ?? "",
          c.tickerAt ?? "",
          c.bookAt ?? "",
          c.tickerBlock ?? "",
          c.bookBlock ?? "",
          c.tickerReceivedAt ?? "",
          c.bookReceivedAt ?? "",
          c.firstValidMs ?? "",
          c.acquisitionMs,
          c.attempts,
        ].join(","),
      ),
    ].join("\n");
    await writeFile(join(output, "report.csv"), csv + "\n");
    await writeFile(
      join(output, "report.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Perpl public data acquisition</title><style>body{font:15px system-ui;margin:32px;background:#10141d;color:#e1e8f3}table{border-collapse:collapse;width:100%}td,th{padding:9px;border-bottom:1px solid #334155;text-align:left}pre{white-space:pre-wrap}a{color:#8bcaff}</style><h1>Perpl public acquisition ${diagnostic ? "comparison" : "acceptance"}</h1><p>${validCycles}/${count} valid primary cycles. Completed and released: ${completed && databaseReleased && readerClosed}. Acceptance: ${diagnostic ? "transport selection only" : report.accepted}.</p><p>Paid calls: 0. Virtual or real purchases: 0. Availability is not profitability.</p><p>Commit: ${commit}. Policy: ${policy}. Maximum age 30s, future 5s, component skew 5s, joint deadline 20s.</p><p>Both first valid acquisitions are checked at one common reference time. No transport receives a replacement snapshot after the other has finished.</p><table><thead><tr><th>Slot</th><th>Transport</th><th>Market</th><th>Joint / market valid</th><th>Initial → final skew</th><th>First valid ms</th><th>Code</th></tr></thead><tbody>${marketRows.map((r) => `<tr><td>${r.slot}</td><td>${r.transport}</td><td>${r.symbol}</td><td>${r.jointValid} / ${r.valid}</td><td>${r.initialSkewMs ?? "?"} → ${r.finalSkewMs ?? "?"}</td><td>${r.firstValidMs ?? "—"}</td><td>${escape(r.code ?? "OK")}</td></tr>`).join("")}</tbody></table><h2>Update cadence and repeated provider dates</h2><pre>${escape(JSON.stringify(cadence, null, 2))}</pre><p>Renewals: ${renewals.length}, failures: ${renewals.filter((r) => r.kind !== "renewed").length}. Reader closed: ${readerClosed}; PostgreSQL lease released: ${databaseReleased}.</p><a href="report.json">Full JSON</a> · <a href="report.csv">CSV</a> · <a href="events.jsonl">Bounded public capture</a></html>`,
    );
  };
  try {
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    scope = await study.initializeDiagnostic(config, id, {
      kind: "public-stability-v1",
      commit,
      cycles: count,
      durationMs: count * 60000,
      acquisitionPolicy: policy,
      transport: diagnostic ? "comparison" : policy === "stream-20s-v1" ? "websocket" : "rest",
    });
    lease = await study.claim(scope);
    const ownedScope = scope,
      ownedLease = lease;
    heartbeat = startLeaseHeartbeat({
      lease,
      renew: () => study.renew(ownedScope, ownedLease),
      diagnostic: (event) => {
        renewals.push(event);
        recordLocal(event);
      },
    });
    ownedLease.assertActive = heartbeat.assertActive;
    const signal = AbortSignal.any([parent, heartbeat.signal]);
    const guard = async () => {
      heartbeat!.assertActive();
      signal.throwIfAborted();
      await study.guard(ownedScope, ownedLease);
      heartbeat!.assertActive();
      signal.throwIfAborted();
      await writes;
    };
    const source = await study.view(config);
    const schedule = new PerplRequestSchedule();
    const agentScope = { tenantId: config.tenantId, agentId: source.record.agentIds.rules };
    let currentDiagnostics: AcquisitionDiagnostic[] = [],
      currentRequests: PerplRequestDiagnostic[] = [];
    const streamEvent = (event: import("@pickler/infrastructure").PerplStreamEvent) => {
      streamEvents.push({
        kind: event.kind,
        receivedAt: event.receivedAt,
        ...(event.code ? { code: event.code } : {}),
      });
      const bytes = Buffer.byteLength(JSON.stringify(event));
      if (streamBytes + bytes <= 32 * 1024 * 1024) {
        streamBytes += bytes;
        recordLocal(event);
      } else {
        captureTruncated = true;
      }
    };
    const rest = createPerplAcquisitionReader(research, {
      onStream: streamEvent,
      policy,
      schedule,
      guard,
      onAcquisition: (event) => currentDiagnostics.push(event),
      onDiagnostic: (event) => currentRequests.push(event),
      onResponse: async (response) => {
        const entry = { kind: "rest-response", ...response };
        const bytes = Buffer.byteLength(JSON.stringify(entry));
        if (streamBytes + bytes <= 32 * 1024 * 1024) {
          streamBytes += bytes;
          recordLocal(entry);
        } else {
          captureTruncated = true;
        }
      },
    });
    const websocket = diagnostic
      ? createPerplAcquisitionReader(research, {
          policy: "stream-20s-v1",
          schedule,
          guard,
          onAcquisition: (event) => wsDiagnostics.push(event),
          onStream: streamEvent,
        })
      : undefined;
    let wsDiagnostics: AcquisitionDiagnostic[] = [];
    readers = websocket ? [rest, websocket] : [rest];
    startedAt = Date.now();
    for (let slot = 0; slot < count; slot++) {
      const due = startedAt + slot * 60000;
      await wait(Math.max(0, due - Date.now()), undefined, { signal });
      const at = Date.now();
      currentDiagnostics = [];
      currentRequests = [];
      wsDiagnostics = [];
      const diagnostics = currentDiagnostics,
        requests = currentRequests;
      const transports: Record<
        string,
        {
          valid: boolean;
          code: string | null;
          firstValidMs: number | null;
          frames: PerpsPaperFrame[];
          diagnostics: AcquisitionDiagnostic[];
        }
      > = {};
      let code: string | null = null;
      if (at - due > 5000) {
        code = "MISSED_CYCLE";
        for (const name of diagnostic ? ["rest", "websocket"] : ["rest"]) {
          transports[name] = {
            valid: false,
            code,
            firstValidMs: null,
            frames: [],
            diagnostics: [],
          };
        }
      } else {
        const deadline = AbortSignal.timeout(Math.max(1, 20000 - (Date.now() - at)));
        const acquire = async (
          name: string,
          reader: ReturnType<typeof createPerplAcquisitionReader>,
          events: AcquisitionDiagnostic[],
        ) => {
          try {
            const frames = await reader.read(
              agentScope,
              ["BTC", "ETH"],
              signal,
              undefined,
              at + 20000,
            );
            transports[name] = {
              valid: true,
              code: null,
              firstValidMs: Date.now() - at,
              frames,
              diagnostics: events,
            };
          } catch (cause) {
            signal.throwIfAborted();
            const failure = deadline.aborted ? "DATA_UNAVAILABLE" : safeCode(cause);
            transports[name] = {
              valid: false,
              code: failure,
              firstValidMs: null,
              frames: [],
              diagnostics: events,
            };
            if (
              !["DATA_UNAVAILABLE", "PERPL_TRANSPORT_FAILURE"].includes(failure) &&
              !failure.startsWith("PERPL_STREAM_")
            ) {
              throw cause;
            }
          }
        };
        try {
          await Promise.all([
            acquire("rest", rest, diagnostics),
            ...(websocket ? [acquire("websocket", websocket, wsDiagnostics)] : []),
          ]);
          // Compare first valid acquisitions at the same reference instant, retaining their original dates.
          // Neither side gets a newer replacement snapshot after its counterpart has finished.
          const reference = Date.now();
          for (const result of Object.values(transports)) {
            if (!result.valid) {
              continue;
            }
            try {
              for (const frame of result.frames) {
                validatePaperFrame(frame, config.network, frame.snapshot.market.symbol, reference);
              }
            } catch (cause) {
              result.valid = false;
              result.code = safeCode(cause);
            }
          }
          code = transports.rest!.valid ? null : transports.rest!.code;
          await guard();
        } catch (cause) {
          signal.throwIfAborted();
          code = safeCode(cause);
        }
      }
      // Outside the market acquisition deadline, once per failed slot, never a price fallback.
      const acquisitionMs = Date.now() - at;
      let connectivityControl: ConnectivityControl | null = null;
      if (code === "DATA_UNAVAILABLE" && requests.some((request) => request.code !== null)) {
        connectivityControl = await checkPublicConnectivity({ signal, guard });
      }
      const cycle = {
        slot,
        at,
        durationMs: acquisitionMs,
        connectivityControl,
        valid: code === null,
        code,
        diagnostics,
        requests,
        transports,
      };
      cycles.push(cycle);
      await guard();
      await study.event(
        scope,
        lease,
        `cycle-${slot}`,
        diagnostic ? "transport-cycle" : "stability-cycle",
        cycle,
      );
      recordLocal(cycle);
      await render();
      console.log(
        JSON.stringify({
          slot,
          valid: cycle.valid,
          code,
          validCycles: cycles.filter((c) => c.valid).length,
        }),
      );
      if (code && !["DATA_UNAVAILABLE", "MISSED_CYCLE"].includes(code)) {
        throw new PilotError(code, "Stability stopped on a non-recoverable failure");
      }
    }
    await wait(Math.max(0, startedAt + count * 60000 - Date.now()), undefined, { signal });
    await guard();
    await study.complete(scope, lease);
    completed = true;
  } catch (cause) {
    error = safeCode(cause);
    recordLocal({ kind: "stopped", at: Date.now(), code: error });
  } finally {
    for (const reader of readers) {
      await reader.close();
    }
    readerClosed = true;
    await heartbeat?.stop();
    if (scope && lease) {
      await study
        .release(scope, lease)
        .then(async () => {
          const result = await research.pool.query(
            "SELECT owner IS NULL AS released FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
            [scope!.tenantId, scope!.sessionId, scope!.network],
          );
          databaseReleased = result.rows.length === 1 && result.rows[0].released === true;
          if (!databaseReleased) {
            error ??= "LEASE_RELEASE_FAILED";
          }
        })
        .catch(() => {
          error ??= "LEASE_RELEASE_FAILED";
        });
    }
    releaseAwake();
    await research.close().catch(() => {
      error ??= "DATABASE_CLOSE_FAILED";
    });
    await render();
  }
  console.log(JSON.stringify({ output, error }));
  if (error) {
    throw new PilotError(error, "Stability did not complete; inspect retained diagnostics");
  }
}
