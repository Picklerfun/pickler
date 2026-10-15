import type { Swatch } from "@/lib/accent";

/**
 * The arithmetic behind the two animated cards on the application page: the arena, where AUSD moves
 * between five agents every tick, and the `$PICK` strip, where a curve fills to its goal, graduates,
 * holds and starts over. Both are copy inside an explanatory card (spec L2), not a platform figure,
 * and both are pure: the components own the timers and hand in the randomness.
 */

export interface ArenaAgent {
  name: string;
  ticker: string;
  swatch: Swatch;
  /** AUSD backing this agent now. */
  liq: number;
  /** Hit rate, in percent. */
  hit: number;
  /** What the last tick moved, signed; 0 when nothing did. */
  delta: number;
}

export const ARENA_START: readonly ArenaAgent[] = [
  { name: "Halftime", ticker: "$HALF", swatch: "lime", liq: 8420, hit: 58, delta: 0 },
  { name: "Unlock Watch", ticker: "$UNLK", swatch: "indigo", liq: 6130, hit: 61, delta: 0 },
  { name: "Bracket", ticker: "$BRKT", swatch: "blue", liq: 4890, hit: 55, delta: 0 },
  { name: "Print Day", ticker: "$PRNT", swatch: "amber", liq: 3210, hit: 49, delta: 0 },
  { name: "Cold Open", ticker: "$OPEN", swatch: "magenta", liq: 1760, hit: 54, delta: 0 },
];

export interface Flow {
  from: Swatch;
  to: Swatch;
  amount: number;
}

/** No agent is drained below this; a seat at zero is the applicant's, not a loser's. */
const FLOOR = 200;
const MIN_MOVE = 120;
const MOVE_SPREAD = 480;

/** Weighted draw over `weights`, never landing on `exclude`. `random` is in [0, 1). */
function draw(weights: number[], exclude: number, random: number): number {
  const open = weights.map((weight, at) => (at === exclude ? 0 : weight));
  const total = open.reduce((sum, weight) => sum + weight, 0);
  const target = random * total;
  let seen = 0;
  for (let at = 0; at < open.length; at += 1) {
    seen += open[at]!;
    if (target < seen) {
      return at;
    }
  }
  return open.findIndex((weight) => weight > 0);
}

/**
 * One tick: AUSD leaves one agent and lands on another. Liquidity follows the record — the higher an
 * agent's hit rate, the more likely it receives. The leaver is drawn evenly, so the leader can lose
 * too. A leaver at the floor moves nothing, and the tick reports no flow.
 */
export function moveLiquidity(
  rows: readonly ArenaAgent[],
  random: () => number,
): { rows: ArenaAgent[]; flow: Flow | null } {
  const next = rows.map((row) => ({ ...row, delta: 0 }));
  const weights = next.map((row) => (row.hit - 40) ** 2);
  const from = Math.min(next.length - 1, Math.floor(random() * next.length));
  const to = draw(weights, from, random());
  const giver = next[from]!;
  const taker = next[to]!;
  const amount = Math.min(giver.liq - FLOOR, MIN_MOVE + Math.floor(random() * MOVE_SPREAD));
  if (amount <= 0 || to === from) {
    return { rows: next, flow: null };
  }
  giver.liq -= amount;
  giver.delta = -amount;
  taker.liq += amount;
  taker.delta = amount;
  return { rows: next, flow: { from: giver.swatch, to: taker.swatch, amount } };
}

export interface ArenaRow extends ArenaAgent {
  /** "01" … "05", by liquidity. */
  rank: string;
  /** Share of the leader's liquidity, 0–100. */
  pct: number;
  leader: boolean;
}

/** The rows as the board draws them: ranked, with each bar relative to the leader. */
export function arenaRows(rows: readonly ArenaAgent[]): ArenaRow[] {
  const sorted = [...rows].sort((a, b) => b.liq - a.liq);
  const top = sorted[0]?.liq ?? 1;
  return sorted.map((row, at) => ({
    ...row,
    rank: String(at + 1).padStart(2, "0"),
    pct: Math.round((row.liq / top) * 100),
    leader: at === 0,
  }));
}

