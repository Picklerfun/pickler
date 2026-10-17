import { adviceFixture } from "./advice-fixture.js";
import type { PerpCandles } from "@pickler/core";
import {
  PTS_CATALOG,
  analyzePts,
  PTS_INTRADAY_VERSION,
  recoveryPrice,
  type PtsHistory,
} from "../src/pts.js";
import { validateUniverseStream, COMPONENT_PAPER_POLICY } from "../src/perps.js";
import type { PerpsEvidence } from "../src/evaluation.js";

export const intradayTime = Date.UTC(2026, 9, 11, 12, 1);
/** Native-resolution, closed, synthetic paths: financial fixtures are never market returns. */
export function intradayFixture(symbol = "BTC", short = false, at = intradayTime): PtsHistory {
  const market = structuredClone(adviceFixture(at).evidence.frame.snapshot.market);
  const id = PTS_CATALOG.find((m) => m.symbol === symbol)!.marketId;
  Object.assign(market, {
    symbol,
    marketId: id,
    perpetualId: id,
    priceDecimals: 2,
    sizeDecimals: 4,
  });
  Object.assign(market.provenance, {
    network: "mainnet",
    chainId: 143,
    providerTimestamp: at,
    receivedAt: at,
    block: 100,
  });
  const price = (value: number) => (short ? 400 - value : value).toFixed(4);
  const native = (resolution: 86400 | 14400 | 3600 | 900 | 300, count: number): PerpCandles => {
    const end = Math.floor(at / (resolution * 1000)) * resolution * 1000;
    const candles = Array.from({ length: count }, (_, i) => ({
      openTime: end - (count - i) * resolution * 1000,
      open: price(125),
      close: price(125),
      high: price(short ? 124.9 : 125.1),
      low: price(short ? 125.1 : 124.9),
      volumeCollateral: "1000",
      trades: 1,
      closed: true,
    }));
    const extreme = (i: number, kind: "high" | "low", value: number) => {
      candles[i]![short ? (kind === "high" ? "low" : "high") : kind] = price(value);
    };
    if (resolution === 86400) {
      extreme(10, "low", 80);
      extreme(14, "high", 180);
      extreme(18, "low", 90);
      extreme(22, "high", 200);
    } else if (resolution === 14400) {
      extreme(158, "low", 100);
      extreme(164, "high", 150);
      extreme(170, "low", 110);
      extreme(176, "high", 160);
    } else if (resolution === 3600) {
      extreme(230, "low", 100);
      extreme(236, "high", 150);
    } else if (resolution === 900) {
      extreme(175, "low", 118.1);
    } else {
      for (const [offset, value] of [
        [2, 130.2],
        [1, 130.86],
      ]) {
        const candle = candles.at(-offset!)!;
        candle.close = price(value!);
        candle.high = price(short ? 124.9 : value! + 0.1);
        candle.low = price(short ? value! + 0.1 : 124.9);
      }
    }
    return {
      market,
      resolution,
      candles,
      from: candles[0]!.openTime,
      to: end,
      missingOpenTimes: [],
      provenance: market.provenance,
    };
  };
  return {
    market,
    capturedAt: at,
    series: [
      native(86400, 30),
      native(14400, 180),
      native(3600, 240),
      native(900, 180),
      native(300, 180),
    ],
  };
}
export function intradayEvidence(
  at: number,
  short: boolean,
  ratio: string,
  hash: (v: unknown) => string,
): PerpsEvidence {
  const histories = PTS_CATALOG.map((m) => intradayFixture(m.symbol, short));
  const components = histories.map((h) => {
    const setup = analyzePts(h, intradayTime, PTS_INTRADAY_VERSION).setup;
    if (!setup) {
      throw new Error(JSON.stringify(analyzePts(h, intradayTime, PTS_INTRADAY_VERSION)));
    }
    const market = structuredClone(h.market);
    Object.assign(market.provenance, {
      providerTimestamp: at,
      receivedAt: at,
      block: 100 + Math.floor((at - intradayTime) / 60000),
    });
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
    now: at,
    hash,
    policy: COMPONENT_PAPER_POLICY,
    buffer: {
      generation: 1,
      observedAt: at,
      continuity: {
        heartbeatSequence: Math.floor(at / 1000),
        headBlock: 100 + Math.floor((at - intradayTime) / 60000),
        heartbeatReceivedAt: at,
      },
      components,
    },
  });
  if (result.excluded.length) {
    throw new Error(JSON.stringify(result.excluded));
  }
  return {
    observedAt: at,
    frames: result.frames,
    candles: histories.flatMap((h) => h.series),
    sourceIds: ["controlled-native-intraday-candles"],
  };
}
