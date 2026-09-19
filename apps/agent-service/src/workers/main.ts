import { setTimeout } from "node:timers/promises";
import { createContainer } from "../composition/container";
import { executeWithLease } from "./lease";

const container = await createContainer();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  console.log("Pickler worker ready with per-run leases.");
  while (!controller.signal.aborted) {
    await container.repository.recover(Date.now());
    await container.repository.tick(Date.now());
    const run = await container.repository.claim(Date.now());
    if (run) {
      try {
        await executeWithLease(container.repository, run, container.execute, controller.signal);
      } catch {
        console.error("Research execution interrupted; expired leases will be recovered");
      }
    } else {
      await setTimeout(250, undefined, { signal: controller.signal }).catch(() => {});
    }
  }
} finally {
  await container.repository.close();
}
