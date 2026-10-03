import type { PerpsDecisionContext } from "@pickler/trading/evaluation";
export function perpsModelState(context: PerpsDecisionContext) {
  return {
    observedAt: context.evidence.observedAt,
    sourceIds: context.evidence.sourceIds,
    markets: context.evidence.frames.map((f) => ({
      symbol: f.snapshot.market.symbol,
      mark: f.snapshot.ticker.mark,
      index: f.snapshot.ticker.index,
      last: f.snapshot.ticker.last,
      timestamp: f.snapshot.ticker.provenance.providerTimestamp,
      book: {
        timestamp: f.book.provenance.providerTimestamp,
        bids: f.book.bids.map((l) => [l.price, l.size]),
        asks: f.book.asks.map((l) => [l.price, l.size]),
      },
      funding: f.snapshot.funding,
      fees: f.snapshot.market.fees,
    })),
    candles: context.evidence.candles.map((c) => ({
      symbol: c.market.symbol,
      resolution: c.resolution,
      columns: ["openTime", "open", "high", "low", "close", "volumeCollateral"],
      rows: c.candles.map((v) => [v.openTime, v.open, v.high, v.low, v.close, v.volumeCollateral]),
      missing: c.missingOpenTimes,
    })),
    account: {
      cash: context.account.cash,
      positions: context.account.positions.filter((p) => p.closedAt === null),
      blocked: context.account.blocked,
      dailyBlocked: context.account.dailyBlocked,
      fundingPending: context.account.fundingPending,
    },
  };
}
