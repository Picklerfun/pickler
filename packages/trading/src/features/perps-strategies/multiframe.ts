import { PilotError, type PerpSymbol } from "@pickler/core";
import { paperUnits as u, paperDecimal as d } from "../perps-paper/decimal.js";
import { validatePaperFrame } from "../perps-paper/simulation.js";
import type { PerpsDecisionContext, PerpsEvidence, PerpsProposal } from "./types.js";

/** Experimental activity hurdle, NOT an expected return or a calibrated forecast. */
export const PERPS_MULTIFRAME_POLICY = Object.freeze({
  version: "1.1.0",
  horizonMs: 30 * 60000,
  decisionIntervalMs: 15 * 60000,
  resolutions: Object.freeze([3600, 900, 300]),
  candleCount: 60,
  trendGapBps: 10,
  costMultiplier: 1.5,
  slippageAllowanceBpsPerSide: 5,
  notionalAUSD: 100,
});

export function validateMultiframeEvidence(evidence: PerpsEvidence): void {
  for (const symbol of ["BTC", "ETH"] as const) {
    const frames = evidence.frames.filter((f) => f.snapshot.market.symbol === symbol);
    if (frames.length !== 1) {
      throw new PilotError("INVALID_MARKET_DATA", "Exactly one frame per asset required");
    }
    const frame = frames[0]!;
    if (
      u(frame.snapshot.market.fees.taker) < 0n ||
      u(frame.snapshot.market.fees.taker) >= u("1") ||
      (frame.snapshot.funding &&
        (!Number.isFinite(Number(frame.snapshot.funding.rate)) ||
          frame.snapshot.funding.intervalSeconds <= 0))
    ) {
      throw new PilotError("INVALID_MARKET_DATA", "Invalid cost metadata");
    }
    for (const levels of [frame.book.bids, frame.book.asks]) {
      if (levels.some((l) => u(l.price) <= 0n || u(l.size) <= 0n)) {
        throw new PilotError("INVALID_MARKET_DATA", "Invalid price or depth");
      }
    }
    if (
      frame.book.bids[0] &&
      frame.book.asks[0] &&
      u(frame.book.bids[0].price) > u(frame.book.asks[0].price)
    ) {
      throw new PilotError("INVALID_MARKET_DATA", "Crossed order book");
    }
    validatePaperFrame(
      frame,
      frame.snapshot.market.provenance.network,
      symbol,
      evidence.observedAt,
    );
    for (const resolution of PERPS_MULTIFRAME_POLICY.resolutions) {
      const matches = evidence.candles.filter(
        (s) => s.market.symbol === symbol && s.resolution === resolution,
      );
      const series = matches[0];
      const interval = resolution * 1000;
      const end = Math.floor(evidence.observedAt / interval) * interval;
      if (
        matches.length !== 1 ||
        !series ||
        series.market.marketId !== frame.snapshot.market.marketId ||
        series.market.configVersion !== frame.snapshot.market.configVersion ||
        series.provenance.network !== frame.snapshot.market.provenance.network
      ) {
        throw new PilotError(
          "INVALID_MARKET_DATA",
          "Candle identity does not match the execution market",
        );
      }
      if (
        series.to !== end ||
        series.from !== end - 60 * interval ||
        series.candles.length !== 60 ||
        series.missingOpenTimes.length
      ) {
        throw new PilotError(
          "DATA_UNAVAILABLE",
          "Sixty current closed candles per timeframe required",
        );
      }
      for (const [i, c] of series.candles.entries()) {
        if (
          !c.closed ||
          c.openTime !== series.from + i * interval ||
          c.openTime + interval > evidence.observedAt ||
          u(c.low) <= 0n ||
          u(c.high) < u(c.low) ||
          u(c.open) < u(c.low) ||
          u(c.open) > u(c.high) ||
          u(c.close) < u(c.low) ||
          u(c.close) > u(c.high) ||
          u(c.volumeCollateral) < 0n
        ) {
          throw new PilotError("INVALID_MARKET_DATA", "Invalid or nonconsecutive closed candle");
        }
      }
    }
  }
}

