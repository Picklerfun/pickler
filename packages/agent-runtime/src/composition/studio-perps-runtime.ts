import { createHash } from "node:crypto";
import { PilotError } from "@pickler/core";
import {
  ExaResearch,
  PERPL_CHECK_SESSION_LIMIT,
  PostgresPerpsCheckCostStore,
  PostgresPerpsPaperStore,
  exaSearchRequest,
  type PostgresResearchStore,
  type PostgresCustodyStore,
  type PostgresPerpsRuntimeStore,
  type PerplRequestSchedule,
} from "@pickler/infrastructure";
import type { StudioCallPlan, StudioPerpsCheckDependencies } from "@pickler/trading/perps";
import type { StudioPerpsModels } from "@pickler/trading/strategies";
import { z } from "zod";
import { createPerplSession } from "../plugins/perpl/index.js";
import { siteScopedWeb } from "../plugins/exa.js";
import { readPerplInstrument } from "./advice.js";
import type { PerpsRuntimeEnvironment } from "./perps-runtime.js";
import { perpsFrame } from "./perps-check.js";
import {
  createStudioPerpsModels,
  studioPerpsForecastPrompt,
  studioPerpsJevPrompt,
} from "./studio-perps-models.js";
const micros = z.string().regex(/^\d{1,24}$/);
const tariff = z
  .object({
    model: z.string().min(1),
    inputMicrosPerMillion: micros,
    outputMicrosPerMillion: micros,
  })
  .strict();
const policySchema = z
  .object({
    version: z.literal(1),
    enabled: z.boolean(),
    reviewedAt: z.string().datetime(),
    perOperationMicros: micros,
    perDayMicros: micros,
    forecast: tariff.extend({ baseUrl: z.string().url() }).strict().optional(),
    jev: tariff.optional(),
    searchMaximumMicros: micros.optional(),
  })
  .strict();
