import { parentPort, workerData } from "node:worker_threads";
import { tsImport } from "tsx/esm/api";
const { renderProfileReport } = await tsImport("./profiles-report.ts", import.meta.url);
parentPort.postMessage(
  renderProfileReport(workerData.snapshot, workerData.summary, workerData.state),
);
