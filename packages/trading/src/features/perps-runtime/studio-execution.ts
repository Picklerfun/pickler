import { PilotError, type EntrySetting, type RiskLimits, type SpendLimits } from "@pickler/core";
import type { StudioPerpsProposal } from "../perps-strategies/studio.js";
import { paperDecimal as d, paperUnits as u } from "../perps-paper/decimal.js";
import { productFeeReserve } from "../perps-paper/policy.js";
import type { PerpsPaperSide } from "../perps-paper/types.js";

export interface StudioExecutionState {
  paused: boolean;
  fundingPending: boolean;
  freeEquity: string | null;
  openedMarginToday: string;
  realizedToday: string;
  openCount: number;
  position: { id: string; side: PerpsPaperSide } | null;
  takerFee: string;
  spend: SpendLimits;
  risk: RiskLimits;
  entry: EntrySetting;
  leverage: number;
}
export type StudioExecutionPlan =
  | { kind: "hold"; reason: string }
  | { kind: "close"; positionId: string; reason: string }
  | { kind: "propose"; margin: string; leverage: number; side: PerpsPaperSide }
  | {
      kind: "open";
      margin: string;
      notional: string;
      leverage: number;
      side: PerpsPaperSide;
      sizeUpMargin: string | null;
    };

/** Amounts are creator configuration; no answer score enters sizing. */
export function planStudioExecution(
  proposal: StudioPerpsProposal,
  state: StudioExecutionState,
): StudioExecutionPlan {
  if (!Number.isInteger(state.leverage) || state.leverage < 1 || state.leverage > 10) {
    throw new PilotError("INVALID_INPUT", "Invalid Studio leverage");
  }
  const hold = (reason: string): StudioExecutionPlan => ({ kind: "hold", reason });
  if (proposal.action === "close") {
    return state.position
      ? { kind: "close", positionId: state.position.id, reason: proposal.reason }
      : hold("NOTHING_TO_CLOSE");
  }
  if (proposal.action === "hold") {
    return hold(proposal.reason);
  }
  const side = proposal.action === "open-long" ? "long" : "short";
  if (state.position) {
    return state.position.side === side
      ? hold("ALREADY_OPEN")
      : { kind: "close", positionId: state.position.id, reason: "OPPOSITE_SIGNAL_CLOSE_ONLY" };
  }
  if (state.paused) {
    return hold("PAUSED");
  }
  if (state.fundingPending) {
    return hold("FUNDING_PENDING");
  }
  if (state.freeEquity === null) {
    return hold("UNKNOWN_MARKS");
  }
  if (state.openCount >= state.risk.maxOpenPositions) {
    return hold("CAP_OPEN");
  }
  if (u(state.realizedToday) <= -u(String(state.risk.dayLossStopAusd))) {
    return hold("DAY_LOSS");
  }
  const cap = u(String(state.spend.perCallAusd));
  if (u(state.openedMarginToday) + cap > u(String(state.spend.perDayAusd))) {
    return hold("CAP_DAY");
  }
  const small = u(String(state.entry.smallAusd));
  const margin =
    state.entry.mode !== "auto" && state.entry.meanwhile === "small" && small < cap ? small : cap;
  const proposed = state.entry.mode !== "auto" && state.entry.meanwhile === "wait";
  const required = proposed ? cap : margin;
  const notional = required * BigInt(state.leverage);
  const fee = u(productFeeReserve(d(notional), state.takerFee));
  if (u(state.freeEquity) < required + fee) {
    return hold("NO_FREE_AUSD");
  }
  if (proposed) {
    return { kind: "propose", margin: d(cap), leverage: state.leverage, side };
  }
  return {
    kind: "open",
    margin: d(margin),
    notional: d(notional),
    leverage: state.leverage,
    side,
    sizeUpMargin: margin < cap ? d(cap - margin) : null,
  };
}
