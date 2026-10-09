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
  monotonic?: () => number;
  diagnostic?: (event: LeaseDiagnostic) => void;
}) {
  const now = input.now ?? Date.now;
  const monotonic = input.monotonic ?? now;
  const lost = new AbortController();
  let pending: Promise<void> | undefined;
  let lastSuccessAt: number | null = null;
  const startedAt = now();
  let expected = startedAt + 20000;
  const assertActive = () => {
    if (!lost.signal.aborted && now() - (lastSuccessAt ?? startedAt) >= 90000) {
      const error = new PilotError(
        "PROCESS_INTERRUPTED",
        "Renewal gap exceeded the lease duration",
      );
      lost.abort(error);
      input.diagnostic?.({
        kind: "renewal-failed",
        at: now(),
        durationMs: 0,
        timerDelayMs: Math.max(0, now() - expected),
        lastSuccessAt,
        expiresAt: input.lease.expiresAt,
        code: error.code,
      });
    }
    lost.signal.throwIfAborted();
  };
  const tick = () => {
    try {
      assertActive();
    } catch {
      return;
    }
    if (pending || lost.signal.aborted) {
      return;
    }
    const started = now();
    const startedMono = monotonic();
    const delay = Math.max(0, started - expected);
    expected = started + 20000;
    pending = input
      .renew()
      .then(() => {
        assertActive();
        lastSuccessAt = now();
        input.diagnostic?.({
          kind: "renewed",
          at: now(),
          durationMs: monotonic() - startedMono,
          timerDelayMs: delay,
          lastSuccessAt,
          expiresAt: input.lease.expiresAt,
          code: null,
        });
      })
      .catch((error) => {
        if (lost.signal.aborted) {
          return;
        }
        const code = error instanceof PilotError ? error.code : "LEASE_RENEWAL_FAILED";
        lost.abort(error);
        input.diagnostic?.({
          kind: "renewal-failed",
          at: now(),
          durationMs: monotonic() - startedMono,
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
    assertActive,
    tick,
    async stop() {
      clearInterval(timer);
      await pending;
    },
  };
}
