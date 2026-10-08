import { readFile, mkdir, writeFile, appendFile, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { localStudyDatabase } from "./database-env.js";
import { Worker } from "node:worker_threads";
import { createPriorityPerplStudyData } from "@pickler/agent-runtime/plugins/perps-paper";
import { timingReport } from "./timing-report.js";
import { createReportQueue } from "./report-queue.js";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
  exportPerpsAudit,
  timeEvaluationPool,
} from "@pickler/infrastructure";
import {
  assertPerpsStudyConfig,
  SMA_PROFILES,
  SELECTIVE_RISK,
  createProfileStudyRunner,
  canonicalAudit,
  type PerpsSmaReentryConfig,
  reentryCoverage,
  SMA_ENTRY_POLICIES,
  type EvaluationCommand,
} from "@pickler/trading/evaluation";
import { validatePaperFrame } from "@pickler/trading/perps";
import { keepAwake } from "../paper-study/comparison-host.js";

import { perpsStudyReport } from "./report.js";
import type { renderProfileReport } from "./profiles-report.js";
import { closeProfileResources } from "./profiles-resources.js";

/** Only local PostgreSQL and public Perpl data are composed; no model or signer imports. */
export async function runSmaReentry(
  input: {
    command: EvaluationCommand;
    configPath: string;
    envFile?: string;
    output?: string;
    allowPaid?: boolean;
    qualification?: string;
  },
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  if (input.allowPaid || !input.envFile || !input.output) {
    throw new PilotError(
      "INVALID_INPUT",
      "SMA profiles requires --env-file and --output; paid calls are forbidden",
    );
  }
  const configText = await readFile(resolve(input.configPath), "utf8");
  const config = JSON.parse(configText) as PerpsSmaReentryConfig;
  assertPerpsStudyConfig(config);
  if (config.version !== 7) {
    throw new PilotError("INVALID_INPUT", "SMA profiles protocol required");
  }
  const url = await localStudyDatabase(resolve(input.envFile));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const metadata = {
    commit,
    originalCommit: "a06826a78af44aacdcac695f8254c52d65f83342",
    acquisitionPolicy: "rest-universe-20s-v1",
    strategy: {
      id: "sma-reentry-latency-v1",
      version: "1.0.0",
      candles: "1h/15m/5m",
      decisionsMinutes: 5,
      maxHoldingHours: 4,
    },
    profiles: { hourly: SMA_PROFILES.hourly },
    entryPolicies: SMA_ENTRY_POLICIES,
    timingVersion: 1,
    baselineCommit: "0364706b90d85f845d2bf4d32ab846678b0edd40",
    selectiveRisk: SELECTIVE_RISK,
    catalogHash: createHash("sha256").update(canonicalAudit(config.markets)).digest("hex"),
    configurationHash: createHash("sha256").update(canonicalAudit(config)).digest("hex"),
    modelCalls: 0,
    modelReservationsUSD: "0",
  };
  if (input.command === "run") {
    if (!input.qualification) {
      throw new PilotError(
        "QUALIFICATION_REQUIRED",
        "A successful eleven-market public qualification is required",
      );
    }
    const proof = JSON.parse(await readFile(resolve(input.qualification), "utf8")) as {
      protocol: string;
      passed: boolean;
      commit: string;
      configurationHash: string;
      validCycles: number;
      ownershipFailures: number;
      leaseReleased: boolean;
      cycles: unknown[];
    };
    if (
      proof.protocol !== "perps-universe-stability-v1" ||
      !proof.passed ||
      proof.commit !== commit ||
      proof.configurationHash !== metadata.configurationHash ||
      proof.validCycles < 29 ||
      proof.cycles.length !== 30 ||
      proof.ownershipFailures !== 0 ||
      !proof.leaseReleased
    ) {
      throw new PilotError(
        "QUALIFICATION_REQUIRED",
        "Qualification must match frozen code and configuration and meet capture acceptance",
      );
    }
    if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) {
      throw new PilotError("DIRTY_CHECKOUT", "Freeze tested clean code before running");
    }
  }
  const research = new PostgresResearchStore(url);

  const output = resolve(input.output);
  await mkdir(output, { recursive: true, mode: 0o700 });
  let diagnostics = Promise.resolve();
  const diagnostic = (value: unknown) => {
    diagnostics = diagnostics.then(() =>
      appendFile(join(output, "diagnostics.jsonl"), JSON.stringify(value) + "\n", { mode: 0o600 }),
    );
    void diagnostics.catch(() =>
      controller.abort(new PilotError("PERSISTENCE_FAILED", "Local diagnostics failed")),
    );
  };
  const pool = timeEvaluationPool(
    research.pool,
    diagnostic,
    () => `${config.sessionId}:minute-${Math.floor(Date.now() / 60000)}`,
  );
  const study = new PostgresPerpsStudyStore(pool);
  const paper = new PostgresPerpsPaperStore(pool);
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new PilotError("OPERATOR_INTERRUPTED", "Operator interrupted SMA profiles"));
  signal.addEventListener("abort", interrupt, { once: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const combined = AbortSignal.any([signal, controller.signal]);
  const data = createPriorityPerplStudyData(research, {
    onDiagnostic: (value) =>
      diagnostic({
        ...value,
        cycle: `${config.sessionId}:minute-${Math.floor(Date.now() / 60000)}`,
      }),
    onAcquisition: (value) =>
      diagnostic({
        ...value,
        cycle: `${config.sessionId}:minute-${Math.floor(Date.now() / 60000)}`,
      }),
    onTiming: diagnostic,
    onValidation: (value) =>
      diagnostic({
        ...value,
        at: Date.now(),
        cycle: `${config.sessionId}:minute-${Math.floor(Date.now() / 60000)}`,
      }),
  });
  let releaseAwake = () => {};
  let processState = "idle";
  let primaryFailure = false;
  const report = async () => {
    const snapshot = await exportPerpsAudit(pool, config);
    const measured = perpsStudyReport(snapshot.study, snapshot.accounts);
    let state = processState;
    if (["report", "status"].includes(input.command)) {
      state = "process-unverified";
      if (snapshot.study.record.status === "completed") {
        state = "finished";
      } else if (snapshot.study.record.status === "interrupted") {
        state = "interrupted";
      }
    }
    const result = {
      ...measured,
      status: state === "interrupted" ? ("interrupted" as const) : measured.status,
      processState: state,
      reportCommit: commit,
      generatedAt: Date.now(),
    };
    const started = performance.now();
    const rendered = await new Promise<ReturnType<typeof renderProfileReport>>(
      (resolve, reject) => {
        const worker = new Worker(new URL("./reentry-report-worker.mjs", import.meta.url), {
          workerData: { snapshot, summary: result, state },
        });
        let delivered = false;
        worker.once("message", (value) => {
          delivered = true;
          resolve(value);
        });
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code !== 0 || !delivered) {
            reject(new PilotError("REPORT_FAILED", "Report worker exited without output"));
          }
        });
      },
    );
    const coverage = reentryCoverage(snapshot.study, snapshot.accounts);
    await diagnostics;
    const times = timingReport(
      await readFile(join(output, "diagnostics.jsonl"), "utf8").catch(
        (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") {
            return "";
          }
          throw e;
        },
      ),
    );
    diagnostic({
      version: 1,
      cycle: `report-${result.generatedAt}`,
      operation: "report-generation",
      at: Date.now(),
      durationMs: performance.now() - started,
    });
    const coverageHtml = `<section><h2>Operational qualification</h2><pre>${JSON.stringify(coverage, null, 2).replaceAll("<", "&lt;")}</pre><p>Both portfolios use the improved execution. P&amp;L differences describe the reopening rule, not latency. Six hours are exploratory; a smaller negative result is a reduction in losses.</p></section>`;
    for (const [name, content] of Object.entries({
      "report.json": JSON.stringify(result, null, 2) + "\n",
      "report.html": rendered.html.replace(
        "<h1>SMA profiles and selective risk</h1>",
        "<h1>SMA reopening comparison</h1>" +
          coverageHtml +
          `<section><h2>Measured phase durations</h2><pre>${JSON.stringify(times.operations, null, 2)}</pre><p>Durations use a monotonic clock. Historical component timings absent from evidence remain unverifiable. Detection is the first observed condition, not the time the market crossed a stop.</p><a href="timings.csv">Detailed timing CSV</a></section>`,
      ),
      "coverage.json": JSON.stringify(coverage, null, 2) + "\n",
      "timings.json": JSON.stringify(times, null, 2) + "\n",
      "timings.csv": times.csv,
      "report.csv": rendered.csv,
      "rounds.csv": rendered.roundsCsv,
      "decisions.json": JSON.stringify(rendered.rows, null, 2) + "\n",
      "executions.json": JSON.stringify(rendered.executions, null, 2) + "\n",
      "executions.csv": rendered.executionsCsv,
      "observations.json": JSON.stringify(rendered.observations, null, 2) + "\n",
      "observations.csv": rendered.observationsCsv,
      "comparisons.json":
        JSON.stringify(
          { comparisons: rendered.comparisons, riskSummary: rendered.riskSummary },
          null,
          2,
        ) + "\n",
    })) {
      const temporary = join(output, name + ".tmp");
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, join(output, name));
    }
  };
  const reports = createReportQueue(report, () =>
    controller.abort(new PilotError("REPORT_FAILED", "Report generation failed")),
  );
  const compact = async (value: unknown) => {
    const temporary = join(output, "runtime-status.json.tmp");
    await writeFile(
      temporary,
      JSON.stringify({
        processState,
        at: Date.now(),
        modelCalls: 0,
        modelCostUSD: "0",
        observation: value,
      }) + "\n",
      { mode: 0o600 },
    );
    await rename(temporary, join(output, "runtime-status.json"));
  };
  try {
    if (input.command === "prepare") {
      await study.initialize(config, metadata);
      await report();
      console.log(
        JSON.stringify({
          status: "prepared",
          agents: ["sma-reference", "sma-once-bar"],
          modelCalls: 0,
        }),
      );
      return;
    }
    if (["report", "status"].includes(input.command)) {
      await report();
      console.log(JSON.stringify({ output }));
      return;
    }
    if (input.command === "stop") {
      await study.stop(config);
      return;
    }
    const view = await study.initialize(config, metadata);
    if (input.command === "preflight") {
      const evidence = await data.prepareEvidence!(view.record, combined, async () => {});
      for (const frame of evidence.frames) {
        validatePaperFrame(frame, config.network, frame.snapshot.market.symbol, Date.now());
      }
      console.log(
        JSON.stringify({
          status: "public-data-verified",
          candles: evidence.candles.map((c) => ({
            symbol: c.market.symbol,
            count: c.candles.length,
          })),
          modelCalls: 0,
        }),
      );
      return;
    }
    if (input.command !== "run" || view.record.startedAt !== null) {
      throw new PilotError(
        "STUDY_ALREADY_STARTED",
        "Only one SMA profiles run is allowed; no restart or resume",
      );
    }
    let reportedProgress = "";
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    processState = "active";
    await createProfileStudyRunner({
      study,
      paper,
      data,
      paperForLease: (scope, lease, ownedSignal) =>
        new PostgresPerpsPaperStore(pool, undefined, {
          ...scope,
          owner: lease.owner,
          ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
          signal: ownedSignal,
        }),
      leaseDiagnostic: diagnostic,
      timing: diagnostic,
      afterObservation: compact,
      afterCycle: async () => {
        if (
          (await readFile(resolve(input.configPath), "utf8")) !== configText ||
          execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== commit
        ) {
          throw new PilotError("CONFIG_CHANGED", "Frozen code or configuration changed");
        }
        const current = await study.view(config);
        processState =
          current.record.status === "completed"
            ? "finished"
            : Date.now() >= current.record.endsAt! ||
                current.record.stopRequested ||
                current.record.decisionStopReason
              ? "closing"
              : "active";
        const progress = JSON.stringify([
          processState,
          current.rounds.map((r) => [r.key, r.executionStatus]),
          current.events
            .filter((e) => ["data-unavailable", "slot-missed"].includes(e.kind))
            .map((e) => e.key),
        ]);
        if (progress !== reportedProgress) {
          reportedProgress = progress;
          reports.request();
        }
      },
    }).run(config, combined);
    processState = "finished";
    reports.request();
    await reports.flush();
    await compact({ state: "completed" });
  } catch (error) {
    primaryFailure = true;
    processState = "interrupted";
    reports.request();
    await reports.flush().catch(() => {});
    await writeFile(
      join(output, "runtime-status.json"),
      JSON.stringify(
        {
          processState,
          at: Date.now(),
          error: error instanceof PilotError ? error.code : "STUDY_OPERATION_FAILED",
          modelCalls: 0,
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    ).catch(() => {});
    throw error;
  } finally {
    const cleanupFailures = await closeProfileResources([
      () => releaseAwake(),
      () => signal.removeEventListener("abort", interrupt),
      () => {
        process.removeListener("SIGINT", interrupt);
      },
      () => {
        process.removeListener("SIGTERM", interrupt);
      },
      () => reports.flush(),
      () => data.close(),
      () => diagnostics,
      () => research.close(),
    ]);
    if (cleanupFailures.length && !primaryFailure) {
      await writeFile(
        join(output, "runtime-status.json"),
        JSON.stringify({
          processState: "interrupted",
          phase: "cleanup",
          error: "RESOURCE_CLEANUP_FAILED",
          cleanupFailures,
          at: Date.now(),
          modelCalls: 0,
        }) + "\n",
        { mode: 0o600 },
      ).catch(() => {});
      throw new PilotError("RESOURCE_CLEANUP_FAILED", "SMA profile resource cleanup failed");
    }
  }
}
