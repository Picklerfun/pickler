import {
  PilotError,
  type PerpNetwork,
  type PerpOrderBook,
  type PerpSnapshot,
  type PerpSymbol,
} from "@pickler/core";
import { transientPerpsData, type AcquisitionDiagnostic } from "./acquisition.js";
import { validatePaperFrame, type PerpsPaperFrame } from "./simulation.js";

export const PERPS_UNIVERSE_COHERENT_POLICY = "rest-universe-coherent-20s-v2" as const;

export interface UniverseAcquisitionDiagnostic extends AcquisitionDiagnostic {
  policy: typeof PERPS_UNIVERSE_COHERENT_POLICY;
  component: "book" | "ticker-batch";
  repeated: boolean;
  nextRetryAt: number | null;
  deadlineAt: number;
}

interface Pair {
  snapshot?: PerpSnapshot;
  book?: PerpOrderBook;
  error?: string;
  permanent?: boolean;
  tickerReadyAt: number;
  bookReadyAt: number;
  lastBookAttempt: number;
}

const permanentCodes = ["PERPL_INVALID_RESPONSE", "PERPL_MARKET_IDENTITY", "INVALID_MARKET_DATA"];

function recoverable(error: unknown): error is PilotError {
  return (
    error instanceof PilotError &&
    (transientPerpsData(error) ||
      permanentCodes.includes(error.code) ||
      error.code === "PERPL_SESSION_LIMIT")
  );
}

/**
 * Every snapshots call must perform one fresh, guarded bulk ticker read. Its latest states are
 * shared with every pair, including previously valid pairs. Transport owns serialization/caps.
 * deadlineAt includes metadata work before this function; component backoff never stalls ready work.
 */
