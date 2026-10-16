import { Worker } from "node:worker_threads";
import { PilotError } from "@pickler/core";
import { ArtifactBudget } from "./files.js";
import type { SourceManifest } from "./report.js";

export interface SourceReportWorkerInput {
  sourceDirectory: string;
  outputDirectory: string;
  generation: string;
  manifest: SourceManifest;
}

/** Start a read-only source worker with no inherited environment and wait for verified exit. */
export function runSourceReportWorker(
  input: SourceReportWorkerInput,
  budget: ArtifactBudget,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./report-worker.mjs", import.meta.url), {
      workerData: input,
      env: {},
    });
    let published = false;
    let failure: unknown;
    const abort = () => {
      failure ??= signal?.reason ?? new PilotError("CANCELLED", "Source report cancelled");
      void worker.terminate().catch(() => {});
    };
    worker.on(
      "message",
      (message: {
        kind?: string;
        id?: number;
        bytes?: number;
        code?: string;
        generation?: string;
      }) => {
        try {
          if (message.kind === "reserve") {
            const commit = budget.reserve(message.bytes ?? -1);
            commit();
            worker.postMessage({ reserved: message.id, ok: true });
          } else if (message.kind === "released") {
            budget.release(message.bytes ?? -1);
          } else if (message.kind === "published" && message.generation === input.generation) {
            published = true;
          } else if (message.kind === "failed") {
            failure ??= new PilotError(
              /^BREAKOUT_[A-Z0-9_]{1,70}$/.test(message.code ?? "")
                ? message.code!
                : "BREAKOUT_REPORT_FAILED",
              "Source report worker failed before verified publication",
            );
          } else {
            throw new PilotError("BREAKOUT_REPORT_FAILED", "Unexpected report worker protocol");
          }
        } catch (error) {
          failure ??= error;
          if (message.kind === "reserve") {
            worker.postMessage({ reserved: message.id, ok: false });
          } else {
            void worker.terminate().catch(() => {});
          }
        }
      },
    );
    worker.once("error", () => {
      failure ??= new PilotError("BREAKOUT_REPORT_FAILED", "Source report worker terminated");
    });
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      if (failure) {
        reject(failure);
      } else if (published && code === 0) {
        resolve();
      } else {
        reject(
          new PilotError("BREAKOUT_REPORT_FAILED", "Source worker exited without publication"),
        );
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}
