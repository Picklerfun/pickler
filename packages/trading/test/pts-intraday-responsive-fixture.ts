import type { PerpCandles } from "@pickler/core";
import type { PerpsEvidence } from "../src/evaluation.js";
import {
  analyzePts,
  PTS_CATALOG,
  PTS_INTRADAY_RESPONSIVE_VERSION,
  type PtsHistory,
} from "../src/pts.js";
import { fastFixture, fastEvidence, fastTime } from "./pts-intraday-fast-fixture.js";

export const responsiveTime = fastTime;
/** Synthetic native series only. Never retime or replace captured Perpl bars this way. */
export function responsiveFixture(symbol = "BTC", short = false, at = responsiveTime): PtsHistory {
  const source = fastFixture(symbol, short, at);
  const end = (resolution: number) => Math.floor(at / (resolution * 1000)) * resolution * 1000;
  const template = source.series[0]!;
  const prefix = Array.from({ length: 36 }, () => ({ ...template.candles[0]! }));
  const primaryBars = [...prefix, ...template.candles].map((bar, i, all) => ({
    ...bar,
    openTime: end(3600) - (all.length - i) * 3600000,
  }));
  const primary: PerpCandles = {
    ...template,
    resolution: 3600,
    from: primaryBars[0]!.openTime,
    to: end(3600),
    candles: primaryBars,
  };
  const make = (resolution: number, count: number): PerpCandles => {
    const candles = Array.from({ length: count }, (_, i) => ({
      ...template.candles[0]!,
      openTime: end(resolution) - (count - i) * resolution * 1000,
      open: "125.0000",
      close: "125.0000",
      high: "126.0000",
      low: "124.0000",
    }));
    return { ...template, resolution, from: candles[0]!.openTime, to: end(resolution), candles };
  };
  const shared = make(900, 240);
  const entry = make(300, 180);
  const set = (
    series: PerpCandles,
    offset: number,
    open: string,
    high: string,
    low: string,
    close = open,
  ) => {
    Object.assign(series.candles.at(-offset)!, { open, high, low, close });
  };
  // The rising edge reaches C=118.1 at -40m; one 15m series owns both channel and impulse.
  set(shared, 17, "90.0000", "91.0000", "77.1368");
  set(shared, 13, "130.0000", "140.0000", "129.0000");
  set(shared, 9, "110.0000", "111.0000", "100.0000");
  set(shared, 5, "140.0000", "150.0000", "139.0000");
  set(shared, 4, "139.0000", "142.0000", "130.0000", "138.0000");
  set(shared, 3, "130.0000", "131.0000", "119.5000", "129.0000");
  set(shared, 2, "123.0000", "128.0000", "118.1000", "127.0000");
  set(shared, 1, "127.0000", "132.0000", "126.0000", "131.0000");
  set(entry, 10, "126.0000", "127.0000", "125.0000");
  set(entry, 9, "125.0000", "126.0000", "123.0000");
  set(entry, 8, "120.0000", "121.0000", "118.1000");
  set(entry, 7, "122.0000", "123.0000", "121.0000");
  set(entry, 6, "124.0000", "125.0000", "123.0000");
  set(entry, 5, "125.0000", "126.0000", "124.0000");
  set(entry, 4, "126.0000", "127.0000", "125.0000");
  set(entry, 3, "127.0000", "129.0000", "126.0000", "128.0000");
  set(entry, 2, "128.0000", "130.0000", "127.0000", "129.0000");
  set(entry, 1, "129.0000", "132.0000", "128.0000", "131.0000");
  if (short) {
    for (const series of [shared, entry]) {
      for (const bar of series.candles) {
        const mirror = (value: string) => (400 - Number(value)).toFixed(4);
        const high = mirror(bar.low);
        const low = mirror(bar.high);
        bar.open = mirror(bar.open);
        bar.close = mirror(bar.close);
        bar.high = high;
        bar.low = low;
      }
    }
  }
  return { ...source, series: [primary, shared, entry] };
}
export function responsiveEvidence(
  at: number,
  short: boolean,
  ratio: string,
  hash: (value: unknown) => string,
): PerpsEvidence {
  const source = fastEvidence(at, short, ratio, hash);
  const histories = PTS_CATALOG.map((market) => responsiveFixture(market.symbol, short));
  for (const history of histories) {
    const setup = analyzePts(history, responsiveTime, PTS_INTRADAY_RESPONSIVE_VERSION).setup;
    if (
      !setup ||
      setup.c.price !== (short ? "281.9000" : "118.1000") ||
      setup.b.price !== (short ? "250.0000" : "150.0000")
    ) {
      throw new Error("Controlled responsive price path does not match its anchors");
    }
  }
  return {
    ...source,
    candles: histories.flatMap((history) => history.series),
    sourceIds: ["controlled-native-responsive-candles"],
  };
}
