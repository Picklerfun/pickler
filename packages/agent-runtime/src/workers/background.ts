import { PREVIEW_PRIORITY_AFTER_MS, type ResearchRepository, type RunRecord } from "@pickler/core";
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

/** The preview runs of briefs (studio-brief-v1 §4), executed by the same runner. */
export type PreviewExecution = {
  repository: Pick<ResearchRepository, "recover" | "renew"> & {
    /** With `queuedBefore`, only a preview queued before then. */
    claim(now: number, queuedBefore?: number): Promise<RunRecord | null>;
  };
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>;
};

export type ClaimedJob = {
  run: RunRecord;
  lease: Pick<ResearchRepository, "renew">;
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>;
};

/**
 * The next job: a preview queued longer than `PREVIEW_PRIORITY_AFTER_MS`, else a research run,
 * else any preview. Both claims share the execution policy's limits.
 */
export async function claimNext(
  repository: Pick<ResearchRepository, "claim" | "renew">,
  execute: (run: RunRecord, signal: AbortSignal) => Promise<void>,
  previews: PreviewExecution | undefined,
  now = Date.now,
): Promise<ClaimedJob | null> {
  const preview = (claimed: RunRecord | null): ClaimedJob | null =>
    claimed && previews
      ? { run: claimed, lease: previews.repository, execute: previews.execute }
      : null;
  if (previews) {
    const overdue = preview(
      await previews.repository.claim(now(), now() - PREVIEW_PRIORITY_AFTER_MS),
    );
    if (overdue) {
      return overdue;
    }
  }
  const run = await repository.claim(now());
  if (run) {
    return { run, lease: repository, execute };
  }
  return previews ? preview(await previews.repository.claim(now())) : null;
}

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
    const job = await claimNext(repository, execute, previews, now);
    if (!job) {
      return;
    }
    // Wake another invocation before research, so pending jobs can use spare capacity.
    await executeWithLease(job.lease, job.run, async (claimed, signal) => {
      await notify(queue);
      await job.execute(claimed, signal);
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