export async function acquireUniverseV2(input: {
  network: PerpNetwork;
  symbols: readonly PerpSymbol[];
  deadlineAt: number;
  now(): number;
  signal: AbortSignal;
  guard(): Promise<void>;
  snapshots(symbols: readonly PerpSymbol[]): Promise<PerpSnapshot[]>;
  book(symbol: PerpSymbol): Promise<PerpOrderBook>;
  hash(value: unknown): string;
  waitUntil(at: number, signal: AbortSignal): Promise<void>;
  diagnostic?(value: UniverseAcquisitionDiagnostic): void;
}) {
  const start = input.now();
  if (!Number.isFinite(input.deadlineAt) || input.deadlineAt > start + 20000) {
    throw new PilotError("INVALID_ACQUISITION_DEADLINE", "Invalid bounded acquisition deadline");
  }
  const pairs = new Map<PerpSymbol, Pair>();
  for (const symbol of input.symbols) {
    if (pairs.has(symbol)) {
      throw new PilotError("PERPL_MARKET_IDENTITY", "Duplicate universe symbol");
    }
    pairs.set(symbol, { tickerReadyAt: start, bookReadyAt: start, lastBookAttempt: 0 });
  }
  let attempt = 0;
  let operation = 0;
  let lastWasRecovery = false;

  const deadlineAborted = () => {
    const reason: unknown = input.signal.reason;
    const timedOut =
      (reason instanceof PilotError && reason.code === "PERPL_TIMEOUT") ||
      (reason instanceof Error && reason.name === "TimeoutError");
    return input.signal.aborted && timedOut && input.now() >= input.deadlineAt;
  };

  const frame = (pair: Pair): PerpsPaperFrame | null =>
    pair.snapshot && pair.book
      ? {
          snapshot: pair.snapshot,
          book: pair.book,
          hash: input.hash({ snapshot: pair.snapshot, book: pair.book }),
        }
      : null;

  const codeAt = (symbol: PerpSymbol, pair: Pair, at: number): string | null => {
    if (pair.permanent) {
      return pair.error ?? "PERPL_INVALID_RESPONSE";
    }
    const value = frame(pair);
    if (!value) {
      return pair.error ?? "DATA_UNAVAILABLE";
    }
    try {
      validatePaperFrame(value, input.network, symbol, at);
      return null;
    } catch (error) {
      if (!recoverable(error)) {
        throw error;
      }
      if (permanentCodes.includes(error.code)) {
        pair.permanent = true;
        pair.error = error.code;
      }
      return error.code;
    }
  };

  const record = (
    symbol: PerpSymbol,
    pair: Pair,
    component: UniverseAcquisitionDiagnostic["component"],
    repeated: boolean,
    operationCode?: string,
  ) => {
    const tickerAt = pair.snapshot?.ticker.provenance.providerTimestamp ?? null;
    const bookAt = pair.book?.provenance.providerTimestamp ?? null;
    const at = input.now();
    const readyAt = component === "book" ? pair.bookReadyAt : pair.tickerReadyAt;
    input.diagnostic?.({
      policy: PERPS_UNIVERSE_COHERENT_POLICY,
      symbol,
      attempt: ++attempt,
      component,
      repeated,
      nextRetryAt: readyAt > at ? readyAt : null,
      deadlineAt: input.deadlineAt,
      at,
      tickerAt,
      bookAt,
      skewMs: tickerAt === null || bookAt === null ? null : Math.abs(tickerAt - bookAt),
      code: operationCode ?? codeAt(symbol, pair, at),
    });
  };

  try {
    while (input.now() < input.deadlineAt) {
      input.signal.throwIfAborted();
      await input.guard();
      input.signal.throwIfAborted();
      if (input.now() >= input.deadlineAt) {
        break;
      }
      const at = input.now();
      const invalid = input.symbols.filter((symbol) => {
        const pair = pairs.get(symbol)!;
        return codeAt(symbol, pair, at) !== null && !pair.permanent;
      });
      if (!invalid.length) {
        break;
      }
      const needsTicker = invalid.filter((symbol) => {
        const pair = pairs.get(symbol)!;
        return (
          !pair.snapshot ||
          (!!pair.book &&
            (pair.snapshot.ticker.provenance.providerTimestamp ?? -Infinity) <
              (pair.book.provenance.providerTimestamp ?? -Infinity))
        );
      });
      const needsBook = invalid.filter((symbol) => !needsTicker.includes(symbol));
      const readyTicker = needsTicker.filter((symbol) => pairs.get(symbol)!.tickerReadyAt <= at);
      const readyBook = needsBook.filter((symbol) => pairs.get(symbol)!.bookReadyAt <= at);
      const missingBook = readyBook.filter((symbol) => !pairs.get(symbol)!.book);
      const recoveryBook = readyBook
        .filter((symbol) => !!pairs.get(symbol)!.book)
        .sort(
          (left, right) => pairs.get(left)!.lastBookAttempt - pairs.get(right)!.lastBookAttempt,
        );
      const recoveryTicker = readyTicker.some((symbol) => !!pairs.get(symbol)!.book);

      // One repair may jump ahead of the initial scan; an unread book then gets its turn.
      let selectedBook: PerpSymbol | undefined;
      let selectedBatch = false;
      if (lastWasRecovery && missingBook.length) {
        selectedBook = missingBook[0];
      } else if (recoveryTicker) {
        selectedBatch = true;
      } else if (recoveryBook.length) {
        selectedBook = recoveryBook[0];
      } else if (readyTicker.length) {
        selectedBatch = true;
      } else if (missingBook.length) {
        selectedBook = missingBook[0];
      }

      if (selectedBatch) {
        lastWasRecovery = recoveryTicker;
        try {
          const batch = await input.snapshots(input.symbols);
          await input.guard();
          input.signal.throwIfAborted();
          const next = new Map<PerpSymbol, PerpSnapshot>();
          for (const snapshot of batch) {
            const symbol = snapshot.market.symbol;
            if (!pairs.has(symbol) || next.has(symbol)) {
              throw new PilotError("PERPL_MARKET_IDENTITY", "Invalid bulk ticker identity");
            }
            next.set(symbol, snapshot);
          }
          for (const symbol of input.symbols) {
            const pair = pairs.get(symbol)!;
            if (pair.permanent) {
              continue;
            }
            const snapshot = next.get(symbol);
            const previous = pair.snapshot?.ticker.provenance.providerTimestamp ?? null;
            const timestamp = snapshot?.ticker.provenance.providerTimestamp ?? null;
            const repeated = !!snapshot && previous !== null && previous === timestamp;
            if (snapshot) {
              pair.snapshot = snapshot;
              if (previous !== null && timestamp !== null && timestamp < previous) {
                pair.error = "PERPL_INVALID_RESPONSE";
                pair.permanent = true;
              } else {
                delete pair.error;
              }
            } else {
              delete pair.snapshot;
              pair.error = "DATA_UNAVAILABLE";
            }
            pair.tickerReadyAt = repeated || !snapshot ? input.now() + 2000 : input.now();
            record(symbol, pair, "ticker-batch", repeated);
          }
        } catch (error) {
          if (input.signal.aborted || !recoverable(error)) {
            throw error;
          }
          if (error.code === "PERPL_SESSION_LIMIT") {
            break;
          }
          for (const symbol of input.symbols) {
            const pair = pairs.get(symbol)!;
            if (pair.permanent) {
              continue;
            }
            pair.error = error.code;
            pair.permanent = permanentCodes.includes(error.code);
            pair.tickerReadyAt = input.now() + 2000;
            record(symbol, pair, "ticker-batch", false, error.code);
          }
        }
      } else if (selectedBook) {
        const symbol = selectedBook;
        const pair = pairs.get(symbol)!;
        lastWasRecovery = !!pair.book;
        pair.lastBookAttempt = ++operation;
        let repeated = false;
        let operationCode: string | undefined;
        try {
          const book = await input.book(symbol);
          await input.guard();
          input.signal.throwIfAborted();
          const previous = pair.book?.provenance.providerTimestamp ?? null;
          const timestamp = book.provenance.providerTimestamp;
          repeated = previous !== null && previous === timestamp;
          pair.book = book;
          if (previous !== null && timestamp !== null && timestamp < previous) {
            pair.error = "PERPL_INVALID_RESPONSE";
            pair.permanent = true;
          } else {
            delete pair.error;
          }
          pair.bookReadyAt = repeated ? input.now() + 2000 : input.now();
        } catch (error) {
          if (input.signal.aborted || !recoverable(error)) {
            throw error;
          }
          if (error.code === "PERPL_SESSION_LIMIT") {
            break;
          }
          pair.error = error.code;
          operationCode = error.code;
          pair.permanent = permanentCodes.includes(error.code);
          pair.bookReadyAt = input.now() + 2000;
        }
        record(symbol, pair, "book", repeated, operationCode);
      } else {
        const readyAt = Math.min(
          input.deadlineAt,
          ...needsTicker.map((symbol) => pairs.get(symbol)!.tickerReadyAt),
          ...needsBook.map((symbol) => pairs.get(symbol)!.bookReadyAt),
        );
        await input.waitUntil(readyAt, input.signal);
      }
    }
  } catch (error) {
    const deadlineFailure =
      error === input.signal.reason ||
      (error instanceof PilotError && ["PERPL_TIMEOUT", "PERPL_CANCELLED"].includes(error.code));
    if (!(deadlineAborted() && deadlineFailure)) {
      throw error;
    }
  }

  // Deadline cancellation is not permission/ownership renewal. The host's live guard must pass
  // before an elapsed acquisition can return a partial subset, including after an aborted read.
  await input.guard();
  if (!deadlineAborted()) {
    input.signal.throwIfAborted();
  }
  const at = input.now();
  const frames: PerpsPaperFrame[] = [];
  const excluded: { symbol: PerpSymbol; code: string; phase: string }[] = [];
  for (const symbol of input.symbols) {
    const pair = pairs.get(symbol)!;
    const code = codeAt(symbol, pair, at);
    const value = frame(pair);
    if (code === null && value) {
      frames.push(value);
    } else {
      excluded.push({ symbol, code: code ?? "DATA_UNAVAILABLE", phase: "acquisition" });
    }
  }
  return { frames, excluded };
}
