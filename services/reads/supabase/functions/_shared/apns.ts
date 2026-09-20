// Push por APNs directo (D10): JWT ES256 con WebCrypto, HTTP/2 vía fetch. Token del dispositivo lo manda la app (F2).
export const APNS_TOPIC = "fun.pickler.app";
const JWT_TTL_MS = 40 * 60 * 1000; // Apple acepta hasta 60 min

const utf8 = (s: string) => new TextEncoder().encode(s);
const b64url = (bytes: ArrayBuffer | Uint8Array): string =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlDecode = (s: string): string => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

export function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, "");
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export function importP8(pem: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pemToPkcs8(pem) as unknown as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function makeProviderJwt(key: CryptoKey, keyId: string, teamId: string, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const data = `${b64url(utf8(JSON.stringify({ alg: "ES256", kid: keyId })))}.${b64url(utf8(JSON.stringify({ iss: teamId, iat: nowSec })))}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(data)); // r‖s de 64 bytes = formato JOSE
  return `${data}.${b64url(sig)}`;
}

export function decodeJwt(jwt: string): { header: unknown; payload: unknown } {
  const [h, p] = jwt.split(".");
  return { header: JSON.parse(b64urlDecode(h)), payload: JSON.parse(b64urlDecode(p)) };
}

let cached: { jwt: string; at: number } | null = null;

/** JWT de proveedor desde los secretos, cacheado 40 min por instancia. Lanza si falta algún secreto. */
export async function providerJwt(now = Date.now()): Promise<string> {
  if (cached && now - cached.at < JWT_TTL_MS) return cached.jwt;
  const p8b64 = Deno.env.get("APNS_KEY_P8_B64"), keyId = Deno.env.get("APNS_KEY_ID"), teamId = Deno.env.get("APNS_TEAM_ID");
  if (!p8b64 || !keyId || !teamId) throw new Error("APNS secrets missing");
  const jwt = await makeProviderJwt(await importP8(atob(p8b64)), keyId, teamId, Math.floor(now / 1000));
  cached = { jwt, at: now };
  return jwt;
}

export type Push = { token: string; env: "sandbox" | "production"; title: string; body: string; data?: Record<string, unknown> };

export async function sendPush(p: Push, jwt: string, doFetch: (url: string, init: RequestInit) => Promise<Response> = fetch): Promise<{ status: number; reason: string | null }> {
  const host = p.env === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await doFetch(`https://${host}/3/device/${p.token}`, {
    method: "POST",
    headers: { authorization: `bearer ${jwt}`, "apns-topic": APNS_TOPIC, "apns-push-type": "alert", "apns-priority": "10", "content-type": "application/json" },
    body: JSON.stringify({ aps: { alert: { title: p.title, body: p.body }, sound: "default" }, ...(p.data ? { pickler: p.data } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, reason: typeof body?.reason === "string" ? body.reason : null };
}
