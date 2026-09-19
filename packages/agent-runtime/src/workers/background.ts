import type { ResearchRepository, RunRecord } from "@pickler/core";
import { executeWithLease } from "./lease.js";

export type BackgroundRepository = Pick<
  ResearchRepository,
  "recover" | "claim" | "tick" | "renew"
> & {
  close(): Promise<void>;
};
export type WakeupQueue = { send(body: { kind: "research-wakeup" }): Promise<void> };

async function notify(queue: WakeupQueue) {
  try {
    await queue.send({ kind: "research-wakeup" });
  } catch {
    console.error("Research wakeup failed; scheduled reconciliation will retry");
  }
}

export async function consumeWakeup(
  repository: BackgroundRepository,
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>,
  queue: WakeupQueue,
  now = Date.now,
) {
  try {
    await repository.recover(now());
    const run = await repository.claim(now());
    if (!run) {
      return;
    }
    // Wake another invocation before research, so pending jobs can use spare capacity.
    await executeWithLease(repository, run, async (claimed, signal) => {
      await notify(queue);
      await execute(claimed, signal);
    });
    await notify(queue);
  } finally {
    await repository.close();
  }
}

export async function reconcile(
  repository: BackgroundRepository,
  queue: WakeupQueue,
  now = Date.now,
) {
  try {
    await repository.recover(now());
    await repository.tick(now());
    await queue.send({ kind: "research-wakeup" });
  } finally {
    await repository.close();
  }
}
