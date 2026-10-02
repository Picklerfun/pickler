// Cliente de la API del producto (workers/api, tras el host web: `<base>` = https://pickler.fun/api/v1) para la cuenta:
// entrar con la wallet (SIWE) y el username. fetch con AbortController + setTimeout: AbortSignal.timeout no existe en RN.
// Mismo contrato que usa la web (apps/web/src/features/wallet/lib/connect.ts y handles.ts).

export type DoFetch = (url: string, init: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 15_000;

/** Error de la API: `status` HTTP (0 si no hubo respuesta) y `code` = `{ error }` del servidor, el status, o `timeout` | `network`. */
export class IdentityError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? `account ${status} ${code}`);
    this.name = "IdentityError";
  }
}

const COPY: Record<string, string> = {
  nonce_invalid: "That sign-in took too long to come back. Try again.",
  wrong_domain: "That signature was for a different site.",
  wrong_purpose: "That signature was for something else. Try again.",
  timeout: "Pickler took too long to answer. Try again.",
  network: "Couldn't reach Pickler. Check your connection and try again.",
  handle_taken: "Someone already has that one.",
};

export function describeIdentityError(e: unknown): string {
  if (e instanceof IdentityError) return COPY[e.code] ?? e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Respuesta `{ data }` del envelope de la API; un cuerpo sin él es un error del servidor, no un dato. */
async function call(url: string, init: RequestInit, doFetch: DoFetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new IdentityError(0, controller.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await res.json().catch(() => undefined);
  const fields = body !== null && typeof body === "object" ? (body as { error?: unknown; message?: unknown; data?: unknown }) : {};
  if (!res.ok) {
    const code = typeof fields.error === "string" ? fields.error : String(res.status);
    throw new IdentityError(res.status, code, typeof fields.message === "string" ? fields.message : undefined);
  }
  return fields.data;
}

const JSON_HEADERS = { "Content-Type": "application/json" };
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** El texto exacto a firmar, construido por el servidor: la app nunca arma un mensaje SIWE. */
export async function fetchChallenge(base: string, address: string, chainId: number, doFetch: DoFetch = fetch): Promise<string> {
  const data = await call(`${base}/auth/wallet/nonce`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ address, chain_id: chainId }) }, doFetch);
  const message = (data as { message?: unknown } | undefined)?.message;
  if (typeof message !== "string" || message === "") throw new IdentityError(200, "bad_response", "Pickler sent something unexpected.");
  return message;
}

export type SignedIn = { userId: string; token: string };

/** Presenta el texto firmado, sin tocarlo. `kind: "mera"`: describe el enlace; no decide nada. */
export async function presentSignature(base: string, raw: string, signature: string, doFetch: DoFetch = fetch): Promise<SignedIn> {
  const data = await call(`${base}/auth/wallet/verify`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ raw, signature, kind: "mera" }) }, doFetch);
  const { userId, session } = (data ?? {}) as { userId?: unknown; session?: { accessToken?: unknown } };
  if (typeof userId !== "string" || typeof session?.accessToken !== "string") throw new IdentityError(200, "bad_response", "Pickler sent something unexpected.");
  return { userId, token: session.accessToken };
}

/** El username de la cuenta; null si no tiene perfil (404). Cualquier otro fallo se lanza: no saber no es «no tiene». */
export async function fetchProfile(base: string, token: string, doFetch: DoFetch = fetch): Promise<{ handle: string } | null> {
  let data: unknown;
  try {
    data = await call(`${base}/profile`, { method: "GET", headers: bearer(token) }, doFetch);
  } catch (e) {
    if (e instanceof IdentityError && e.status === 404) return null;
    throw e;
  }
  const handle = (data as { handle?: unknown } | undefined)?.handle;
  if (typeof handle !== "string" || handle === "") throw new IdentityError(200, "bad_response", "Pickler sent something unexpected.");
  return { handle };
}

/** Reclama el username. El nombre visible es el mismo handle, como en la web. */
export async function createProfile(base: string, token: string, handle: string, doFetch: DoFetch = fetch): Promise<{ handle: string }> {
  const data = await call(`${base}/profile`, { method: "POST", headers: { ...JSON_HEADERS, ...bearer(token) }, body: JSON.stringify({ handle, display_name: handle }) }, doFetch);
  const claimed = (data as { handle?: unknown } | undefined)?.handle;
  return { handle: typeof claimed === "string" && claimed !== "" ? claimed : handle };
}

/** true libre, false tomado, null si no se pudo consultar (nunca «tomado» por un fallo). */
export async function handleAvailable(base: string, handle: string, doFetch: DoFetch = fetch): Promise<boolean | null> {
  try {
    const data = await call(`${base}/handles/${encodeURIComponent(handle)}/availability`, { method: "GET", headers: {} }, doFetch);
    const available = (data as { available?: unknown } | undefined)?.available;
    return typeof available === "boolean" ? available : null;
  } catch {
    return null;
  }
}
