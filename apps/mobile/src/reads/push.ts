// Payload de los pushes de resolve-reads (F1 copy.ts: `pickler: { kind, readId, marketId }`) → navegación (D10, P7). Puro.
import type { Patch, TradeLevel } from "../store";
import { cellLabel } from "./matrix";
import type { Read } from "./types";

export type PushTarget =
  | { kind: "read"; readId: string; marketId: number }
  | { kind: "reminder"; reminderId: string; marketId: number; readId: string | null };

function targetOf(v: unknown): PushTarget | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.marketId !== "number") return null;
  if (r.kind === "read" && typeof r.readId === "string") return { kind: "read", readId: r.readId, marketId: r.marketId };
  if (r.kind === "reminder" && typeof r.reminderId === "string") {
    return { kind: "reminder", reminderId: r.reminderId, marketId: r.marketId, readId: typeof r.readId === "string" ? r.readId : null };
  }
  return null;
}

/** Busca `pickler` (o el objeto mismo) en cada fuente: content.data, trigger.payload (userInfo de iOS). */
export function pushTargetOf(...sources: unknown[]): PushTarget | null {
  for (const s of sources) {
    if (s === null || typeof s !== "object") continue;
    const t = targetOf((s as Record<string, unknown>).pickler) ?? targetOf(s);
    if (t) return t;
  }
  return null;
}

export function patchForPush(t: PushTarget): Patch {
  return t.kind === "read"
    ? { perpsMarketId: t.marketId, marketTab: "ask", askView: "mine", askFocusReadId: t.readId }
    : { perpsMarketId: t.marketId, marketTab: "trade" }; // el push de recordatorio no trae target ni vencimiento: Trade se abre sin LevelCard (F3, P9)
}

export const pushEnvFor = (dev: boolean): "sandbox" | "production" => (dev ? "sandbox" : "production");

/** Fallback D10: notificación local al vencer la read, sin mark (la app no lo sabe). */
export function localResolutionContent(read: Read): { title: string; body: string; data: Record<string, unknown> } {
  return {
    title: `${read.symbol} ${cellLabel(read)}`,
    body: "Your read has resolved — open Pickler to see if the agent was right.",
    data: { pickler: { kind: "read", readId: read.id, marketId: read.marketId } },
  };
}

/** Fallback D10 para recordatorios (PUSH_MODE === "local"): sin mark (la app no lo sabe al programarla). */
export function localReminderContent(symbol: string, level: TradeLevel, kind: "pre" | "expiry"): { title: string; body: string; data: Record<string, unknown> } {
  return {
    title: `${symbol} ${cellLabel(level)}`,
    body: kind === "pre" ? "Your level resolves in 15 min — check your position on Perpl." : "Your level resolves now — check your position on Perpl.",
    data: { pickler: { kind: "reminder", reminderId: `local-${kind}-${level.expiresAt}`, marketId: level.marketId, readId: level.readId ?? null } },
  };
}
