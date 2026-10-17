import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createLocalPerpsLabStore,
  exportPerpsAuditParts,
  type PerpsLabFailureDiagnostic,
} from "@pickler/infrastructure/perps-lab";
import { localStudyDatabase } from "../perps-study/database-env.js";
import { createPtsPartsExport } from "./parts.js";
import { createPtsPersistenceDiagnostic } from "./persistence-diagnostic.js";
import {
  ptsReportWorkerCode,
  type PtsReportPersistenceDiagnostic,
  type PtsReportWorkerInput,
} from "./report-worker-client.js";

/** Called only inside the report thread. The pool rejects writes at the server. */
export async function exportPtsReportSource(
  source: NonNullable<PtsReportWorkerInput["source"]>,
  commit: string,
  failed: (code: string, diagnostic: PtsReportPersistenceDiagnostic) => void = () => {},
) {
  const queries = createPtsPersistenceDiagnostic();
  let failure: PerpsLabFailureDiagnostic | null = null;
  let notified = false;
  let primaryError: unknown;
  const notify = (error: unknown) => {
    if (notified) {
      return;
    }
    notified = true;
    try {
      failed(ptsReportWorkerCode(error), {
        version: 1,
        origin: "report-worker",
        failure,
        queries: queries.snapshot(),
      });
    } catch {
      // Capture failure must not replace the database failure or prevent cleanup.
    }
  };
  const store = createLocalPerpsLabStore(await localStudyDatabase(source.envFile), "report", {
    query: queries.observe,
    failed: (error, value) => {
      failure = value;
      notify(error);
    },
  });
  const pool = store.pool;
  try {
    await mkdir(source.directory, { recursive: true, mode: 0o700 });
    const exporter = await createPtsPartsExport(source.directory, commit, { reuseSource: true });
    const capture = await exportPerpsAuditParts(pool, source.configuration, exporter.emit, {
      reuse: exporter.reuse,
    });
    await exporter.finish(capture);
    return resolve(source.directory, "export.json");
  } catch (error) {
    primaryError = error;
    if (queries.failure()) {
      notify(error);
    }
    throw error;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      if (!primaryError) {
        notify(error);
        throw error;
      }
    }
  }
}
