// Sesión de la cuenta: entrar con la wallet contra la API (SIWE) y saber hasta cuándo vale el token. Puro (el fetch se inyecta).
// La app guarda la llave abierta mientras la wallet está desbloqueada, así que firmar el mensaje no cuesta ningún prompt:
// la sesión vive en memoria y se vuelve a pedir cuando hace falta, sin refresh token ni cliente de Supabase.
import { base64urlnopad } from "@scure/base";
import type { Hex } from "viem";
import { type DoFetch, fetchChallenge, presentSignature } from "./api";

export type IdentitySession = { address: string; userId: string; token: string };

/** Margen antes del vencimiento en que el token ya no se usa: uno que vence en vuelo es un 401 que nadie provocó. */
export const EXPIRY_MARGIN_MS = 60_000;

/** Vencimiento del JWT en ms, o null si no se puede leer. No verifica nada: la API verifica; esto sólo decide si vale la pena enviarlo. */
export function tokenExpiry(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    // Sin TextDecoder (no está garantizado en Hermes): el payload es JSON y `exp` un número, así que byte a carácter basta.
    const text = String.fromCharCode(...base64urlnopad.decode(payload.replace(/=+$/, "")));
    const exp = (JSON.parse(text) as { exp?: unknown } | null)?.exp;
    return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** La sesión sólo vale para su dirección y mientras el token no esté por vencer; un vencimiento ilegible no se reusa. */
export function sessionFor(s: IdentitySession | undefined, address: string, now = Date.now()): IdentitySession | undefined {
  if (!s || s.address !== address.toLowerCase()) return undefined;
  const exp = tokenExpiry(s.token);
  return exp !== null && exp - EXPIRY_MARGIN_MS > now ? s : undefined;
}

/**
 * Entra con la wallet: pide el mensaje, lo firma sin tocarlo y lo presenta. `sign` es `LocalAccount.signMessage` de la
 * wallet desbloqueada (sin prompt). Lanza IdentityError si la API no responde o rechaza.
 */
export async function signInWithWallet(
  args: { base: string; address: string; chainId: number; sign: (message: string) => Promise<Hex> },
  doFetch: DoFetch = fetch,
): Promise<IdentitySession> {
  const message = await fetchChallenge(args.base, args.address, args.chainId, doFetch);
  const signature = await args.sign(message);
  const { userId, token } = await presentSignature(args.base, message, signature, doFetch);
  return { address: args.address.toLowerCase(), userId, token };
}
