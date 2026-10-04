import { createHash } from "node:crypto";
import {
  PilotError,
  requireTool,
  type AdviceExecutionRepository,
  type AdviceJob,
  type PerpCandles,
  type PerpReadTools,
  type PerpSymbol,
} from "@pickler/core";
import {
  PostgresAdviceStore,
  PostgresResearchStore,
  ExaResearch,
  type DatabaseConnectionOptions,
} from "@pickler/infrastructure";
import {
  parseAdvicePolicy,
  advicePolicyKey,
  usdMicros,
  createAdviceRunner,
  type AdviceEvidence,
  type AdviceSource,
  type PerpsPaperFrame,
} from "@pickler/trading/perps";
import { createPerplSession } from "../plugins/perpl/index.js";
import { siteScopedWeb } from "../plugins/exa.js";
import { adviceProviderMatches, createAdviceModels } from "./advice-model.js";
/**
 * One instrument's market evidence from a bounded Perpl session, read in this order: `candles`
 * closed hourly candles, a 20-level book, then the snapshot (the ticker last, so the book's request
 * delay does not add to its lag). `guard` runs after each read. Advice and the Perpl paper runtime
 * share it; `prefix` names the source ids (`perpl-ticker`, `perpl-book`, `perpl-candles` for advice).
 */
export async function readPerplInstrument(
  service: PerpReadTools,
  symbol: PerpSymbol,
  options: { candles: number; guard: () => Promise<void>; prefix?: string; now?: () => number },
): Promise<{ frame: PerpsPaperFrame; candles: PerpCandles; sources: AdviceSource[] }> {
  const prefix = options.prefix ?? "perpl";
  const hour = Math.floor((options.now ?? Date.now)() / 3600000) * 3600000;
  const candles = await service.getPerpCandles({
    symbol,
    resolution: 3600,
    from: hour - options.candles * 3600000,
    to: hour,
  });
  await options.guard();
  const book = await service.getPerpOrderBook({ symbol, levels: 20 });
  await options.guard();
  const snapshot = await service.getPerpSnapshot({ symbol });
  await options.guard();
  const frame = {
    snapshot,
    book,
    hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
  };
  const sources: AdviceSource[] = [
    {
      id: `${prefix}-ticker`,
      name: "Perpl ticker",
      url: snapshot.ticker.provenance.url,
      observedAt: new Date(snapshot.ticker.provenance.receivedAt).toISOString(),
    },
    {
      id: `${prefix}-book`,
      name: "Perpl order book",
      url: book.provenance.url,
      observedAt: new Date(book.provenance.receivedAt).toISOString(),
    },
    {
      id: `${prefix}-candles`,
      name: "Perpl closed hourly candles",
      url: candles.provenance.url,
      observedAt: new Date(candles.provenance.receivedAt).toISOString(),
    },
  ];
  return { frame, candles, sources };
}
export function createAdviceData(
  repository: AdviceExecutionRepository,
  research: Pick<PostgresResearchStore, "agent">,
  exa: ExaResearch,
) {
  return async (job: AdviceJob, signal: AbortSignal): Promise<AdviceEvidence> => {
    const scope = { tenantId: job.tenantId, agentId: job.agentId };
    const guard = async () => {
      signal.throwIfAborted();
      await repository.guard(job);
    };

    let web: AdviceEvidence["web"] = [],
      sources: AdviceEvidence["sources"] = [];
    if (job.config.sources?.web) {
      requireTool(job.config, "searchWeb");
      let calls = 0;
      const search = siteScopedWeb(
        {
          read: (url, s) => exa.read(url, s),
          async search(query, s, domains) {
            await guard();
            const lane = calls++ === 0 ? "web" : "web-fallback";
            await repository.startCall(
              job,
              lane,
              createHash("sha256").update(JSON.stringify({ query, domains })).digest("hex"),
            );
            const result = await exa.search(query, s, domains);
            const u = result.usage as { total?: unknown } | number | null;
            const amount =
              typeof u === "number" ? u : typeof u?.total === "number" ? u.total : null;
            if (amount === null || !Number.isFinite(amount) || amount < 0) {
              throw new PilotError("ADVICE_COST_UNKNOWN", "Source cost is unknown");
            }
            const micros = BigInt(Math.ceil(amount * 1000000));
            await repository.usage(job, lane, {
              costMicros: micros.toString(),
              inputTokens: null,
              outputTokens: null,
            });
            if (micros > usdMicros(job.policy.webSearchUsd)) {
              throw new PilotError("ADVICE_BUDGET_EXCEEDED", "Source cost exceeds its reservation");
            }
            return result;
          },
        },
        job.config.sources.web,
        (event) => repository.event(job, "sources.fallback", event),
      );
      const result = await search.search(
        `${job.symbol} perpetual market news risks last 24 hours`,
        signal,
      );
      web = result.sources;
      sources = result.sources.map((s) => ({
        id: s.id,
        name: (s.title || "Web source").slice(0, 300),
        url: s.url,
        observedAt: s.retrievedAt,
      }));
    }
    await guard();
    const perplSignal = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const perpl = await createPerplSession(research, scope, perplSignal);
    const read = await readPerplInstrument(perpl.service, job.symbol, {
      candles: 60,
      guard,
    });
    const { frame, candles } = read;
    sources.push(...read.sources);
    return { frame, candles, sources, web };
  };
}
export interface AdviceEnvironment {
  DATABASE_URL: string;
  ADVICE_ENABLED?: string;
  ADVICE_POLICY_JSON?: string;
  ADVICE_JEV_API_KEY?: string;
  MODEL_BASE_URL: string;
  MODEL_ID: string;
  MODEL_API_KEY: string;
  EXA_API_KEY?: string;
}
export function createAdviceRuntime(env: AdviceEnvironment, options: DatabaseConnectionOptions) {
  const research = new PostgresResearchStore(env.DATABASE_URL, undefined, options);
  const repository = new PostgresAdviceStore(research.pool);
  const modelConfiguration = {
    jev: env.ADVICE_JEV_API_KEY ?? "",
    baseUrl: env.MODEL_BASE_URL,
    model: env.MODEL_ID,
    apiKey: env.MODEL_API_KEY,
  };
  const models = createAdviceModels(repository, modelConfiguration);
  const runner = createAdviceRunner({
    repository,
    models,
    data: createAdviceData(repository, research, new ExaResearch(env.EXA_API_KEY ?? "")),
    now: Date.now,
  });
  return {
    repository,
    close: () => research.close(),
    async execute(job: AdviceJob, parent: AbortSignal) {
      if (
        !adviceProviderMatches(job.policy, modelConfiguration) ||
        (Boolean(job.config.sources?.web) && !env.EXA_API_KEY) ||
        advicePolicyKey(parseAdvicePolicy(env.ADVICE_POLICY_JSON)) !== advicePolicyKey(job.policy)
      ) {
        await repository.finish(job, null, "ADVICE_CONFIGURATION_UNAVAILABLE");
        return;
      }
      await runner(job, AbortSignal.any([parent, AbortSignal.timeout(180000)]));
    },
  };
}
