import { readQuestionAtLevel, type MarketDetail, type PerpMarket } from "@pickler/core";
import type { MarketDetailDto, PerpMarketDto } from "@pickler/api-schema";

export function toPerpMarketDto(market: PerpMarket): PerpMarketDto {
  return {
    symbol: market.symbol,
    base: market.base,
    accent: market.accent,
    mark: market.mark,
    change24h: market.change24h,
    funding1h: market.funding1h,
    openInterest: market.openInterest,
    maxLeverage: market.maxLeverage,
    agentsReading: market.agentsReading,
    openCalls: market.openCalls,
    lastCall: market.lastCall && { ...market.lastCall },
    note: market.note,
    hourlyReach: market.hourlyReach,
    limits: { ...market.limits },
    source: { ...market.source },
  };
}

export function toMarketDetailDto(detail: MarketDetail): MarketDetailDto {
  return {
    market: toPerpMarketDto(detail.market),
    readQuestion: readQuestionAtLevel("perps", detail.market.symbol, "{level}"),
    calls: detail.calls.map((call) => ({ ...call })),
    trail: [...detail.trail],
  };
}
