// Textos de los pushes (D10). `token`/`env` los rellena quien manda; aquí sólo el contenido.
import type { Push } from "./apns.ts";
import { formatScaled } from "./matrix.ts";

const HORIZONS: Record<number, string> = { 60: "1H", 240: "4H", 720: "12H", 1440: "24H" };
export const horizonLabel = (min: number): string => HORIZONS[min] ?? `${min}m`;
export const levelLabel = (bps: number): string => `${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;

export type ReadForPush = { id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number; price_decimals: number; agent_name: string };
export type ReminderForPush = { id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number; price_decimals: number; target: number; kind: string; read_id: string | null };

const title = (symbol: string, bps: number, tail: string) => `${symbol} ${levelLabel(bps)} · ${tail}`;

export function readResolvedPush(r: ReadForPush, status: "right" | "wrong", mark: number): Push {
  return { token: "", env: "production", title: title(r.symbol, r.level_bps, horizonLabel(r.horizon_min)),
    body: `${r.agent_name} was ${status} · mark ${formatScaled(mark, r.price_decimals)}`, data: { kind: "read", readId: r.id, marketId: r.market_id } };
}

export function readVoidPush(r: ReadForPush): Push {
  return { token: "", env: "production", title: title(r.symbol, r.level_bps, horizonLabel(r.horizon_min)),
    body: "Read voided: Perpl was unavailable at expiry. Your credit is back.", data: { kind: "read", readId: r.id, marketId: r.market_id } };
}

export function reminderPush(m: ReminderForPush, mark: number): Push {
  const pre = m.kind === "pre";
  const body = `${m.symbol} at ${formatScaled(mark, m.price_decimals)} · your level ${formatScaled(m.target, m.price_decimals)}${pre ? "" : " · close by hand if you're done"}`;
  return { token: "", env: "production", title: title(m.symbol, m.level_bps, pre ? "15 min left" : "horizon reached"), body,
    data: { kind: "reminder", reminderId: m.id, marketId: m.market_id, readId: m.read_id } };
}