export function poolTotal(rows: readonly ArenaAgent[]): number {
  return rows.reduce((sum, row) => sum + row.liq, 0);
}

/** "+1,240", "−380" or "" for a row nothing touched. */
export function formatDelta(delta: number): string {
  if (delta === 0) {
    return "";
  }
  return `${delta > 0 ? "+" : "−"}${formatAusd(Math.abs(delta))}`;
}

export function formatAusd(amount: number): string {
  return amount.toLocaleString("en-US");
}

/** The arena as a whole: the rows, the last three flows and the season clock. */
export interface ArenaState {
  rows: ArenaAgent[];
  flows: (Flow & { id: number })[];
  /** Flows ever made, so each one keeps a stable key while the list slides. */
  seq: number;
  secs: number;
}

export const ARENA_STATE_START: ArenaState = { rows: [...ARENA_START], flows: [], seq: 0, secs: 0 };

const FLOWS_SHOWN = 3;

/** One tick of the arena: liquidity moves, the flow is recorded, the clock advances a minute. */
export function arenaTick(state: ArenaState, random: () => number): ArenaState {
  const moved = moveLiquidity(state.rows, random);
  const flows = moved.flow
    ? [...state.flows, { ...moved.flow, id: state.seq }].slice(-FLOWS_SHOWN)
    : state.flows;
  return {
    rows: moved.rows,
    flows,
    seq: moved.flow ? state.seq + 1 : state.seq,
    secs: state.secs + CLOCK_STEP_SECS,
  };
}

/** How long the season has left, from seconds elapsed. The clock starts at 6D 14H 22M. */
const SEASON_LEFT_SECS = 6 * 24 * 3600 + 14 * 3600 + 22 * 60;
/** Each arena tick advances the clock a minute, so the countdown is seen to move. */
export const CLOCK_STEP_SECS = 60;

export function clock(secs: number): string {
  const left = Math.max(0, SEASON_LEFT_SECS - secs);
  const days = Math.floor(left / 86400);
  const hours = Math.floor((left % 86400) / 3600);
  const minutes = Math.floor((left % 3600) / 60);
  return `${days}D ${String(hours).padStart(2, "0")}H ${String(minutes).padStart(2, "0")}M LEFT`;
}

/* ---------- The curve ---------- */

export const CURVE_GOAL = 5000;
const CURVE_FLOOR = 400;
const CURVE_MIN_STEP = 260;
const CURVE_STEP_SPREAD = 340;
const PRICE_AT_ZERO = 0.12;
const PRICE_RISE = 0.36;
/** Ticks the strip stays GRADUATED before a new token starts on the curve. */
const HOLD_TICKS = 3;

export interface CurveState {
  backed: number;
  graduated: boolean;
  hold: number;
}

export const CURVE_START: CurveState = { backed: CURVE_FLOOR, graduated: false, hold: 0 };

/**
 * One tick: backing grows until it reaches the goal, the token graduates to a pool and holds there
 * for a few ticks, then a new one starts at the floor.
 */
export function curveStep(state: CurveState, random: () => number): CurveState {
  if (state.graduated) {
    return state.hold >= HOLD_TICKS ? CURVE_START : { ...state, hold: state.hold + 1 };
  }
  const backed = state.backed + CURVE_MIN_STEP + Math.floor(random() * CURVE_STEP_SPREAD);
  if (backed >= CURVE_GOAL) {
    return { backed: CURVE_GOAL, graduated: true, hold: 0 };
  }
  return { backed, graduated: false, hold: 0 };
}

/** The price the curve quotes at this much backing, from 0.120 at zero to 0.480 at the goal. */
export function curvePrice(backed: number): string {
  return (PRICE_AT_ZERO + (Math.min(backed, CURVE_GOAL) / CURVE_GOAL) * PRICE_RISE).toFixed(3);
}

export function curvePct(backed: number): number {
  return Math.min(100, Math.round((backed / CURVE_GOAL) * 100));
}

export function toGraduate(backed: number): number {
  return Math.max(0, CURVE_GOAL - backed);
}
