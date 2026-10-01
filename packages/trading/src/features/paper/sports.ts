import { PilotError, isSoccerFullGameWinner, nflMarketEligible, type Market } from "@pickler/core";

/** Deliberately excludes awards, seasons, handicaps and unidentified sporting periods. */
export function assertPaperMarket(market: Market): void {
  const nfl =
    market.classification?.subcategory === "american-football" &&
    market.classification.league === "nfl" &&
    market.classification.temporalClass === "match" &&
    nflMarketEligible(market);
  if (!nfl && !isSoccerFullGameWinner(market)) {
    throw new PilotError(
      "PAPER_UNSUPPORTED_MARKET",
      "Paper supports NFL and soccer full-game winners with explicit rules",
    );
  }
}
