// «Trade this level» (D12): del nivel de Ask (celda o read) al TradeLevel del store, y lo que Trade muestra de él. Puro.
import type { Side } from "../perpl/orders";
import type { AskCell, TradeLevel } from "../store";
import { cellLabel, expiresAtFor, formatRemaining, targetFor } from "./matrix";
import type { Read } from "./types";

/** Igual que PRE_MS de reminder-set: el recordatorio `pre` sólo existe si faltan más de 15 min. */
export const REMINDER_PRE_MS = 15 * 60_000;

/** Desde la hoja: vista previa con el mark de la app y vencimiento desde `now` (sin read no hay valores del servidor). */
export function levelFromCell(market: { id: number; mark: number }, cell: AskCell, now: Date): TradeLevel {
  return {
    marketId: market.id, levelBps: cell.levelBps, horizonMin: cell.horizonMin,
    target: targetFor(market.mark, cell.levelBps), expiresAt: expiresAtFor(now, cell.horizonMin).toISOString(),
  };
}

/** Desde una read: los valores que decidió el servidor (D2) y el id para ligar los recordatorios. */
export function levelFromRead(read: Read): TradeLevel {
  return { marketId: read.marketId, levelBps: read.levelBps, horizonMin: read.horizonMin, target: read.target, expiresAt: read.expiresAt, readId: read.id };
}

/** Lado sugerido (D12): nivel por encima del mark → long; por debajo → short. */
export const sideFor = (levelBps: number): Side => (levelBps > 0 ? "long" : "short");

export const levelIsLive = (level: TradeLevel, nowMs: number): boolean => Date.parse(level.expiresAt) > nowMs;

/** «Resolves 14:05 · in 3 h 58 m» (hora local, 24 h); vencido: «Resolves 14:05 · now». */
export function resolvesLabel(level: TradeLevel, nowMs: number): string {
  const d = new Date(level.expiresAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const left = d.getTime() - nowMs;
  return `Resolves ${p(d.getHours())}:${p(d.getMinutes())} · ${left <= 0 ? "now" : `in ${formatRemaining(left)}`}`;
}

export const levelTitle = (symbol: string, level: TradeLevel): string => `${symbol} ${cellLabel(level)}`;

export type ReminderKind = "pre" | "expiry";

/** Qué programará reminder-set para este nivel (misma regla que el servidor). */
export const reminderKinds = (level: TradeLevel, nowMs: number): ReminderKind[] =>
  Date.parse(level.expiresAt) - REMINDER_PRE_MS > nowMs ? ["pre", "expiry"] : ["expiry"];

export const remindersCopy = (kinds: readonly ReminderKind[]): string =>
  kinds.length === 2 ? "Reminders set: 15 min before and at expiry." : "Reminder set at expiry.";
