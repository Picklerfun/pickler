import { PilotError, type PerpNetwork, type PerpReadContext } from "@pickler/core";
export const PERPL_NETWORKS = {
  mainnet: { chainId: 143, base: "https://app.perpl.xyz/api" },
  testnet: { chainId: 10143, base: "https://testnet.perpl.xyz/api" },
} as const;
export interface PerplPublicResponse {
  url: string;
  receivedAt: number;
  body: string;
}
export interface PerplDataOptions {
  transport?: typeof fetch;
  now?: () => number;
  /** Trusted host hook for private captures; no headers or credentials are supplied. */
  onResponse?: (response: PerplPublicResponse) => Promise<void>;
}
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
async function pause(ms: number, signal: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await abortable(
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms);
      }),
      signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
/** One adapter is one bounded session. No background requests, redirects, or retries. */
export class PerplTransport {
  private tail: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;
  private requests = 0;
  private stopped = false;
  readonly now: () => number;
  constructor(private readonly options: PerplDataOptions = {}) {
    this.now = options.now ?? Date.now;
  }
  get(network: PerpNetwork, path: string, ctx: PerpReadContext): Promise<PerplPublicResponse> {
    const result = this.tail.then(() => this.request(network, path, ctx));
    this.tail = result.catch(() => {});
    return result;
  }
  private async request(
    network: PerpNetwork,
    path: string,
    ctx: PerpReadContext,
  ): Promise<PerplPublicResponse> {
    await ctx.guard();
    ctx.signal.throwIfAborted();
    if (this.stopped || this.requests >= 12) {
      throw new PilotError(
        "PERPL_SESSION_LIMIT",
        "Perpl read session has stopped or reached its limit",
      );
    }
    await pause(Math.max(0, 1000 - (Date.now() - this.lastStart)), ctx.signal);
    await ctx.guard();
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    this.lastStart = Date.now();
    this.requests++;
    const url = PERPL_NETWORKS[network].base + path;
    try {
      const response = await abortable(
        (this.options.transport ?? fetch)(url, { method: "GET", redirect: "manual", signal }),
        signal,
      );
      if (!response.ok) {
        await response.body?.cancel();
        throw new PilotError(`PERPL_HTTP_${response.status}`, "Perpl public request failed");
      }
      if (Number(response.headers.get("content-length")) > 2 * 1024 * 1024) {
        await response.body?.cancel();
        throw new PilotError("PERPL_RESPONSE_LIMIT", "Perpl response exceeds 2 MiB");
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new PilotError("PERPL_INVALID_RESPONSE", "Missing Perpl response body");
      }
      let size = 0;
      let body = "";
      const decoder = new TextDecoder("utf-8", { fatal: true });
      try {
        for (;;) {
          const chunk = await abortable(reader.read(), signal);
          if (chunk.done) {
            break;
          }
          size += chunk.value.byteLength;
          if (size > 2 * 1024 * 1024) {
            throw new PilotError("PERPL_RESPONSE_LIMIT", "Perpl response exceeds 2 MiB");
          }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
      } finally {
        void reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      signal.throwIfAborted();
      await ctx.guard();
      const result = { url, receivedAt: this.now(), body };
      await this.options.onResponse?.(result);
      return result;
    } catch (error) {
      this.stopped = true;
      if (error instanceof PilotError) {
        throw error;
      }
      throw new PilotError(
        ctx.signal.aborted
          ? "PERPL_CANCELLED"
          : signal.aborted
            ? "PERPL_TIMEOUT"
            : "PERPL_TRANSPORT_FAILURE",
        "Perpl public read did not complete",
      );
    }
  }
}
