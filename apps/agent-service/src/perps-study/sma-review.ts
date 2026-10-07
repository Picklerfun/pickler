import {
  createSmaReviewModels,
  smaReviewDefinition,
} from "@pickler/agent-runtime/composition/sma-review-model";
import { syntheticSmaContext } from "./sma-review-contract.js";
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
  type PerpsSmaReviewConfig,
  type EvaluationCommand,
} from "@pickler/trading/evaluation";
import { paperUnits, paperDecimal } from "@pickler/trading/perps";
import { validatePaperFrame } from "@pickler/trading/perps";
import { keepAwake } from "../paper-study/comparison-host.js";
import { createStudyData } from "./data.js";
import { perpsStudyReport, renderPerpsReport } from "./report.js";

/** Operator-only local comparison. Read-only commands never construct paid clients. */
export async function runSmaReview(
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
  if (!input.envFile || !input.output) {
    throw new PilotError("INVALID_INPUT", "SMA review requires --env-file and --output");
  }
  const configText = await readFile(resolve(input.configPath), "utf8");
  const config = JSON.parse(configText) as PerpsSmaReviewConfig;
  assertPerpsStudyConfig(config);
  if (config.version !== 4) {
    throw new PilotError("INVALID_INPUT", "SMA review protocol required");
  }
  const environment = parse(await readFile(resolve(input.envFile), "utf8"));
  const url = environment.DATABASE_URL;
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
    reviewer: smaReviewDefinition,
    spendingAuthorization: config.authorization,
    historicalAccountedOrReservedUSD: config.historicalAccountedOrReservedUSD,
    historicalUnknownReservations: config.historicalUnknownReservations,
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
    controller.abort(new PilotError("OPERATOR_INTERRUPTED", "Operator interrupted SMA comparison"));
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
    let contract: ReturnType<typeof perpsStudyReport> | null = null;
    try {
      const check = await exportPerpsAudit(research.pool, {
        ...config,
        sessionId: config.sessionId + "-check",
      });
      contract = perpsStudyReport(check.study, check.accounts);
    } catch (error) {
      if (!(error instanceof PilotError && error.code === "NOT_FOUND")) {
        throw error;
      }
    }
    const combinedProviderUSD = paperDecimal(
      paperUnits(measured.accountedOrReservedUSD) +
        paperUnits(contract?.accountedOrReservedUSD ?? "0"),
    );
    const contractAccounting = contract
      ? {
          accountedOrReservedUSD: contract.accountedOrReservedUSD,
          unknownCalls: contract.unknownCalls,
          rows: contract.rows,
          calls: contract.roundDetails,
        }
      : null;
    const result = {
      ...measured,
      contractAccounting,
      combinedProviderAccountedOrReservedUSD: combinedProviderUSD,
      limitations: [
        ...measured.limitations,
        `Contract checks plus prospective provider accounting: USD ${combinedProviderUSD}. Historical campaign total is ${config.historicalAccountedOrReservedUSD === null ? "not verifiable from the recovered database; retained historical unknown reservations remain recorded" : config.historicalAccountedOrReservedUSD}.`,
      ],
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
    if (processState !== "idle") {
      await writeFile(
        join(output, "runtime-status.json"),
        JSON.stringify(
          {
            processState,
            studyStatus: result.status,
            rounds: result.rounds,
            at: Date.now(),
            endsAt: result.endsAt,
            modelCalls: result.rows.reduce((s, r) => s + r.modelCalls, 0),
            providerAccountedOrReservedUSD: result.combinedProviderAccountedOrReservedUSD,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
    }
  };
  try {
    if (input.command === "prepare") {
      await study.initialize(config, metadata);
      await report();
      console.log(
        JSON.stringify({
          status: "prepared",
          agents: ["rules", "sma-jev", "sma-exa-jev"],
          paidCalls: 0,
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
        }),
      );
      return;
    }
    if (["run", "validate"].includes(input.command)) {
      if (!input.allowPaid || !environment.TYPESAFE_API_KEY || !environment.EXA_API_KEY) {
        throw new PilotError(
          "PLUGIN_NOT_CONFIGURED",
          "Explicit paid opt-in and Jev/Exa credentials required",
        );
      }
    }
    const modelsFor = (record: typeof view.record) =>
      createSmaReviewModels(
        config,
        { jev: environment.TYPESAFE_API_KEY ?? "", exa: environment.EXA_API_KEY ?? "" },
        {
          exa: async () => {
            combined.throwIfAborted();
            const agent = await research.agent({
              tenantId: config.tenantId,
              agentId: record.agentIds["sma-exa-jev"]!,
            });
            if (
              agent.paused ||
              agent.version !== record.agentVersions["sma-exa-jev"] ||
              !agent.config.plugins?.enabled.includes("exa") ||
              !agent.config.tools.includes("searchWeb")
            ) {
              throw new PilotError("PLUGIN_DISABLED", "Exa permission revoked");
            }
          },
          review: async () => {
            combined.throwIfAborted();
          },
        },
      );
    if (input.command === "validate") {
      const marker = join(output, "CONTRACT_STARTED");
      await writeFile(marker, new Date().toISOString(), { flag: "wx", mode: 0o600 });
      const probeConfig = { ...config, sessionId: config.sessionId + "-check" };
      assertPerpsStudyConfig(probeConfig);
      const probe = await study.initialize(probeConfig, {
        ...metadata,
        purpose: "contracts-sma-v1",
      });
      const lease = await study.claim(probeConfig);
      const synthetic = () => syntheticSmaContext(Date.now()).evidence;
      const live = modelsFor(probe.record);
      const contractModels = {
        ...live,
        news: async (...args: Parameters<typeof live.news>) => {
          const result = await live.news(...args);
          await writeFile(
            join(output, "exa-contract-source.json"),
            JSON.stringify(result, null, 2) + "\n",
            { mode: 0o600 },
          );
          return {
            sources: [],
            excluded: result.sources.map((s) => ({
              id: s.id,
              reason: "LIVE_NEWS_EXCLUDED_FROM_SYNTHETIC_CONTRACT",
            })),
            cutoff: args[0].evidence.observedAt,
          };
        },
      };
      const runner = createPerpsStudyRunner({
        study,
        paper,
        smaModels: contractModels,
        data: {
          observe: async () => {
            const e = synthetic();
            return {
              frames: e.frames,
              funding: e.frames.map((f) => ({
                market: f.book.market,
                from: probe.record.createdAt,
                to: Date.now(),
                complete: true,
                events: [],
                pages: [f.book.provenance],
              })),
            };
          },
          evidence: async () => synthetic(),
          execution: async () => synthetic().frames,
        },
        paperForLease: (scope, l, ownedSignal) =>
          new PostgresPerpsPaperStore(research.pool, undefined, {
            ...scope,
            owner: l.owner,
            signal: ownedSignal,
          }),
      });
      try {
        await runner.cycle(probeConfig, lease, combined);
        const saved = await study.view(probeConfig);
        if (
          saved.rounds[0]?.executionStatus !== "complete" ||
          saved.rounds[0].status !== "completed"
        ) {
          throw new PilotError(
            "CONTRACT_FAILED",
            "Paid contract failed; no prospective run authorized",
          );
        }
        for (const id of Object.values(probe.record.agentIds)) {
          const account = await paper.view({ ...probeConfig, agentId: id });
          if (account.account.positions.filter((p) => p.closedAt === null).length !== 2) {
            throw new PilotError("CONTRACT_VETO_UNEXPECTED", "Coherent synthetic openings blocked");
          }
        }
        await study.stop(probeConfig);
        await runner.cycle(probeConfig, lease, combined);
        for (const id of Object.values(probe.record.agentIds)) {
          if (
            (await paper.view({ ...probeConfig, agentId: id })).account.positions.some(
              (p) => p.closedAt === null,
            )
          ) {
            throw new PilotError("CONTRACT_FAILED", "Synthetic positions not closed");
          }
        }
        await writeFile(
          join(output, "contract-checks.json"),
          JSON.stringify(
            {
              passed: true,
              configurationHash: metadata.configurationHash,
              commit,
              probe: probeConfig.sessionId,
              paidCalls: 3,
              synthetic: true,
              actualExaNewsExcludedFromSyntheticReviewer: true,
            },
            null,
            2,
          ) + "\n",
          { mode: 0o600 },
        );
      } finally {
        await study.release(probeConfig, lease);
      }
      await report();
      return;
    }
    if (input.command === "run") {
      const checks = JSON.parse(await readFile(join(output, "contract-checks.json"), "utf8"));
      if (
        !checks.passed ||
        checks.configurationHash !== metadata.configurationHash ||
        checks.commit !== commit
      ) {
        throw new PilotError("CONTRACT_REQUIRED", "Frozen paid contract checks required");
      }
    }
    if (input.command !== "run" || view.record.startedAt !== null) {
      throw new PilotError(
        "STUDY_ALREADY_STARTED",
        "Only one SMA comparison is allowed; no restart or resume",
      );
    }
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    processState = "active";
    await createPerpsStudyRunner({
      study,
      paper,
      data,
      smaModels: modelsFor(view.record),
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
