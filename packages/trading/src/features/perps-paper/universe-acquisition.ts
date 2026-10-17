import {
  PilotError,
  type PerpNetwork,
  type PerpSymbol,
  type PerpSnapshot,
  type PerpOrderBook,
} from "@pickler/core";
import { validatePaperFrame, type PerpsPaperFrame } from "./simulation.js";
import { transientPerpsData, type AcquisitionDiagnostic } from "./acquisition.js";
export * from "./universe-acquisition-v2.js";
/** Bounded partial universe acquisition; individual exclusions are shared by every strategy. */
export async function acquireUniverse(input: {
  network: PerpNetwork;
  symbols: readonly PerpSymbol[];
  now(): number;
  signal: AbortSignal;
  guard(): Promise<void>;
  snapshot(symbol: PerpSymbol): Promise<PerpSnapshot>;
  book(symbol: PerpSymbol): Promise<PerpOrderBook>;
  hash(value: unknown): string;
  wait(signal: AbortSignal): Promise<void>;
  diagnostic?(value: AcquisitionDiagnostic): void;
}) {
  const start = input.now();
  const pairs = new Map<
    PerpSymbol,
    {
      snapshot?: PerpSnapshot;
      book?: PerpOrderBook;
      error?: string;
      permanent?: boolean;
      repeat?: boolean;
    }
  >();
  const recoverable = (e: unknown) =>
    transientPerpsData(e) ||
    (e instanceof PilotError &&
      [
        "PERPL_SESSION_LIMIT",
        "PERPL_INVALID_RESPONSE",
        "PERPL_MARKET_IDENTITY",
        "INVALID_MARKET_DATA",
      ].includes(e.code));
  let attempt = 0;
  let exhausted = false;
  try {
    while (input.now() - start < 20000 && !exhausted) {
      let allValid = true;
      for (const symbol of input.symbols) {
        if (input.now() - start >= 20000) {
          exhausted = true;
          break;
        }
        input.signal.throwIfAborted();
        await input.guard();
        const pair = pairs.get(symbol) ?? {};
        pairs.set(symbol, pair);
        if (pair.permanent) {
          continue;
        }
        if (pair.snapshot && pair.book) {
          try {
            validatePaperFrame(
              { snapshot: pair.snapshot, book: pair.book, hash: input.hash(pair) },
              input.network,
              symbol,
              input.now(),
            );
            continue;
          } catch (e) {
            if (!recoverable(e)) {
              throw e;
            }
          }
        }
        allValid = false;
        try {
          if (pair.repeat) {
            await input.wait(input.signal);
            pair.repeat = false;
          }
          if (input.now() - start >= 20000) {
            exhausted = true;
            break;
          }
          if (
            !pair.book ||
            (pair.snapshot &&
              (pair.book.provenance.providerTimestamp ?? -Infinity) <=
                (pair.snapshot.ticker.provenance.providerTimestamp ?? -Infinity))
          ) {
            const next = await input.book(symbol);
            pair.repeat =
              !!pair.book &&
              next.provenance.providerTimestamp === pair.book.provenance.providerTimestamp;
            pair.book = next;
          } else {
            const next = await input.snapshot(symbol);
            pair.repeat =
              !!pair.snapshot &&
              next.ticker.provenance.providerTimestamp ===
                pair.snapshot.ticker.provenance.providerTimestamp;
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
          delete pair.error;
        } catch (e) {
          if (input.signal.aborted) {
            throw e;
          }
          if (!recoverable(e)) {
            throw e;
          }
          pair.error = (e as PilotError).code;
          pair.permanent = [
            "PERPL_INVALID_RESPONSE",
            "PERPL_MARKET_IDENTITY",
            "INVALID_MARKET_DATA",
          ].includes(pair.error);
          if (pair.error === "PERPL_SESSION_LIMIT") {
            exhausted = true;
            break;
          }
        }
        const t = pair.snapshot?.ticker.provenance.providerTimestamp ?? null,
          b = pair.book?.provenance.providerTimestamp ?? null;
        input.diagnostic?.({
          symbol,
          attempt: ++attempt,
          at: input.now(),
          tickerAt: t,
          bookAt: b,
          skewMs: t === null || b === null ? null : Math.abs(t - b),
          code: pair.error ?? null,
        });
      }
      if (allValid) {
        break;
      }
    }
  } catch (e) {
    if (!input.signal.aborted) {
      throw e;
    }
  }
  // The caller rechecks parent cancellation/ownership with a live signal before accepting this subset.
  const frames: PerpsPaperFrame[] = [],
    excluded: { symbol: PerpSymbol; code: string; phase: string }[] = [];
  const at = input.now();
  for (const symbol of input.symbols) {
    const pair = pairs.get(symbol);
    try {
      if (!pair?.snapshot || !pair.book || pair.permanent) {
        throw new PilotError(pair?.error ?? "DATA_UNAVAILABLE", "Incomplete universe pair");
      }
      const frame = {
        snapshot: pair.snapshot,
        book: pair.book,
        hash: input.hash({ snapshot: pair.snapshot, book: pair.book }),
      };
      validatePaperFrame(frame, input.network, symbol, at);
      frames.push(frame);
    } catch (e) {
      if (!recoverable(e)) {
        throw e;
      }
      excluded.push({ symbol, code: (e as PilotError).code, phase: "acquisition" });
    }
  }
  return { frames, excluded };
}
