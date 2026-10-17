import { adviceFixture } from "./advice-fixture.js";
import type { PerpCandles } from "@pickler/core";
import { PTS_CATALOG, DAY, type PtsHistory, type PtsSetup, analyzePts } from "../src/pts.js";
export const ptsTime = Date.UTC(2026, 9, 10, 0, 5);
export function ptsFixture(symbol = "BTC", short = false, now = ptsTime): PtsHistory {
  const market = structuredClone(adviceFixture(now).evidence.frame.snapshot.market);
  const id = PTS_CATALOG.find((m) => m.symbol === symbol)!.marketId;
  Object.assign(market, {
    symbol,
    marketId: id,
    perpetualId: id,
    priceDecimals: 2,
    sizeDecimals: 4,
  });
  const price = (n: number) => (short ? 400 - n : n).toFixed(4);
  const bar = (time: number, center: number) => ({
    openTime: time,
    open: price(center),
    close: price(center),
    high: price(short ? center - 0.1 : center + 0.1),
    low: price(short ? center + 0.1 : center - 0.1),
    volumeCollateral: "1000",
    trades: 1,
    closed: true,
  });
  const end = Math.floor(now / DAY) * DAY;
  const start = Date.UTC(2023, 0, 1);
  const points = [
    [Date.UTC(2026, 6, 13), 80],
    [Date.UTC(2026, 7, 3), 130],
    [Date.UTC(2026, 7, 24), 100],
    [Date.UTC(2026, 7, 31), 120],
    [Date.UTC(2026, 8, 7), 110],
    [Date.UTC(2026, 8, 14), 150],
    [Date.UTC(2026, 9, 9), 122],
  ];
  const days: PerpCandles["candles"] = [];
  for (let time = start; time < end; time += DAY) {
    const dt = new Date(time),
      month = (dt.getUTCFullYear() - 2023) * 12 + dt.getUTCMonth();
    let center = 100 + month * 0.4;
    if (time >= points[0]![0]!) {
      const index = points.findIndex((p) => p[0]! > time);
      if (index < 0) {
        center = points.at(-1)![1]!;
      } else {
        const a = points[index - 1]!,
          b = points[index]!;
        center = a[1]! + ((b[1]! - a[1]!) * (time - a[0]!)) / (b[0]! - a[0]!);
      }
    }
    const c = bar(time, center);
    // Separated highs/lows produce confirmed rising monthly pivots.
    const extremes: Record<string, [string, number]> = {
      "2025-08-10": ["low", 50],
      "2025-11-10": ["high", 160],
      "2026-02-10": ["low", 60],
      "2026-04-10": ["high", 180],
      "2026-06-10": ["low", 70],
      "2026-07-02": ["high", 200],
    };
    const e = extremes[dt.toISOString().slice(0, 10)];
    if (e) {
      c[short ? (e[0] === "high" ? "low" : "high") : (e[0] as "high" | "low")] = price(e[1]);
    }
    if (time === Date.UTC(2026, 9, 9)) {
      c.low = price(short ? 134 : 121.8);
      c.high = price(short ? 121.8 : 134);
      c.open = price(124);
      c.close = price(133);
    }
    days.push(c);
  }
  const make = (
    resolution: 3600 | 14400 | 86400,
    candles: PerpCandles["candles"],
  ): PerpCandles => ({
    market,
    resolution,
    candles,
    from: candles[0]!.openTime,
    to: Math.floor(now / (resolution * 1000)) * resolution * 1000,
    missingOpenTimes: [],
    provenance: market.provenance,
  });
  const series: PerpCandles[] = [make(86400, days)];
  for (const resolution of [14400, 3600] as const) {
    const to = Math.floor(now / (resolution * 1000)) * resolution * 1000;
    const candles = Array.from({ length: resolution === 14400 ? 400 : 900 }, (_, i) =>
      bar(to - (resolution === 14400 ? 400 : 900) * resolution * 1000 + i * resolution * 1000, 125),
    );
    if (resolution === 14400) {
      const c = candles.find((b) => b.openTime === Date.UTC(2026, 9, 9, 8))!;
      c[short ? "high" : "low"] = price(121.8);
    } else {
      candles.at(-2)!.close = price(132);
      candles.at(-2)!.high = price(short ? 124.9 : 132.1);
      candles.at(-2)!.low = price(short ? 132.1 : 124.9);
      candles.at(-1)!.close = price(133);
      candles.at(-1)!.high = price(short ? 124.9 : 133.1);
      candles.at(-1)!.low = price(short ? 133.1 : 124.9);
    }
    series.push(make(resolution, candles));
  }
  return { market, series, capturedAt: now };
}
export function ptsSetup(short = false): PtsSetup {
  const result = analyzePts(ptsFixture("BTC", short), ptsTime);
  if (!result.setup) {
    throw new Error(
      JSON.stringify(
        result.checks.map((c) => ({
          code: c.code,
          passed: c.passed,
          values: c.code === "HISTORY_COVERAGE" ? c.values : undefined,
        })),
      ) +
        " " +
        result.reason,
    );
  }
  return result.setup;
}

import { validateUniverseStream, COMPONENT_PAPER_POLICY } from "../src/perps.js";
import { recoveryPrice } from "../src/pts.js";
import type { PerpsEvidence } from "../src/evaluation.js";
export function ptsEvidence(
  time = ptsTime,
  short = false,
  ratio = "0.40",
  hash: (v: unknown) => string,
): PerpsEvidence {
  const histories = PTS_CATALOG.map((m) => ptsFixture(m.symbol, short, ptsTime));
  const components = histories.map((history) => {
    const market = history.market;
    Object.assign(market.provenance, {
      network: "mainnet",
      chainId: 143,
      receivedAt: time,
      providerTimestamp: time,
      block: 100 + Math.floor((time - ptsTime) / 60000),
    });
    for (const series of history.series) {
      series.provenance = market.provenance;
    }
    const setup = analyzePts(history, ptsTime).setup!;
    const price = recoveryPrice(setup.c.price, setup.b.price, ratio);
    const snapshot = {
      market,
      ticker: {
        mark: price,
        index: price,
        last: price,
        bid: price,
        ask: price,
        openInterestBase: "20",
        freshness: "fresh" as const,
        provenance: market.provenance,
      },
      funding: null,
    };
    const book = {
      market,
      requestedLevels: 20,
      depthLimited: true as const,
      bids: [{ price, size: "100", orders: 1 }],
      asks: [{ price, size: "100", orders: 1 }],
      freshness: "fresh" as const,
      provenance: market.provenance,
    };
    return { symbol: market.symbol, snapshot, book };
  });
  const result = validateUniverseStream({
    network: "mainnet",
    markets: PTS_CATALOG,
    now: time,
    hash,
    policy: COMPONENT_PAPER_POLICY,
    buffer: {
      generation: 1,
      observedAt: time,
      continuity: {
        heartbeatSequence: Math.floor(time / 1000),
        headBlock: 100 + Math.floor((time - ptsTime) / 60000),
        heartbeatReceivedAt: time,
      },
      components,
    },
  });
  if (result.excluded.length) {
    throw new Error(JSON.stringify(result.excluded));
  }
  return {
    observedAt: time,
    frames: result.frames,
    candles: histories.flatMap((h) => h.series),
    sourceIds: ["controlled-PTS-candles"],
  };
}
