import { Worker } from "node:worker_threads";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { PilotError } from "@pickler/core";
import { localStudyDatabase } from "../perps-study/database-env.js";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
  exportPerpsAudit,
} from "@pickler/infrastructure/perps-lab";
import { createPriorityPerplStudyData } from "@pickler/agent-runtime/plugins/perps-paper/public-study";
import { createProfileStudyRunner } from "@pickler/trading/evaluation";
import {
  inspectPtsHistory,
  PTS_POLICY,
  PTS_VARIANTS,
  type PerpsPtsConfig,
  type PtsReplayInput,
} from "@pickler/trading/pts";
import { keepAwake } from "../paper-study/comparison-host.js";
import { createReportQueue } from "../perps-study/report-queue.js";
import { digest, commit, newDirectory, publish, refuseSecrets } from "./files.js";
import type { PtsCommandInput } from "./index.js";
export async function prepareDatabase(config: PerpsPtsConfig, envFile: string, metadata: unknown) {
  const research = new PostgresResearchStore(await localStudyDatabase(resolve(envFile)));
  try {
    const study = new PostgresPerpsStudyStore(research.pool),
      paper = new PostgresPerpsPaperStore(research.pool);
    const view = await study.initialize(config, metadata);
    if (view.record.startedAt !== null) {
      throw new PilotError(
        "STUDY_ALREADY_STARTED",
        "Preparation cannot replace a started PTS study",
      );
    }
    for (const v of PTS_VARIANTS) {
      await paper.initialize(
        { ...config, agentId: view.record.agentIds[v]! },
        view.record.agentVersions[v]!,
      );
    }
  } finally {
    await research.close();
  }
}
export async function runPtsHost(
  input: PtsCommandInput & {
    config: PerpsPtsConfig;
    configText: string;
    packet: {
      history: PtsReplayInput;
      historyHash: string;
      policyHash: string;
      fatalCode?: string | null;
    };
  },
) {
  if (!input.envFile || !input.output) {
    throw new PilotError("INVALID_INPUT", "Dedicated local PostgreSQL file and --output required");
  }
  const configuration = input.config,
    output = resolve(input.output);
  const coverage = input.packet.history.markets.map((h) => ({
    symbol: h.market.symbol,
    analysis: inspectPtsHistory(h, input.packet.history.to),
  }));
  const eligible = coverage
    .filter(
      (c) =>
        c.analysis.validationStatus === "VALID" && c.analysis.coverage.every((v) => v.eligible),
    )
    .map((c) => c.symbol);
  if (
    ["preflight", "run"].includes(input.command) &&
    (!eligible.length || input.packet.fatalCode)
  ) {
    throw new PilotError(
      "PTS_NO_ELIGIBLE_MARKETS",
      "Perpl history does not satisfy the frozen requirements for any market; public trial disabled",
    );
  }
  if (
    input.command === "run" &&
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
  ) {
    throw new PilotError(
      "DIRTY_CHECKOUT",
      "Freeze a clean tested commit before the explicit future run",
    );
  }
  const research = new PostgresResearchStore(await localStudyDatabase(resolve(input.envFile)));
  const study = new PostgresPerpsStudyStore(research.pool);
  const controller = new AbortController(),
    signal = AbortSignal.any([input.signal, controller.signal]);
  let primaryError: unknown;
  let state = "process-unverified";
  let releaseAwake = () => {},
    data: ReturnType<typeof createPriorityPerplStudyData> | undefined,
    reports: ReturnType<typeof createReportQueue> | undefined;
  try {
    if (input.command === "audit-export") {
      const dir = await newDirectory(input.output),
        payload = await exportPerpsAudit(research.pool, configuration);
      refuseSecrets(payload);
      const packet = {
        version: 1,
        protocol: "perps-decision-audit-export-v1",
        exportCommit: commit(),
        payload,
        payloadHash: digest(payload),
      };
      await publish(dir, { "export.json": JSON.stringify(packet, null, 2) + "\n" });
      return;
    }
    const view = await study.view(configuration);
    if (digest(view.record.config) !== digest(configuration)) {
      throw new PilotError("CONFIG_CHANGED", "Database study configuration differs");
    }
    if (input.command === "preflight") {
      if (view.record.startedAt !== null) {
        throw new PilotError("STUDY_ALREADY_STARTED", "Preflight cannot authorize a restart");
      }
      for (const variant of PTS_VARIANTS) {
        const agent = await research.agent({
          tenantId: configuration.tenantId,
          agentId: view.record.agentIds[variant]!,
        });
        if (
          agent.paused ||
          agent.version !== view.record.agentVersions[variant] ||
          agent.config.perpl?.network !== configuration.network
        ) {
          throw new PilotError("CONFIG_CHANGED", "Prepared public permission differs");
        }
      }
      const saved = await exportPerpsAudit(research.pool, configuration);
      if (
        saved.accounts["pts-basic"]?.account.positionPolicy !== "pts-basic-1x-0.2.0" ||
        saved.accounts["sma-reference"]?.account.positionPolicy !== undefined
      ) {
        throw new PilotError("CONFIG_CHANGED", "Independent account policies differ");
      }
      await mkdir(output, { recursive: true, mode: 0o700 });
      await publish(output, {
        "preflight.json":
          JSON.stringify(
            {
              status: "prepared-not-started",
              commit: commit(),
              configHash: digest(configuration),
              eligible,
              coverage,
              publicRequests: 0,
              modelCalls: 0,
              policyHash: digest(PTS_POLICY),
            },
            null,
            2,
          ) + "\n",
      });
      return;
    }
    if (input.command === "stop") {
      await study.stop(configuration);
      return;
    }
    await mkdir(output, { recursive: true, mode: 0o700 });
    state =
      input.command === "run"
        ? "active"
        : view.record.startedAt === null
          ? "prepared"
          : view.record.status === "completed"
            ? "finished"
            : view.record.status === "interrupted"
              ? "interrupted"
              : view.record.decisionStopReason ||
                  view.record.stopRequested ||
                  Date.now() >= view.record.endsAt!
                ? "closing"
                : "process-unverified";
    const report = async () => {
      const snapshot = await exportPerpsAudit(research.pool, configuration);
      await new Promise<void>((resolveWorker, rejectWorker) => {
        const worker = new Worker(new URL("./report-worker.mjs", import.meta.url), {
          workerData: {
            snapshot,
            configuration,
            coverage,
            state,
            output,
            commit: commit(),
            policyHash: digest(PTS_POLICY),
          },
        });
        let done = false;
        worker.once("message", () => {
          done = true;
          resolveWorker();
        });
        worker.once("error", rejectWorker);
        worker.once("exit", (code) => {
          if (!done) {
            rejectWorker(
              new PilotError(
                "PTS_REPORT_FAILED",
                "Report worker exited without publication: " + code,
              ),
            );
          }
        });
      });
    };
    if (["status", "report"].includes(input.command)) {
      await report();
      return;
    }
    if (input.command !== "run" || view.record.startedAt !== null) {
      throw new PilotError(
        "STUDY_ALREADY_STARTED",
        "PTS permits one explicit future run, with no resume",
      );
    }
    if ((view.record.metadata as { commit: string }).commit !== commit()) {
      throw new PilotError("CONFIG_CHANGED", "Prepared study commit differs from executable code");
    }
    releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    data = createPriorityPerplStudyData(research, {
      acquisitionPolicy: configuration.acquisitionPolicy,
      initialHistory: input.packet.history.markets,
      onHistoryRevision: (event) => {
        void appendFile(
          resolve(output, "history-revisions.jsonl"),
          JSON.stringify({ ...event, receivedAt: Date.now() }) + "\n",
          { mode: 0o600 },
        ).catch((error) => controller.abort(error));
      },
    });
    reports = createReportQueue(report, (error) => controller.abort(error));
    await createProfileStudyRunner({
      study,
      paper: new PostgresPerpsPaperStore(research.pool),
      data,
      paperForLease: (scope, lease, ownedSignal) =>
        new PostgresPerpsPaperStore(research.pool, undefined, {
          ...scope,
          owner: lease.owner,
          signal: ownedSignal,
          ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
        }),
      afterObservation: async (observation) =>
        publish(output, {
          "runtime-status.json":
            JSON.stringify({ processState: state, at: Date.now(), modelCalls: 0, observation }) +
            "\n",
        }),
      afterCycle: async () => {
        if ((await readFile(resolve(input.configPath!), "utf8")) !== input.configText) {
          throw new PilotError("CONFIG_CHANGED", "Frozen configuration changed");
        }
        const current = (await study.cycleView(configuration)).record;
        state =
          current.status === "completed"
            ? "finished"
            : current.decisionStopReason || current.stopRequested || Date.now() >= current.endsAt!
              ? "closing"
              : "active";
        if (Date.now() >= current.endsAt! || current.lastRoundSlot !== view.record.lastRoundSlot) {
          view.record.lastRoundSlot = current.lastRoundSlot;
          reports!.request();
        }
      },
    }).run(configuration, signal);
    state = "finished";
    reports.request();
    await reports.flush();
  } catch (error) {
    primaryError = error;
    if (input.command === "run") {
      state = "interrupted";
      reports?.request();
      await publish(output, {
        "runtime-status.json":
          JSON.stringify({
            processState: "interrupted",
            code: error instanceof PilotError ? error.code : "PTS_OPERATION_FAILED",
            at: Date.now(),
            modelCalls: 0,
          }) + "\n",
      }).catch(() => {});
    }
    throw error;
  } finally {
    releaseAwake();
    const cleanup = await Promise.allSettled([data?.close(), reports?.flush()]);
    cleanup.push(...(await Promise.allSettled([research.close()])));
    const failed = cleanup.find((r) => r.status === "rejected");
    if (failed?.status === "rejected" && !primaryError) {
      throw new PilotError(
        "PTS_RESOURCE_CLOSE_FAILED",
        "PTS reader/report cleanup did not complete",
      );
    }
  }
}
