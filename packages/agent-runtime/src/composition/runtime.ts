import {
  createResearchRunner,
  createPaperService,
  effectivePlugins,
  PilotError,
  type PluginId,
} from "@pickler/core";
import {
  PostgresResearchStore,
  PostgresPaperStore,
  ExaResearch,
  PolymarketData,
  BallDontLieSports,
  OddsApiSports,
  PostgresPublicDataCache,
} from "@pickler/infrastructure";
import type { Environment } from "../environment.js";
import { createModel } from "./model.js";

export function createRuntime(env: Environment) {
  const repository = new PostgresResearchStore(env.DATABASE_URL);
  const search = new ExaResearch(env.EXA_API_KEY);
  const markets = new PolymarketData();
  const model = createModel(env);
  const cache = new PostgresPublicDataCache(repository.pool);
  const sports = env.BALLDONTLIE_API_KEY
    ? new BallDontLieSports(env.BALLDONTLIE_API_KEY, cache)
    : undefined;
  const odds = env.THE_ODDS_API_KEY ? new OddsApiSports(env.THE_ODDS_API_KEY, cache) : undefined;
  let checking = false;
  return {
    env,
    repository,
    markets,
    paper: createPaperService(new PostgresPaperStore(repository.pool), markets),
    execute: createResearchRunner({
      repository,
      search,
      reader: search,
      markets,
      model,
      configured: { exa: Boolean(env.EXA_API_KEY) },
      ...(sports ? { sports } : {}),
      ...(odds ? { odds } : {}),
    }),
    async checkPlugin(scope: { tenantId: string; agentId: string }, plugin: string) {
      const agent = await repository.agent(scope);
      if (!effectivePlugins(agent.config).enabled.includes(plugin as PluginId)) {
        throw new PilotError("PLUGIN_DISABLED", "Plugin is disabled");
      }
      const signal = AbortSignal.timeout(20000);
      if (plugin === "balldontlie") {
        if (!sports) {
          throw new PilotError("PLUGIN_NOT_CONFIGURED", "Missing credentials");
        }
        await sports.check(signal);
      } else if (plugin === "the-odds-api") {
        if (!odds) {
          throw new PilotError("PLUGIN_NOT_CONFIGURED", "Missing credentials");
        }
        await odds.check(signal);
      } else if (plugin === "polymarket") {
        await markets.categories(signal);
      } else if (plugin === "exa") {
        await search.search("NFL official schedule", signal);
      } else if (plugin === "paper-trading") {
        if (!effectivePlugins(agent.config).enabled.includes("polymarket")) {
          throw new PilotError("PLUGIN_DISABLED", "Paper requires Polymarket");
        }
      } else {
        throw new PilotError("INVALID_INPUT", "Unknown research plugin");
      }
      return { plugin, ok: true };
    },
    async checkConnections(scope?: { tenantId: string; agentId: string }) {
      if (checking) {
        throw new Error("Connection check already running");
      }
      const agent = scope ? await repository.agent(scope) : null;
      if (agent) {
        const enabled = effectivePlugins(agent.config).enabled;
        if (!enabled.includes("polymarket") || !enabled.includes("exa")) {
          throw new PilotError("PLUGIN_DISABLED", "Required research capabilities are disabled");
        }
        await repository.setAgentConnectionsChecked(scope!, agent.version, false);
      }
      checking = true;
      try {
        const result = await model.check();
        const categories = await markets.categories(AbortSignal.timeout(20_000));
        const searchResult = await search.search(
          "Polymarket resolution rules official documentation",
          AbortSignal.timeout(20_000),
        );
        const sources = searchResult.sources;
        if (!categories.length || !sources.length) {
          throw new Error("Provider returned no verification data");
        }
        const source = await search.read(sources[0]!.url, AbortSignal.timeout(20_000));
        if (scope && agent) {
          await repository.setAgentConnectionsChecked(scope, agent.version, true);
        }
        return {
          modelCheck: result,
          categories: categories.length,
          exa: { search: true, read: true, usage: [searchResult.usage, source.providerUsage] },
        };
      } finally {
        checking = false;
      }
    },
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
