import { isMarketOpen, type Market, type DiscoveryPolicy } from "./types.js";

export function marketExclusion(
  market: Market,
  now: number,
  policy?: DiscoveryPolicy,
): string | null {
  if (!isMarketOpen(market, now)) {
    return "MARKET_NOT_OPEN";
  }
  if (policy?.mode !== "pre-event") {
    return null;
  }
  if (
    !market.startsAt ||
    market.timingSource !== "polymarket.gameStartTime" ||
    !Number.isFinite(Date.parse(market.startsAt))
  ) {
    return "UNKNOWN_EVENT_TIME";
  }
  if (/future|outright|season|champion/i.test(market.sportsMarketType ?? "")) {
    return "SEASON_MARKET";
  }
  const lead = Date.parse(market.startsAt) - now;
  if (lead < policy.minLeadMinutes * 60000) {
    return "EVENT_STARTED_OR_TOO_SOON";
  }
  if (lead > policy.maxHorizonDays * 86400000) {
    return "EVENT_OUTSIDE_HORIZON";
  }
  return null;
}