export function multiframeFeatures(context: PerpsDecisionContext, symbol: PerpSymbol) {
  const candles = (resolution: number) =>
    context.evidence.candles.find((c) => c.market.symbol === symbol && c.resolution === resolution)!
      .candles;
  const hourly = candles(3600).slice(-50);
  const five = candles(300);
  const fifteen = candles(900);
  const fast = hourly.slice(-20).reduce((s, c) => s + u(c.close), 0n) * 50n;
  const slow = hourly.reduce((s, c) => s + u(c.close), 0n) * 20n;
  const trend =
    fast * 1000n > slow * 1001n ? "long" : fast * 1000n < slow * 999n ? "short" : "neutral";
  const change = (a: string, b: string) => Number(((u(b) - u(a)) * 1000000n) / u(a)) / 100;
  const momentum5Bps = change(five.at(-4)!.close, five.at(-1)!.close);
  const momentum15Bps = change(fifteen.at(-2)!.close, fifteen.at(-1)!.close);
  const frame = context.evidence.frames.find((f) => f.snapshot.market.symbol === symbol)!;
  const bid = frame.book.bids[0];
  const ask = frame.book.asks[0];
  const funding = frame.snapshot.funding;
  const spreadBps = bid && ask ? change(bid.price, ask.price) : null;
  const feeBps = Number((u(frame.snapshot.market.fees.taker) * 1000000n) / u("1")) / 100;
  const fundingBps =
    funding && funding.intervalSeconds > 0
      ? Math.abs(Number(funding.rate)) *
        10000 *
        Math.ceil(PERPS_MULTIFRAME_POLICY.horizonMs / (funding.intervalSeconds * 1000))
      : null;
  const estimatedRoundTripBps =
    spreadBps !== null && fundingBps !== null
      ? spreadBps +
        feeBps * 2 +
        PERPS_MULTIFRAME_POLICY.slippageAllowanceBpsPerSide * 2 +
        fundingBps
      : null;
  return {
    symbol,
    trend,
    momentum5Bps,
    momentum15Bps,
    spreadBps,
    feeBps,
    fundingBps,
    estimatedRoundTripBps,
    activityHurdleBps:
      estimatedRoundTripBps === null
        ? null
        : estimatedRoundTripBps * PERPS_MULTIFRAME_POLICY.costMultiplier,
    activityIsNotExpectedReturn: true,
  };
}

export function gateMultiframeProposal(
  context: PerpsDecisionContext,
  proposal: PerpsProposal,
): PerpsProposal {
  return gateEntry(context, proposal, true, true);
}

/** Laboratory ablation only; the historical public gate always enables both filters. */
export function gateSmaEntry(
  context: PerpsDecisionContext,
  proposal: PerpsProposal,
  variant: import("../perps-study/types.js").SmaVariant,
): PerpsProposal {
  if (variant === "sma-hourly" && proposal.action.startsWith("open-")) {
    const trend = multiframeFeatures(context, proposal.symbol).trend;
    const direction = proposal.action === "open-long" ? "long" : "short";
    if (trend !== direction) {
      return { ...proposal, action: "hold", reason: "TREND_NOT_CONFIRMED" };
    }
  }
  return gateEntry(context, proposal, variant !== "sma-hourly", variant === "sma-multiframe");
}

function gateEntry(
  context: PerpsDecisionContext,
  proposal: PerpsProposal,
  directionFilter: boolean,
  activityFilter: boolean,
): PerpsProposal {
  const position = context.account.positions.find(
    (p) => p.symbol === proposal.symbol && p.closedAt === null,
  );
  const blocked = (reason: string): PerpsProposal => ({ ...proposal, action: "hold", reason });
  if (
    position &&
    context.evidence.observedAt - position.openedAt >= PERPS_MULTIFRAME_POLICY.horizonMs
  ) {
    return { ...proposal, action: "close", reason: "HORIZON_EXIT" };
  }
  if (!proposal.action.startsWith("open-")) {
    return proposal;
  }
  if (position) {
    return blocked("POSITION_ALREADY_OPEN");
  }
  const f = multiframeFeatures(context, proposal.symbol);
  const direction = proposal.action === "open-long" ? "long" : "short";
  const sign = direction === "long" ? 1 : -1;
  if (
    directionFilter &&
    (f.trend !== direction || f.momentum5Bps * sign <= 0 || f.momentum15Bps * sign <= 0)
  ) {
    return blocked("DIRECTION_NOT_CONFIRMED");
  }
  if (f.activityHurdleBps === null || !Number.isFinite(f.activityHurdleBps)) {
    return blocked("COST_DATA_UNAVAILABLE");
  }
  if (
    activityFilter &&
    (Math.abs(f.momentum5Bps) <= f.activityHurdleBps ||
      Math.abs(f.momentum15Bps) <= f.activityHurdleBps)
  ) {
    return blocked("RECENT_MOVE_BELOW_COST_HURDLE");
  }
  const depth = multiframeDepth(context, proposal.symbol, direction);
  if (depth < u("100")) {
    return blocked("INSUFFICIENT_DEPTH");
  }
  return proposal;
}

