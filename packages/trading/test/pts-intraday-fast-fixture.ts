import type { PerpCandles } from "@pickler/core";
import type { PerpsEvidence } from "../src/evaluation.js";
import { analyzePts, PTS_CATALOG, PTS_INTRADAY_FAST_VERSION, type PtsHistory } from "../src/pts.js";
import { intradayFixture, intradayEvidence, intradayTime } from "./pts-intraday-fixture.js";

export const fastTime = intradayTime;
/** Synthetic native roles. Never use this transformation to relabel recorded market candles. */
export function fastFixture(symbol = "BTC", short = false, at = fastTime): PtsHistory {
  const original = intradayFixture(symbol, short, at);
  const resolutions = [14400, 3600, 900, 300] as const;
  const series = resolutions.map((resolution, index): PerpCandles => {
    const source = original.series[index]!;
    const end = Math.floor(at / (resolution * 1000)) * resolution * 1000;
    const count = source.candles.length;
    const candles = source.candles.map((bar, i) => ({
      ...bar,
      openTime: end - (count - i) * resolution * 1000,
    }));
    if (resolution === 300) {
      // One 5m series owns both C and its later entry cross. C confirms two bars later.
      for (const offset of [2, 1]) {
        const entry = original.series[4]!.candles.at(-offset)!;
        Object.assign(candles.at(-offset)!, {
          open: entry.open,
          close: entry.close,
          high: entry.high,
          low: entry.low,
        });
      }
    }
    return { ...source, resolution, candles, from: candles[0]!.openTime, to: end };
  });
  return { ...original, series };
}
export function fastEvidence(
  at: number,
  short: boolean,
  ratio: string,
  hash: (value: unknown) => string,
): PerpsEvidence {
  const result = intradayEvidence(at, short, ratio, hash);
  const histories = PTS_CATALOG.map((market) => fastFixture(market.symbol, short));
  for (const history of histories) {
    const fast = analyzePts(history, fastTime, PTS_INTRADAY_FAST_VERSION).setup;
    if (
      !fast ||
      fast.c.price !== (short ? "281.9000" : "118.1000") ||
      fast.b.price !== (short ? "250.0000" : "150.0000")
    ) {
      throw new Error("Controlled price path does not match fast setup anchors");
    }
  }
  return {
    ...result,
    candles: histories.flatMap((history) => history.series),
    sourceIds: ["controlled-native-fast-candles"],
  };
}
