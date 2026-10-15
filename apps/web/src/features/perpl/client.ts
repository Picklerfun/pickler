import { z } from "zod";
import { apiClock } from "../../lib/server-clock";
export class PerplReadError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PerplReadError";
  }
}
const words: Record<string, string> = {
  UNAVAILABLE: "Perpl is not responding. Your last snapshot is kept.",
  INVALID_RESPONSE: "This snapshot could not be verified. Updates will retry shortly.",
  READ_ACCESS_EXPIRED: "Read access expired or was revoked. Authorize it again.",
  READ_ACCESS_DENIED: "Perpl denied read access. Check permissions at Perpl.",
  NO_PERPL_PROFILE: "Connect this wallet at Perpl testnet first, then return here.",
  KEY_LIMIT: "Remove unused keys at Perpl before authorizing another read session.",
  INVALID_AUTHORIZATION:
    "The read-access request is invalid. Pickler needs to review this request.",
  AUTHORIZATION_STALE: "The signing request timed out. Prepare a new read-access request.",
  AUTHORIZATION_REJECTED: "Perpl rejected read-access registration. No read session was created.",
  INTEGRATION_NOT_ALLOWED:
    "Perpl has not allowed this integration. Pickler needs to review its registration.",
  READ_SIGNATURE_REJECTED:
    "Perpl could not verify this account read. Retrying with a fresh signature.",
  READ_REQUEST_REJECTED: "Perpl rejected the account read. Your read session is kept.",
  PICKLER_SESSION_EXPIRED:
    "Your Pickler sign-in expired. Reconnect your wallet to resume account reads.",
  RATE_LIMITED: "Perpl is limiting reads. Updates will resume shortly.",
};
export async function perplRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  token?: string,
  input?: unknown,
): Promise<T> {
  const started = performance.now();
  const response = await fetch(`/api/v1/perpl/${path}`, {
    method: input === undefined ? "GET" : "POST",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(input === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const code =
      typeof body?.error === "string" && body.error in words
        ? body.error
        : response.status === 401
          ? "PICKLER_SESSION_EXPIRED"
          : "UNAVAILABLE";
    throw new PerplReadError(code, words[code] ?? words.UNAVAILABLE!);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PerplReadError("INVALID_RESPONSE", words.INVALID_RESPONSE!);
  }
  if (path === "markets") {
    const data = parsed.data as { serverTimeMs?: unknown };
    if (typeof data.serverTimeMs === "number") {
      apiClock.observe(data.serverTimeMs, started);
    }
  }
  return parsed.data;
}
