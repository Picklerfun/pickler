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
