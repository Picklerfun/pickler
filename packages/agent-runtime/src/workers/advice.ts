import type { AdviceExecutionRepository, AdviceJob } from "@pickler/core";
import { executeWithLease } from "./lease.js";
export interface AdviceBackground {
  repository: AdviceExecutionRepository;
  execute(job: AdviceJob, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
async function notify(send: () => Promise<void>) {
  try {
    await send();
  } catch {
    console.error("Advice wakeup awaits scheduled reconciliation");
  }
}
export async function consumeAdvice(runtime: AdviceBackground, send: () => Promise<void>) {
  try {
    await runtime.repository.recover();
    const job = await runtime.repository.claim();
    if (!job) {
      return;
    }
    await executeWithLease(runtime.repository, job, async (claimed, signal) => {
      if (await runtime.repository.recover()) {
        await notify(send);
      }
      await runtime.execute(claimed, signal);
    });
    if (await runtime.repository.recover()) {
      await notify(send);
    }
  } finally {
    await runtime.close();
  }
}
export async function reconcileAdvice(
  runtime: AdviceBackground,
  enabled: boolean,
  send: () => Promise<void>,
) {
  try {
    if ((await runtime.repository.recover()) && enabled) {
      await notify(send);
    }
  } finally {
    await runtime.close();
  }
}
