import {
  PilotError,
  type PerpNetwork,
  type PerpSymbol,
  type PerpSnapshot,
  type PerpOrderBook,
} from "@pickler/core";
import { validatePaperFrame, type PerpsPaperFrame } from "./simulation.js";

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
export async function acquirePerpsFrames(input: {
  network: PerpNetwork;
  symbols: readonly PerpSymbol[];
  now: () => number;
  signal: AbortSignal;
  guard: () => Promise<void>;
  snapshot: (symbol: PerpSymbol) => Promise<PerpSnapshot>;
  book: (symbol: PerpSymbol) => Promise<PerpOrderBook>;
  hash: (value: unknown) => string;
  diagnostic?: (event: AcquisitionDiagnostic) => void;
}): Promise<PerpsPaperFrame[]> {
  const start = input.now();
  const pairs = new Map<PerpSymbol, { snapshot?: PerpSnapshot; book?: PerpOrderBook }>();
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
          pair.book = await input.book(symbol);
        } else {
          pair.snapshot = await input.snapshot(symbol);
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
