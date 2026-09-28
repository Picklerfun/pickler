import { PilotError, type Market } from "../research/types.js";
import { nflMarketEligible } from "../research/nfl.js";

/** Deliberately excludes awards, seasons, handicaps and unidentified sporting periods. */
export function assertPaperMarket(market: Market): void {
  const soccer =
    market.classification?.subcategory === "soccer" &&
    market.classification.temporalClass === "match" &&
    ["moneyline", "match_winner"].includes(market.sportsMarketType ?? "") &&
    /\b(?:90 minutes|regular time|regulation time|(?:including|includes|after|with) (?:extra time|overtime))\b/i.test(
      market.rules,
    ) &&
    !/(?:first half|second half|handicap|spread|total goals|qualif)/i.test(market.question);
  const nfl =
    market.classification?.subcategory === "american-football" &&
    market.classification.league === "nfl" &&
    market.classification.temporalClass === "match" &&
    nflMarketEligible(market);
  if (!nfl && !soccer) {
    throw new PilotError(
      "PAPER_UNSUPPORTED_MARKET",
      "Paper supports NFL and soccer full-game winners with explicit rules",
    );
  }
}
