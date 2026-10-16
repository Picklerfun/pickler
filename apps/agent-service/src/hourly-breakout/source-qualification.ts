import { PilotError } from "@pickler/core";
import { assertBreakoutMarketIdentity } from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  validatePaperFrameSet,
  type PerpsPaperFrame,
} from "@pickler/trading/perps";
import type { BreakoutClockRecord } from "./clock.js";
import type { CaptureWindow } from "./schedule.js";

export interface SourceQualificationFailure {
  marketId: number;
  code: "BREAKOUT_WINDOW_EXPIRED" | "STALE_MARKET_DATA" | "INCONSISTENT_MARKET_DATA";
}

/** Qualify each market at both outward receipt bounds without losing its valid peers. */
export function qualifySourceFrames(input: {
  frames: readonly PerpsPaperFrame[];
  network: string;
  markets: readonly { marketId: number; symbol: string }[];
  receipt: BreakoutClockRecord;
  window: CaptureWindow;
  completedAt: number;
}) {
  const { frames, receipt, window, completedAt } = input;
  const identities = new Set<number>();
  for (const frame of frames) {
    assertBreakoutMarketIdentity(frame.snapshot.market);
    assertBreakoutMarketIdentity(frame.book.market);
    const marketId = frame.snapshot.market.marketId;
    if (
      identities.has(marketId) ||
      !input.markets.some(
        (market) => market.marketId === marketId && market.symbol === frame.snapshot.market.symbol,
      )
    ) {
      throw new PilotError("BREAKOUT_SOURCE_INVALID", "Copied market identity is not unique");
    }
    identities.add(marketId);
  }
  // This invariant is independent of freshness: an expired component cannot conceal a mixed
  // generation. The native financial validator still validates each proof and every kept set.
  const reference = frames[0]?.streamEvidence;
  if (
    frames.some(
      (frame) =>
        !reference ||
        !frame.streamEvidence ||
        Object.keys(reference).some(
          (key) =>
            frame.streamEvidence![key as keyof typeof reference] !==
            reference[key as keyof typeof reference],
        ),
    )
  ) {
    throw new PilotError("INVALID_MARKET_DATA", "Copied source generations differ");
  }
  const expired =
    completedAt >= window.deadlineAt ||
    receipt.boundary.financial.upperMs >= window.deadlineAt ||
    receipt.boundary.financial.lowerMs < window.dueAt;
  const failures: SourceQualificationFailure[] = [];
  const qualified = new Set<number>();
  for (const frame of frames) {
    const marketId = frame.snapshot.market.marketId;
    try {
      for (const at of [
        Math.floor(receipt.boundary.financial.lowerMs),
        Math.ceil(receipt.boundary.financial.upperMs),
      ]) {
        validatePaperFrameSet([frame], input.network, at, COMPONENT_PAPER_POLICY, at);
      }
      if (expired) {
        failures.push({ marketId, code: "BREAKOUT_WINDOW_EXPIRED" });
      } else {
        qualified.add(marketId);
      }
    } catch (error) {
      if (
        !(error instanceof PilotError) ||
        !["STALE_MARKET_DATA", "INCONSISTENT_MARKET_DATA"].includes(error.code)
      ) {
        throw error;
      }
      failures.push({ marketId, code: error.code as SourceQualificationFailure["code"] });
    }
  }
  const kept = frames.filter((frame) => qualified.has(frame.snapshot.market.marketId));
  for (const at of [
    Math.floor(receipt.boundary.financial.lowerMs),
    Math.ceil(receipt.boundary.financial.upperMs),
  ]) {
    validatePaperFrameSet(kept, input.network, at, COMPONENT_PAPER_POLICY, at);
  }
  return {
    qualifiedMarketIds: input.markets
      .filter((market) => qualified.has(market.marketId))
      .map((market) => market.marketId),
    failures,
  };
}
