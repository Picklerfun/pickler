import type { ResearchRepository, RunRecord } from "@pickler/core";

/** Await both execution and heartbeat cleanup inside the host invocation. */
export async function executeWithLease(
  repository: Pick<ResearchRepository, "renew">,
  run: RunRecord,
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>,
  parentSignal?: AbortSignal,
  heartbeatMs = 15_000,
) {
  const controller = new AbortController();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, controller.signal])
    : controller.signal;
  let stopped = false;
  let wake: (() => void) | undefined;
  const heartbeat = (async () => {
    while (!stopped && !signal.aborted) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, heartbeatMs);
        function done() {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        }
        wake = done;
        signal.addEventListener("abort", done, { once: true });
      });
      if (stopped || signal.aborted) {
        break;
      }
      try {
        await repository.renew(run);
      } catch {
        controller.abort(new Error("Execution lease renewal failed"));
      }
    }
  })();
  try {
    await execute(run, signal);
  } finally {
    stopped = true;
    wake?.();
    await heartbeat;
  }
}
