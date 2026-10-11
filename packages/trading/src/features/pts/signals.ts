import type { PtsAnalysis, PtsHistory, PtsPivot, PtsSetup, PtsBar } from "./types.js";
import { PTS_VERSION } from "./types.js";
import { ptsSeries, ptsCoverage, DAY } from "./calendar.js";
import { ptsPivots, ptsTrend, ptsChannel, channelDistance } from "./pivots.js";
import { units as u, decimal as d, abs, max, tick, recoveryRatioCompare } from "./math.js";
/** Simple ATR14, retaining its rational numerator for exact threshold comparisons. */
export function ptsAtr(bars: readonly PtsBar[]) {
  const last = bars.slice(-15);
  if (last.length !== 15 || last.some((b, i) => i > 0 && b.openTime !== last[i - 1]!.closeTime)) {
    return null;
  }
  return last
    .slice(1)
    .reduce(
      (sum, b, i) =>
        sum +
        max(
          u(b.high) - u(b.low),
          abs(u(b.high) - u(last[i]!.close)),
          abs(u(b.low) - u(last[i]!.close)),
        ),
      0n,
    );
}
export function ptsSetupKey(
  marketId: number,
  direction: "long" | "short",
  a: PtsPivot,
  b: PtsPivot,
  c: PtsPivot,
) {
  return [marketId, direction, ...[a, b, c].flatMap((p) => [p.openTime, p.price])].join(":");
}
export function analyzePts(history: PtsHistory, now: number): PtsAnalysis {
  const series = ptsSeries(history, now),
    coverage = ptsCoverage(series, now);
  const result: PtsAnalysis = {
    version: PTS_VERSION,
    at: now,
    symbol: history.market.symbol,
    action: "hold",
    reason: "NOT_VERIFIABLE",
    setup: null,
    checks: [],
    coverage,
  };
  const check = (code: string, passed: boolean | null, values: unknown) => {
    result.checks.push({ code, passed, values });
    if (passed !== true) {
      result.reason = code;
    }
    return passed === true;
  };
  if (
    !check(
      "HISTORY_COVERAGE",
      coverage.every((c) => c.eligible),
      coverage,
    )
  ) {
    return result;
  }
  const monthly = ptsPivots(series["1M"], now),
    weekly = ptsPivots(series["1w"], now);
  const trend = ptsTrend(monthly.pivots),
    weekTrend = ptsTrend(weekly.pivots);
  if (
    !check("PRIMARY_TREND", trend === "unknown" ? null : trend !== "neutral", {
      trend,
      pivots: monthly,
    })
  ) {
    return result;
  }
  if (trend !== "long" && trend !== "short") {
    return result;
  }
  if (
    !check("WEEKLY_ALIGNMENT", weekTrend === "unknown" ? null : weekTrend === trend, {
      weekTrend,
      pivots: weekly,
    })
  ) {
    return result;
  }
  const daily = ptsPivots(series["1d"], now).pivots;
  let impulse: [PtsPivot, PtsPivot] | null = null;
  for (let i = 1; i < daily.length; i++) {
    const a = daily[i - 1]!,
      b = daily[i]!;
    if (
      a.kind === (trend === "long" ? "low" : "high") &&
      b.kind !== a.kind &&
      (u(b.price) - u(a.price)) * (trend === "long" ? 1n : -1n) > 0n
    ) {
      impulse = [a, b];
    }
  }
  if (!check("DAILY_IMPULSE", !!impulse, impulse)) {
    return result;
  }
  const [a, b] = impulse!;
  const c = ptsPivots(series["4h"], now)
    .pivots.filter((p) => p.kind === a.kind && p.openTime >= b.closeTime)
    .at(-1);
  if (!check("CONFIRMED_CORRECTION", !!c, c ?? null)) {
    return result;
  }
  if (
    !check("FORMATION_WINDOW", c!.confirmedAt <= b.closeTime + 30 * DAY, {
      bAt: b.closeTime,
      cKnownAt: c!.confirmedAt,
      maximumMs: 30 * DAY,
    })
  ) {
    return result;
  }
  const numerator = (u(b.price) - u(c!.price)) * (trend === "long" ? 1n : -1n),
    span = abs(u(b.price) - u(a.price));
  if (
    !check("RETRACEMENT_61_78", numerator * 100n >= span * 61n && numerator * 100n <= span * 78n, {
      numerator: numerator.toString(),
      denominator: span.toString(),
      inclusive: ["0.61", "0.78"],
      a,
      b,
      c,
    })
  ) {
    return result;
  }
  const channel = ptsChannel(ptsPivots(series["1w"], c!.confirmedAt).pivots, trend, c!.confirmedAt);
  if (
    !check(
      "WEEKLY_CHANNEL",
      !!channel && ptsTrend(ptsPivots(series["1w"], c!.confirmedAt).pivots) === trend,
      { channel, contactsRequired: 3 },
    )
  ) {
    return result;
  }
  const atr = ptsAtr(series["1d"].filter((p) => p.closeTime <= c!.confirmedAt));
  if (
    !check("ATR14", atr !== null && atr > 0n, {
      numerator: atr?.toString() ?? null,
      denominator: "14",
    })
  ) {
    return result;
  }
  const distance = channelDistance(channel!, c!.price, c!.openTime),
    t = tick(history.market.priceDecimals);
  const toleranceNumerator = max(2n * t * 56n, atr!);
  if (
    !check(
      "CHANNEL_CONFLUENCE",
      distance.numerator * 56n <= toleranceNumerator * distance.denominator,
      {
        distanceNumerator: distance.numerator.toString(),
        distanceDenominator: distance.denominator.toString(),
        toleranceNumerator: toleranceNumerator.toString(),
        toleranceDenominator: "56",
      },
    )
  ) {
    return result;
  }
  const knownAt = Math.max(
    a.confirmedAt,
    b.confirmedAt,
    c!.confirmedAt,
    channel!.first.confirmedAt,
    channel!.second.confirmedAt,
    channel!.opposite.confirmedAt,
  );
  const hourly = series["1h"];
  let trigger: PtsBar | null = null;
  for (let i = 1; i < hourly.length; i++) {
    const current = hourly[i]!,
      previous = hourly[i - 1]!;
    if (
      current.openTime === previous.closeTime &&
      current.closeTime > knownAt &&
      recoveryRatioCompare(current.close, c!.price, b.price, "0.38") > 0 &&
      recoveryRatioCompare(previous.close, c!.price, b.price, "0.38") <= 0
    ) {
      trigger = current;
    }
  }
  if (
    !check("RECOVERY_CROSS_38", !!trigger, {
      trigger,
      cConfirmedAt: c!.confirmedAt,
      setupKnownAt: knownAt,
    })
  ) {
    return result;
  }
  const expiresAt = Math.min(trigger!.closeTime + 900000, c!.confirmedAt + 72 * 3600000);
  if (!check("SIGNAL_WINDOW", now < expiresAt, { now, expiresAt, triggerAt: trigger!.closeTime })) {
    return result;
  }
  // ATR margin is rounded away from C to the native tick, never toward the position.
  const margin = max(t, (atr! + 139n) / 140n),
    roundedMargin = ((margin + t - 1n) / t) * t;
  const stop = u(c!.price) - roundedMargin * (trend === "long" ? 1n : -1n);
  if (!check("STRUCTURAL_STOP", stop > 0n, { stop: d(stop), margin: d(roundedMargin) })) {
    return result;
  }
  const setup: PtsSetup = {
    version: PTS_VERSION,
    id: ptsSetupKey(history.market.marketId, trend, a, b, c!),
    marketId: history.market.marketId,
    symbol: history.market.symbol,
    direction: trend,
    a,
    b,
    c: c!,
    knownAt,
    triggerAt: trigger!.closeTime,
    expiresAt,
    channel: channel!,
    atrNumerator: atr!.toString(),
    atrDenominator: "14",
    tolerance: d((toleranceNumerator + 55n) / 56n),
    toleranceNumerator: toleranceNumerator.toString(),
    toleranceDenominator: "56",
    initialStop: d(stop),
    recovery: { from: c!.price, to: b.price, ratios: ["0.38", "0.495", "0.61", "0.78", "1"] },
  };
  result.action = trend === "long" ? "open-long" : "open-short";
  result.reason = "PTS_RECOVERY_CONFIRMED";
  result.setup = setup;
  return result;
}
export function ptsFillAdmissible(setup: PtsSetup, price: string, now: number) {
  return (
    now >= setup.triggerAt &&
    now < setup.expiresAt &&
    recoveryRatioCompare(price, setup.c.price, setup.b.price, "0.38") > 0 &&
    recoveryRatioCompare(price, setup.c.price, setup.b.price, "0.495") < 0
  );
}
