// Sesión firmada app → servicio de reads (D6): personal_sign de `pickler-reads:<address>:<ts>`, 24 h. Puro (P1).
import type { Hex } from "viem";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_RENEW_BEFORE_MS = 60 * 60 * 1000; // se renueva cuando queda menos de 1 h (P2)
const FUTURE_MS = 5 * 60 * 1000; // el servidor acepta ts hasta 5 min en el futuro

export type ReadsSession = { address: string; ts: number; sig: Hex };

export function canonicalMessage(address: string, ts: number): string {
  return `pickler-reads:${address.toLowerCase()}:${ts}`;
}

/** Firma con la cuenta de la wallet (viem LocalAccount.signMessage). `now` en ms. */
export async function createSession(sign: (message: string) => Promise<Hex>, address: string, now = Date.now()): Promise<ReadsSession> {
  const lower = address.toLowerCase();
  return { address: lower, ts: now, sig: await sign(canonicalMessage(lower, now)) };
}

export function isUsable(s: ReadsSession, now = Date.now()): boolean {
  return now - s.ts < SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS && s.ts <= now + FUTURE_MS;
}

/** La sesión guardada sólo vale para su dirección y mientras sea usable. */
export function sessionFor(s: ReadsSession | undefined, address: string, now = Date.now()): ReadsSession | undefined {
  return s && s.address === address.toLowerCase() && isUsable(s, now) ? s : undefined;
}

/**
 * true si la cuenta cambió mientras una petición estaba en vuelo: su respuesta (éxito o error) ya no
 * corresponde a la cuenta visible y se descarta (revisión final F1 mobile-light, I1). Compara en minúsculas.
 */
export function isStaleAccount(requested: string | null, current: string | null): boolean {
  return (requested?.toLowerCase() ?? null) !== (current?.toLowerCase() ?? null);
}

export function signedHeaders(s: ReadsSession): Record<string, string> {
  return { "x-pickler-address": s.address, "x-pickler-ts": String(s.ts), "x-pickler-sig": s.sig };
}

export function serializeSession(s: ReadsSession): string {
  return JSON.stringify(s);
}

export function parseSession(raw: string): ReadsSession | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (value === null || typeof value !== "object") return undefined;
  const { address, ts, sig } = value as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/.test(address)) return undefined;
  if (typeof ts !== "number" || !Number.isInteger(ts) || ts <= 0) return undefined;
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return undefined;
  return { address, ts, sig: sig as Hex };
}
