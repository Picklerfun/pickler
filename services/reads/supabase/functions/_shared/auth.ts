// Identidad app → servicio (D6): firma personal_sign de `pickler-reads:<address>:<ts>`, válida 24 h.
import { type Hex, isAddress, recoverMessageAddress } from "npm:viem@2.56.8";

export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SESSION_FUTURE_MS = 5 * 60 * 1000;

export type AuthResult = { ok: true; address: string } | { ok: false; status: 401; error: "missing_signature" | "signature_expired" | "bad_signature" };

export function canonicalMessage(address: string, ts: number): string {
  return `pickler-reads:${address.toLowerCase()}:${ts}`;
}

export async function authenticate(headers: Headers, now = Date.now()): Promise<AuthResult> {
  const address = headers.get("x-pickler-address")?.toLowerCase() ?? "";
  const tsRaw = headers.get("x-pickler-ts") ?? "";
  const sig = headers.get("x-pickler-sig") ?? "";
  if (!isAddress(address) || !/^\d{13}$/.test(tsRaw) || !/^0x[0-9a-fA-F]{130}$/.test(sig)) {
    return { ok: false, status: 401, error: "missing_signature" };
  }
  const ts = Number(tsRaw);
  if (ts < now - SESSION_MAX_AGE_MS || ts > now + SESSION_FUTURE_MS) return { ok: false, status: 401, error: "signature_expired" };
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: canonicalMessage(address, ts), signature: sig as Hex });
  } catch {
    return { ok: false, status: 401, error: "bad_signature" };
  }
  return recovered.toLowerCase() === address ? { ok: true, address } : { ok: false, status: 401, error: "bad_signature" };
}
