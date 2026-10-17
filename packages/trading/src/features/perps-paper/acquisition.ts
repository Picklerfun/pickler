import {
  PilotError,
  type PerpNetwork,
  type PerpSymbol,
  type PerpSnapshot,
  type PerpOrderBook,
} from "@pickler/core";
import { validatePaperFrame, type PerpsPaperFrame } from "./simulation.js";

export const PERPS_REST_PACED_POLICY = "rest-paced-20s-v1" as const;
export const PERPS_STREAM_POLICY = "stream-20s-v1" as const;
export type PerpsDataPolicy =
  | "coherent-20s-v1"
  | "rest-universe-20s-v1"
  | "rest-universe-coherent-20s-v2"
  | "stream-universe-20s-v1"
  | "stream-universe-component-20s-v2"
  | "stream-universe-component-paper-20s-v1"
  | typeof PERPS_REST_PACED_POLICY
  | typeof PERPS_STREAM_POLICY;

export const PERPS_DATA_POLICY = "coherent-20s-v1" as const;
export function transientPerpsData(error: unknown): boolean {
  return (
    error instanceof PilotError &&
    ([
      "STALE_MARKET_DATA",
      "INCONSISTENT_MARKET_DATA",
      "PERPL_TIMEOUT",
      "PERPL_TRANSPORT_FAILURE",
      "DATA_UNAVAILABLE",
    ].includes(error.code) ||
      /^PERPL_HTTP_(408|429|5\d\d)$/.test(error.code))
  );
}
export interface AcquisitionDiagnostic {
  symbol: PerpSymbol;
  attempt: number;
  at: number;
  tickerAt: number | null;
  bookAt: number | null;
  skewMs: number | null;
  code: string | null;
}
/** The host supplies a twenty-second cancellation deadline covering every read and wait. */
export async function acquirePerpsFrames<S extends PerpSymbol>(input: {
  network: PerpNetwork;
  symbols: readonly S[];
  now: () => number;
  signal: AbortSignal;
  guard: () => Promise<void>;
  snapshot: (symbol: S) => Promise<PerpSnapshot>;
  book: (symbol: S) => Promise<PerpOrderBook>;
  hash: (value: unknown) => string;
  repeatedTimestampWait?: (
    symbol: S,
    component: "book" | "ticker",
    signal: AbortSignal,
  ) => Promise<void>;
  diagnostic?: (event: AcquisitionDiagnostic) => void;
}): Promise<PerpsPaperFrame[]> {
  const start = input.now();
  const pairs = new Map<PerpSymbol, { snapshot?: PerpSnapshot; book?: PerpOrderBook }>();
  const repeat = new Set<string>();
  let attempt = 0;
  while (input.now() - start < 20000) {
    input.signal.throwIfAborted();
    for (const symbol of input.symbols) {
      await input.guard();
      const pair = pairs.get(symbol) ?? {};
      pairs.set(symbol, pair);
      if (pair.snapshot && pair.book) {
        try {
          validatePaperFrame(
            { snapshot: pair.snapshot, book: pair.book, hash: input.hash(pair) },
            input.network,
            symbol,
            input.now(),
          );
          continue;
        } catch (error) {
          if (!transientPerpsData(error)) {
            throw error;
          }
        }
      }
      let code: string | null = null;
      try {
        const tickerAt = pair.snapshot?.ticker.provenance.providerTimestamp ?? -Infinity;
        const bookAt = pair.book?.provenance.providerTimestamp ?? -Infinity;
        if (!pair.book || (pair.snapshot && bookAt <= tickerAt)) {
          if (repeat.has(`${symbol}:book`)) {
            await input.repeatedTimestampWait?.(symbol, "book", input.signal);
            repeat.delete(`${symbol}:book`);
          }
          const next = await input.book(symbol);
          if (
            pair.book &&
            next.provenance.providerTimestamp === pair.book.provenance.providerTimestamp
          ) {
            repeat.add(`${symbol}:book`);
          }
          pair.book = next;
        } else {
          if (repeat.has(`${symbol}:ticker`)) {
            await input.repeatedTimestampWait?.(symbol, "ticker", input.signal);
            repeat.delete(`${symbol}:ticker`);
          }
          const next = await input.snapshot(symbol);
          if (
            pair.snapshot &&
            next.ticker.provenance.providerTimestamp ===
              pair.snapshot.ticker.provenance.providerTimestamp
          ) {
            repeat.add(`${symbol}:ticker`);
          }
          pair.snapshot = next;
        }
        if (!pair.snapshot) {
          pair.snapshot = await input.snapshot(symbol);
        }
        await input.guard();
        input.signal.throwIfAborted();
        if (pair.snapshot && pair.book) {
          validatePaperFrame(
            { snapshot: pair.snapshot, book: pair.book, hash: input.hash(pair) },
            input.network,
            symbol,
            input.now(),
          );
        }
      } catch (error) {
        input.signal.throwIfAborted();
        if (!transientPerpsData(error)) {
          throw error;
        }
        code = (error as PilotError).code;
      }
      const tickerAt = pair.snapshot?.ticker.provenance.providerTimestamp ?? null;
      const bookAt = pair.book?.provenance.providerTimestamp ?? null;
      input.diagnostic?.({
        symbol,
        attempt: ++attempt,
        at: input.now(),
        tickerAt,
        bookAt,
        skewMs: tickerAt === null || bookAt === null ? null : Math.abs(tickerAt - bookAt),
        code,
      });
    }
    const frames: PerpsPaperFrame[] = [];
    try {
      await input.guard();
      input.signal.throwIfAborted();
      const at = input.now();
      for (const symbol of input.symbols) {
        const pair = pairs.get(symbol)!;
        if (!pair.snapshot || !pair.book) {
          throw new PilotError("DATA_UNAVAILABLE", "Incomplete pair");
        }
        const frame = { snapshot: pair.snapshot, book: pair.book, hash: input.hash(pair) };
        validatePaperFrame(frame, input.network, symbol, at);
        frames.push(frame);
      }
      if (input.now() - start >= 20000) {
        break;
      }
      return frames;
    } catch (error) {
      if (!transientPerpsData(error)) {
        throw error;
      }
    }
  }
  throw new PilotError("DATA_UNAVAILABLE", "No coherent public data within twenty seconds");
}
