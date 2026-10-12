import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
import type { PublicTradeAttempt } from "./public-trade-memory";
import { WalletSubmissionUnknown } from "./public-token-transaction";

export type PublicReceiptResult = "pending" | "confirmed" | "reverted";
export const PUBLIC_CONFIRMATION_LIMITS = { reads: 30, interval: 3000, duration: 120_000 } as const;

/** Read the same hash only. A missing response never authorizes another broadcast. */
export async function waitForPublicTradeReceipt({
  read,
  signal,
  page = document,
}: {
  read: (signal: AbortSignal) => Promise<PublicReceiptResult>;
  signal: AbortSignal;
  page?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
}): Promise<PublicReceiptResult> {
  const bounded = AbortSignal.any([
    signal,
    AbortSignal.timeout(PUBLIC_CONFIRMATION_LIMITS.duration),
  ]);
  function wait(visible: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      function clear() {
        clearTimeout(timer);
        bounded.removeEventListener("abort", abort);
        page.removeEventListener("visibilitychange", changed);
      }
      function done() {
        clear();
        resolve();
      }
      function abort() {
        clear();
        reject(bounded.reason);
      }
      function changed() {
        if (!page.hidden) {
          done();
        }
      }
      if (bounded.aborted) {
        abort();
        return;
      }
      bounded.addEventListener("abort", abort, { once: true });
      if (visible) {
        page.addEventListener("visibilitychange", changed);
      } else {
        timer = setTimeout(done, PUBLIC_CONFIRMATION_LIMITS.interval);
      }
    });
  }
  try {
    for (let reads = 0; reads < PUBLIC_CONFIRMATION_LIMITS.reads; reads += 1) {
      bounded.throwIfAborted();
      if (page.hidden) {
        await wait(true);
      }
      const request = new AbortController();
      function pause() {
        if (page.hidden) {
          request.abort();
        }
      }
      page.addEventListener("visibilitychange", pause);
      try {
        const result = await read(AbortSignal.any([bounded, request.signal]));
        bounded.throwIfAborted();
        if (request.signal.aborted) {
          continue;
        }

        if (result !== "pending") {
          return result;
        }
      } catch {
        bounded.throwIfAborted();
        // Retry reads within the ceiling, never signing, sending or replacing the transaction.
      } finally {
        page.removeEventListener("visibilitychange", pause);
      }
      if (reads + 1 < PUBLIC_CONFIRMATION_LIMITS.reads) {
        await wait(false);
      }
    }
  } catch {
    signal.throwIfAborted();
  }
  return "pending";
}

/** One user-initiated approval/trade flow; restoration uses receipt reads only. */
export async function runPublicTokenTrade({
  prepared,
  prepareNext,
  send,
  receipt,
  keep,
  signal,
}: {
  prepared: PublicTokenTradePreparedDto;
  prepareNext: () => Promise<PublicTokenTradePreparedDto>;
  send: (prepared: PublicTokenTradePreparedDto) => Promise<string>;
  receipt: (hash: string) => Promise<PublicReceiptResult>;
  keep: (attempt: PublicTradeAttempt) => void;
  signal: AbortSignal;
}): Promise<PublicReceiptResult | "review"> {
  let next = prepared;
  for (let step = 0; step < 2; step += 1) {
    signal.throwIfAborted();
    const attempt: PublicTradeAttempt = { prepared: next, status: "review", hash: null };
    keep(attempt);
    keep({ ...attempt, status: "submitting" });
    let hash: string;
    try {
      hash = await send(next);
    } catch (error) {
      if (error instanceof WalletSubmissionUnknown) {
        keep({ ...attempt, status: "unknown", hash: error.hash });
        if (!error.hash) {
          throw error;
        }
        hash = error.hash;
      } else {
        keep(attempt);
        throw error;
      }
    }
    // Preserve the returned hash even if navigation/account change aborted this flow meanwhile.
    keep({ ...attempt, status: "confirming", hash });
    signal.throwIfAborted();
    const result = await receipt(hash);
    signal.throwIfAborted();
    if (result === "pending") {
      return result;
    }
    keep({ ...attempt, status: result, hash });
    if (result === "reverted" || !next.quote.approval) {
      return result;
    }
    const refreshed = await prepareNext();
    signal.throwIfAborted();
    if (
      refreshed.quote.approval ||
      refreshed.token.toLowerCase() !== next.token.toLowerCase() ||
      refreshed.curve.toLowerCase() !== next.curve.toLowerCase() ||
      refreshed.quoteToken.toLowerCase() !== next.quoteToken.toLowerCase() ||
      refreshed.transaction.from.toLowerCase() !== next.transaction.from.toLowerCase() ||
      refreshed.quote.side !== next.quote.side ||
      refreshed.quote.amount !== next.quote.amount ||
      refreshed.quote.slippageBps !== next.quote.slippageBps
    ) {
      throw new Error("Approval confirmed. The trade could not be prepared.");
    }
    keep({ prepared: refreshed, status: "review", hash: null });
    if (BigInt(refreshed.quote.minimumOutput) < BigInt(next.quote.minimumOutput)) {
      return "review";
    }
    next = refreshed;
  }
  throw new Error("The trade could not be completed.");
}
