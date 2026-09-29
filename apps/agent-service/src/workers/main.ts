import { setTimeout } from "node:timers/promises";
import { claimNext } from "@pickler/agent-runtime";
import { createContainer } from "../composition/container";
import { executeWithLease } from "./lease";

const container = await createContainer();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const tradingLoop = (async () => {
  while (!controller.signal.aborted && container.trading) {
    try {
      await container.trading.tick();
    } catch {
      console.error("Trading reconciliation deferred; no orders resent");
    }
    await setTimeout(5000, undefined, { signal: controller.signal }).catch(() => {});
  }
})();
try {
  console.log("Pickler worker ready with per-run leases.");
  while (!controller.signal.aborted) {
    await container.repository.recover(Date.now());
    await container.previews.repository.recover(Date.now());
    await container.repository.tick(Date.now());
    const job = await claimNext(container.repository, container.execute, container.previews);
    if (job) {
      try {
        await executeWithLease(job.lease, job.run, job.execute, controller.signal);
      } catch {
        console.error("Research execution interrupted; expired leases will be recovered");
      }
    } else {
      await setTimeout(250, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
} finally {
  controller.abort();
  await tradingLoop;
  await container.repository.close();
}
