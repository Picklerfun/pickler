import { parentPort, workerData } from "node:worker_threads";
import { open, lstat, rm } from "node:fs/promises";
import { tsImport } from "tsx/esm/api";

const pending = new Map();
let sequence = 0;
parentPort.on("message", (message) => {
  const callbacks = pending.get(message?.reserved);
  if (!callbacks) {
    return;
  }
  pending.delete(message.reserved);
  if (message.ok) {
    callbacks.resolve();
  } else {
    callbacks.reject(
      Object.assign(new Error("Report artifact reservation rejected"), {
        code: "BREAKOUT_ARTIFACT_LIMIT",
      }),
    );
  }
});

async function reserve(bytes) {
  const id = sequence++;
  const acknowledged = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  parentPort.postMessage({ kind: "reserve", id, bytes });
  await acknowledged;
}

const writer = {
  async write(path, bytes) {
    // The host is the sole byte authority. Every temporary and completed file is reserved
    // before opening, while all capture writes continue using that same authority.
    await reserve(bytes.byteLength);
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async remove(path) {
    const bytes = (await lstat(path)).size;
    await rm(path);
    parentPort.postMessage({ kind: "released", bytes });
  },
};

try {
  const { publishReportGeneration } = await tsImport("./report.ts", import.meta.url);
  const result = await publishReportGeneration({
    ...workerData,
    writer,
    released(bytes) {
      parentPort.postMessage({ kind: "released", bytes });
    },
  });
  parentPort.postMessage({ kind: "published", ...result });
} catch (error) {
  const code =
    typeof error?.code === "string" && /^(BREAKOUT_|CLOCK_|GAP_)[A-Z0-9_]{1,70}$/.test(error.code)
      ? error.code
      : "BREAKOUT_REPORT_FAILED";
  parentPort.postMessage({ kind: "failed", code });
  process.exitCode = 1;
} finally {
  parentPort.close();
}
