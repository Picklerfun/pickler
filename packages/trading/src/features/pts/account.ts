import { PilotError } from "@pickler/core";
import type {
  PerpsPaperAccount,
  PerpsPaperFill,
  PerpsPaperIntent,
  PerpsPaperPosition,
} from "../perps-paper/types.js";
import type { PerpsPaperFrame } from "../perps-paper/simulation.js";
import {
  PTS_ACCOUNT_POLICY,
  PTS_INTRADAY_ACCOUNT_POLICY,
  PTS_INTRADAY_VERSION,
  PTS_INTRADAY_FAST_VERSION,
  PTS_INTRADAY_FAST_ACCOUNT_POLICY,
  PTS_VERSION,
  type PtsSetup,
  type PtsManagement,
  type PtsHistory,
} from "./types.js";
import {
  units as u,
  decimal as d,
  PAPER_SCALE as S,
  abs,
  min,
  floorQuantity,
  recoveryRatioCompare,
} from "./math.js";
import { ptsTemporalProfile } from "./temporal-profile.js";
import { ptsFillAdmissible, ptsSetupKey } from "./signals.js";
import { ptsSeries, DAY, periodStart as importPeriodStart } from "./calendar.js";
import { ptsPivots, ptsTrend, outsideChannel } from "./pivots.js";
export function isPtsAccount(a: PerpsPaperAccount) {
  return ptsAccountVersion(a) !== null;
}
export function ptsAccountVersion(a: PerpsPaperAccount) {
  if (a.scope.sessionId === "product") {
    return null;
  }
  if (a.positionPolicy === PTS_ACCOUNT_POLICY) {
    return PTS_VERSION;
  }
  if (a.positionPolicy === PTS_INTRADAY_ACCOUNT_POLICY) {
    return PTS_INTRADAY_VERSION;
  }
  if (a.positionPolicy === PTS_INTRADAY_FAST_ACCOUNT_POLICY) {
    return PTS_INTRADAY_FAST_VERSION;
  }
  return null;
}
export function ptsPartialSchedule(quantity: string, decimals: number) {
  const q = u(quantity),
    portion = floorQuantity(q / 5n, decimals);
  if (portion <= 0n || q - 2n * portion <= 0n || floorQuantity(q, decimals) !== q) {
    throw new PilotError(
      "PTS_PARTIAL_NOT_EXECUTABLE",
      "All three planned partial quantities must be positive native units",
    );
  }
  return [d(portion), d(portion), d(q - 2n * portion)];
}
export function ptsPlannedLoss(quantity: string, entry: string, stop: string, feeRate: string) {
  const q = u(quantity),
    price = u(entry);
  const numerator = q * abs(price - u(stop)) * S + q * price * (2n * u(feeRate) + u("0.005"));
  return (numerator + S * S - 1n) / (S * S);
}
export function ptsRemainingRisk(p: PerpsPaperPosition) {
  if (!p.pts || p.closedAt !== null) {
    return 0n;
  }
  const adverse = (u(p.entryPrice) - u(p.pts.stop)) * (p.side === "long" ? 1n : -1n);
  const numerator =
    u(p.quantity) * (adverse > 0n ? adverse : 0n) +
    u(p.entryNotional) * (u(p.pts.feeRate) + u("0.005"));
  return (numerator + S - 1n) / S;
}
export function ptsSize(
  a: PerpsPaperAccount,
  setup: PtsSetup,
  projectedPrice: string,
  feeRate: string,
  equity: string | null,
  sizeDecimals: number,
) {
  if (
    !isPtsAccount(a) ||
    equity === null ||
    u(equity) <= 0n ||
    u(feeRate) < 0n ||
    !ptsFillAdmissible(setup, projectedPrice, setup.triggerAt)
  ) {
    return null;
  }
  const price = u(projectedPrice),
    distance = abs(price - u(setup.initialStop));
  const perUnit = distance * S + price * (2n * u(feeRate) + u("0.005"));
  const existing = a.positions.reduce((n, p) => n + ptsRemainingRisk(p), 0n);
  const allowance = min(u(equity) / 100n, (u(equity) * 3n) / 100n - existing);
  if (perUnit <= 0n || allowance <= 0n) {
    return null;
  }
  const q = floorQuantity(min((allowance * S * S) / perUnit, (u("100") * S) / price), sizeDecimals);
  try {
    ptsPartialSchedule(d(q), sizeDecimals);
  } catch {
    return null;
  }
  return {
    quantity: d(q),
    notional: d((q * price) / S),
    plannedLoss: d(ptsPlannedLoss(d(q), projectedPrice, setup.initialStop, feeRate)),
  };
}
export function assertPtsOpening(
  a: PerpsPaperAccount,
  intent: PerpsPaperIntent,
  fill: PerpsPaperFill,
  equity: string | null,
  now: number,
) {
  const setup = intent.pts?.setup;
  const version = ptsAccountVersion(a);
  if (
    !isPtsAccount(a) ||
    !setup ||
    intent.pts?.version !== version ||
    setup.version !== version ||
    setup.id !==
      ptsSetupKey(setup.marketId, setup.direction, setup.a, setup.b, setup.c, setup.version) ||
    setup.symbol !== intent.symbol ||
    setup.direction !== intent.side ||
    fill.market?.marketId !== setup.marketId ||
    !ptsFillAdmissible(setup, fill.price, now) ||
    !equity ||
    u(equity) <= 0n ||
    u(fill.market.fees.taker) < 0n ||
    (u(fill.price) - u(setup.initialStop)) * (intent.side === "long" ? 1n : -1n) <= 0n
  ) {
    throw new PilotError(
      "PTS_ENTRY_REJECTED",
      "PTS setup, structural stop or projected entry is not admissible",
    );
  }
  if (a.consumedPtsSetups?.includes(setup.id)) {
    throw new PilotError("PTS_SETUP_CONSUMED", "This setup already has a confirmed opening");
  }
  ptsPartialSchedule(fill.quantity, fill.market.sizeDecimals);
  const risk = ptsPlannedLoss(fill.quantity, fill.price, setup.initialStop, fill.market.fees.taker);
  const aggregate = a.positions.reduce((n, p) => n + ptsRemainingRisk(p), 0n) + risk;
  if (
    risk > u(equity) / 100n ||
    aggregate > (u(equity) * 3n) / 100n ||
    u(fill.notional) > u("100")
  ) {
    throw new PilotError(
      "PTS_RISK_REJECTED",
      "PTS planned opening/aggregate risk exceeds the frozen limits",
    );
  }
}
export function attachPtsOpening(
  a: PerpsPaperAccount,
  p: PerpsPaperPosition,
  intent: PerpsPaperIntent,
  fill: PerpsPaperFill,
) {
  if (!isPtsAccount(a) || !intent.pts?.setup || !fill.market) {
    throw new PilotError("INVALID_INPUT", "PTS account/setup is required");
  }
  p.market = structuredClone(fill.market);
  p.pts = {
    version: intent.pts.setup.version,
    setup: structuredClone(intent.pts.setup),
    initialQuantity: fill.quantity,
    initialNotional: fill.notional,
    stop: intent.pts.setup.initialStop,
    initialStop: intent.pts.setup.initialStop,
    feeRate: fill.market.fees.taker,
    consumedTargets: [],
    reductions: [],
    stopChanges: [],
  };
  a.consumedPtsSetups = [...(a.consumedPtsSetups ?? []), intent.pts.setup.id];
}
export function ptsQuantityAtBlock(p: PerpsPaperPosition, block: number) {
  if (!p.pts) {
    return p.quantity;
  }
  const reductions = p.pts.reductions
    .filter((r) => r.block < block)
    .reduce((n, r) => n + u(r.quantity), 0n);
  return d(u(p.pts.initialQuantity) - reductions);
}
/** A mark changes the stop, never the original data timestamps and never consumes a target. */
export function updatePtsStop(p: PerpsPaperPosition, frame: PerpsPaperFrame, now: number) {
  if (!p.pts || p.closedAt !== null) {
    return;
  }
  if (
    recoveryRatioCompare(
      frame.snapshot.ticker.mark,
      p.pts.setup.c.price,
      p.pts.setup.b.price,
      "0.495",
    ) >= 0 &&
    (u(p.entryPrice) - u(p.pts.stop)) * (p.side === "long" ? 1n : -1n) > 0n
  ) {
    p.pts.stop = p.entryPrice;
    p.pts.stopChanges.push({ at: now, stop: p.entryPrice, frameHash: frame.hash });
  }
}
export function ptsManagement(
  p: PerpsPaperPosition,
  mark: string | null,
  now: number,
  history?: PtsHistory,
): PtsManagement {
  if (!p.pts || p.closedAt !== null) {
    return { action: "hold", reason: "NOT_PTS_POSITION", quantity: null, targets: [] };
  }
  const close = (reason: string): PtsManagement => ({
    action: "close",
    reason,
    quantity: p.quantity,
    targets: [],
  });
  if (mark !== null && (u(mark) - u(p.pts.stop)) * (p.side === "long" ? 1n : -1n) <= 0n) {
    return close("PTS_STOP");
  }
  const profile = ptsTemporalProfile(p.pts.version);
  if (profile.closeAtUtcDayEnd && now >= importPeriodStart(p.openedAt, "1d") + DAY) {
    return close("PTS_UTC_DAY_END");
  }
  if (now - p.openedAt >= profile.maximumHoldingMs) {
    return close("PTS_MAX_DURATION");
  }
  if (history) {
    const s = ptsSeries(history, now, p.pts.version);
    for (const period of [profile.primary, profile.channel]) {
      const trend = ptsTrend(ptsPivots(s[period], now).pivots);
      // A stale or absent macro series is not a verifiable invalidation.
      if (
        s[period].at(-1)?.closeTime === importPeriodStart(now, period) &&
        trend !== "unknown" &&
        trend !== p.side
      ) {
        return close("PTS_TREND_INVALIDATION");
      }
    }
    const days = s[profile.impulse].slice(-2);
    if (
      days.length === 2 &&
      days[1]!.closeTime === importPeriodStart(now, profile.impulse) &&
      days[0]!.closeTime === days[1]!.openTime &&
      days.every(
        (c) =>
          c.closeTime > p.openedAt &&
          outsideChannel(p.pts!.setup.channel, c.close, c.closeTime, {
            numerator: p.pts!.setup.toleranceNumerator,
            denominator: p.pts!.setup.toleranceDenominator,
          }),
      )
    ) {
      return close("PTS_CHANNEL_INVALIDATION");
    }
  }
  if (mark === null) {
    return { action: "hold", reason: "NOT_VERIFIABLE", quantity: null, targets: [] };
  }
  const targets = ["0.61", "0.78", "1"]
    .map((ratio, i) => ({ ratio, id: i + 1 }))
    .filter(
      (t) =>
        !p.pts!.consumedTargets.includes(t.id) &&
        recoveryRatioCompare(mark, p.pts!.setup.c.price, p.pts!.setup.b.price, t.ratio) >= 0,
    )
    .map((t) => t.id);
  if (!targets.length) {
    return { action: "hold", reason: "PTS_POSITION_INTACT", quantity: null, targets: [] };
  }
  const schedule = ptsPartialSchedule(p.pts.initialQuantity, p.market!.sizeDecimals);
  const q = targets.includes(3)
    ? u(p.quantity)
    : min(
        u(p.quantity),
        targets.reduce((sum, id) => sum + u(schedule[id - 1]!), 0n),
      );
  return { action: "close", reason: "PTS_TARGET", quantity: d(q), targets };
}
export function assertPtsReduction(
  p: PerpsPaperPosition,
  intent: PerpsPaperIntent,
  fill: PerpsPaperFill,
) {
  const evidence = intent.pts;
  if (
    !p.pts ||
    evidence?.version !== p.pts.version ||
    u(fill.quantity) > u(p.quantity) ||
    (evidence.quantity !== undefined && u(evidence.quantity) !== u(fill.quantity)) ||
    fill.block < (p.pts.reductions.at(-1)?.block ?? p.entryBlock)
  ) {
    throw new PilotError("INVALID_FILL", "Invalid PTS reduction quantity or sequence");
  }
  const targets = evidence.targets ?? [];
  if (
    new Set(targets).size !== targets.length ||
    targets.some((t) => ![1, 2, 3].includes(t) || p.pts!.consumedTargets.includes(t))
  ) {
    throw new PilotError("INVALID_FILL", "PTS target is invalid or already consumed");
  }
  if (targets.length) {
    const actual = ptsManagement(p, fill.mark?.price ?? null, fill.timestamp);
    if (
      actual.reason !== "PTS_TARGET" ||
      actual.quantity !== fill.quantity ||
      JSON.stringify(actual.targets) !== JSON.stringify(targets)
    ) {
      throw new PilotError(
        "PTS_TARGET_REJECTED",
        "Reduction must match reached unconsumed targets",
      );
    }
  } else if (u(fill.quantity) !== u(p.quantity)) {
    throw new PilotError("INVALID_FILL", "Non-target PTS exits must close the remainder");
  }
}
