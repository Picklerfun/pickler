import { BRIEF_LIMITS, type PerpSymbol } from "@pickler/core";

/**
 * The model's answer for one Perpl check (`perps-check-v1`, spec R4). The model never outputs
 * size, leverage, price or account: code decides those (`outcome.ts`, `sizing.ts`).
 */
export const PERPS_CHECK_DECISION_VERSION = "perps-check-v1" as const;
export const CHECK_INSTRUMENTS = ["BTC", "ETH"] as const satisfies readonly PerpSymbol[];
export const CHECK_ACTIONS = ["open-long", "open-short", "close", "hold"] as const;
export type PerpsCheckAction = (typeof CHECK_ACTIONS)[number];
export const CHECK_HORIZONS = [4, 24, 72] as const;
export type PerpsCheckHorizon = (typeof CHECK_HORIZONS)[number];
/** The horizon a `hold` gets when the model leaves it out. */
export const HOLD_HORIZON: PerpsCheckHorizon = 24;
export const STOP_LOSS_BPS = { min: 100, max: 1500, default: 300 } as const;
export const TAKE_PROFIT_BPS = { min: 100, max: 5000, default: 600 } as const;
export const CHECK_PROBABILITY = { min: 0.5, max: 1 } as const;
export const CHECK_RATIONALE_LIMIT = 600;
export const CHECK_WHY_LIMIT = 300;
export const CHECK_SOURCES_LIMIT = 32;

export interface PerpsCheckLine {
  /** The brief line's 1-based position in its section. */
  index: number;
  met: boolean;
  why: string;
  /**
   * Exit lines only: the held instrument the line was judged for. Absent means the decision's
   * instrument, so a check can report exit lines for every position it holds.
   */
  instrument?: PerpSymbol;
}

export interface PerpsCheckNeverLine {
  index: number;
  broken: boolean;
}

export interface PerpsCheckDecision {
  instrument: PerpSymbol;
  action: PerpsCheckAction;
  /**
   * For the called direction, 0..1 (outside it the answer is `MODEL_INVALID`). Required to open
   * (below 0.55 holds as LOW_CONVICTION), optional to close, absent on hold.
   */
  probability?: number;
  horizonHours: PerpsCheckHorizon;
  stopLossBps?: number;
  takeProfitBps?: number;
  /** One per brief "enters when" line. */
  entries: PerpsCheckLine[];
  /** One per brief "exits when" line and held instrument; only meaningful with a position. */
  exits: PerpsCheckLine[];
  never: PerpsCheckNeverLine[];
  rationale: string;
  sources: string[];
}

export type ParsedCheckDecision =
  { ok: true; decision: PerpsCheckDecision } | { ok: false; code: "MODEL_INVALID" };

class Malformed extends Error {}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Malformed();
  }
  return value as Record<string, unknown>;
}

function finite(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Malformed();
  }
  return value;
}

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

/** Models often write `null` for a field they leave out; it means absent. */
function absent(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function optionalBps(value: unknown, bounds: { min: number; max: number }): number | undefined {
  if (absent(value)) {
    return undefined;
  }
  return Math.round(clamp(finite(value), bounds));
}

/** The nearest allowed horizon; ties go to the shorter one. */
function horizon(value: unknown): PerpsCheckHorizon {
  const hours = finite(value);
  let best: PerpsCheckHorizon = CHECK_HORIZONS[0];
  for (const candidate of CHECK_HORIZONS) {
    if (Math.abs(candidate - hours) < Math.abs(best - hours)) {
      best = candidate;
    }
  }
  return best;
}

function text(value: unknown, limit: number): string {
  if (typeof value !== "string") {
    throw new Malformed();
  }
  return value.slice(0, limit);
}

function index(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Malformed();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Malformed();
  }
  return value;
}

function list(value: unknown, limit: number): unknown[] {
  if (!Array.isArray(value) || value.length > limit) {
    throw new Malformed();
  }
  return value;
}

/** Each key at most once: a repeated or contradictory line makes the answer malformed. */
function unique<T>(items: T[], key: (item: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) {
    throw new Malformed();
  }
  return items;
}

function lines(value: unknown, limit: number): PerpsCheckLine[] {
  return unique(
    list(value, limit).map((item) => {
      const line = record(item);
      return {
        index: index(line.index),
        met: boolean(line.met),
        why: text(line.why, CHECK_WHY_LIMIT),
      };
    }),
    (line) => String(line.index),
  );
}

