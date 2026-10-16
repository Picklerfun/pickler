import { parentPort, workerData } from "node:worker_threads";
import { lstat, open, rm } from "node:fs/promises";
import { PilotError } from "@pickler/core";
import { ArtifactBudget, type ArtifactWriter } from "./files.js";
import { financialReportSafeCode, publishFinancialGeneration } from "./financial-report.js";

/** Synchronous journal writes obtain the host's shared byte authority before opening/writing.
 * Blocking occurs only on this read-only report worker, never on financial execution. */
class WorkerArtifactBudget extends ArtifactBudget {
  override reserve(bytes: number): () => void {
    const shared = new Int32Array(new SharedArrayBuffer(4));
    parentPort!.postMessage({ kind: "reserve-sync", bytes, shared: shared.buffer });
    Atomics.wait(shared, 0, 0, 30_000);
    if (Atomics.load(shared, 0) !== 1) {
      throw new PilotError(
        "BREAKOUT_ARTIFACT_LIMIT",
        "Financial report byte authority was not confirmed",
      );
    }
    return super.reserve(bytes);
  }
}

const budget = new WorkerArtifactBudget();
const writer: ArtifactWriter = {
  async write(path, bytes) {
    const commit = budget.reserve(bytes.length);
    let file;
    try {
      file = await open(path, "wx", 0o600);
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file?.close();
      // Failed partial files retain their full pre-reserved byte charge until explicit removal.
      commit();
    }
  },
  async remove(path) {
    const bytes = (await lstat(path)).size;
    await rm(path);
    parentPort!.postMessage({ kind: "released", bytes });
  },
};
try {
  await publishFinancialGeneration({
    ...workerData,
    writer,
    budget,
    released(bytes: number) {
      parentPort!.postMessage({ kind: "released", bytes });
    },
  });
  parentPort!.postMessage({ kind: "published" });
} catch (error) {
  parentPort!.postMessage({ kind: "failed", code: financialReportSafeCode(error) });
  process.exitCode = 1;
} finally {
  parentPort!.close();
}
