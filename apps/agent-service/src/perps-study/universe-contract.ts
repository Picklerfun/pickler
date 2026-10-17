import { createHash } from "node:crypto";
import type { PerpsSmaUniverseConfig, PerpsEvidence } from "@pickler/trading/evaluation";
import { syntheticEvidence, syntheticFrame } from "./sma-review-contract.js";
/** Five known, coherent openings. Live Exa output never supplies synthetic market facts. */
export function syntheticUniverseEvidence(
  config: PerpsSmaUniverseConfig,
  now: number,
): PerpsEvidence {
  const base = syntheticEvidence(now);
  const frames = config.markets.map(({ symbol, marketId }) => {
    const frame = syntheticFrame(now, symbol);
    frame.snapshot.market.sizeDecimals = 2;
    frame.snapshot.market.marketId = marketId;
    frame.snapshot.market.perpetualId = marketId;
    frame.book.market = frame.snapshot.market;
    frame.hash = createHash("sha256")
      .update(JSON.stringify({ snapshot: frame.snapshot, book: frame.book }))
      .digest("hex");
    return frame;
  });
  return {
    observedAt: now,
    frames,
    sourceIds: config.markets.flatMap((m) => [
      `${m.symbol}:market`,
      `${m.symbol}:book`,
      `${m.symbol}:candles`,
    ]),
    candles: frames.map((frame, index) => ({
      ...structuredClone(base.candles[0]!),
      market: frame.snapshot.market,
      candles: base.candles[0]!.candles.map((c) => ({ ...c, close: index < 5 ? c.close : "100" })),
    })),
  };
}
