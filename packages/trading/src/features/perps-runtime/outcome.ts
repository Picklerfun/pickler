import type { EntrySetting, PerpSymbol, RiskLimits, SpendLimits } from "@pickler/core";
import type { PerpsPaperSide } from "../perps-paper/types.js";
import type { PerpsCheckDecision } from "./decision.js";
import { dayLossReached } from "./exits.js";
import {
  CONVICTION,
  feeReserveFor,
  leverageFor,
  marginFor,
  microAusd,
  notionalFor,
} from "./sizing.js";

export const CHECK_OUTCOMES = [
  "entered",
  "exited",
  "held",
  "blocked",
  "proposed",
  "skipped",
  "failed",
  "system",
] as const;
export type PerpsCheckOutcome = (typeof CHECK_OUTCOMES)[number];

export type PerpsCheckCode =
  | "EXIT_MET"
  | "CLOSE_CALLED"
  | "NOTHING_TO_CLOSE"
  | "HOLD"
  | "PAUSED"
  | "NEVER_BROKEN"
  | "NOT_ITS_MARKET"
  | "ENTRY_HELD"
  | "LOW_CONVICTION"
  | "ALREADY_OPEN"
  | "CAP_OPEN"
  | "CAP_DAY"
  | "DAY_LOSS"
  | "NO_FREE_AUSD"
  | "ENTERED"
  | "ENTERED_SMALL"
  | "PROPOSED";

export interface PerpsProposalDraft {
  kind: "enter" | "size_up";
  instrument: PerpSymbol;
  side: PerpsPaperSide;
  margin: number;
  leverage: number;
  notional: number;
}

export interface DecideOutcomeInput {
  decision: PerpsCheckDecision;
  /** How many lines each brief section has. */
  brief: { entries: number; exits: number; never: number };
  paused: boolean;
  /** The agent's Perpl markets (`config.perpl.markets`): it opens only on these. */
  markets: readonly PerpSymbol[];
  /** The venue's taker fee as a fraction (e.g. 0.0002); the open's fee reserve scales with it. */
  takerFee: number;
  /** The open paper position on the decision's instrument, if any. */
  position: { id: string; side: PerpsPaperSide; margin: number } | null;
  /** Open paper positions across instruments. */
  openCount: number;
  risk: RiskLimits;
  spend: SpendLimits;
  maxLeverage: number | undefined;
  /** Read with core's `effectiveEntry`. */
  entry: EntrySetting;
  /** Margin opened today (UTC), in AUSD. */
  newMarginToday: number;
  /** Realized P&L today (UTC), in AUSD. */
  realizedToday: number;
  /**
   * Free paper AUSD (trading's `productFreeEquity`: open P&L at marks, minus margin and pending
   * reservations). An open needs its margin plus its fee reserve (`feeReserveFor`) free.
   */
  freeEquity: number;
}

export interface PerpsCheckResult {
  outcome: PerpsCheckOutcome;
  code: PerpsCheckCode;
  /** The feed's short label, e.g. "ENTRY 2 HELD". */
  text: string;
  side?: PerpsPaperSide;
  /** Margin to open now, in AUSD (entered only). */
  margin?: number;
  leverage?: number;
  notional?: number;
  /**
   * The open position to close: the outcome itself when `exited`; done before opening when an
   * opposite call passed the brief (R7), whatever the caps then say.
   */
  close?: { positionId: string; reason: "brief" };
  proposals?: PerpsProposalDraft[];
}

function sideOf(action: PerpsCheckDecision["action"]): PerpsPaperSide | null {
  if (action === "open-long") {
    return "long";
  }
  if (action === "open-short") {
    return "short";
  }
  return null;
}

function label(side: PerpsPaperSide, instrument: PerpSymbol): string {
  return `${side.toUpperCase()} ${instrument}`;
}

function held(code: PerpsCheckCode, text: string): PerpsCheckResult {
  return { outcome: "held", code, text };
}

/**
 * The brief exit lines (1..`exitCount`) the decision reports met for the position on `instrument`
 * (lines without an instrument are the decision's own), ascending. Indexes past the brief are
 * ignored.
 */
export function exitsMet(
  decision: PerpsCheckDecision,
  exitCount: number,
  instrument: PerpSymbol,
): number[] {
  return decision.exits
    .filter(
      (line) =>
        line.met &&
        line.index <= exitCount &&
        (line.instrument ?? decision.instrument) === instrument,
    )
    .map((line) => line.index)
    .sort((a, b) => a - b);
}

/**
 * R6: what the check does with a valid decision, in order. Exits first (an exit line met on the
 * open position, or a `close` call), then for an open call: paused, its markets, never, entries,
 * conviction, one position per instrument, caps, free equity (margin plus fee reserve), and the
 * entry mode. Each brief line counts once (the parser refuses repeats); an entry line with no
 * answer is not met, and indexes past the brief's counts are ignored. Positions on other
 * instruments are the host's (`exitsMet` per held instrument).
 */
