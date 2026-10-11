import { PilotError, type PerpCandles } from "@pickler/core";
import type { PtsBar, PtsPeriod, PtsCoverage, PtsHistory } from "./types.js";
import { units, decimal } from "./math.js";
export const PTS_MINIMUM = { "1M": 24, "1w": 104, "1d": 240, "4h": 180, "1h": 168 } as const;
export const DAY = 86400000;
export function periodStart(at: number, period: PtsPeriod): number {
  if (!Number.isSafeInteger(at) || at < 0) {
    throw new PilotError("INVALID_INPUT", "Invalid UTC time");
  }
  const day = Math.floor(at / DAY) * DAY;
  if (period === "1M") {
    const d = new Date(at);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }
  if (period === "1w") {
    return day - ((new Date(day).getUTCDay() + 6) % 7) * DAY;
  }
  const interval = period === "1d" ? DAY : period === "4h" ? 4 * 3600000 : 3600000;
  return Math.floor(at / interval) * interval;
}
export function nextPeriod(at: number, period: PtsPeriod, delta = 1): number {
  if (period === "1M") {
    const d = new Date(at);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1);
  }
  const interval =
    period === "1w" ? 7 * DAY : period === "1d" ? DAY : period === "4h" ? 14400000 : 3600000;
  return at + delta * interval;
}
export function closedSeries(series: PerpCandles, now: number): PtsBar[] {
  const interval = series.resolution * 1000;
  const result = series.candles
    .filter((c) => c.closed && c.openTime + interval <= now)
    .map((c) => ({ ...c, closeTime: c.openTime + interval }));
  let previous = -1;
  for (const c of result) {
    if (
      !Number.isSafeInteger(c.openTime) ||
      c.openTime % interval !== 0 ||
      c.openTime <= previous ||
      units(c.low) <= 0n ||
      units(c.high) < units(c.low) ||
      units(c.open) < units(c.low) ||
      units(c.open) > units(c.high) ||
      units(c.close) < units(c.low) ||
      units(c.close) > units(c.high)
    ) {
      throw new PilotError(
        "INVALID_MARKET_DATA",
        "Invalid, duplicate or unordered closed PTS candle",
      );
    }
    previous = c.openTime;
  }
  return result;
}
/** No aggregate is created unless every native day in its UTC bucket is present and closed. */
export function aggregateDays(days: readonly PtsBar[], period: "1M" | "1w", now: number): PtsBar[] {
  const groups = new Map<number, PtsBar[]>();
  for (const c of days) {
    const at = periodStart(c.openTime, period);
    groups.set(at, [...(groups.get(at) ?? []), c]);
  }
  const result: PtsBar[] = [];
  for (const [at, bars] of groups) {
    const end = nextPeriod(at, period),
      count = (end - at) / DAY;
    if (end > now || bars.length !== count || bars.some((b, i) => b.openTime !== at + i * DAY)) {
      continue;
    }
    result.push({
      ...bars[0]!,
      openTime: at,
      closeTime: end,
      close: bars.at(-1)!.close,
      high: bars.reduce((a, b) => (units(a.high) > units(b.high) ? a : b)).high,
      low: bars.reduce((a, b) => (units(a.low) < units(b.low) ? a : b)).low,
      volumeCollateral: decimal(bars.reduce((total, b) => total + units(b.volumeCollateral), 0n)),
      trades: bars.reduce((total, b) => total + b.trades, 0),
      closed: true,
    });
  }
  return result;
}
export function ptsSeries(history: PtsHistory, now: number): Record<PtsPeriod, PtsBar[]> {
  const mapped = new Map<number, PtsBar[]>();
  for (const resolution of [86400, 14400, 3600]) {
    const matches = history.series.filter((s) => s.resolution === resolution);
    if (matches.length > 1) {
      throw new PilotError("INVALID_MARKET_DATA", "Ambiguous PTS series revision");
    }
    const s = matches[0];
    if (
      s &&
      (s.market.marketId !== history.market.marketId ||
        s.market.symbol !== history.market.symbol ||
        s.market.perpetualId !== history.market.perpetualId ||
        s.market.instanceId !== history.market.instanceId ||
        s.market.exchangeAddress !== history.market.exchangeAddress ||
        s.market.priceDecimals !== history.market.priceDecimals ||
        s.market.sizeDecimals !== history.market.sizeDecimals ||
        s.market.collateral.address !== history.market.collateral.address ||
        s.market.collateral.symbol !== history.market.collateral.symbol ||
        s.provenance.provider !== "perpl" ||
        s.provenance.network !== history.market.provenance.network)
    ) {
      throw new PilotError("PERPL_MARKET_IDENTITY", "PTS history identity mismatch");
    }
    mapped.set(resolution, s ? closedSeries(s, now) : []);
  }
  const days = mapped.get(86400)!;
  return {
    "1d": days,
    "4h": mapped.get(14400)!,
    "1h": mapped.get(3600)!,
    "1M": aggregateDays(days, "1M", now),
    "1w": aggregateDays(days, "1w", now),
  };
}
export function ptsCoverage(series: Record<PtsPeriod, PtsBar[]>, now: number): PtsCoverage[] {
  return (Object.keys(PTS_MINIMUM) as PtsPeriod[]).map((period) => {
    const required = PTS_MINIMUM[period],
      bars = series[period].slice(-required);
    const consecutive = bars.every(
      (b, i) => i === 0 || b.openTime === nextPeriod(bars[i - 1]!.openTime, period),
    );
    const through = bars.at(-1)?.closeTime ?? null;
    const eligible = bars.length >= required && consecutive && through === periodStart(now, period);
    return {
      period,
      required,
      available: series[period].length,
      consecutive,
      completeThrough: through,
      eligible,
      reason: eligible
        ? null
        : bars.length < required
          ? "INSUFFICIENT_HISTORY"
          : !consecutive
            ? "CANDLE_GAP"
            : "HISTORY_NOT_CURRENT",
    };
  });
}
