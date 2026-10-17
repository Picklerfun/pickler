import type { TokenMarketDto } from "@pickler/api-schema";
import type { PricePoint } from "@pickler/ui";
import { formatUnits } from "viem";

const PRICE_WINDOWS = { "1H": 3_600_000, "24H": 86_400_000, "7D": 604_800_000 };
export type TokenPriceRange = keyof typeof PRICE_WINDOWS | "ALL";
type PriceHistory = Pick<TokenMarketDto, "history" | "windowEnd">;

/** Filter recorded observations without changing timestamps or extending prices into idle time. */
export function tokenHistoryForRange(
  market: PriceHistory | null | undefined,
  range: TokenPriceRange,
): TokenMarketDto["history"] {
  if (!market) {
    return [];
  }
  const end = Date.parse(market.windowEnd);
  const start = range === "ALL" ? -Infinity : end - PRICE_WINDOWS[range];
  return market.history.filter((point) => {
    const at = Date.parse(point.at);
    return at >= start && at <= end;
  });
}

/** Prefer 24h, widening only until existing observations can draw a chart. */
export function initialTokenPriceRange(market: PriceHistory | null | undefined): TokenPriceRange {
  for (const range of ["24H", "7D", "ALL"] as const) {
    if (tokenPricePoints(tokenHistoryForRange(market, range)).length > 1) {
      return range;
    }
  }
  return "24H";
}

/** Number conversion is only for chart coordinates; monetary figures stay in prepared units. */
export function tokenPricePoints(history: TokenMarketDto["history"]): PricePoint[] {
  const bySecond = new Map<number, number>();
  for (const point of history) {
    const at = Math.floor(Date.parse(point.at) / 1000) * 1000;
    const value = Number(formatUnits(BigInt(point.priceWad), 18));
    if (Number.isFinite(at) && Number.isFinite(value) && value > 0) {
      bySecond.set(at, value);
    }
  }
  return [...bySecond].map(([at, value]) => ({ at, value })).sort((a, b) => a.at - b.at);
}
