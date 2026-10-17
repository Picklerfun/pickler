import type { PtsBar, PtsPivot, PtsPivotEvent, PtsDirection, PtsChannel } from "./types.js";
import { units, abs } from "./math.js";
export function ptsPivots(bars: readonly PtsBar[], now: number) {
  const normalized: PtsPivot[] = [],
    events: PtsPivotEvent[] = [];
  for (let i = 2; i + 2 < bars.length; i++) {
    const bar = bars[i]!,
      confirming = bars[i + 2]!;
    if (
      confirming.closeTime > now ||
      bars.slice(i - 2, i + 3).some((b, j, a) => j > 0 && b.openTime !== a[j - 1]!.closeTime)
    ) {
      continue;
    }
    const neighbours = [bars[i - 2]!, bars[i - 1]!, bars[i + 1]!, bars[i + 2]!];
    const high = neighbours.every((b) => units(bar.high) > units(b.high));
    const low = neighbours.every((b) => units(bar.low) < units(b.low));
    if (high && low) {
      events.push({ at: confirming.closeTime, kind: "ambiguous", pivot: null, previous: null });
      continue;
    }
    if (!high && !low) {
      continue;
    }
    const pivot: PtsPivot = {
      kind: high ? "high" : "low",
      openTime: bar.openTime,
      closeTime: bar.closeTime,
      confirmedAt: confirming.closeTime,
      price: high ? bar.high : bar.low,
    };
    const previous = normalized.at(-1) ?? null;
    if (previous?.kind === pivot.kind) {
      const replaces = high
        ? units(pivot.price) > units(previous.price)
        : units(pivot.price) < units(previous.price);
      if (replaces) {
        normalized[normalized.length - 1] = pivot;
      }
      events.push({
        at: pivot.confirmedAt,
        kind: replaces ? "replaced" : "ignored",
        pivot,
        previous,
      });
    } else {
      normalized.push(pivot);
      events.push({ at: pivot.confirmedAt, kind: "confirmed", pivot, previous });
    }
  }
  return { pivots: normalized, events };
}
export function ptsTrend(pivots: readonly PtsPivot[]): PtsDirection | "neutral" | "unknown" {
  const highs = pivots.filter((p) => p.kind === "high").slice(-2),
    lows = pivots.filter((p) => p.kind === "low").slice(-2);
  if (highs.length < 2 || lows.length < 2) {
    return "unknown";
  }
  if (
    units(highs[1]!.price) > units(highs[0]!.price) &&
    units(lows[1]!.price) > units(lows[0]!.price)
  ) {
    return "long";
  }
  if (
    units(highs[1]!.price) < units(highs[0]!.price) &&
    units(lows[1]!.price) < units(lows[0]!.price)
  ) {
    return "short";
  }
  return "neutral";
}
export function channelBase(channel: Pick<PtsChannel, "first" | "second">, at: number) {
  const { first, second } = channel,
    denominator = BigInt(second.openTime - first.openTime);
  return {
    numerator:
      units(first.price) * denominator +
      (units(second.price) - units(first.price)) * BigInt(at - first.openTime),
    denominator,
  };
}
export function ptsChannel(
  pivots: readonly PtsPivot[],
  direction: PtsDirection,
  at: number,
): PtsChannel | null {
  const baseKind = direction === "long" ? "low" : "high";
  const base = pivots.filter((p) => p.kind === baseKind && p.confirmedAt <= at).slice(-2);
  if (base.length !== 2) {
    return null;
  }
  const first = base[0]!,
    second = base[1]!;
  if (
    second.openTime <= first.openTime ||
    (units(second.price) - units(first.price)) * (direction === "long" ? 1n : -1n) <= 0n
  ) {
    return null;
  }
  const opposites = pivots.filter(
    (p) =>
      p.kind !== baseKind &&
      p.openTime > first.openTime &&
      p.openTime < second.openTime &&
      p.confirmedAt <= at,
  );
  let selected: PtsPivot | null = null,
    widest = 0n;
  const denominator = BigInt(second.openTime - first.openTime);
  for (const p of opposites) {
    const edge = channelBase({ first, second }, p.openTime);
    const distance =
      (units(p.price) * denominator - edge.numerator) * (direction === "long" ? 1n : -1n);
    if (distance > widest) {
      selected = p;
      widest = distance;
    }
  }
  if (!selected || widest <= 0n) {
    return null;
  }
  return {
    direction,
    first,
    second,
    opposite: selected,
    frozenAt: at,
    widthNumerator: widest.toString(),
    widthDenominator: denominator.toString(),
  };
}
export function channelDistance(channel: PtsChannel, price: string, at: number) {
  const base = channelBase(channel, at);
  return {
    numerator: abs(units(price) * base.denominator - base.numerator),
    denominator: base.denominator,
  };
}
export function outsideChannel(
  channel: PtsChannel,
  price: string,
  at: number,
  tolerance: string | { numerator: string; denominator: string },
) {
  const base = channelBase(channel, at),
    offset = units(price) * base.denominator - base.numerator;
  const width = BigInt(channel.widthNumerator);
  const fraction =
    typeof tolerance === "string"
      ? { numerator: units(tolerance), denominator: 1n }
      : { numerator: BigInt(tolerance.numerator), denominator: BigInt(tolerance.denominator) };
  const scaledOffset = offset * fraction.denominator,
    scaledWidth = width * fraction.denominator,
    tol = fraction.numerator * base.denominator;
  return channel.direction === "long"
    ? scaledOffset < -tol || scaledOffset > scaledWidth + tol
    : scaledOffset > tol || scaledOffset < -scaledWidth - tol;
}