/** Exit lines, optionally per held instrument; at most one per (instrument, index). */
function exitLines(value: unknown, instrument: PerpSymbol): PerpsCheckLine[] {
  const items = absent(value) ? [] : list(value, BRIEF_LIMITS.exitsWhen * CHECK_INSTRUMENTS.length);
  return unique(
    items.map((item) => {
      const line = record(item);
      const parsed: PerpsCheckLine = {
        index: index(line.index),
        met: boolean(line.met),
        why: text(line.why, CHECK_WHY_LIMIT),
      };
      if (!absent(line.instrument)) {
        const held = oneOf(line.instrument, CHECK_INSTRUMENTS);
        if (held !== instrument) {
          parsed.instrument = held;
        }
      }
      return parsed;
    }),
    (line) => `${line.instrument ?? instrument}:${line.index}`,
  );
}

function neverLines(value: unknown): PerpsCheckNeverLine[] {
  const items = absent(value) ? [] : list(value, BRIEF_LIMITS.never);
  return unique(
    items.map((item) => {
      const line = record(item);
      return {
        index: index(line.index),
        broken: boolean(line.broken),
      };
    }),
    (line) => String(line.index),
  );
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!(allowed as readonly unknown[]).includes(value)) {
    throw new Malformed();
  }
  return value as T;
}

/**
 * A probability is a fraction: outside [0, 1] (e.g. `70` meaning 70%) is malformed, never clamped
 * into full size. Inside it the value is kept, so under 0.55 an open holds as LOW_CONVICTION.
 */
function probability(value: unknown, action: PerpsCheckAction): number | undefined {
  if (action === "hold") {
    return undefined;
  }
  if (absent(value) && action === "close") {
    return undefined;
  }
  const p = finite(value);
  if (p < 0 || p > CHECK_PROBABILITY.max) {
    throw new Malformed();
  }
  return p;
}

function decide(raw: unknown): PerpsCheckDecision {
  const input = record(typeof raw === "string" ? JSON.parse(raw) : raw);
  const action = oneOf(input.action, CHECK_ACTIONS);
  const instrument = oneOf(input.instrument, CHECK_INSTRUMENTS);
  const decision: PerpsCheckDecision = {
    instrument,
    action,
    horizonHours:
      action === "hold" && absent(input.horizonHours) ? HOLD_HORIZON : horizon(input.horizonHours),
    entries: lines(input.entries, BRIEF_LIMITS.entersWhen),
    exits: exitLines(input.exits, instrument),
    never: neverLines(input.never),
    rationale: text(input.rationale, CHECK_RATIONALE_LIMIT),
    sources: list(input.sources, CHECK_SOURCES_LIMIT).map((source) => text(source, 200)),
  };

  const p = probability(input.probability, action);
  if (p !== undefined) {
    decision.probability = p;
  }
  const stop = optionalBps(input.stopLossBps, STOP_LOSS_BPS);
  if (stop !== undefined) {
    decision.stopLossBps = stop;
  }
  const target = optionalBps(input.takeProfitBps, TAKE_PROFIT_BPS);
  if (target !== undefined) {
    decision.takeProfitBps = target;
  }
  return decision;
}

/**
 * Validates the model's answer. Out-of-range bps are clamped (horizons snap to the nearest allowed
 * one, long text is cut); `null` means absent, missing `exits`/`never` mean none and a `hold` may
 * omit its horizon (24). A probability outside [0, 1] or a repeated line index (per section, and
 * per instrument for exits) is malformed. A malformed answer is `MODEL_INVALID`, never a trade.
 */
export function parseCheckDecision(raw: unknown): ParsedCheckDecision {
  try {
    return { ok: true, decision: decide(raw) };
  } catch {
    return { ok: false, code: "MODEL_INVALID" };
  }
}

function joined(indexes: number[]): string {
  if (indexes.length <= 1) {
    return indexes.join("");
  }
  return `${indexes.slice(0, -1).join(", ")} and ${indexes.at(-1)}`;
}

/** The trace line for the brief's entries, e.g. "Entry 1 and 2 met · 3 held". */
export function entryTrace(decision: PerpsCheckDecision, entryCount: number): string {
  if (entryCount === 0) {
    return "No entry lines";
  }
  const met: number[] = [];
  const held: number[] = [];
  for (let i = 1; i <= entryCount; i++) {
    const answered = decision.entries.find((line) => line.index === i);
    if (answered?.met) {
      met.push(i);
    } else {
      held.push(i);
    }
  }
  const parts: string[] = [];
  if (met.length) {
    parts.push(`${joined(met)} met`);
  }
  if (held.length) {
    parts.push(`${joined(held)} held`);
  }
  return `Entry ${parts.join(" · ")}`;
}
