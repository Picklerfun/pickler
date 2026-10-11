import type { PublicTokenTradePreparedDto } from "@pickler/api-schema";
export interface PublicTradeAttempt {
  prepared: PublicTokenTradePreparedDto;
  status: "review" | "submitting" | "confirming" | "unknown" | "confirmed" | "reverted";
  hash: string | null;
}
const attempts = new Map<string, PublicTradeAttempt | null>();
const listeners = new Set<() => void>();
export const subscribePublicTrade = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function readPublicTrade(
  key: string,
  decode: (value: unknown) => PublicTokenTradePreparedDto | null,
) {
  if (typeof window === "undefined") {
    return null;
  }
  if (!attempts.has(key)) {
    let value: PublicTradeAttempt | null = null;
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) ?? "null");
      const prepared = decode(stored?.prepared);
      if (
        prepared &&
        (stored.hash === null ||
          (typeof stored.hash === "string" && /^0x[0-9a-f]{64}$/i.test(stored.hash))) &&
        ["review", "submitting", "confirming", "unknown", "confirmed", "reverted"].includes(
          stored.status,
        )
      ) {
        value = { prepared, status: stored.status, hash: stored.hash };
        if (value?.status === "submitting") {
          value = { ...value, status: "unknown" };
        }
      }
    } catch {
      /* Unread local memory cannot initiate a signature. */
    }
    attempts.set(key, value);
  }
  return attempts.get(key) ?? null;
}
export function writePublicTrade(key: string, value: PublicTradeAttempt | null) {
  // Before signing, persistence is mandatory. After submission, keep the result in memory
  // even if storage fails: the previously stored submitting state restores as unknown.
  try {
    if (value) {
      sessionStorage.setItem(key, JSON.stringify(value));
    } else {
      sessionStorage.removeItem(key);
    }
  } catch (error) {
    if (!value || value.status === "review" || value.status === "submitting") {
      throw error;
    }
  }
  attempts.set(key, value);
  for (const listener of listeners) {
    listener();
  }
}
