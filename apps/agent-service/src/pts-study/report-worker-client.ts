import { Worker } from "node:worker_threads";
import { PilotError } from "@pickler/core";
import type { PerpsPtsConfig } from "@pickler/trading/pts";
import type { PerpsLabFailureDiagnostic } from "@pickler/infrastructure/perps-lab";
import type { createPtsPersistenceDiagnostic } from "./persistence-diagnostic.js";

export interface PtsReportPersistenceDiagnostic {
  version: 1;
  origin: "report-worker";
  failure: PerpsLabFailureDiagnostic | null;
  queries: ReturnType<ReturnType<typeof createPtsPersistenceDiagnostic>["snapshot"]>;
}
export interface PtsReportWorkerInput {
  source?: {
    envFile: string;
    configuration: PerpsPtsConfig;
    directory: string;
  };
  manifestPath?: string;
  coverage: unknown[];
  state: string;
  output: string;
  commit: string;
  policyHash: string;
}
const failureCodes = new Set([
  "PTS_REPORT_SERIALIZATION_FAILED",
  "PTS_REPORT_SOURCE_INVALID",
  "PTS_REPORT_FAILED",
  "PERSISTENCE_QUERY_TIMEOUT",
  "PERSISTENCE_QUERY_CANCELLED",
  "PERSISTENCE_CONNECTION_TIMEOUT",
  "PERSISTENCE_CONNECTION_FAILED",
]);
export function ptsReportWorkerCode(error: unknown): string {
  try {
    const code = error && typeof error === "object" ? Reflect.get(error, "code") : null;
    return typeof code === "string" && failureCodes.has(code) ? code : "PTS_REPORT_FAILED";
  } catch {
    return "PTS_REPORT_FAILED";
  }
}

/** Resolve only after exit, and never share the host's environment or financial pool. */
export function runPtsReportWorker(
  input: PtsReportWorkerInput,
  options: {
    signal?: AbortSignal;
    onPersistenceFailure?: (error: PilotError, diagnostic: PtsReportPersistenceDiagnostic) => void;
  } = {},
): Promise<void> {
  const signal = options.signal;
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL("./report-worker.mjs", import.meta.url), {
      workerData: input,
      env: {},
    });
    let published = false;
    let failure: unknown;
    let terminating = false;
    const abort = () => {
      failure ??= signal?.reason ?? new PilotError("CANCELLED", "Report cancelled");
      if (!terminating) {
        terminating = true;
        void worker.terminate().catch(() => {});
      }
    };
    worker.on(
      "message",
      (
        message: {
          kind?: string;
          published?: boolean;
          code?: string;
          diagnostic?: PtsReportPersistenceDiagnostic;
        } | null,
      ) => {
        if (message?.published === true) {
          published = true;
          return;
        }
        const error = new PilotError(
          ptsReportWorkerCode(message),
          "Report worker did not publish its verified artifacts",
        );
        failure ??= error;
        if (message?.kind === "persistence-failure" && message.diagnostic) {
          try {
            options.onPersistenceFailure?.(error, message.diagnostic);
          } catch {
            // Notification cannot mask the primary failure or acknowledge publication.
          }
        }
      },
    );
    worker.once("error", () => {
      failure ??= new PilotError("PTS_REPORT_FAILED", "Report worker failed");
    });
    worker.once("exit", (code) => {
      signal?.removeEventListener("abort", abort);
      if (failure) {
        reject(failure);
      } else if (published && code === 0) {
        resolve();
      } else {
        reject(new PilotError("PTS_REPORT_FAILED", "Report worker exited without publication"));
      }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }
  });
}
