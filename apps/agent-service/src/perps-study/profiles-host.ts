import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { PilotError } from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
  exportPerpsAudit,
} from "@pickler/infrastructure";
import {
  assertPerpsStudyConfig,
  SMA_PROFILES,
  SELECTIVE_RISK,
  createProfileStudyRunner,
  canonicalAudit,
  type PerpsSmaProfileConfig,
  type EvaluationCommand,
} from "@pickler/trading/evaluation";
import { validatePaperFrame } from "@pickler/trading/perps";
import { keepAwake } from "../paper-study/comparison-host.js";
import { createProfileStudyData } from "./profiles-data.js";
import { perpsStudyReport } from "./report.js";
import { renderProfileReport } from "./profiles-report.js";
import { closeProfileResources } from "./profiles-resources.js";

/** Only local PostgreSQL and public Perpl data are composed; no model or signer imports. */
export async function runSmaProfiles(
  input: {
    command: EvaluationCommand;
    configPath: string;
    envFile?: string;
    output?: string;
    allowPaid?: boolean;
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
  const config = JSON.parse(configText) as PerpsSmaProfileConfig;
  assertPerpsStudyConfig(config);
  if (config.version !== 6) {
    throw new PilotError("INVALID_INPUT", "SMA profiles protocol required");
  }
  const url = parse(await readFile(resolve(input.envFile), "utf8")).DATABASE_URL;
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new PilotError("INVALID_INPUT", "Explicit local PostgreSQL required");
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const metadata = {
    commit,
    originalCommit: "a06826a78af44aacdcac695f8254c52d65f83342",
    acquisitionPolicy: "rest-universe-20s-v1",
    strategy: {
      id: "profile-risk-paired-v1",
      version: "1.0.0",
      candles: "1h/15m/5m",
      decisionsMinutes: 5,
      maxHoldingHours: 4,
    },
    profiles: SMA_PROFILES,
    selectiveRisk: SELECTIVE_RISK,
    catalogHash: createHash("sha256").update(canonicalAudit(config.markets)).digest("hex"),
    configurationHash: createHash("sha256").update(canonicalAudit(config)).digest("hex"),
    modelCalls: 0,
    modelReservationsUSD: "0",
  };
  const research = new PostgresResearchStore(url);
  const study = new PostgresPerpsStudyStore(research.pool);
  const paper = new PostgresPerpsPaperStore(research.pool);
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
  const controller = new AbortController();
  const interrupt = () =>
    controller.abort(new PilotError("OPERATOR_INTERRUPTED", "Operator interrupted SMA profiles"));
  signal.addEventListener("abort", interrupt, { once: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const combined = AbortSignal.any([signal, controller.signal]);
  const data = createProfileStudyData(research, {
    onDiagnostic: diagnostic,
    onAcquisition: diagnostic,
  });
  let releaseAwake = () => {};
  let processState = "idle";
  let primaryFailure = false;
  const report = async () => {
    const snapshot = await exportPerpsAudit(research.pool, config);
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
    const rendered = renderProfileReport(snapshot, result, state);
    for (const [name, content] of Object.entries({
      "report.json": JSON.stringify(result, null, 2) + "\n",
      "report.html": rendered.html,
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
      const { rename } = await import("node:fs/promises");
      await rename(temporary, join(output, name));
    }
    await writeFile(
      join(output, "runtime-status.json"),
      JSON.stringify(
        {
          processState: state,
          studyStatus: result.status,
          rounds: result.rounds,
          at: Date.now(),
          endsAt: result.endsAt,
          modelCalls: 0,
          modelCostUSD: "0",
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
  };
  try {
    if (input.command === "prepare") {
      await study.initialize(config, metadata);
      await report();
      console.log(
        JSON.stringify({
          status: "prepared",
          agents: ["hourly-legacy", "hourly-selective", "fast-legacy", "fast-selective"],
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
      const observation = await data.observe(view.record, combined);
      const evidence = await data.evidence(view.record, observation, combined);
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
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    processState = "active";
    await createProfileStudyRunner({
      study,
      paper,
      data,
      paperForLease: (scope, lease, ownedSignal) =>
        new PostgresPerpsPaperStore(research.pool, undefined, {
          ...scope,
          owner: lease.owner,
          ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
          signal: ownedSignal,
        }),
      leaseDiagnostic: diagnostic,
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
        await report();
      },
    }).run(config, combined);
    processState = "finished";
    await report();
  } catch (error) {
    primaryFailure = true;
    processState = "interrupted";
    await report().catch(() => {});
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
