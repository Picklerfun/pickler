// Board nivel × tiempo (spec mobile-light D10–D12). Puro: geometría, rótulos y trayectoria.
// El Handoff dibuja 6 niveles × 3 horizontes; aquí mandan los del backend (5 × 4).
import { formatPrice, type Side } from "../perpl/orders";
import { horizonLabel, LEVELS_BPS, levelLabel, targetFor } from "./matrix";

export const BOARD_CELL_H = 48;
export const BOARD_MARK_H = 26;
const ABOVE = LEVELS_BPS.filter((b) => b > 0).length; // 3 filas sobre la banda
export const BOARD_H = LEVELS_BPS.length * BOARD_CELL_H + BOARD_MARK_H;

export type BoardMode = "trade" | "ask";
export type BoardRow = { kind: "level"; bps: number; price: number; label: string; side: Side } | { kind: "mark" };

export function boardRows(mark: number): BoardRow[] {
  const levels: BoardRow[] = LEVELS_BPS.map((bps) => ({ kind: "level", bps, price: targetFor(mark, bps), label: levelLabel(bps), side: bps > 0 ? "long" : "short" }));
  return [...levels.slice(0, ABOVE), { kind: "mark" }, ...levels.slice(ABOVE)];
}

export const cellTone = (mode: BoardMode, bps: number): "long" | "short" | "ask" => (mode === "ask" ? "ask" : bps > 0 ? "long" : "short");

export function boardCaption(mode: BoardMode, cell: { levelBps: number; horizonMin: number; target?: number } | undefined, mark: number, pd: number): { text: string; tone: "long" | "short" | "ask" | "none" } {
  if (!cell) return { text: "TAP A SQUARE", tone: "none" };
  // Con `target` explícito (nivel ya armado en Trade), se usa ése y no el que recalcularía el mark vivo (item 2 de la ola final).
  const price = formatPrice(cell.target ?? targetFor(mark, cell.levelBps), pd);
  const h = horizonLabel(cell.horizonMin);
  if (mode === "ask") return { text: `ASK ABOUT ${price} WITHIN ${h}`, tone: "ask" };
  const tone = cellTone(mode, cell.levelBps) as "long" | "short";
  return { text: `${tone.toUpperCase()} TO ${price} WITHIN ${h}`, tone };
}

// Anclas en bps respecto al mark actual → y en px del board: centro de cada fila y de la banda.
const ANCHORS: [number, number][] = [
  ...LEVELS_BPS.slice(0, ABOVE).map((b, i): [number, number] => [b, i * BOARD_CELL_H + BOARD_CELL_H / 2]),
  [0, ABOVE * BOARD_CELL_H + BOARD_MARK_H / 2],
  ...LEVELS_BPS.slice(ABOVE).map((b, i): [number, number] => [b, (ABOVE + i) * BOARD_CELL_H + BOARD_MARK_H + BOARD_CELL_H / 2]),
];

function yFor(bps: number): number {
  // Segmento entre dos anclas; fuera del board se extrapola con el segmento del extremo y el clamp lo pega al borde.
  const j = ANCHORS.findIndex(([b]) => b <= bps);
  const i = j <= 0 ? 1 : j; // j = -1: por debajo de la última ancla; j = 0: por encima de la primera
  const [b0, y0] = ANCHORS[j === -1 ? ANCHORS.length - 2 : i - 1];
  const [b1, y1] = ANCHORS[j === -1 ? ANCHORS.length - 1 : i];
  const px = y0 + ((b0 - bps) / (b0 - b1)) * (y1 - y0);
  return Math.min(98, Math.max(2, Math.round((px / BOARD_H) * 1000) / 10));
}

/** Historial de marks en memoria (`perpl/marks.ts`) → polilínea detrás de las celdas. Con < 2 marks, nada. */
export function trajectory(marks: readonly number[], mark: number): [number, number][] {
  if (marks.length < 2 || !(mark > 0)) return [];
  const last = marks.length - 1;
  return marks.map((m, i) => [Math.round((i / last) * 1000) / 10, yFor(((m - mark) / mark) * 10000)]);
}

export function stickyPhrase(side: Side, symbol: string, level: { target: number; horizonMin: number; levelBps: number } | undefined, pd: number): string {
  const s = side === "long" ? "Long" : "Short";
  // Si el lado elegido no coincide con el que implica el nivel (levelBps > 0 ⇒ long), el nivel no aplica a este lado:
  // la barra dice el mercado liso, no un precio que contradiría "Short" (item 4 de la ola final).
  const matches = level !== undefined && (level.levelBps > 0) === (side === "long");
  return matches ? `${s} to ${formatPrice(level!.target, pd)} within ${horizonLabel(level!.horizonMin)}` : `${s} ${symbol} at market`;
}
