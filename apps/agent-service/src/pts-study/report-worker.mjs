import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
import { auditPtsStudy } from "@pickler/trading/pts";
const { ptsReport } = await tsImport("./report.ts", import.meta.url);
const { perpsStudyReport } = await tsImport("../perps-study/report.ts", import.meta.url);
const { digest } = await tsImport("./files.ts", import.meta.url);
const { snapshot, coverage, state, output, commit, policyHash } = workerData;
const summary = perpsStudyReport(snapshot.study, snapshot.accounts);
const audit = auditPtsStudy(snapshot.study, snapshot.accounts, digest);
const { rows, ...auditSummary } = audit;
await ptsReport(
  output,
  {
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
    audit: auditSummary,
    processState: state,
    commit,
    policyHash,
    coverage,
    sourceHash: audit.sourceHash,
    accounts: snapshot.accounts,
    events: snapshot.study.events,
  },
  rows,
);
parentPort.postMessage({ published: true });
