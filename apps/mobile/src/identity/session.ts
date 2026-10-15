// Sesión de la cuenta: entrar con la wallet contra la API (SIWE) y saber hasta cuándo vale el token. Puro (el fetch se inyecta).
// La app guarda la llave abierta mientras la wallet está desbloqueada, así que firmar el mensaje no cuesta ningún prompt:
// la sesión vive en memoria y se vuelve a pedir cuando hace falta, sin refresh token ni cliente de Supabase.
import { base64urlnopad } from "@scure/base";
import type { Hex } from "viem";
import { parseSiweMessage } from "viem/siwe";
import { type DoFetch, fetchChallenge, IdentityError, presentSignature } from "./api";

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

/** La frase que core escribe en el mensaje de entrada (`SIGN_IN_STATEMENT` en packages/core). */
export const SIGN_IN_STATEMENT = "Sign in to Pickler";

export type ExpectedMessage = { address: string; chainId: number; domain: string };

/**
 * Lo único que la wallet firma sin prompt es el mensaje de entrada de SU dirección. La misma ruta de la API emite otro
 * mensaje —«Link wallet 0x… to this wallet's Pickler account»— que deja entrar a otra wallet a la cuenta, y la llave que
 * firma es la de los fondos; una API comprometida o una URL mal configurada no deben poder pedirlo. Se exige: un SIWE
 * bien formado, la dirección propia, la chain de la app, la frase exacta de entrada y el dominio del passkey (o un
 * subdominio: el estudio vive dentro de ese límite de confianza, spec mobile-monorepo §2). Lanza IdentityError.
 */
export function checkSignInMessage(message: string, expected: ExpectedMessage): void {
  const refuse = (why: string) => new IdentityError(0, "unexpected_message", `Pickler asked for something that is not a sign-in (${why}). Nothing was signed.`);
  let parsed: ReturnType<typeof parseSiweMessage>;
  try { parsed = parseSiweMessage(message); } catch { throw refuse("malformed"); }
  if (!parsed.domain || !parsed.address || parsed.chainId === undefined || !parsed.nonce) throw refuse("malformed");
  if (parsed.address.toLowerCase() !== expected.address.toLowerCase()) throw refuse("another address");
  if (parsed.chainId !== expected.chainId) throw refuse("another chain");
  if (parsed.statement !== SIGN_IN_STATEMENT) throw refuse("another purpose");
  const domain = parsed.domain.toLowerCase();
  const own = expected.domain.toLowerCase();
  if (domain !== own && !domain.endsWith(`.${own}`)) throw refuse("another site");
}

/**
 * Entra con la wallet: pide el mensaje, comprueba que es el de entrada de esta dirección, lo firma sin tocarlo y lo
 * presenta. `sign` es `LocalAccount.signMessage` de la wallet desbloqueada (sin prompt). Lanza IdentityError si la API
 * no responde, rechaza, o pide firmar otra cosa.
 */
export async function signInWithWallet(
  args: { base: string; address: string; chainId: number; domain: string; sign: (message: string) => Promise<Hex> },
  doFetch: DoFetch = fetch,
): Promise<IdentitySession> {
  const message = await fetchChallenge(args.base, args.address, args.chainId, doFetch);
  checkSignInMessage(message, args);
  const signature = await args.sign(message);
  const { userId, token } = await presentSignature(args.base, message, signature, doFetch);
  return { address: args.address.toLowerCase(), userId, token };
}
