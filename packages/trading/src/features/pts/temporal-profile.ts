import { PilotError } from "@pickler/core";
import { PTS_VERSION, PTS_INTRADAY_VERSION, type PtsVersion, type PtsPeriod } from "./types.js";
import type { PerpsPtsConfig } from "./policy.js";

/** Trusted experimental temporal roles. A version never relabels native candle timestamps. */
export function ptsTemporalProfile(version: PtsVersion = PTS_VERSION) {
  if (version === PTS_VERSION) {
    return {
      version,
      identity: "pts-trend-reversal@0.2.0",
      accountPolicy: "pts-basic-1x-0.2.0" as const,
      primary: "1M" as PtsPeriod,
      channel: "1w" as PtsPeriod,
      impulse: "1d" as PtsPeriod,
      correction: "4h" as PtsPeriod,
      entry: "1h" as PtsPeriod,
      native: [86400, 14400, 3600],
      minimum: { "1M": 24, "1w": 104, "1d": 240, "4h": 180, "1h": 168 } as Partial<
        Record<PtsPeriod, number>
      >,
      formationMs: 30 * 86400000,
      triggerMs: 900000,
      correctionMs: 72 * 3600000,
      maximumHoldingMs: 7 * 86400000,
      closeAtUtcDayEnd: false,
    };
  }
  if (version === PTS_INTRADAY_VERSION) {
    return {
      version,
      identity: "pts-intraday@0.1.0",
      accountPolicy: "pts-intraday-1x-0.1.0" as const,
      primary: "1d" as PtsPeriod,
      channel: "4h" as PtsPeriod,
      impulse: "1h" as PtsPeriod,
      correction: "15m" as PtsPeriod,
      entry: "5m" as PtsPeriod,
      native: [86400, 14400, 3600, 900, 300],
      minimum: { "1d": 24, "4h": 104, "1h": 240, "15m": 180, "5m": 168 } as Partial<
        Record<PtsPeriod, number>
      >,
      formationMs: 72 * 3600000,
      triggerMs: 300000,
      correctionMs: 24 * 3600000,
      maximumHoldingMs: 6 * 3600000,
      closeAtUtcDayEnd: true,
    };
  }
  throw new PilotError("INVALID_INPUT", "Unknown experimental PTS temporal version");
}
export function ptsConfigVersion(config: PerpsPtsConfig): PtsVersion {
  return config.version === 9 ? PTS_INTRADAY_VERSION : PTS_VERSION;
}
export function ptsVariant(config: PerpsPtsConfig) {
  return config.version === 9 ? ("pts-intraday" as const) : ("pts-basic" as const);
}
export function ptsVariants(config: PerpsPtsConfig) {
  return ["sma-reference", ptsVariant(config)] as const;
}
export const PTS_INTRADAY_POLICY = {
  format: "pts-intraday-policy-v1",
  ...ptsTemporalProfile(PTS_INTRADAY_VERSION),
  knowledge: "pts-course@1.0.0",
  experimental: true,
  pivotNeighbours: 2,
  atrBars: 14,
  correctionRangeInclusive: ["0.61", "0.78"],
  boundaryTicks: 2,
  boundaryAtrFraction: "0.25",
  triggerExclusive: "0.38",
  latestFillExclusive: "0.495",
  stopTicks: 1,
  stopAtrFraction: "0.10",
  breakEven: "0.495",
  targets: ["0.61", "0.78", "1"],
  initialQuantityFractions: ["0.20", "0.20", "remainder"],
  openingRiskPercent: 1,
  aggregateRiskPercent: 3,
  exitAllowanceBps: 50,
  maximumNotional: "100",
  maximumPositions: 5,
  leverage: 1,
  exposureTargetPercent: 40,
  exposureCeilingPercent: 50,
  dailyEmergencyPercent: 3,
  drawdownEmergencyPercent: 5,
} as const;
