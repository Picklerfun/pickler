import { parentPort, workerData } from "node:worker_threads";
import { dirname } from "node:path";
import { tsImport } from "tsx/esm/api";
import { auditPtsStudy } from "@pickler/trading/pts";
let phase = "loading";
try {
  const { ptsReport } = await tsImport("./report.ts", import.meta.url);
  const { digest } = await tsImport("./files.ts", import.meta.url);
  const { coverage, state, output, commit, policyHash } = workerData;
  let report;
  let rows;
  phase = "source-validation";
  if (workerData.manifestPath) {
    const { readPtsExportManifest } = await tsImport("./parts.ts", import.meta.url);
    const { ptsPartReport } = await tsImport("./part-report.ts", import.meta.url);
    const manifest = await readPtsExportManifest(workerData.manifestPath);
    phase = "audit";
    ({ report, rows } = await ptsPartReport(dirname(workerData.manifestPath), manifest));
  } else {
    // Controlled historical callers may still supply the original v1 snapshot.
    const { perpsStudyReport } = await tsImport("../perps-study/report.ts", import.meta.url);
    const snapshot = workerData.snapshot;
    const summary = perpsStudyReport(snapshot.study, snapshot.accounts);
    const audit = auditPtsStudy(snapshot.study, snapshot.accounts, digest);
    rows = audit.rows;
    report = {
      ...summary,
      portfolioMetrics: summary.rows.map((row) => {
        const financial = audit.financial.find((metric) => metric.variant === row.strategy);
        return {
          ...row,
          recordedFundingVirtualAUSD: row.fundingVirtualAUSD,
          recordedNetRealizedPnlVirtualAUSD: row.netRealizedPnlVirtualAUSD,
          fundingVirtualAUSD: financial?.fundingAUSD ?? null,
          netRealizedPnlVirtualAUSD: financial?.netRealizedAUSD ?? null,
        };
      }),
      financial: audit.financial,
      sourceHash: audit.sourceHash,
      accounts: snapshot.accounts,
      events: snapshot.study.events,
    };
  }
  phase = "publication";
  await ptsReport(output, { ...report, processState: state, commit, policyHash, coverage }, rows);
  parentPort.postMessage({ published: true });
} catch (error) {
  const code =
    error instanceof RangeError
      ? "PTS_REPORT_SERIALIZATION_FAILED"
      : /^(AUDIT_|INVALID_INPUT|PTS_EXPORT_)/.test(String(error?.code ?? ""))
        ? "PTS_REPORT_SOURCE_INVALID"
        : "PTS_REPORT_FAILED";
  parentPort.postMessage({ published: false, code, phase });
  process.exitCode = 1;
} finally {
  parentPort.close();
}
