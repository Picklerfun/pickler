import {
  MARKET_CATALOG,
  hasMarketSelection,
  configuredMarketExclusion,
  assertConfiguredMarket,
  protocolForMarket,
} from "./market-scope.js";
import { PLUGINS, effectivePlugins, requireTool, toolEnabled, pluginEnabled } from "./plugins.js";
import {
  nflMarketEligible,
  validateReport,
  uniqueSources,
  researchReferences,
  type SportsData,
} from "./nfl.js";
import { marketExclusion } from "./eligibility.js";
import { publicSourceUrl } from "./source-url.js";
import { evaluateDecision } from "./decision-policy.js";
import {
  PilotError,
  ModelFailure,
  DEFAULT_UNCERTAINTY_POLICY,
  assertMarket,
  type ResearchRepository,
  type ResearchModel,
  type WebSearch,
  type PageReader,
  type MarketData,
  type RunRecord,
  type Source,
  type OrderBook,
  type ToolName,
  type ResearchTools,
} from "./types.js";

/** The only research entry point: API, worker and Studio all dispatch through it. */
export function createResearchRunner(deps: {
  repository: Pick<ResearchRepository, "agent" | "event" | "finish" | "assertOwnership">;
  model: ResearchModel;
  search: WebSearch;
  reader: PageReader;
  markets: MarketData;
  configured?: { exa: boolean };
  sports?: SportsData;
  odds?: SportsData;
  now?: () => number;
}) {
  const { repository: repo } = deps;
  const now = deps.now ?? Date.now;
  return async function execute(run: RunRecord, parentSignal?: AbortSignal): Promise<void> {
    const signal = parentSignal
      ? AbortSignal.any([parentSignal, AbortSignal.timeout(run.config.limits.durationMs)])
      : AbortSignal.timeout(run.config.limits.durationMs);
    const sources = new Map<string, Source>();
    const quotes: OrderBook[] = [];
    const searchIntents = new Set<string>();
    let searches = 0;
    let reads = 0;
    let bookReads = 0;
    let providerFailure = false;
    const event = (type: string, data: unknown) => repo.event(run, type, data, now());
    const guard = async (tool?: ToolName) => {
      signal.throwIfAborted();
      await repo.assertOwnership(run);
      const current = await repo.agent(run);
      if (current.paused) {
        throw new PilotError("PAUSED", "Agent is paused");
      }
      if (current.version !== run.configVersion) {
        throw new PilotError("CONFIG_CHANGED", "Configuration changed during research");
      }
      if (tool) {
        requireTool(current.config, tool);
      }
    };
    const external = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      try {
        const result = await fn();
        await event(name, result);
        return result;
      } catch (error) {
        providerFailure = true;
        await event("provider_failure", {
          operation: name,
          code: error instanceof PilotError ? error.code : "PROVIDER_FAILURE",
        });
        throw error;
      }
    };
    try {
      await event("runtime", {
        ...deps.model.metadata(),
        uncertaintyPolicy: {
          version: "1.0.0",
          config: run.config.uncertaintyPolicy ?? DEFAULT_UNCERTAINTY_POLICY,
        },
        plugins: PLUGINS.filter((p) => effectivePlugins(run.config).enabled.includes(p.id)),
      });
      await guard("searchWeb");
      if (deps.configured && !deps.configured.exa) {
        throw new PilotError("PLUGIN_NOT_CONFIGURED", "Exa requires credentials");
      }
      await guard("getMarketRules");
      await guard("getOrderBook");
      const availability: Record<string, string> = {};
      let marketId = run.marketId;
      if (!hasMarketSelection(run.config)) {
        throw new PilotError("CATEGORIES_REQUIRED", "Select categories before researching");
      }
      if (!marketId) {
        await guard("getMarketRules");
        const discovered = await external("candidates", () =>
          run.config.marketScope
            ? (() => {
                if (!deps.markets.listScope) {
                  throw new PilotError(
                    "CAPABILITY_UNAVAILABLE",
                    "Market scope discovery unavailable",
                  );
                }
                return deps.markets.listScope(run.config.marketScope, signal, (data) =>
                  event("discovery_scan", data),
                );
              })()
            : deps.markets.list(run.config.categoryIds ?? [], signal, (data) =>
                event("discovery_scan", data),
              ),
        );
        const selectionTime = now();
        const exclusions = discovered.map((m) => ({
          marketId: m.id,
          reason: configuredMarketExclusion(m, run.config, selectionTime),
        }));
        await event(
          "discovery_exclusions",
          exclusions.filter((item) => item.reason),
        );
        const excluded = new Set(
          exclusions.filter((item) => item.reason).map((item) => item.marketId),
        );
        const candidates = discovered
          .filter((m) => !excluded.has(m.id))
          .sort((a, b) => b.liquidity - a.liquidity)
          .slice(0, 20);
        await event("eligible_candidates", candidates);
        if (!candidates.length) {
          throw new PilotError("NO_ELIGIBLE_MARKETS", "No eligible active markets found");
        }
        await guard();
        const selection = await deps.model.select(
          candidates,
          run.config.profile,
          signal,
          run.config.limits,
          new Date(now()).toISOString(),
          (data) => event("model_diagnostic", data),
        );
        await event("selection", selection);
        if (!candidates.some((m) => m.id === selection.marketId)) {
          throw new PilotError("INVALID_DECISION", "Selected market was not a candidate");
        }
        marketId = selection.marketId;
      }
      await guard("getMarketRules");
      const market = await external("market", () => deps.markets.get(marketId, signal));
      if (run.config.marketScope) {
        assertConfiguredMarket(market, run.config, now());
      } else {
        assertMarket(market, run.config.categoryIds ?? [], now());
        if (run.config.researchProtocol && !nflMarketEligible(market)) {
          throw new PilotError(
            "UNSUPPORTED_NFL_MARKET",
            "Only NFL full-game moneylines are supported",
          );
        }
        const exclusion = marketExclusion(market, now(), run.config.discoveryPolicy);
        if (exclusion) {
          throw new PilotError("NO_ELIGIBLE_MARKETS", exclusion);
        }
      }
      const protocol = protocolForMarket(market, run.config);
      await event("market_classification", {
        catalog: run.config.marketScope ? MARKET_CATALOG : null,
        classification: market.classification ?? null,
        protocol: protocol ?? null,
        temporalPolicy: run.config.marketScope
          ? market.classification?.temporalClass === "match"
            ? { mode: "pre-event", minLeadMinutes: 15, maxHorizonDays: 7 }
            : { mode: "open-market", requiresFutureClose: true }
          : (run.config.discoveryPolicy ?? { mode: "open-market" }),
      });
      for (const [id, tool, adapter] of [
        ["balldontlie", "getSportsContext", deps.sports],
        ["the-odds-api", "getExternalOdds", deps.odds],
      ] as const) {
        availability[id] =
          run.config.marketScope && protocol !== "nfl-winner-v1"
            ? "not_applicable"
            : !pluginEnabled(run.config, id) || !toolEnabled(run.config, tool)
              ? "disabled"
              : adapter
                ? "available"
                : "not_configured";
        if (availability[id] === "not_configured") {
          throw new PilotError(
            "PLUGIN_NOT_CONFIGURED",
            "Enabled sports plugin requires operator credentials",
          );
        }
      }
      await event("plugin_availability", availability);
      if (protocol) {
        const rules: Source = {
          id: `polymarket:${market.id}:rules`,
          externalId: market.id,
          pluginVersion: "1.0.0",
          provider: "polymarket",
          url: `https://gamma-api.polymarket.com/markets/${market.id}`,
          title: "Market resolution rules and schedule",
          content: JSON.stringify({
            rules: market.rules,
            startsAt: market.startsAt,
            timingSource: market.timingSource,
          }).slice(0, 6000),
          truncated: market.rules.length > 5700,
          retrievedAt: new Date(now()).toISOString(),
          publishedAt: null,
        };
        sources.set(rules.id, rules);
        await event("source", rules);
      }
      await guard("getOrderBook");
      for (const outcome of market.outcomes) {
        await guard("getOrderBook");
        quotes.push(await external("initial_quote", () => deps.markets.book(outcome.id, signal)));
      }
      const tools: Partial<ResearchTools> = {};
      if (toolEnabled(run.config, "searchWeb")) {
        tools.searchWeb = async (query, intent) => {
          await guard("searchWeb");
          if (++searches > run.config.limits.searches) {
            throw new PilotError("TOOL_LIMIT", "Search limit reached");
          }
          if (!["supporting", "contradicting"].includes(intent)) {
            throw new PilotError("INVALID_INPUT", "Search intent is required");
          }
          await event("search_query", { query, intent });
          const result = await external("sources", async () => {
            const result = await deps.search.search(query, signal);
            return {
              ...result,
              sources: result.sources.map((source) => ({
                ...source,
                provenance: "search" as const,
              })),
            };
          });
          await event(
            "evidence_limitations",
            result.sources
              .map((source) => ({
                sourceId: source.id,
                missingPublicationDate: source.publishedAt === null,
                truncated: source.truncated,
                olderThanSevenDays:
                  source.publishedAt !== null &&
                  Date.parse(source.publishedAt) < now() - 7 * 86400000,
              }))
              .filter(
                (source) =>
                  source.missingPublicationDate || source.truncated || source.olderThanSevenDays,
              ),
          );
          searchIntents.add(intent);
          const deduplicated = uniqueSources([...sources.values(), ...result.sources]);
          const accepted = new Set(deduplicated.map((s) => s.id));
          for (const source of result.sources.filter((s) => accepted.has(s.id))) {
            sources.set(source.id, source);
          }
          return result.sources.filter((s) => accepted.has(s.id));
        };
      }
      if (toolEnabled(run.config, "readPage")) {
        tools.readPage = async (url) => {
          await guard("readPage");
          if (++reads > run.config.limits.pageReads) {
            throw new PilotError("TOOL_LIMIT", "Page read limit reached");
          }
          const normalized = publicSourceUrl(url);
          const resolution = (market.resolutionUrls ?? []).some(
            (link) => publicSourceUrl(link) === normalized,
          );
          if (
            !normalized ||
            (!resolution &&
              ![...sources.values()].some((s) => publicSourceUrl(s.url) === normalized))
          ) {
            throw new PilotError(
              "INVALID_INPUT",
              "Only discovered or resolution-rule URLs can be read",
            );
          }
          const source = await external("source", async () => ({
            ...(await deps.reader.read(normalized, signal)),
            requestedUrl: normalized,
            provenance: resolution ? ("resolution-rule-link" as const) : ("search" as const),
          }));
          sources.set(source.id, source);
          return source;
        };
      }
      if (toolEnabled(run.config, "getMarketRules")) {
        tools.getMarketRules = async () => {
          await guard("getMarketRules");
          return market;
        };
      }
      if (toolEnabled(run.config, "getOrderBook")) {
        tools.getOrderBook = async (outcomeId) => {
          await guard("getOrderBook");
          if (++bookReads > 6) {
            throw new PilotError("TOOL_LIMIT", "Quote call limit reached");
          }
          if (!market.outcomes.some((o) => o.id === outcomeId)) {
            throw new PilotError("INVALID_INPUT", "Outcome is not in selected market");
          }
          const quote = await external("quote", () => deps.markets.book(outcomeId, signal));
          quotes.push(quote);
          return quote;
        };
      }
      for (const [id, tool, adapter, cap] of [
        ["balldontlie", "getSportsContext", deps.sports, 6],
        ["the-odds-api", "getExternalOdds", deps.odds, 2],
      ] as const) {
        if (availability[id] === "not_applicable" || !toolEnabled(run.config, tool) || !adapter) {
          continue;
        }
        let calls = 0;
        tools[tool] = async () => {
          await guard(tool);
          const context = await external("sports_evidence", () =>
            adapter.context(market, signal, async (network) => {
              await guard(tool);
              if (network && ++calls > cap) {
                throw new PilotError("TOOL_LIMIT", "Sports request budget exhausted");
              }
            }),
          );
          availability[id] = context.status;
          for (const source of context.sources) {
            sources.set(source.id, source);
          }
          return context;
        };
        // Establish structured context before the model, without spending another model step.
        if (protocol) {
          await tools[tool]!();
        }
      }
      await guard();
      const result = await deps.model.research({
        ...(protocol ? { protocol } : {}),
        availability,
        beforeStep: async () => {
          await guard();
          if (providerFailure) {
            throw new PilotError("PROVIDER_FAILURE", "Research provider failed");
          }
        },
        selectionSteps: run.marketId ? 0 : 1,
        evidence: () => ({
          sources: [...sources.values()],
          quotes,
          ...(protocol ? { references: researchReferences(market, quotes, availability) } : {}),
        }),
        onDiagnostic: (data) => event("model_diagnostic", data),
        market,
        profile: run.config.profile,
        tools,
        signal,
        limits: run.config.limits,
        onUsage: (usage) => event("model_step_usage", usage),
      });
      await event("model_usage", result.usage);
      await guard();
      if (providerFailure) {
        throw new PilotError("PROVIDER_FAILURE", "A provider failed; research is incomplete");
      }
      const decision = result.decision;
      if (protocol) {
        await event("research_references", researchReferences(market, quotes, availability));
      }
      await event("model_assessment", decision);
      let observedPrice: string | null = null;
      if (
        decision.marketId !== market.id ||
        decision.sourceIds.some((id) => !sources.has(id)) ||
        !decision.sourceIds.length
      ) {
        throw new PilotError(
          "INVALID_DECISION",
          "Decision must cite retrieved evidence for the selected market",
        );
      }
      if (!searchIntents.has("supporting") || !searchIntents.has("contradicting")) {
        throw new PilotError(
          "INCOMPLETE_RESEARCH",
          "Research must search both supporting and contradicting evidence",
        );
      }
      if (decision.action === "TRADE") {
        if (
          !market.outcomes.some((o) => o.id === decision.outcomeId) ||
          !decision.limitPrice ||
          !decision.expiresAt ||
          !Number.isFinite(Date.parse(decision.expiresAt)) ||
          Date.parse(decision.expiresAt) <= now()
        ) {
          throw new PilotError(
            "INVALID_DECISION",
            "Trade proposal requires valid outcome, limit and future expiry",
          );
        }
        await guard("getMarketRules");
        const freshMarket = await external("final_market", () =>
          deps.markets.get(market.id, signal),
        );
        if (run.config.marketScope) {
          assertConfiguredMarket(freshMarket, run.config, now());
          if (protocolForMarket(freshMarket, run.config) !== protocol) {
            throw new PilotError("MARKET_CLASSIFICATION_CHANGED", "Market protocol changed");
          }
        } else {
          assertMarket(freshMarket, run.config.categoryIds ?? [], now());
        }
        const exclusion = configuredMarketExclusion(freshMarket, run.config, now());
        if (exclusion) {
          throw new PilotError("NO_ELIGIBLE_MARKETS", exclusion);
        }
        await guard("getOrderBook");
        const fresh = await external("final_quote", () =>
          deps.markets.book(decision.outcomeId!, signal),
        );
        const ask = fresh.asks[0];
        if (!ask) {
          throw new PilotError("NO_QUOTE", "No executable ask available");
        }
        observedPrice = ask.price;
      } else {
        if (!decision.abstentionReason) {
          throw new PilotError("INVALID_DECISION", "Abstention requires a reason");
        }
        observedPrice = null;
      }
      await guard();
      const evaluated = evaluateDecision(
        decision,
        observedPrice,
        run.config.uncertaintyPolicy,
        now(),
      );
      const report = protocol
        ? validateReport(
            decision,
            market,
            [...sources.values()],
            researchReferences(market, quotes, availability),
            protocol,
          )
        : undefined;
      const finalDecision = report
        ? {
            ...evaluated,
            schemaVersion: run.config.marketScope ? (4 as const) : (3 as const),
            ...(run.config.marketScope ? { protocol: protocol! } : {}),
            forecast: report.forecast,
            coverage: report.sections,
          }
        : evaluated;
      await event("policy_evaluation", finalDecision.policyEvaluation);
      await repo.finish(run, finalDecision, null, now());
    } catch (error) {
      if (error instanceof PilotError && error.code === "LEASE_LOST") {
        throw error;
      }
      await repo.assertOwnership(run);
      if (error instanceof ModelFailure) {
        await event("model_failure", { code: error.code, ...error.details });
      }
      const code =
        error instanceof PilotError
          ? error.code
          : signal.aborted
            ? "DEADLINE_OR_CANCELLED"
            : "PROVIDER_OR_MODEL_FAILURE";
      await repo.finish(run, null, code, now());
    }
  };
}
