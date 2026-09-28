import { parseArgs } from "node:util";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import {
  PostgresResearchStore,
  PostgresPerpsPaperStore,
  PostgresPerpsStudyStore,
} from "@pickler/infrastructure";
import {
  PERPS_STUDY_STRATEGIES,
  PilotError,
  assertPerpsStudyConfig,
  type PerpsStrategy,
  type PerpsPaperView,
} from "@pickler/core";
import { perpsStudyConfigSchema } from "@pickler/api-schema";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";
import { createStudyData } from "./data.js";
import { createPerpsStudyRunner } from "./runner.js";
import { perpsStudyReport, renderPerpsReport } from "./report.js";
export async function runPerpsStudy(args: string[], signal?: AbortSignal) {
  signal?.throwIfAborted();
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      "env-file": { type: "string" },
      output: { type: "string" },
      "allow-paid": { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "evaluate prepare|preflight|run|resume|stop|settle|report --config FILE [--env-file FILE] [--output DIRECTORY] [--allow-paid]\nLocal virtual capital only. Run/resume require explicit paid authorization (maximum USD 5 per session). No migrations, wallet, real orders, alpha/beta initialization or automatic retries.",
    );
    return;
  }
  const action = positionals[0];
  if (
    positionals.length !== 1 ||
    !["init", "preflight", "run", "resume", "stop", "settle", "report"].includes(action ?? "") ||
    !values.config
  ) {
    throw new PilotError("INVALID_INPUT", "Command and --config are required");
  }
  const config = perpsStudyConfigSchema.parse(
    JSON.parse(await readFile(resolve(values.config), "utf8")),
  );
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
  const data = createStudyData(paper, research);
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Operator interrupted"));
  signal?.addEventListener("abort", interrupt, { once: true });
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    signal?.throwIfAborted();
    if (action === "init") {
      const view = await study.initialize(config, models.metadata);
      console.log(
        JSON.stringify(
          { status: view.record.status, agents: view.record.agentIds, budgetUsd: config.budgetUsd },
          null,
          2,
        ),
      );
      return;
    }
    let view = await study.view(config);
    // Initialization compares canonical pinned metadata; report/stop remain possible after a code upgrade.
    if (["run", "resume", "preflight"].includes(action!)) {
      view = await study.initialize(config, models.metadata);
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
        await import("@pickler/agent-runtime/composition/perps-paper");
      const runtime = createPerpsPaperRuntime(paper, research);
      for (const strategy of PERPS_STUDY_STRATEGIES) {
        await runtime.service.tick(
          { ...config, agentId: view.record.agentIds[strategy] },
          `settle-${Date.now()}`,
          controller.signal,
        );
      }
      console.log("Public mark/funding reconciliation completed; no paid decisions or openings.");
      return;
    }
    if (action === "report") {
      const accounts = {} as Record<PerpsStrategy, PerpsPaperView>;
      for (const strategy of PERPS_STUDY_STRATEGIES) {
        accounts[strategy] = await paper.view({
          ...config,
          agentId: view.record.agentIds[strategy],
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
    if (
      !process.env.MODEL_API_KEY ||
      !process.env.TYPESAFE_API_KEY ||
      process.env.MODEL_ID !== config.deepseek.model ||
      process.env.MODEL_BASE_URL?.replace(/\/$/, "") !== config.deepseek.baseUrl.replace(/\/$/, "")
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
    if (action === "preflight") {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]);
      const observation = await data.observe(view.record, signal);
      const evidence = await data.evidence(view.record, observation, signal);
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
    await createPerpsStudyRunner({ study, paper, data, models }).run(config, controller.signal);
    console.log("Study finished; regenerate the report to inspect open positions and limitations.");
  } finally {
    signal?.removeEventListener("abort", interrupt);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    await research.close();
  }
}
