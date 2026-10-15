import type { TokenOperationDto } from "@pickler/api-schema";
import { startPolling } from "../studio/lib/polling";

export type TokenConfirmationPhase = "receipt" | "indexing";
export interface TokenConfirmationBudget {
  startedAt: number;
  reads: number;
  stopped: boolean;
}
export const TOKEN_CONFIRMATION_LIMITS = {
  receipt: { reads: 10, interval: 3000 },
  indexing: { reads: 6, interval: 5000 },
  duration: 60_000,
} as const;

/** Only known broadcasts may start automatic receipt reads. Signing recovery stays explicit. */
export function tokenConfirmationPhase(
  operation: TokenOperationDto | null | undefined,
  hasToken: boolean,
): TokenConfirmationPhase | null {
  if (!operation?.txHash) {
    return null;
  }
  if (operation.status === "confirming" || operation.status === "included") {
    return "receipt";
  }
  if (operation.status === "finalized" && operation.action === "launch" && !hasToken) {
    return "indexing";
  }
  return null;
}

/** Budgets are retained in owner-scoped Studio memory across section navigation. */
export function startTokenConfirmation({
  phase,
  budget,
  read,
  onStop,
  page = document,
  now = Date.now,
}: {
  phase: TokenConfirmationPhase;
  budget: TokenConfirmationBudget;
  read: (signal: AbortSignal) => Promise<boolean>;
  onStop: (reason: "complete" | "limit" | "error") => void;
  page?: Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;
  now?: () => number;
}): () => void {
  const limit = TOKEN_CONFIRMATION_LIMITS[phase];
  const remaining = budget.startedAt + TOKEN_CONFIRMATION_LIMITS.duration - now();
  if (budget.stopped || budget.reads >= limit.reads || remaining <= 0) {
    budget.stopped = true;
    onStop("limit");
    return () => {};
  }
  let stopped = false;
  let stopReads = () => {};
  function finish(reason: "complete" | "limit" | "error") {
    if (stopped) {
      return;
    }
    stopped = true;
    budget.stopped = true;
    clearTimeout(deadline);
    stopReads();
    onStop(reason);
  }
  const deadline = setTimeout(() => finish("limit"), remaining);
  stopReads = startPolling(
    async (signal) => {
      if (
        stopped ||
        budget.reads >= limit.reads ||
        now() >= budget.startedAt + TOKEN_CONFIRMATION_LIMITS.duration
      ) {
        finish("limit");
        return null;
      }
      budget.reads += 1;
      let pending: boolean;
      try {
        pending = await read(signal);
      } catch {
        if (!signal.aborted) {
          finish("error");
        }
        return null;
      }
      if (signal.aborted || stopped) {
        return null;
      }
      if (!pending) {
        finish("complete");
        return null;
      }
      if (budget.reads >= limit.reads) {
        finish("limit");
        return null;
      }
      return limit.interval;
    },
    () => finish("error"),
    page,
  );
  return () => {
    stopped = true;
    clearTimeout(deadline);
    stopReads();
  };
}
