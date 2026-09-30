import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
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
import { createCoherentPerplReader } from "@pickler/agent-runtime/plugins/perps-paper";
import { startLeaseHeartbeat, type LeaseDiagnostic } from "@pickler/trading/evaluation";
import type { AcquisitionDiagnostic } from "@pickler/trading/perps";
import { keepAwake } from "../paper-study/comparison-host.js";

const safeCode = (error: unknown) =>
  error instanceof PilotError ? error.code : "STABILITY_FAILED";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
export async function runPerpsStability(
  input: { configPath: string; envFile?: string; output?: string; allowPaid?: boolean },
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
  const id = `stability-${new Date().toISOString().replace(/[-:.]/g, "")}`;
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
      (["BTC", "ETH"] as const).map((symbol) => {
        const events = cycle.diagnostics.filter((event) => event.symbol === symbol);
        const initial = events[0];
        const final = events.at(-1);
        const reference = cycle.at + cycle.durationMs;
        return {
          slot: cycle.slot,
          symbol,
          jointValid: cycle.valid,
          code: cycle.code,
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
          acquisitionMs: cycle.durationMs,
          attempts: events.length,
        };
      }),
    );
    const report = {
      version: 2,
      kind: "perpl-public-stability",
      id,
      commit,
      config,
      dataPolicy: "coherent-20s-v1",
      startedAt,
      finishedAt: Date.now(),
      cycles,
      marketRows,
      renewals,
      validCycles,
      totalCycles: 30,
      paidCalls: 0,
      fills: 0,
      error,
      accepted:
        completed &&
        cycles.length === 30 &&
        validCycles >= 29 &&
        !error &&
        !renewals.some((r) => r.kind !== "renewed"),
    };
    await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    const csv = [
      "slot,symbol,joint_valid,market_valid,code,initial_skew_ms,final_skew_ms,ticker_at,book_at,duration_ms,attempts",
      ...marketRows.map((c) =>
        [
          c.slot,
          c.symbol,
          c.jointValid,
          c.valid,
          c.code ?? "",
          c.initialSkewMs ?? "",
          c.finalSkewMs ?? "",
          c.tickerAt ?? "",
          c.bookAt ?? "",
          c.acquisitionMs,
          c.attempts,
        ].join(","),
      ),
    ].join("\n");
    await writeFile(join(output, "report.csv"), csv + "\n");
    await writeFile(
      join(output, "report.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8"><title>Perpl public data stability</title><style>body{font:16px system-ui;margin:30px}pre{white-space:pre-wrap}</style><h1>Perpl public data stability</h1><p>${validCycles}/30 valid joint cycles. Acceptance: ${report.accepted}. Paid calls: 0. Virtual or real purchases: 0.</p><p>Public availability is not strategy profitability.</p><pre>${escape(JSON.stringify(report, null, 2))}</pre></html>`,
    );
  };
  try {
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    scope = await study.initializeDiagnostic(config, id, {
      kind: "public-stability-v1",
      commit,
      cycles: 30,
      durationMs: 1800000,
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
    startedAt = Date.now();
    for (let slot = 0; slot < 30; slot++) {
      const due = startedAt + slot * 60000;
      await wait(Math.max(0, due - Date.now()), undefined, { signal });
      const at = Date.now();
      const diagnostics: AcquisitionDiagnostic[] = [],
        requests: PerplRequestDiagnostic[] = [];
      let code: string | null = null;
      if (at - due > 5000) {
        code = "MISSED_CYCLE";
      } else {
        try {
          const read = createCoherentPerplReader(research, {
            schedule,
            guard,
            onAcquisition: (event) => diagnostics.push(event),
            onDiagnostic: (event) => requests.push(event),
          });
          const frames = await read(
            { tenantId: config.tenantId, agentId: source.record.agentIds.rules },
            ["BTC", "ETH"],
            signal,
          );
          await guard();
          await study.event(scope, lease, `cycle-${slot}`, "stability-cycle", {
            slot,
            at,
            frames,
            diagnostics,
            requests,
          });
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
      };
      cycles.push(cycle);
      await guard();
      if (code) {
        await study.event(scope, lease, `cycle-${slot}`, "stability-cycle", cycle);
      }
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
    await wait(Math.max(0, startedAt + 1800000 - Date.now()), undefined, { signal });
    await guard();
    await study.complete(scope, lease);
    completed = true;
  } catch (cause) {
    error = safeCode(cause);
    recordLocal({ kind: "stopped", at: Date.now(), code: error });
  } finally {
    await heartbeat?.stop();
    if (scope && lease) {
      await study.release(scope, lease).catch(() => {
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
