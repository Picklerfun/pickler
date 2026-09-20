// Matriz nivel × horizonte (D1, D2). Puro y con la misma aritmética que services/reads/_shared/matrix.ts (P10).
import { formatPrice } from "../perpl/orders";

export const LEVELS_BPS = [250, 100, 50, -50, -100] as const;
export const HORIZONS_MIN = [60, 240, 720, 1440] as const;
export type LevelBps = (typeof LEVELS_BPS)[number];
export type HorizonMin = (typeof HORIZONS_MIN)[number];
export type Cell = { levelBps: LevelBps; horizonMin: HorizonMin };

export const isLevel = (v: number): v is LevelBps => (LEVELS_BPS as readonly number[]).includes(v);
export const isHorizon = (v: number): v is HorizonMin => (HORIZONS_MIN as readonly number[]).includes(v);

/** Target en las mismas unidades escaladas que el mark (priceDecimals). */
export function targetFor(mark: number, levelBps: number): number {
  return Math.round((mark * (10000 + levelBps)) / 10000);
}

export function expiresAtFor(createdAt: Date, horizonMin: number): Date {
  return new Date(createdAt.getTime() + horizonMin * 60_000);
}

export function questionFor(symbol: string, levelBps: number, target: number, pd: number, expiresAt: Date): string {
  const dir = levelBps > 0 ? "at or above" : "at or below";
  const when = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return `Will the ${symbol} mark be ${dir} ${formatPrice(target, pd)} at ${when} UTC?`;
}

const HORIZON_LABELS: Record<number, string> = { 60: "1H", 240: "4H", 720: "12H", 1440: "24H" };
export const horizonLabel = (min: number): string => HORIZON_LABELS[min] ?? `${min}m`;
export const levelLabel = (bps: number): string => `${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;
export const cellLabel = (c: { levelBps: number; horizonMin: number }): string => `${levelLabel(c.levelBps)} · ${horizonLabel(c.horizonMin)}`;

export const callOf = (probability: number): boolean => probability >= 0.5;

export function outcomeOf(levelBps: number, target: number, mark: number): boolean {
  return levelBps > 0 ? mark >= target : mark <= target;
}

/** "3 h 58 m" | "12 m" | "< 1 m" | "now". Redondea hacia abajo. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  if (m === 0) return "< 1 m";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} m` : `${m} m`;
}

export const formatProbability = (p: number): string => `${Math.round(p * 100)} %`;

export function recordLabel(r: { reads: number; resolved: number; right: number; brierAvg: number | null }): string {
  if (r.resolved === 0 || r.brierAvg === null) return "No resolved reads yet";
  return `${r.right}/${r.resolved} right · Brier ${r.brierAvg.toFixed(2)}`;
}
