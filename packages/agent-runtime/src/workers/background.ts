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

/** The preview runs of briefs (studio-brief-v1 §4): claimed when no research run is waiting. */
export type PreviewExecution = {
  repository: Pick<ResearchRepository, "recover" | "claim" | "renew">;
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>;
};

export async function consumeWakeup(
  repository: BackgroundRepository,
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>,
  queue: WakeupQueue,
  now = Date.now,
  previews?: PreviewExecution,
) {
  try {
    await repository.recover(now());
    await previews?.repository.recover(now());
    const run = await repository.claim(now());
    let job: {
      run: RunRecord;
      lease: Pick<ResearchRepository, "renew">;
      execute: (run: RunRecord, signal: AbortSignal) => Promise<void>;
    } | null = run ? { run, lease: repository, execute } : null;
    if (!job && previews) {
      const preview = await previews.repository.claim(now());
      job = preview
        ? { run: preview, lease: previews.repository, execute: previews.execute }
        : null;
    }
    if (!job) {
      return;
    }
    const current = job;
    // Wake another invocation before research, so pending jobs can use spare capacity.
    await executeWithLease(current.lease, current.run, async (claimed, signal) => {
      await notify(queue);
      await current.execute(claimed, signal);
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
