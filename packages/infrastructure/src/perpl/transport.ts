import { PilotError, type PerpNetwork, type PerpReadContext, type PerpSymbol } from "@pickler/core";
import { networkFailure, type NetworkFailure } from "./network-diagnostics.js";
export const PERPL_NETWORKS = {
  mainnet: { chainId: 143, base: "https://app.perpl.xyz/api" },
  testnet: { chainId: 10143, base: "https://testnet.perpl.xyz/api" },
} as const;
export interface PerplPublicResponse {
  url: string;
  receivedAt: number;
  body: string;
}
export interface PerplRequestDiagnostic {
  version?: 2 | 3;
  queuedAt?: number;
  startedAt?: number | null;
  queueMs?: number;
  bodyMs?: number | null;
  validationMs?: number | null;
  operation: string;
  /** Present only for recognized individual-market book/ticker paths; never a URL or query. */
  marketId?: number;
  status: number | null;
  durationMs: number;
  code: string | null;
  phase: "request_queue" | "response_headers" | "response_body" | "validation" | "complete";
  headersMs: number | null;
  network: NetworkFailure | null;
}
function requestMarketId(path: string): number | undefined {
  const match = /^\/v1\/market-data\/([1-9]\d*)\/(?:ticker|book(?:\?levels=\d+)?)$/.exec(path);
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}
/** A normalized ticker read is not necessarily a new HTTP request. */
export interface PerplTickerReadDiagnostic {
  version: 1;
  source: "network" | "cache";
  batch: boolean;
  receivedAt: number;
  requestedSymbols: PerpSymbol[];
  symbols: {
    symbol: PerpSymbol;
    marketId: number;
    providerTimestamp: number | null;
    block: number | null;
  }[];
}
/** Shared by all read sessions in one evaluation host, including retries. */
export class PerplRequestSchedule {
  tail: Promise<unknown> = Promise.resolve();
  lastStart = -Infinity;
  blockedUntil = 0;
}
/** Requests one read session may make unless the host asks for more (up to the check cap). */
export const PERPL_SESSION_LIMIT = 12;
/** A studio Perpl check reads two instruments, refreshes a frame before acting, and the web. */
export const PERPL_CHECK_SESSION_LIMIT = 24;
export interface PerplDataOptions {
  positionMarkets?: readonly import("@pickler/core").PerpMarketInfo[];
  schedule?: PerplRequestSchedule;
  /** Explicit private universe adapter; never selected by public tools. */
  universe?: boolean;
  /** Requests this session may make: 1–24, default 12. Trusted host configuration only. */
  sessionLimit?: number;
  retryTransient?: boolean;
  guard?: () => Promise<void>;
  onDiagnostic?: (event: PerplRequestDiagnostic) => void;
  /** Safe original per-market dates; no response bodies, headers or credentials. */
  onTickerRead?: (event: PerplTickerReadDiagnostic) => void;
  onValidation?: (event: {
    version: 1;
    operation: string;
    durationMs: number;
    code: string | null;
  }) => void;

