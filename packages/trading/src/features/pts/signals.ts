import type { PtsAnalysis, PtsHistory, PtsVersion } from "./types.js";
import { PTS_VERSION } from "./types.js";
import { ptsSeries } from "./calendar.js";
import { analyzePtsKernel } from "./research-signal-kernel.js";
export { ptsAtr, ptsSetupKey, ptsFillAdmissible } from "./research-signal-kernel.js";

export function analyzePts(
  history: PtsHistory,
  now: number,
  version: PtsVersion = PTS_VERSION,
): PtsAnalysis {
  return analyzePtsKernel(history, now, version, ptsSeries(history, now, version));
}