export function decideOutcome(input: DecideOutcomeInput): PerpsCheckResult {
  const { decision, position } = input;

  if (position) {
    const met = exitsMet(decision, input.brief.exits, decision.instrument);
    if (met.length) {
      return {
        outcome: "exited",
        code: "EXIT_MET",
        text: `EXIT ${met.join(", ")} MET`,
        close: { positionId: position.id, reason: "brief" },
      };
    }
  }

  if (decision.action === "hold") {
    return held("HOLD", "HOLD");
  }
  if (decision.action === "close") {
    if (!position) {
      return held("NOTHING_TO_CLOSE", "NOTHING TO CLOSE");
    }
    return {
      outcome: "exited",
      code: "CLOSE_CALLED",
      text: `CLOSED ${label(position.side, decision.instrument)}`,
      close: { positionId: position.id, reason: "brief" },
    };
  }

  const side = sideOf(decision.action)!;

  if (input.paused) {
    return held("PAUSED", "PAUSED");
  }
  if (!input.markets.includes(decision.instrument)) {
    return held("NOT_ITS_MARKET", "NOT ITS MARKET");
  }

  const broken = decision.never
    .filter((line) => line.broken && line.index <= input.brief.never)
    .map((line) => line.index)
    .sort((a, b) => a - b);
  if (broken.length) {
    return held("NEVER_BROKEN", `NEVER ${broken.join(", ")}`);
  }

  const unmet: number[] = [];
  for (let i = 1; i <= input.brief.entries; i++) {
    if (!decision.entries.some((line) => line.index === i && line.met)) {
      unmet.push(i);
    }
  }
  if (unmet.length) {
    return held("ENTRY_HELD", `ENTRY ${unmet.join(", ")} HELD`);
  }

  const probability = decision.probability ?? 0;
  if (probability < CONVICTION.min) {
    return held("LOW_CONVICTION", "LOW CONVICTION");
  }

  if (position && position.side === side) {
    return held("ALREADY_OPEN", `ALREADY ${label(side, decision.instrument)}`);
  }

  const close = position ? { positionId: position.id, reason: "brief" as const } : undefined;
  const withClose = (result: PerpsCheckResult): PerpsCheckResult =>
    close ? { ...result, close } : result;
  const openCount = position ? input.openCount - 1 : input.openCount;
  const freeEquity = position ? input.freeEquity + position.margin : input.freeEquity;

  const margin = marginFor(probability, input.spend.perCallAusd);
  const leverage = leverageFor(input.maxLeverage);
  const reserve = feeReserveFor(notionalFor(margin, leverage), input.takerFee);

  if (openCount >= input.risk.maxOpenPositions) {
    return withClose({
      outcome: "blocked",
      code: "CAP_OPEN",
      text: `BLOCKED BY CAP · ${openCount} OPEN`,
    });
  }
  if (microAusd(input.newMarginToday + margin) > input.spend.perDayAusd) {
    return withClose({ outcome: "blocked", code: "CAP_DAY", text: "BLOCKED BY CAP · PER DAY" });
  }
  if (dayLossReached(input.realizedToday, input.risk)) {
    return withClose({ outcome: "blocked", code: "DAY_LOSS", text: "DAY-LOSS STOP" });
  }

  if (freeEquity < microAusd(margin + reserve)) {
    return withClose({ outcome: "blocked", code: "NO_FREE_AUSD", text: "NO FREE AUSD" });
  }

  const name = label(side, decision.instrument);
  const draft = (kind: PerpsProposalDraft["kind"], amount: number): PerpsProposalDraft => ({
    kind,
    instrument: decision.instrument,
    side,
    margin: amount,
    leverage,
    notional: notionalFor(amount, leverage),
  });
  const enter = (amount: number, code: PerpsCheckCode, text: string): PerpsCheckResult => ({
    outcome: "entered",
    code,
    text,
    side,
    margin: amount,
    leverage,
    notional: notionalFor(amount, leverage),
  });

  if (input.entry.mode === "auto") {
    return withClose(enter(margin, "ENTERED", `ENTERED ${name}`));
  }
  if (input.entry.meanwhile === "wait") {
    return withClose({
      outcome: "proposed",
      code: "PROPOSED",
      text: `PROPOSED ${name}`,
      side,
      proposals: [draft("enter", margin)],
    });
  }

  const small = microAusd(Math.min(input.entry.smallAusd, margin));
  if (small >= margin) {
    return withClose(enter(margin, "ENTERED", `ENTERED ${name}`));
  }
  return withClose({
    ...enter(small, "ENTERED_SMALL", `ENTERED ${name} SMALL · SIZE-UP PROPOSED`),
    proposals: [draft("size_up", microAusd(margin - small))],
  });
}
