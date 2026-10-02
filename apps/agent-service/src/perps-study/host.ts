import { readPerplTransportChoice } from "./transport-report.js";
import { keepAwake } from "../paper-study/comparison-host.js";
import { parseArgs } from "node:util";
import { readFile, mkdir, writeFile, appendFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
} from "@pickler/infrastructure";
import {
  perpsStrategies,
  type PerpsStudyMap,
  type PerpsProposal,
  type PerpsCallLane,
  startLeaseHeartbeat,
  assertPerpsStudyConfig,
} from "@pickler/trading/evaluation";
import { PilotError } from "@pickler/core";
import { validatePaperFrame, type PerpsPaperView } from "@pickler/trading/perps";
import { z } from "zod";
import { perpsStudyConfigSchema } from "@pickler/api-schema";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";

import { createStudyData } from "./data.js";
import { createPerpsStudyRunner } from "@pickler/trading/evaluation";
import { perpsStudyReport, renderPerpsReport } from "./report.js";
export async function runPerpsStudy(args: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      "env-file": { type: "string" },
      "acquisition-choice": { type: "string" },
      output: { type: "string" },
      "allow-paid": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "evaluate prepare|preflight|run|resume|stop|settle|report --config FILE [--env-file FILE] [--output DIRECTORY] [--allow-paid]\nLocal virtual capital only. Run/resume require explicit paid authorization (maximum USD 5 across sessions in the same tenant/network). No migrations, wallet, real orders, alpha/beta initialization or automatic retries.",
    );
    return;
  }
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !["init", "validate", "preflight", "run", "resume", "stop", "settle", "report"].includes(
      action ?? "",
    ) ||
    !values.config
  ) {
    throw new PilotError("INVALID_INPUT", "Command and --config are required");
  }
  const v2 = perpsStudyConfigSchema
    .extend({
      version: z.literal(2),
      protocol: z.literal("perps-four-way-v2"),
      hours: z.literal(2),
      acknowledgedUnknownCalls: z
        .array(
          z
            .object({
              sessionId: z.string(),
              roundKey: z.string(),
              lane: z.enum(["direct", "jev", "fallback", "review"]),
              requestHash: z.string().regex(/^[a-f0-9]{64}$/),
              reservationUsd: z.string().regex(/^\d+(?:\.\d+)?$/),
            })
            .strict(),
        )
        .max(2),
    })
    .strict();
  const config = z
    .union([perpsStudyConfigSchema, v2])
    .parse(JSON.parse(await readFile(resolve(values.config), "utf8")));
  assertPerpsStudyConfig(config);
  loadEnv({
    path: values["env-file"]
      ? resolve(values["env-file"])
      : fileURLToPath(new URL("../../.env", import.meta.url)),
    quiet: true,
  });
  if (!process.env.DATABASE_URL) {
    throw new PilotError("INVALID_INPUT", "DATABASE_URL required");
  }
  const research = new PostgresResearchStore(process.env.DATABASE_URL);
  const paper = new PostgresPerpsPaperStore(research.pool);
  const study = new PostgresPerpsStudyStore(research.pool);
  const models = createPerpsStudyModels(config, {
    deepseek: process.env.MODEL_API_KEY ?? "",
    jev: process.env.TYPESAFE_API_KEY ?? "",
  });
  let metadata = values["acquisition-choice"]
    ? {
        models: models.metadata,
        acquisition: await readPerplTransportChoice(resolve(values["acquisition-choice"])),
      }
    : config.version === 2
      ? { models: models.metadata }
      : models.metadata;
  if (config.version === 2) {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"]);
    metadata = { ...(metadata as Record<string, unknown>), commit: stdout.trim() };
  }
  const data = createStudyData(paper, research);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Operator interrupted"));
  signal?.addEventListener("abort", interrupt, { once: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  let primaryFailed = false;
  try {
    signal?.throwIfAborted();
    if (action === "init") {
      const view = await study.initialize(config, metadata);
      console.log(
        JSON.stringify(
          { status: view.record.status, agents: view.record.agentIds, budgetUsd: config.budgetUsd },
          null,
          2,
        ),
      );
      return;
    }
    if (["validate", "run", "resume", "preflight"].includes(action!)) {
      if (
        !process.env.MODEL_API_KEY ||
        !process.env.TYPESAFE_API_KEY ||
        process.env.MODEL_ID !== config.deepseek.model ||
        process.env.MODEL_BASE_URL?.replace(/\/$/, "") !==
          config.deepseek.baseUrl.replace(/\/$/, "")
      ) {
        throw new PilotError(
          "MODEL_CONFIG_MISMATCH",
          "Both keys and matching model/base URL are required",
        );
      }
      const pricingAge = Date.now() - Date.parse(config.pricingVerifiedAt);
      if (pricingAge < 0 || pricingAge > 7 * 86400000) {
        throw new PilotError(
          "PRICING_REVIEW_REQUIRED",
          "Verify current provider tariffs and pin a new unused session before starting",
        );
      }
    }
    if (action === "validate") {
      if (config.version !== 2 || !values["allow-paid"]) {
        throw new PilotError(
          "PAID_OPT_IN_REQUIRED",
          "Explicit v2 validation authorization required",
        );
      }
      const probeConfig = { ...config, sessionId: `${config.sessionId}-probe` };
      const probe = await study.initialize(probeConfig, {
        ...(metadata as Record<string, unknown>),
        purpose: "contracts-v2",
      });
      const releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
      if (probe.record.startedAt !== null) {
        throw new PilotError("CONFLICT", "Contract checks cannot be repeated");
      }
      const { contractContext } = await import("./contract-context.js");
      const context = contractContext(Date.now());
      const lease = await study.claim(probeConfig).catch((error) => {
        releaseAwake();
        throw error;
      });
      let probeRoundKey: string | undefined;
      const heartbeat = startLeaseHeartbeat({
        lease,
        renew: () => study.renew(probeConfig, lease),
      });
      lease.assertActive = heartbeat.assertActive;
      const signal = AbortSignal.any([controller.signal, heartbeat.signal]);
      try {
        const accounts = Object.fromEntries(
          perpsStrategies(config).map((s) => [
            s,
            { ...context.account, scope: { ...probeConfig, agentId: probe.record.agentIds[s]! } },
          ]),
        ) as unknown as PerpsStudyMap<typeof context.account>;
        const holds: PerpsProposal[] = (["BTC", "ETH"] as const).map((symbol) => ({
          symbol,
          action: "hold",
          reason: "SYNTHETIC_FLAT_CONTEXT",
          sourceIds: [`${symbol}:candles`],
        }));
        const round = await study.reserve(probeConfig, lease, 0, context.evidence, accounts, holds);
        if (!round) {
          throw new PilotError("BUDGET_EXHAUSTED", "Contract checks not admitted");
        }
        probeRoundKey = round.key;
        const invoke = async (
          lane: PerpsCallLane,
          fn: (hooks: import("@pickler/trading/evaluation").PerpsModelHooks) => Promise<unknown>,
        ) => {
          let started = false;
          try {
            const result = await fn({
              before: async (request) => {
                await study.guard(probeConfig, lease, true);
                await study.startCall(probeConfig, lease, round.key, lane, request);
                started = true;
              },
              diagnostic: (value) =>
                study.event(
                  probeConfig,
                  lease,
                  `${round.key}:${lane}:diagnostic`,
                  "model-diagnostic",
                  value,
                ),
              usage: (input, output) =>
                study.usage(probeConfig, lease, round.key, lane, input, output),
            });
            await study.finishCall(probeConfig, lease, round.key, lane, result, null);
            return result;
          } catch (error) {
            if (started) {
              await study.finishCall(
                probeConfig,
                lease,
                round.key,
                lane,
                null,
                error instanceof PilotError ? error.code : "MODEL_TRANSPORT_FAILURE",
              );
            }
            throw error;
          }
        };
        const direct = (await invoke("direct", (h) =>
          models.direct(context, signal, h),
        )) as PerpsProposal[];
        if (direct.some((p) => p.action !== "hold")) {
          throw new PilotError("CONTRACT_SCENARIO_FAILED", "Flat synthetic context expected hold");
        }
        const decision = (await invoke("jev", (h) => models.decide!(context, signal, h))) as {
          proposals: PerpsProposal[];
        };
        if (decision.proposals.some((p) => p.action !== "hold")) {
          throw new PilotError("CONTRACT_SCENARIO_FAILED", "Jev flat context expected hold");
        }
        const review = (await invoke("review", (h) =>
          models.review!(context, holds, signal, h),
        )) as {
          proposals: PerpsProposal[];
          answers: Record<
            string,
            { choice: string; confidence: number; probabilities: Record<string, number> }
          >;
        };
        if (
          Object.values(review.answers).some(
            (a) =>
              a.choice === "CONTRADICTED" &&
              a.confidence >= 0.9 &&
              a.probabilities.CONTRADICTED! >= 0.9,
          )
        ) {
          throw new PilotError(
            "CONTRACT_SCENARIO_FAILED",
            "Unexpected material veto of coherent holds",
          );
        }
        await study.finishRound(probeConfig, lease, round.key, {
          rules: holds,
          deepseek: direct,
          jev: decision.proposals,
          combined: review.proposals,
        });
        await study.finishExecution(probeConfig, lease, round.key, "complete");
        await study.event(probeConfig, lease, "contract-passed", "contract-passed", {
          checks: 3,
          realOrders: 0,
        });
        await study.complete(probeConfig, lease);
        console.log(
          JSON.stringify({ status: "contracts-passed", session: probeConfig.sessionId, calls: 3 }),
        );
      } catch (error) {
        await study.stopDecisions(
          probeConfig,
          lease,
          error instanceof PilotError ? error.code : "CONTRACT_FAILED",
        );
        if (probeRoundKey) {
          await study.finishRound(probeConfig, lease, probeRoundKey, {});
          await study.finishExecution(probeConfig, lease, probeRoundKey, "incomplete");
        }
        await study.complete(probeConfig, lease);
        throw error;
      } finally {
        await heartbeat.stop();
        releaseAwake();
        await study.release(probeConfig, lease);
      }
      return;
    }
    let view = await study.view(config);
    // Initialization compares canonical pinned metadata; report/stop remain possible after a code upgrade.
    if (["run", "resume", "preflight"].includes(action!)) {
      view = await study.initialize(config, metadata);
    }
    if (action === "stop") {
      await study.stop(config);
      console.log(
        "Stop recorded. The active runner will attempt controlled exits for up to 15 minutes.",
      );
      return;
    }
    if (action === "settle") {
      const { createPerpsPaperRuntime } =
        await import("@pickler/agent-runtime/plugins/perps-paper");
      const runtime = createPerpsPaperRuntime(paper, research);
      for (const strategy of perpsStrategies(config)) {
        await runtime.service.tick(
          { ...config, agentId: view.record.agentIds[strategy]! },
          `settle-${Date.now()}`,
          controller.signal,
        );
      }
      console.log("Public mark/funding reconciliation completed; no paid decisions or openings.");
      return;
    }
    if (action === "report") {
      const accounts = {} as PerpsStudyMap<PerpsPaperView>;
      for (const strategy of perpsStrategies(config)) {
        accounts[strategy] = await paper.view({
          ...config,
          agentId: view.record.agentIds[strategy]!,
        });
      }
      const report = perpsStudyReport(view, accounts);
      const output = resolve(
        values.output ??
          fileURLToPath(new URL(`../../.data/perps-studies/${config.sessionId}`, import.meta.url)),
      );
      await mkdir(output, { recursive: true });
      const rendered = renderPerpsReport(report);
      await Promise.all([
        writeFile(join(output, "report.json"), JSON.stringify(report, null, 2) + "\n"),
        writeFile(join(output, "report.html"), rendered.html),
        writeFile(join(output, "report.csv"), rendered.csv),
        writeFile(join(output, "rounds.csv"), rendered.roundsCsv),
      ]);
      console.log(
        JSON.stringify(
          {
            output,
            status: report.status,
            rounds: report.rounds,
            accountedOrReservedUSD: report.accountedOrReservedUSD,
            comparable: report.comparable,
            rows: report.rows,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (action === "preflight") {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
      const observation = await data.observe(view.record, signal);
      const evidence = await data.evidence(view.record, observation, signal);
      for (const frame of evidence.frames) {
        validatePaperFrame(frame, config.network, frame.snapshot.market.symbol, Date.now());
      }
      for (const [url, key, id] of [
        [
          `${config.deepseek.baseUrl.replace(/\/$/, "")}/models`,
          process.env.MODEL_API_KEY,
          config.deepseek.model,
        ],
        ["https://api.typesafe.ai/v1/models", process.env.TYPESAFE_API_KEY, "jev"],
      ] as const) {
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${key}` },
          signal,
          redirect: "manual",
        });
        if (!response.ok) {
          void response.body?.cancel();
          throw new PilotError("MODEL_PREFLIGHT_FAILED", "Model catalog unavailable");
        }
        const payload = (await response.json()) as {
          data?: { id: string }[];
          models?: { id?: string; name?: string }[];
        };
        const ids = [
          ...(payload.data ?? []).map((m) => m.id),
          ...(payload.models ?? []).map((m) => m.id ?? m.name ?? ""),
        ];
        if (!ids.includes(id) && !(id === "jev" && ids.some((v) => v.startsWith("jev")))) {
          throw new PilotError(
            "MODEL_PREFLIGHT_FAILED",
            "Pinned model family not found in catalog",
          );
        }
      }
      console.log(
        JSON.stringify(
          {
            status: "public-data-and-catalogs-verified",
            candles: evidence.candles.map((c) => ({
              symbol: c.market.symbol,
              count: c.candles.length,
            })),
            pricing: config.pricingSources,
            paidCalls: 0,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (config.version === 2 && action === "run") {
      const probe = await study.view({ ...config, sessionId: `${config.sessionId}-probe` });
      const { isDeepStrictEqual } = await import("node:util");
      if (
        probe.record.status !== "completed" ||
        !probe.events.some((e) => e.kind === "contract-passed") ||
        !isDeepStrictEqual(
          (probe.record.metadata as { models: unknown }).models,
          (metadata as { models: unknown }).models,
        ) ||
        (probe.record.metadata as { commit: string }).commit !==
          (metadata as { commit: string }).commit
      ) {
        throw new PilotError(
          "CONTRACT_VALIDATION_REQUIRED",
          "Matching three-check probe must pass before run",
        );
      }
    }
    if (!values["allow-paid"]) {
      throw new PilotError(
        "PAID_OPT_IN_REQUIRED",
        "Use --allow-paid for the authorized USD 5 session",
      );
    }
    if (
      (action === "run" && view.record.startedAt !== null) ||
      (action === "resume" && view.record.startedAt === null)
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Use run for an unused session and resume for a started session",
      );
    }
    console.log(
      JSON.stringify({
        status: "starting",
        session: config.sessionId,
        budgetUsd: "5",
        virtualCapitalPerAgent: "1000 AUSD",
        model: config.deepseek.model,
      }),
    );
    if (!view.record.dataPolicy) {
      throw new PilotError(
        "HISTORICAL_SESSION",
        "Use a new frozen session for coherent data policy",
      );
    }
    const output = resolve(
      values.output ??
        fileURLToPath(new URL(`../../.data/perps-studies/${config.sessionId}`, import.meta.url)),
    );
    await mkdir(output, { recursive: true });
    let diagnostics: Promise<void> = Promise.resolve();
    const releaseAwake = process.platform === "darwin" ? await keepAwake() : () => {};
    const diagnostic = (event: unknown) => {
      diagnostics = diagnostics.then(() =>
        appendFile(join(output, "diagnostics.jsonl"), JSON.stringify(event) + "\n", {
          mode: 0o600,
        }),
      );
      void diagnostics.catch((cause) => controller.abort(cause));
    };
    const reliableData = createStudyData(paper, research, {
      onDiagnostic: diagnostic,
      onAcquisition: diagnostic,
    });
    try {
      await createPerpsStudyRunner({
        study,
        paper,
        data: reliableData,
        models,
        paperForLease: (scope, lease, signal) =>
          new PostgresPerpsPaperStore(research.pool, undefined, {
            ...scope,
            owner: lease.owner,
            ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
            signal,
          }),
        leaseDiagnostic: diagnostic,
      }).run(config, controller.signal);
    } catch (error) {
      primaryFailed = true;
      throw error;
    } finally {
      await reliableData.close();
      releaseAwake();
      await diagnostics.catch((error) => {
        if (!primaryFailed) {
          throw error;
        }
      });
    }
    console.log("Study finished; regenerate the report to inspect open positions and limitations.");
  } catch (error) {
    primaryFailed = true;
    throw error;
  } finally {
    signal?.removeEventListener("abort", interrupt);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await data.close();
    await research.close().catch((error) => {
      if (!primaryFailed) {
        throw error;
      }
    });
  }
}
