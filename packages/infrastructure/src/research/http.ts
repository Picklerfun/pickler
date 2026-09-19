import { PilotError } from "@pickler/core";

export async function providerJson(
  url: string,
  init: RequestInit,
  parent: AbortSignal,
  fetcher: typeof fetch = fetch,
  onUsage?: (usage: Record<string, number>) => void,
): Promise<unknown> {
  const signal = AbortSignal.any([parent, AbortSignal.timeout(20_000)]);
  try {
    const response = await fetcher(url, { ...init, signal, redirect: "manual" });
    const usage: Record<string, number> = {};
    for (const key of ["x-requests-remaining", "x-requests-used", "x-requests-last"]) {
      const raw = response.headers.get(key);
      if (raw !== null && /^\d+$/.test(raw)) {
        usage[key] = Number(raw);
      }
    }
    onUsage?.(usage);
    if (!response.ok) {
      throw new PilotError(`PROVIDER_HTTP_${response.status}`, "Provider request failed");
    }
    // Bound response bytes before JSON parsing; never log provider bodies or credentials.
    const reader = response.body?.getReader();
    if (!reader) {
      throw new PilotError("INVALID_PROVIDER_RESPONSE", "Empty response");
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > 2_000_000) {
          throw new PilotError("PROVIDER_RESPONSE_TOO_LARGE", "Response exceeded two megabytes");
        }
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof PilotError) {
      throw error;
    }
    throw new PilotError(
      signal.aborted ? "PROVIDER_TIMEOUT" : "INVALID_PROVIDER_RESPONSE",
      "Provider request failed",
    );
  }
}
