import { PERPL_LAB_SYMBOLS, type PerpSymbol } from "@pickler/core";
import type { PerpsSmaReentryConfig, PerpsEvidence } from "@pickler/trading/evaluation";
import { initialPaperAccount, type PerpsPaperAccount } from "@pickler/trading/perps";
import { studyFrame } from "./perps-study-fixtures.js";
export const config: PerpsSmaReentryConfig = {
  version: 7,
  protocol: "perps-sma-reentry-latency-v1",
  tenantId: "alpha",
  sessionId: "reentry-test",
  network: "mainnet",
  hours: 6,
  budgetUsd: "5",
  markets: PERPL_LAB_SYMBOLS.map((symbol, i) => ({
    symbol,
    marketId: [1, 10, 20, 31, 40, 50, 60, 70, 90, 100, 110][i]!,
  })),
};
export const at = 1800000000000;
export function evidence(time = at): PerpsEvidence {
  const frames = config.markets.map((m) => {
    const f = studyFrame(time, m.symbol);
    f.snapshot.market.marketId = m.marketId;
    f.snapshot.market.perpetualId = m.marketId;
    f.book.market = f.snapshot.market;
    return f;
  });
  return {
    observedAt: time,
    frames,
    sourceIds: config.markets.map((m) => `${m.symbol}:candles`),
    candles: frames.flatMap((f) =>
      [3600, 900, 300].map((resolution) => {
        const end = Math.floor(time / (resolution * 1000)) * resolution * 1000;
        return {
          market: f.snapshot.market,
          resolution: resolution as 3600 | 900 | 300,
          from: end - 60 * resolution * 1000,
          to: end,
          missingOpenTimes: [],
          provenance: f.book.provenance,
          candles: Array.from({ length: 60 }, (_, i) => ({
            openTime: end - (60 - i) * resolution * 1000,
            open: "100",
            close: i >= 40 ? "101" : "100",
            high: "102",
            low: "99",
            volumeCollateral: "1000",
            trades: 10,
            closed: true,
          })),
        };
      }),
    ),
  };
}
export function account(selective = false): PerpsPaperAccount {
  const a = initialPaperAccount({ ...config, agentId: "fixture" }, 1, at);
  a.riskManagement = selective ? "buffered-selective-1x-v1" : "legacy-1x-v1";
  a.entryPolicy = "once-hourly-bar-v1";
  a.consumedEntryKeys = [];
  return a;
}
export function position(
  a: PerpsPaperAccount,
  symbol: PerpSymbol,
  qty = "1",
  mark = "100",
  entry = mark,
) {
  a.positions.push({
    id: symbol,
    symbol,
    side: "long",
    quantity: qty,
    entryPrice: entry,
    entryNotional: String(Number(qty) * Number(entry)),
    openedAt: at,
    entryBlock: 1,
    mark,
    markAt: at,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  });
}
