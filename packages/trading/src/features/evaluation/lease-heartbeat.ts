import { PilotError } from "@pickler/core";
export interface LeaseDiagnostic {
  kind: "renewed" | "renewal-failed" | "release-failed";
  at: number;
  durationMs: number;
  timerDelayMs: number;
  lastSuccessAt: number | null;
  expiresAt: number;
  code: string | null;
}
export function startLeaseHeartbeat(input: {
  lease: { expiresAt: number };
  renew: () => Promise<void>;
  now?: () => number;
  diagnostic?: (event: LeaseDiagnostic) => void;
}) {
  const now = input.now ?? Date.now;
  const lost = new AbortController();
  let pending: Promise<void> | undefined;
  let lastSuccessAt: number | null = null;
  let expected = now() + 20000;
  const tick = () => {
    if (pending || lost.signal.aborted) {
      return;
    }
    const started = now();
    const delay = Math.max(0, started - expected);
    expected = started + 20000;
    pending = input
      .renew()
      .then(() => {
        lastSuccessAt = now();
        input.diagnostic?.({
          kind: "renewed",
          at: now(),
          durationMs: now() - started,
          timerDelayMs: delay,
          lastSuccessAt,
          expiresAt: input.lease.expiresAt,
          code: null,
        });
      })
      .catch((error) => {
        const code = error instanceof PilotError ? error.code : "LEASE_RENEWAL_FAILED";
        lost.abort(error);
        input.diagnostic?.({
          kind: "renewal-failed",
          at: now(),
          durationMs: now() - started,
          timerDelayMs: delay,
          lastSuccessAt,
          expiresAt: input.lease.expiresAt,
          code,
        });
      })
      .finally(() => {
        pending = undefined;
      });
  };
  const timer = setInterval(tick, 20000);
  return {
    signal: lost.signal,
    tick,
    async stop() {
      clearInterval(timer);
      await pending;
    },
  };
}
