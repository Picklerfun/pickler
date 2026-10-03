/**
 * The draft's three caps (studio-draft-dashboard-v1 §3.3, D11): the steppers against what is saved,
 * the caps an agent holds with the create screen's starter caps for one never given any, and when
 * its wallet was last read against the minimums to start. The rules the live studio shares are
 * `../shell/build-model.ts`'s. Pure, pinned in `apps/web/test/studio-draft-build.test.ts` and
 * `studio-draft-model.test.ts`.
 */
import {
  LEVERAGE_BOUNDS,
  MIN_START,
  SPEND_BOUNDS,
  STARTER_CAPS,
  type WalletView,
} from "../new-agent/model";
import type { CapRow } from "../shell/build-model";
import { clock } from "../shell/clock";

export interface Caps {
  perTradeAusd: number;
  perDayAusd: number;
  maxLeverage: number;
}

/* The canvas's steps and floors; the ceilings are core's bounds, so + and − never reach a value
   the API would refuse. */
const CAP_ROWS = [
  {
    key: "perTradeAusd",
    title: "PER TRADE",
    unit: " AUSD",
    step: 5,
    min: 5,
    max: SPEND_BOUNDS.perCallAusd.max,
  },
  {
    key: "perDayAusd",
    title: "PER DAY",
    unit: " AUSD",
    step: 10,
    min: 10,
    max: SPEND_BOUNDS.perDayAusd.max,
  },
  {
    key: "maxLeverage",
    title: "MAX LEVERAGE",
    unit: "×",
    step: 1,
    min: LEVERAGE_BOUNDS.min,
    max: LEVERAGE_BOUNDS.max,
  },
] as const;

export interface CapsView {
  rows: CapRow<keyof Caps>[];
  dirty: boolean;
  /** UNSAVED CHANGES once edited; STARTER CAPS (the canvas's tag) for caps it was never given. */
  tag: "SAVED" | "UNSAVED CHANGES" | "STARTER CAPS";
  /** The caps are the create screen's starter caps, never saved: Save writes them as they are. */
  starter: boolean;
  /** A day's cap below one trade's: the caps contradict each other (core refuses it). */
  inverted: boolean;
  canSave: boolean;
}

/**
 * The caps with − and +, against what is saved. `starter` says the saved caps are the create
 * screen's starter caps because the agent was never given any (`capsOf`): they read STARTER CAPS,
 * never SAVED, and can be saved unchanged.
 */
export function capsStepper(current: Caps, saved: Caps, starter = false): CapsView {
  const rows = CAP_ROWS.map((row) => {
    const value = current[row.key];
    return {
      key: row.key,
      title: row.title,
      value,
      display: `${value}${row.unit}`,
      prev: value > row.min ? Math.max(row.min, value - row.step) : null,
      next: value < row.max ? Math.min(row.max, value + row.step) : null,
    };
  });
  const dirty = CAP_ROWS.some((row) => current[row.key] !== saved[row.key]);
  const inverted = current.perDayAusd < current.perTradeAusd;
  let tag: CapsView["tag"] = "SAVED";
  if (dirty) {
    tag = "UNSAVED CHANGES";
  } else if (starter) {
    tag = "STARTER CAPS";
  }
  return {
    rows,
    dirty,
    tag,
    starter,
    inverted,
    canSave: (dirty || starter) && !inverted,
  };
}

/** Where the caps an agent holds come from: the studio agent's DTO and its config. */
export interface CapsSource {
  spend?: { perCallAusd: number; perDayAusd: number } | null | undefined;
  configSpend?: { perCallAusd: number; perDayAusd: number } | null | undefined;
  maxLeverage?: number | null | undefined;
}

/**
 * The caps the agent holds: the studio agent's `spend` (what Pickler enforces) before the
 * config's, and the create screen's starter caps for one it was never given (`starterCaps`).
 */
export function capsOf(input: CapsSource): Caps {
  const spend = input.spend ?? input.configSpend;
  return {
    perTradeAusd: spend?.perCallAusd ?? STARTER_CAPS.perTradeAusd,
    perDayAusd: spend?.perDayAusd ?? STARTER_CAPS.perDayAusd,
    maxLeverage: input.maxLeverage ?? STARTER_CAPS.maxLeverage,
  };
}

/** The agent was never given caps (no spend, or no leverage): `capsOf` filled in starter caps. */
export const starterCaps = (input: CapsSource): boolean =>
  (input.spend ?? input.configSpend) == null || input.maxLeverage == null;

/**
 * "LAST CHECKED hh:mm" in local time for a read's `readAt`, or that it has not been read. With the
 * wallet's read balances, it adds what is still below the minimums (`MIN_START`), as the canvas
 * does: "· WAITING FOR AUSD AND MON", or only the one that is short. A balance the chain did not
 * answer for claims nothing.
 */
export function checkedLabel(
  readAt: number | null,
  wallet: Pick<WalletView, "ausdMicro" | "monWei"> | null = null,
): string {
  if (readAt === null) {
    return "NOT CHECKED YET";
  }
  const label = `LAST CHECKED ${clock(new Date(readAt))}`;
  if (!wallet || wallet.ausdMicro === null || wallet.monWei === null) {
    return label;
  }
  const short = [
    wallet.ausdMicro < MIN_START.ausdMicro ? "AUSD" : null,
    wallet.monWei < MIN_START.monWei ? "MON" : null,
  ].filter((token) => token !== null);
  return short.length > 0 ? `${label} · WAITING FOR ${short.join(" AND ")}` : label;
}
