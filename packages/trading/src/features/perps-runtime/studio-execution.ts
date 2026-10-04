import {
  PilotError,
  effectiveRisk,
  type AgentConfig,
  type PerpSymbol,
  type EntrySetting,
  type RiskLimits,
  type SpendLimits,
} from "@pickler/core";
import type { StudioPerpsProposal } from "../perps-strategies/studio.js";
import { paperDecimal as d, paperUnits as u } from "../perps-paper/decimal.js";
import { productFeeReserve } from "../perps-paper/policy.js";
import { leverageFor } from "./sizing.js";
import type { PerpsProposal } from "../perps-paper/checks.js";
import type { PerpsPaperPosition } from "../perps-paper/types.js";
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

/** What an approve would break, in R6's order for the parts that still apply; null when clear. */
export function proposalRefusal(input: {
  kind: PerpsProposal["kind"];
  instrument: PerpSymbol;
  margin: string | number;
  leverage: number;
  paused: boolean;
  config: Pick<AgentConfig, "maxLeverage" | "risk"> & {
    spend: { perCallAusd: number; perDayAusd: number };
  };
  open: PerpsPaperPosition[];
  /** The position a size-up adds to; null once it closed. */
  position: PerpsPaperPosition | null;
  newMarginToday: string | number;
  realizedToday: string | number;
  /** Free paper AUSD at marks; null without a mark for an open position. */
  freeEquity: string | number | null;
  takerFee: string | number;
  /** Ledger admission separately checks its own pending reserve and exact available balance. */
  checkAvailable?: boolean;
}): { code: string; text: string } | null {
  const { instrument } = input;
  if (input.kind === "size_up" && !input.position) {
    return { code: "POSITION_CLOSED", text: `POSITION CLOSED · ${instrument}` };
  }
  if (input.paused) {
    return { code: "PAUSED", text: "PAUSED" };
  }
  if (input.kind === "enter") {
    const held = input.open.find((p) => p.symbol === instrument);
    if (held) {
      return {
        code: "ALREADY_OPEN",
        text: `ALREADY ${held.side.toUpperCase()} ${instrument}`,
      };
    }
  }
  if (input.leverage > leverageFor(input.config.maxLeverage)) {
    return { code: "CAP_LEVERAGE", text: "BLOCKED BY CAP · LEVERAGE" };
  }
  const already = input.position?.margin ?? "0";
  if (u(String(already)) + u(String(input.margin)) > u(String(input.config.spend.perCallAusd))) {
    return { code: "CAP_TRADE", text: "BLOCKED BY CAP · PER TRADE" };
  }
  const risk = effectiveRisk(input.config);
  if (input.kind === "enter" && input.open.length >= risk.maxOpenPositions) {
    return { code: "CAP_OPEN", text: `BLOCKED BY CAP · ${input.open.length} OPEN` };
  }
  if (
    u(String(input.newMarginToday)) + u(String(input.margin)) >
    u(String(input.config.spend.perDayAusd))
  ) {
    return { code: "CAP_DAY", text: "BLOCKED BY CAP · PER DAY" };
  }
  if (u(String(input.realizedToday)) <= -u(String(risk.dayLossStopAusd))) {
    return { code: "DAY_LOSS", text: "DAY-LOSS STOP" };
  }
  if (input.checkAvailable === false) {
    return null;
  }
  if (input.freeEquity === null) {
    return { code: "NO_MARK", text: `NO MARK · ${instrument}` };
  }
  const reserve = productFeeReserve(
    d(u(String(input.margin)) * BigInt(input.leverage)),
    String(input.takerFee),
  );
  if (u(String(input.freeEquity)) < u(String(input.margin)) + u(String(reserve))) {
    return { code: "NO_FREE_AUSD", text: "NO FREE AUSD" };
  }
  return null;
}