  transport?: typeof fetch;
  now?: () => number;
  monotonic?: () => number;
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
export async function pause(ms: number, signal: AbortSignal) {
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
  private readonly schedule: PerplRequestSchedule;
  private requests = 0;
  private stopped = false;
  private readonly limit: number;
  readonly now: () => number;
  constructor(private readonly options: PerplDataOptions = {}) {
    const limit = options.sessionLimit ?? PERPL_SESSION_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > PERPL_CHECK_SESSION_LIMIT) {
      throw new PilotError("INVALID_INPUT", "A Perpl read session makes 1–24 requests");
    }
    this.limit = limit;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? new PerplRequestSchedule();
  }
  get remainingRequests(): number {
    return Math.max(0, this.limit - this.requests);
  }
  get(network: PerpNetwork, path: string, ctx: PerpReadContext): Promise<PerplPublicResponse> {
    const queuedAt = this.now();
    const queuedMono = (this.options.monotonic ?? (() => performance.now()))();
    const marketId = requestMarketId(path);
    let dispatched = false;
    const result = this.schedule.tail
      .then(() =>
        this.request(network, path, ctx, queuedAt, queuedMono, () => {
          dispatched = true;
        }),
      )
      .catch((error) => {
        if (!dispatched) {
          this.options.onDiagnostic?.({
            version: 3,
            ...(marketId === undefined ? {} : { marketId }),
            operation: path.endsWith("/ticker")
              ? "ticker"
              : path.includes("/book?")
                ? "book"
                : path.includes("/candles/")
                  ? "candles"
                  : path.includes("funding")
                    ? "funding"
                    : "metadata",
            queuedAt,
            startedAt: null,
            queueMs: Math.max(
              0,
              (this.options.monotonic ?? (() => performance.now()))() - queuedMono,
            ),
            durationMs: 0,
            headersMs: null,
            bodyMs: null,
            validationMs: null,
            status: null,
            code:
              error instanceof PilotError
                ? error.code
                : ctx.signal.aborted
                  ? "PERPL_CANCELLED"
                  : "PERPL_TRANSPORT_FAILURE",
            phase: "request_queue",
            network: networkFailure(error, ctx.signal.aborted ? "cancelled" : undefined),
          });
        }
        throw error;
      });
    this.schedule.tail = result.catch(() => {});
    return result;
  }
  private async request(
    network: PerpNetwork,
    path: string,
    ctx: PerpReadContext,
    queuedAt: number,
    queuedMono: number,
    dispatched: () => void,
  ): Promise<PerplPublicResponse> {
    await ctx.guard();
    await this.options.guard?.();
    ctx.signal.throwIfAborted();
    if (this.stopped || this.requests >= this.limit) {
      throw new PilotError(
        "PERPL_SESSION_LIMIT",
        "Perpl read session has stopped or reached its limit",
      );
    }
    await pause(
      Math.max(
        0,
        Math.max(
          1000 - (Date.now() - this.schedule.lastStart),
          this.schedule.blockedUntil - Date.now(),
        ),
      ),
      ctx.signal,
    );
    await ctx.guard();
    await this.options.guard?.();
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(10_000)]);
    signal.throwIfAborted();
    dispatched();
    this.schedule.lastStart = Date.now();
    this.requests++;
    const url = PERPL_NETWORKS[network].base + path;
    const marketId = requestMarketId(path);
    const started = this.now();
    const mono = this.options.monotonic ?? (() => performance.now());
    const startedMono = mono();
    let bodyMs: number | null = null;
    let validationMs: number | null = null;
    let bodyStart: number | null = null;
    let validationStart: number | null = null;
    let status: number | null = null;
    let code: string | null = null;
    let phase: PerplRequestDiagnostic["phase"] = "response_headers";
    let headersMs: number | null = null;
    let networkDiagnostic: NetworkFailure | null = null;
    try {
      const response = await abortable(
        (this.options.transport ?? fetch)(url, { method: "GET", redirect: "manual", signal }),
        signal,
      );
      status = response.status;
      headersMs = mono() - startedMono;
      bodyStart = mono();
      phase = "response_body";
      if (status === 429) {
        const retry = response.headers.get("retry-after");
        const seconds =
          retry !== null && /^\d+(?:\.\d+)?$/.test(retry) ? Number(retry) * 1000 : NaN;
        const date = retry ? Date.parse(retry) - Date.now() : NaN;
        const delay = Number.isFinite(seconds)
          ? seconds
          : Number.isFinite(date)
            ? Math.max(0, date)
            : 60000;
        this.schedule.blockedUntil = Math.max(this.schedule.blockedUntil, Date.now() + delay);
      }
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
      bodyMs = mono() - bodyStart!;
      validationStart = mono();
      phase = "validation";
      signal.throwIfAborted();
      await ctx.guard();
      await this.options.guard?.();
      const result = { url, receivedAt: this.now(), body };
      await this.options.onResponse?.(result);
      validationMs = mono() - validationStart;
      phase = "complete";
      return result;
    } catch (error) {
      networkDiagnostic = networkFailure(
        error,
        ctx.signal.aborted ? "cancelled" : signal.aborted ? "timeout" : undefined,
      );
      const failure =
        error instanceof PilotError
          ? error
          : new PilotError(
              ctx.signal.aborted
                ? "PERPL_CANCELLED"
                : signal.aborted
                  ? "PERPL_TIMEOUT"
                  : "PERPL_TRANSPORT_FAILURE",
              "Perpl public read did not complete",
            );
      code = failure.code;
      this.stopped =
        !this.options.retryTransient ||
        !/^(PERPL_TIMEOUT|PERPL_TRANSPORT_FAILURE|PERPL_HTTP_(408|429|5\d\d))$/.test(code);
      throw failure;
    } finally {
      this.options.onDiagnostic?.({
        operation: path.endsWith("/ticker")
          ? "ticker"
          : path.includes("/book?")
            ? "book"
            : path.includes("/candles/")
              ? "candles"
              : path.includes("funding")
                ? "funding"
                : "metadata",
        version: 3,
        ...(marketId === undefined ? {} : { marketId }),
        queuedAt,
        startedAt: started,
        queueMs: Math.max(0, startedMono - queuedMono),
        bodyMs: bodyMs ?? (bodyStart === null ? null : mono() - bodyStart),
        validationMs: validationMs ?? (validationStart === null ? null : mono() - validationStart),
        status,
        phase,
        headersMs,
        network: networkDiagnostic,
        durationMs: mono() - startedMono,
        code,
      });
    }
  }
}
