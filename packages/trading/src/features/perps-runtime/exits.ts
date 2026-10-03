import { PilotError, type RiskLimits } from "@pickler/core";
import { paperDecimal, paperUnits } from "../perps-paper/decimal.js";
import type { PerpsPaperSide } from "../perps-paper/types.js";
import { STOP_LOSS_BPS, TAKE_PROFIT_BPS } from "./decision.js";

/** Why a runtime paper position closed (spec R10). */
export const CLOSE_REASONS = [
  "stop",
  "take_profit",
  "time",
  "brief",
  "owner",
  "stop_all",
  "day_loss",
] as const;
export type PerpsCloseReason = (typeof CLOSE_REASONS)[number];
export type PerpsExitReason = Extract<PerpsCloseReason, "stop" | "take_profit" | "time">;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export interface ExitLevels {
  stopPrice: string;
  takeProfitPrice: string;
  exitDueAt: number;
}

function bps(value: number | undefined, bounds: { min: number; max: number; default: number }) {
  if (value === undefined || !Number.isFinite(value)) {
    return bounds.default;
  }
  return Math.round(Math.min(bounds.max, Math.max(bounds.min, value)));
}

function shifted(price: bigint, deltaBps: number): string {
  return paperDecimal((price * BigInt(10_000 + deltaBps)) / 10_000n);
}

/**
 * R10: stop and take-profit from the entry price (defaults 300 / 600 bps, clamped to the decision's
 * bounds) and a time stop at open + horizon. Prices stay exact paper decimals.
 */
export function exitLevels(input: {
  side: PerpsPaperSide;
  entryPrice: string;
  stopLossBps?: number | undefined;
  takeProfitBps?: number | undefined;
  horizonHours: number;
  openedAt: number;
}): ExitLevels {
  const entry = paperUnits(input.entryPrice);
  if (entry <= 0n) {
    throw new PilotError("INVALID_INPUT", "The entry price must be positive");
  }
  const stop = bps(input.stopLossBps, STOP_LOSS_BPS);
  const target = bps(input.takeProfitBps, TAKE_PROFIT_BPS);
  const sign = input.side === "long" ? 1 : -1;

  return {
    stopPrice: shifted(entry, -sign * stop),
    takeProfitPrice: shifted(entry, sign * target),
    exitDueAt: input.openedAt + input.horizonHours * HOUR_MS,
  };
}

export interface ExitWatch {
  side: PerpsPaperSide;
  stopPrice: string | null;
  takeProfitPrice: string | null;
  exitDueAt: number | null;
}

/**
 * Which exit is due at `mark` and `now`, if any: the stop first, then the target, then time. An
 * unknown mark can only trigger the time stop.
 */
export function exitDue(
  position: ExitWatch,
  mark: string | null,
  now: number,
): PerpsExitReason | null {
  if (mark !== null) {
    const price = paperUnits(mark);
    const long = position.side === "long";
    if (position.stopPrice !== null) {
      const stop = paperUnits(position.stopPrice);
      if (long ? price <= stop : price >= stop) {
        return "stop";
      }
    }
    if (position.takeProfitPrice !== null) {
      const target = paperUnits(position.takeProfitPrice);
      if (long ? price >= target : price <= target) {
        return "take_profit";
      }
    }
  }
  if (position.exitDueAt !== null && now >= position.exitDueAt) {
    return "time";
  }
  return null;
}

/** R11: realized P&L today (UTC) at or below −dayLossStopAusd. */
export function dayLossReached(realizedToday: number, risk: RiskLimits): boolean {
  return realizedToday <= -risk.dayLossStopAusd;
}

export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** R8: an unanswered proposal expires after 15 minutes. */
export const PROPOSAL_TTL_MS = 15 * 60_000;

export function proposalExpiresAt(createdAt: number): number {
  return createdAt + PROPOSAL_TTL_MS;
}

export function proposalExpired(proposal: { expiresAt: number }, now: number): boolean {
  return now >= proposal.expiresAt;
}
