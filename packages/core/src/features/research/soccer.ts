import type { Market } from "./types.js";

const REGULATION_TIME = /\b(?:90 minutes|regular time|regulation time)\b/i;
const INCLUDES_EXTRA_TIME = /\b(?:including|includes|after|with) (?:extra time|overtime)\b/i;
const NOT_THE_FULL_GAME = /(?:first half|second half|handicap|spread|total goals|qualif)/i;

/**
 * A soccer match winner whose rules say which period decides it: regulation time, or the game
 * including extra time. Deliberately excludes awards, seasons, handicaps, totals, qualification
 * and halves. Paper orders and live purchases accept the same soccer markets through this.
 */
export function isSoccerFullGameWinner(market: Market): boolean {
  return (
    market.classification?.subcategory === "soccer" &&
    market.classification.temporalClass === "match" &&
    ["moneyline", "match_winner"].includes(market.sportsMarketType ?? "") &&
    (REGULATION_TIME.test(market.rules) || INCLUDES_EXTRA_TIME.test(market.rules)) &&
    !NOT_THE_FULL_GAME.test(market.question)
  );
}
