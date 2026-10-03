import { createHash } from "node:crypto";
import {
  PilotError,
  requireTool,
  type AdviceExecutionRepository,
  type AdviceJob,
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
} from "@pickler/trading/perps";
import { createPerplSession } from "../plugins/perpl/index.js";
import { siteScopedWeb } from "../plugins/exa.js";
import { createAdviceModels } from "./advice-model.js";
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
    const hour = Math.floor(Date.now() / 3600000) * 3600000;
    const candles = await perpl.service.getPerpCandles({
      symbol: job.symbol,
      resolution: 3600,
      from: hour - 60 * 3600000,
      to: hour,
    });
    await guard();
    const book = await perpl.service.getPerpOrderBook({ symbol: job.symbol, levels: 20 });
    await guard();
    const snapshot = await perpl.service.getPerpSnapshot({ symbol: job.symbol });
    await guard();
    const frame = {
      snapshot,
      book,
      hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
    };
    sources.push(
      ...[
        {
          id: "perpl-ticker",
          name: "Perpl ticker",
          url: snapshot.ticker.provenance.url,
          observedAt: new Date(snapshot.ticker.provenance.receivedAt).toISOString(),
        },
        {
          id: "perpl-book",
          name: "Perpl order book",
          url: book.provenance.url,
          observedAt: new Date(book.provenance.receivedAt).toISOString(),
        },
        {
          id: "perpl-candles",
          name: "Perpl closed hourly candles",
          url: candles.provenance.url,
          observedAt: new Date(candles.provenance.receivedAt).toISOString(),
        },
      ],
    );
    return { frame, candles, sources, web };
  };
}
export interface AdviceEnvironment {
  DATABASE_URL: string;
  ADVICE_ENABLED?: string;
  ADVICE_POLICY_JSON?: string;
  ADVICE_JEV_API_KEY?: string;
  ADVICE_DEEPSEEK_API_KEY?: string;
  EXA_API_KEY?: string;
}
export function createAdviceRuntime(env: AdviceEnvironment, options: DatabaseConnectionOptions) {
  const research = new PostgresResearchStore(env.DATABASE_URL, undefined, options);
  const repository = new PostgresAdviceStore(research.pool);
  const models = createAdviceModels(repository, {
    jev: env.ADVICE_JEV_API_KEY ?? "",
    deepseek: env.ADVICE_DEEPSEEK_API_KEY ?? "",
  });
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
        !env.ADVICE_JEV_API_KEY ||
        !env.ADVICE_DEEPSEEK_API_KEY ||
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
