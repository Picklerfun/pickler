import {
  settleComparisonCase,
  type ComparisonCase,
  type QuantInput,
} from "@pickler/trading/strategies";
/** Explicit synthetic contract probe; never used as a substitute for live data. */
export function comparisonProbeInput(now: number): QuantInput {
  const start = Math.floor(now / 300000) * 300000;
  now = start + 70000;
  const rule =
    "Synthetic contract-check fixture, not a real listing. Bitcoin Up or Down over five minutes. Up resolves if the final rolling 60-second BTC/USD TWAP is greater than or equal to the opening threshold from Chainlink; otherwise Down. Coinbase is predictive reference only. https://data.chain.link/streams/btc-usd-twap-60s-streams";
  return {
    item: {
      kind: "btc-5m",
      slug: `btc-updown-5m-${start / 1000}`,
      windowStart: start,
      windowEnd: start + 300000,
      market: {
        id: "synthetic-probe",
        question: "Synthetic Bitcoin Up or Down contract check",
        rules: rule,
        active: true,
        categoryIds: [],
        liquidity: 1000,
        closesAt: new Date(start + 300000).toISOString(),
        outcomes: [
          { id: "up", label: "Up" },
          { id: "down", label: "Down" },
        ],
      },
    },
    rule: { version: 1, lookbackSeconds: 60, provenance: "synthetic-fixture-v1", tie: "up" },
    opening: { price: 100, observedAt: start, url: "https://example.com/synthetic/opening" },
    ticker: {
      price: 101,
      bid: 100.99,
      ask: 101.01,
      observedAt: now,
      url: "https://example.com/synthetic/ticker",
    },
    candles: Array.from({ length: 61 }, (_, i) => ({
      time: Math.floor(now / 60000) * 60000 - (61 - i) * 60000,
      close: 100 * Math.exp((i % 2) * 0.0005),
    })),
    books: ["up", "down"].map((outcomeId) => ({
      outcomeId,
      observedAt: new Date(now).toISOString(),
      bids: [{ price: "0.39", size: "100" }],
      asks: [{ price: "0.40", size: "100" }],
    })),
    conditions: ["up", "down"].map((outcomeId, index) => ({
      marketId: "synthetic-probe",
      outcomeId,
      observedAt: new Date(now).toISOString(),
      minimumNotional: "1",
      minimumShares: "1",
      tickSize: "0.01",
      feeRate: "0.07",
      feeExponent: 1 as const,
      provenance: "synthetic-fixture-v1",
      resolution: { conditionId: `0x${"a".repeat(64)}`, outcomeIndex: index, outcomeCount: 2 },
    })),
    observedAt: now,
  };
}
export function settleComparisonProbe(row: ComparisonCase, now: number) {
  if (row.marketId !== "synthetic-probe" || !row.identities) {
    throw new Error("INVALID_PROBE");
  }
  row.resolutions = row.identities.map((i) => ({
    ...i,
    numerator: i.outcomeId === "up" ? "1" : "0",
    denominator: "1",
    observedAt: new Date(now).toISOString(),
    chainId: 137 as const,
    contract: `0x${"b".repeat(40)}`,
    blockNumber: "1",
    blockHash: `0x${"c".repeat(64)}`,
  }));
  settleComparisonCase(row, now);
}
