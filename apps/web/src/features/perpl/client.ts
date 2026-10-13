import { z } from "zod";
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
  INVALID_AUTHORIZATION: "Read authorization changed or expired. Start again.",
  RATE_LIMITED: "Perpl is limiting reads. Updates will resume shortly.",
};
export async function perplRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  token?: string,
  input?: unknown,
): Promise<T> {
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
          ? "READ_ACCESS_EXPIRED"
          : "UNAVAILABLE";
    throw new PerplReadError(code, words[code] ?? words.UNAVAILABLE!);
  }
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) {
    throw new PerplReadError("INVALID_RESPONSE", words.INVALID_RESPONSE!);
  }
  return parsed.data;
}