export function perpsMultiframeRules(context: PerpsDecisionContext): PerpsProposal[] {
  validateMultiframeEvidence(context.evidence);
  return (["BTC", "ETH"] as const).map((symbol) => {
    const f = multiframeFeatures(context, symbol);
    const position = context.account.positions.find(
      (p) => p.symbol === symbol && p.closedAt === null,
    );
    let action: PerpsProposal["action"] = "hold";
    if (position) {
      if (f.trend !== position.side || f.momentum5Bps * (position.side === "long" ? 1 : -1) < 0) {
        action = "close";
      }
    } else if (f.trend !== "neutral") {
      action = f.trend === "long" ? "open-long" : "open-short";
    }
    return gateMultiframeProposal(context, {
      symbol,
      action,
      reason: `MULTIFRAME_${f.trend}`,
      sourceIds: [
        `${symbol}:candles`,
        `${symbol}:candles:300`,
        `${symbol}:candles:900`,
        `${symbol}:book`,
        `${symbol}:market`,
      ],
    });
  });
}

function multiframeDepth(
  context: PerpsDecisionContext,
  symbol: PerpSymbol,
  direction: "long" | "short",
) {
  const frame = context.evidence.frames.find((f) => f.snapshot.market.symbol === symbol)!;
  const levels = direction === "long" ? frame.book.asks : frame.book.bids;
  const best = u(levels[0]!.price);
  return levels
    .filter((l) =>
      direction === "long"
        ? u(l.price) * 10000n <= best * 10050n
        : u(l.price) * 10000n >= best * 9950n,
    )
    .reduce((sum, l) => sum + (u(l.price) * u(l.size)) / u("1"), 0n);
}

/** Diagnostic trace only: the authoritative gate still determines the action and first reason. */
export function traceMultiframeProposal(context: PerpsDecisionContext, proposal: PerpsProposal) {
  const executable = gateMultiframeProposal(context, proposal);
  const f = multiframeFeatures(context, proposal.symbol);
  const position = context.account.positions.find(
    (p) => p.symbol === proposal.symbol && p.closedAt === null,
  );
  const direction = proposal.action === "open-short" ? "short" : "long";
  const sign = direction === "long" ? 1 : -1;
  const hourly = context.evidence.candles
    .find((c) => c.market.symbol === proposal.symbol && c.resolution === 3600)!
    .candles.slice(-50);
  const frame = context.evidence.frames.find((v) => v.snapshot.market.symbol === proposal.symbol)!;
  const levels = direction === "long" ? frame.book.asks : frame.book.bids;
  const depth = levels.length ? multiframeDepth(context, proposal.symbol, direction) : null;
  const costKnown = f.activityHurdleBps !== null && Number.isFinite(f.activityHurdleBps);
  const checks = [
    {
      code: "POSITION_ALREADY_OPEN",
      passed: !position,
      value: position?.side ?? null,
      limit: "no open position",
    },
    {
      code: "DIRECTION_NOT_CONFIRMED",
      passed: f.trend === direction && f.momentum5Bps * sign > 0 && f.momentum15Bps * sign > 0,
      value: { trend: f.trend, momentum5Bps: f.momentum5Bps, momentum15Bps: f.momentum15Bps },
      limit: { direction, directionalMomentumStrictlyAbove: 0 },
    },
    {
      code: "COST_DATA_UNAVAILABLE",
      passed: costKnown,
      value: f.activityHurdleBps,
      limit: "known finite costs",
    },
    {
      code: "RECENT_MOVE_BELOW_COST_HURDLE",
      passed: costKnown
        ? Math.abs(f.momentum5Bps) > f.activityHurdleBps! &&
          Math.abs(f.momentum15Bps) > f.activityHurdleBps!
        : null,
      value: { five: Math.abs(f.momentum5Bps), fifteen: Math.abs(f.momentum15Bps) },
      limit: f.activityHurdleBps,
    },
    {
      code: "INSUFFICIENT_DEPTH",
      passed: depth === null ? null : depth >= u("100"),
      value: depth === null ? null : d(depth),
      limit: "100 AUSD within 50 bps",
    },
  ];
  return {
    proposal,
    executable,
    firstBlock:
      executable.action === "hold" && proposal.action.startsWith("open-")
        ? executable.reason
        : null,
    entryApplicable: proposal.action.startsWith("open-") && executable.reason !== "HORIZON_EXIT",
    horizon: {
      positionAgeMs: position ? context.evidence.observedAt - position.openedAt : null,
      limitMs: PERPS_MULTIFRAME_POLICY.horizonMs,
      triggered: executable.reason === "HORIZON_EXIT",
    },
    sma20: d(hourly.slice(-20).reduce((sum, c) => sum + u(c.close), 0n) / 20n),
    sma50: d(hourly.reduce((sum, c) => sum + u(c.close), 0n) / 50n),
    features: f,
    checks,
    coincidentBlocks: checks.filter((c) => c.passed === false).map((c) => c.code),
  };
}
