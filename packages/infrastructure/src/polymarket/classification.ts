import {
  selectedSports,
  type MarketClassification,
  type MarketScope,
  type SportId,
} from "@pickler/core";

/** Verified Gamma tags, 2026-09-17. Ambiguous `football` tag 10 is deliberately excluded. */
export const SPORT_TAGS: Record<SportId, readonly string[]> = {
  soccer: ["100350", "82", "306", "1234"],
  "american-football": ["450", "100351", "102160", "636", "104982"],
  basketball: ["28", "745"],
  tennis: ["864"],
};
export function scopeTags(scope: MarketScope): string[] {
  const sports = selectedSports(scope);
  // Interleave each sport's primary tag before aliases; five total scan pages remain shared.
  const result: string[] = [];
  for (let index = 0; index < 5; index++) {
    for (const sport of sports) {
      const tag = SPORT_TAGS[sport][index];
      if (tag) {
        result.push(tag);
      }
    }
  }
  return result;
}
export function classifyPolymarket(
  tagIds: string[],
  market: {
    question: string;
    sportsMarketType?: string | null | undefined;
    gameStartTime?: string | null | undefined;
  },
): MarketClassification | undefined {
  const sports = (Object.keys(SPORT_TAGS) as SportId[]).filter((sport) =>
    SPORT_TAGS[sport].some((id) => tagIds.includes(id)),
  );
  if (sports.length !== 1) {
    return undefined;
  }
  let temporalClass: MarketClassification["temporalClass"] = "unknown";
  let temporalBasis = "unclassified";
  const isGame =
    tagIds.includes("100639") ||
    ["moneyline", "spreads", "spread", "totals", "total", "child_moneyline"].includes(
      market.sportsMarketType ?? "",
    );
  const award = tagIds.includes("18");
  const season =
    tagIds.includes("397") ||
    tagIds.includes("100240") ||
    ["futures", "outright", "season", "championship"].includes(market.sportsMarketType ?? "") ||
    /^Will .+ win the \d{4}(?:-\d{2,4})? .*(?:Championship|NBA Finals|Super Bowl)\?$/i.test(
      market.question,
    );
  if (isGame && !award && !season) {
    temporalClass = "match";
    temporalBasis = "game-tag-or-market-type";
  } else if (award && !isGame && !season) {
    temporalClass = "award";
    temporalBasis = "award-tag:18";
  } else if (season && !isGame && !award) {
    temporalClass = "season";
    temporalBasis = "season-tag-type-or-anchored-championship-title-v1";
  }
  return {
    version: 1,
    category: "sports",
    subcategory: sports[0]!,
    temporalClass,
    ...(tagIds.includes("450") ? { league: "nfl" as const } : {}),
    provenance: {
      provider: "polymarket",
      mappingVersion: "1.0.0",
      tagIds: [...tagIds],
      temporalBasis,
    },
  };
}
