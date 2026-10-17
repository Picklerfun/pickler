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
  createPerpsStudyRunner,
  canonicalAudit,
  type PerpsOriginalSmaConfig,
  type EvaluationCommand,
} from "@pickler/trading/evaluation";
import { validatePaperFrame } from "@pickler/trading/perps";
import { keepAwake } from "../paper-study/comparison-host.js";
import { createStudyData } from "./data.js";
import { perpsStudyReport, renderPerpsReport } from "./report.js";

/** Only local PostgreSQL and public Perpl data are composed; no model or signer imports. */
export async function runOriginalSma(
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
      "Original SMA requires --env-file and --output; paid calls are forbidden",
    );
  }
  const configText = await readFile(resolve(input.configPath), "utf8");
  const config = JSON.parse(configText) as PerpsOriginalSmaConfig;
  assertPerpsStudyConfig(config);
  if (config.version !== 3) {
    throw new PilotError("INVALID_INPUT", "Original SMA protocol required");
  }
  const url = parse(await readFile(resolve(input.envFile), "utf8")).DATABASE_URL;
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new PilotError("INVALID_INPUT", "Explicit local PostgreSQL required");
  }
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const metadata = {
    commit,
    originalCommit: "760ad3eae3001ee8ca81d02b4356f6065782db5e",
    acquisitionPolicy: "rest-paced-20s-v1",
    strategy: {
      id: "rules",
      version: "1.0.0",
      candles: "1h",
      decisionsMinutes: 15,
      maxHoldingHours: 4,
    },
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
    controller.abort(new PilotError("OPERATOR_INTERRUPTED", "Operator interrupted original SMA"));
  signal.addEventListener("abort", interrupt, { once: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const combined = AbortSignal.any([signal, controller.signal]);
  const data = createStudyData(paper, research, {
    onDiagnostic: diagnostic,
    onAcquisition: diagnostic,
  });
  let releaseAwake = () => {};
  let processState = "idle";
  const report = async () => {
    const snapshot = await exportPerpsAudit(research.pool, config);
    const measured = perpsStudyReport(snapshot.study, snapshot.accounts);
    const result = {
      ...measured,
      status: processState === "interrupted" ? ("interrupted" as const) : measured.status,
      processState,
      generatedAt: Date.now(),
    };
    const rendered = renderPerpsReport(result, processState);
    for (const [name, content] of Object.entries({
      "report.json": JSON.stringify(result, null, 2) + "\n",
      "report.html": rendered.html,
      "report.csv": rendered.csv,
      "rounds.csv": rendered.roundsCsv,
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
          processState,
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
      console.log(JSON.stringify({ status: "prepared", agents: ["rules"], modelCalls: 0 }));
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
        "Only one original SMA run is allowed; no restart or resume",
      );
    }
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    processState = "active";
    await createPerpsStudyRunner({
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
    releaseAwake();
    signal.removeEventListener("abort", interrupt);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await data.close();
    await diagnostics;
    await research.close();
  }
}
