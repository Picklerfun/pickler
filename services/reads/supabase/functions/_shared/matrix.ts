// Matriz nivel × horizonte y resolución. Puro: sin Deno.env ni red.
export const LEVELS_BPS = [250, 100, 50, -50, -100] as const;
export const HORIZONS_MIN = [60, 240, 720, 1440] as const;
export type LevelBps = (typeof LEVELS_BPS)[number];
export type HorizonMin = (typeof HORIZONS_MIN)[number];

export function isCell(level: number, horizon: number): boolean {
  return (LEVELS_BPS as readonly number[]).includes(level) && (HORIZONS_MIN as readonly number[]).includes(horizon);
}

/** Target en las mismas unidades escaladas que el mark (price_decimals). */
export function targetFor(mark: number, levelBps: number): number {
  return Math.round((mark * (10000 + levelBps)) / 10000);
}

export function formatScaled(v: number, decimals: number): string {
  const neg = v < 0;
  const s = String(Math.abs(v)).padStart(decimals + 1, "0");
  const out = decimals === 0 ? s : `${s.slice(0, -decimals)}.${s.slice(-decimals)}`;
  return neg ? `-${out}` : out;
}

export function questionFor(symbol: string, levelBps: number, target: number, pd: number, expiresAt: Date): string {
  const dir = levelBps > 0 ? "at or above" : "at or below";
  const when = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return `Will the ${symbol} mark be ${dir} ${formatScaled(target, pd)} at ${when} UTC?`;
}

export function expiresAtFor(createdAt: Date, horizonMin: number): Date {
  return new Date(createdAt.getTime() + horizonMin * 60_000);
}

export const callOf = (probability: number): boolean => probability >= 0.5;

export function outcomeOf(levelBps: number, target: number, mark: number): boolean {
  return levelBps > 0 ? mark >= target : mark <= target;
}

export function brierOf(probability: number, outcome: boolean): number {
  return Math.round((probability - (outcome ? 1 : 0)) ** 2 * 10000) / 10000;
}

export type Resolution = { status: "right" | "wrong"; outcome: boolean; brier: number };

export function resolveRead(read: { level_bps: number; target: number; probability: number | null }, mark: number): Resolution {
  if (read.probability === null) throw new Error("resolveRead: no probability");
  const outcome = outcomeOf(read.level_bps, read.target, mark);
  return { status: callOf(read.probability) === outcome ? "right" : "wrong", outcome, brier: brierOf(read.probability, outcome) };
}
