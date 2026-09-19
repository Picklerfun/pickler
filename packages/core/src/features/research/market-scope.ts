import { PilotError, assertMarket, isMarketOpen, type AgentConfig, type Market } from "./types.js";
import { marketExclusion } from "./eligibility.js";
import { nflMarketEligible } from "./nfl.js";

export const SPORT_IDS = ["soccer", "american-football", "basketball", "tennis"] as const;
export type SportId = (typeof SPORT_IDS)[number];
export type ResearchProtocol = "nfl-winner-v1" | "general-market-v1";
export interface MarketScope {
  version: 1;
  category: "sports";
  subcategories: SportId[] | "all";
}
export interface MarketClassification {
  version: 1;
  category: "sports";
  subcategory: SportId;
  temporalClass: "match" | "award" | "season" | "unknown";
  league?: "nfl";
  provenance: {
    provider: "polymarket";
    mappingVersion: "1.0.0";
    tagIds: string[];
    temporalBasis: string;
  };
}
export const MARKET_CATALOG = {
  version: 1,
  categories: [
    {
      id: "sports",
      label: "Sports",
      subcategories: [
        { id: "soccer", label: "Soccer" },
        { id: "american-football", label: "American football" },
        { id: "basketball", label: "Basketball" },
        { id: "tennis", label: "Tennis" },
      ],
    },
  ],
} as const;
export function assertMarketScope(scope: MarketScope): void {
  if (
    scope.version !== 1 ||
    scope.category !== "sports" ||
    (scope.subcategories !== "all" &&
      (!Array.isArray(scope.subcategories) ||
        !scope.subcategories.length ||
        scope.subcategories.some((id) => !SPORT_IDS.includes(id)) ||
        new Set(scope.subcategories).size !== scope.subcategories.length))
  ) {
    throw new PilotError("INVALID_INPUT", "Select known sports from catalog version 1");
  }
}
export function selectedSports(scope: MarketScope): readonly SportId[] {
  assertMarketScope(scope);
  return scope.subcategories === "all" ? SPORT_IDS : scope.subcategories;
}
export function hasMarketSelection(config: AgentConfig): boolean {
  return config.marketScope
    ? selectedSports(config.marketScope).length > 0
    : Boolean(config.categoryIds?.length);
}
export function configuredMarketExclusion(
  market: Market,
  config: AgentConfig,
  now: number,
): string | null {
  if (!config.marketScope) {
    if (!market.categoryIds.some((id) => config.categoryIds?.includes(id))) {
      return "CATEGORY_NOT_ALLOWED";
    }
    if (config.researchProtocol && !nflMarketEligible(market)) {
      return "UNSUPPORTED_NFL_MARKET";
    }
    return marketExclusion(market, now, config.discoveryPolicy);
  }
  const classification = market.classification;
  if (!classification || classification.version !== 1 || classification.category !== "sports") {
    return "MARKET_CLASSIFICATION_UNKNOWN";
  }
  if (!selectedSports(config.marketScope).includes(classification.subcategory)) {
    return "SUBCATEGORY_NOT_ALLOWED";
  }
  if (!isMarketOpen(market, now)) {
    return "MARKET_NOT_OPEN";
  }
  if (!market.rules.trim()) {
    return "MISSING_RESOLUTION_RULES";
  }
  if (classification.temporalClass === "match") {
    return marketExclusion(market, now, {
      version: 1,
      mode: "pre-event",
      minLeadMinutes: 15,
      maxHorizonDays: 7,
    });
  }
  if (classification.temporalClass === "award" || classification.temporalClass === "season") {
    return null;
  }
  return "MARKET_TIMING_CLASS_UNKNOWN";
}
export function assertConfiguredMarket(market: Market, config: AgentConfig, now: number): void {
  if (!config.marketScope) {
    assertMarket(market, config.categoryIds ?? [], now);
  }
  const reason = configuredMarketExclusion(market, config, now);
  if (reason) {
    throw new PilotError(reason, "Market does not satisfy configured scope and timing");
  }
}
export function protocolForMarket(
  market: Market,
  config: AgentConfig,
): ResearchProtocol | undefined {
  if (!config.marketScope) {
    return config.researchProtocol;
  }
  return market.classification?.league === "nfl" &&
    market.classification.subcategory === "american-football" &&
    market.classification.temporalClass === "match" &&
    nflMarketEligible(market)
    ? "nfl-winner-v1"
    : "general-market-v1";
}