export function createStudioPerpsCheckDependencies(input: {
  env: PerpsRuntimeEnvironment;
  research: PostgresResearchStore;
  custody: PostgresCustodyStore;
  store: PostgresPerpsRuntimeStore;
  balances: { read(address: string): Promise<number> };
  schedule: PerplRequestSchedule;
  models?: StudioPerpsModels;
}): StudioPerpsCheckDependencies {
  const { env, research, custody, store } = input;
  let reviewed: z.infer<typeof policySchema> | undefined;
  if (env.PERPS_RUNTIME_POLICY_JSON) {
    let raw: unknown;
    try {
      raw = JSON.parse(env.PERPS_RUNTIME_POLICY_JSON);
    } catch {
      throw new PilotError("COST_POLICY_INVALID", "Invalid Studio USD policy JSON");
    }
    const parsed = policySchema.safeParse(raw);
    if (!parsed.success) {
      throw new PilotError("COST_POLICY_INVALID", "Invalid reviewed Studio USD policy");
    }
    reviewed = parsed.data;
    if (
      reviewed.forecast &&
      (reviewed.forecast.baseUrl !== env.MODEL_BASE_URL || reviewed.forecast.model !== env.MODEL_ID)
    ) {
      throw new PilotError(
        "MODEL_CONFIG_MISMATCH",
        "Forecast differs from the reviewed Studio policy",
      );
    }
  }
  const plans: StudioCallPlan[] = [];
  if (reviewed?.forecast) {
    for (const key of ["direct", "fallback"]) {
      plans.push({
        key,
        provider: reviewed.forecast.baseUrl,
        model: reviewed.forecast.model,
        promptVersion: studioPerpsForecastPrompt.version,
        promptSha256: studioPerpsForecastPrompt.sha256,
        maxInputTokens: 120000,
        maxOutputTokens: 4096,
        inputMicrosPerMillion: reviewed.forecast.inputMicrosPerMillion,
        outputMicrosPerMillion: reviewed.forecast.outputMicrosPerMillion,
      });
    }
  }
  if (reviewed?.jev) {
    for (const key of ["jev", "review"]) {
      plans.push({
        key,
        provider: "https://api.typesafe.ai/v1/systemone",
        model: reviewed.jev.model,
        promptVersion: studioPerpsJevPrompt.version,
        promptSha256: studioPerpsJevPrompt.sha256,
        maxInputTokens: 65536,
        maxOutputTokens: 4096,
        inputMicrosPerMillion: reviewed.jev.inputMicrosPerMillion,
        outputMicrosPerMillion: reviewed.jev.outputMicrosPerMillion,
      });
    }
  }
  const query = "BTC ETH cryptocurrency market news";
  if (reviewed?.searchMaximumMicros !== undefined) {
    for (const key of ["search-1", "search-2"]) {
      plans.push({
        key,
        provider: "https://api.exa.ai/search",
        model: "exa-search",
        promptVersion: "1.0.0",
        promptSha256: createHash("sha256").update(query).digest("hex"),
        maxInputTokens: 0,
        maxOutputTokens: 0,
        inputMicrosPerMillion: "0",
        outputMicrosPerMillion: "0",
        maximumMicros: reviewed.searchMaximumMicros,
      });
    }
  }
  const costs = new PostgresPerpsCheckCostStore(research.pool);
  return {
    store,
    agents: research,
    costs,
    policy: reviewed ?? {
      version: 1,
      enabled: false,
      reviewedAt: "",
      perOperationMicros: "0",
      perDayMicros: "0",
    },
    callPlans: plans,
    models:
      input.models ??
      createStudioPerpsModels({
        forecast: {
          baseUrl: env.MODEL_BASE_URL ?? "",
          model: env.MODEL_ID ?? "",
          apiKey: env.MODEL_API_KEY ?? "",
        },
        jev: { model: reviewed?.jev?.model ?? "", apiKey: env.PERPS_JEV_API_KEY ?? "" },
      }),
    now: Date.now,
    hash: (document) => createHash("sha256").update(JSON.stringify(document)).digest("hex"),
    paper: (scope, version, holder, signal) =>
      new PostgresPerpsPaperStore(research.pool, undefined, undefined, () => ({
        scope,
        configVersion: version,
        lease: holder.lease,
        requireReservation: true,
        signal,
      })),
    async initialCash(productAgentId, signal) {
      signal.throwIfAborted();
      const wallet = await custody.findAgentWallet(productAgentId);
      if (!wallet) {
        throw new PilotError("WALLET_UNFUNDED", "Agent wallet is missing");
      }
      const balance = await input.balances.read(wallet.address);
      signal.throwIfAborted();
      if (!Number.isFinite(balance) || balance < 10) {
        throw new PilotError("WALLET_UNFUNDED", "Agent wallet needs at least ten virtual AUSD");
      }
      return balance.toFixed(6);
    },
    async data(scope, signal) {
      const { service } = await createPerplSession(research, scope, signal, {
        schedule: input.schedule,
        sessionLimit: PERPL_CHECK_SESSION_LIMIT,
      });
      return {
        read: (symbol) =>
          readPerplInstrument(service, symbol, {
            candles: 60,
            guard: async () => signal.throwIfAborted(),
            prefix: `perpl-${symbol.toLowerCase()}`,
          }),
        async frame(symbol) {
          const book = await service.getPerpOrderBook({ symbol, levels: 20 });
          const snapshot = await service.getPerpSnapshot({ symbol });
          return perpsFrame(snapshot, book);
        },
        funding: (symbol, from, to) => service.getPerpFundingHistory({ symbol, from, to }),
      };
    },
    async web(web, signal, hooks) {
      if (!env.EXA_API_KEY) {
        throw new PilotError("WEB_UNAVAILABLE", "Configured sources lack an Exa credential");
      }
      const exa = new ExaResearch(env.EXA_API_KEY);
      let count = 0;
      const scoped = siteScopedWeb(
        {
          read: (url, requestSignal) => exa.read(url, requestSignal),
          async search(searchQuery, requestSignal, domains) {
            count++;
            const key = `search-${count}`;
            const body = JSON.stringify(exaSearchRequest(searchQuery, domains));
            await hooks.before(key, {
              sha256: createHash("sha256").update(body).digest("hex"),
              bytes: new TextEncoder().encode(body).length,
            });
            requestSignal.throwIfAborted();
            const result = await exa.search(searchQuery, requestSignal, domains);
            const usage = result.usage as { total?: unknown } | number | null;
            const amount =
              typeof usage === "number"
                ? usage
                : typeof usage?.total === "number"
                  ? usage.total
                  : null;
            await hooks.usage(
              key,
              amount !== null && Number.isFinite(amount) && amount >= 0
                ? BigInt(Math.ceil(amount * 1000000)).toString()
                : null,
            );
            return result;
          },
        },
        web,
        async () => {},
      );
      return (await scoped.search(query, signal)).sources;
    },
  };
}
