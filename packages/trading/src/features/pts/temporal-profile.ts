import { PilotError } from "@pickler/core";
import {
  PTS_VERSION,
  PTS_INTRADAY_VERSION,
  PTS_INTRADAY_FAST_VERSION,
  type PtsVersion,
  type PtsPeriod,
} from "./types.js";
import { PTS_POLICY, type PerpsPtsConfig } from "./policy.js";

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
  if (version === PTS_INTRADAY_FAST_VERSION) {
    return {
      version,
      identity: "pts-intraday@0.2.0-fast.1",
      accountPolicy: "pts-intraday-1x-0.2.0-fast.1" as const,
      primary: "4h" as PtsPeriod,
      channel: "1h" as PtsPeriod,
      impulse: "15m" as PtsPeriod,
      correction: "5m" as PtsPeriod,
      entry: "5m" as PtsPeriod,
      native: [14400, 3600, 900, 300],
      minimum: { "4h": 24, "1h": 104, "15m": 240, "5m": 180 } as Partial<Record<PtsPeriod, number>>,
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
  if (config.version === 8 && config.candidate === "pts-trend-reversal@0.2.0") {
    return PTS_VERSION;
  }
  if (
    config.version === 9 &&
    (config.candidate === "pts-intraday@0.1.0" || config.candidate === "pts-intraday@0.2.0-fast.1")
  ) {
    return ptsCandidateVersion(config.candidate);
  }
  throw new PilotError("INVALID_INPUT", "PTS configuration and candidate identity disagree");
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

/** Candidate identities are explicit; absence retains the historical basic replay meaning. */
export function ptsCandidateVersion(candidate?: string): PtsVersion {
  if (candidate === undefined || candidate === "pts-trend-reversal@0.2.0") {
    return PTS_VERSION;
  }
  if (candidate === "pts-intraday@0.1.0") {
    return PTS_INTRADAY_VERSION;
  }
  if (candidate === "pts-intraday@0.2.0-fast.1") {
    return PTS_INTRADAY_FAST_VERSION;
  }
  throw new PilotError("INVALID_INPUT", "Unknown experimental PTS candidate");
}
export const PTS_INTRADAY_FAST_POLICY = {
  ...PTS_INTRADAY_POLICY,
  format: "pts-intraday-fast-policy-v1",
  ...ptsTemporalProfile(PTS_INTRADAY_FAST_VERSION),
  reference: "pts-intraday@0.1.0",
  change: "Native temporal roles only; correction and entry share one 5m series",
} as const;
export function ptsPolicy(version: PtsVersion = PTS_VERSION) {
  ptsTemporalProfile(version);
  if (version === PTS_VERSION) {
    return PTS_POLICY;
  }
  return version === PTS_INTRADAY_VERSION ? PTS_INTRADAY_POLICY : PTS_INTRADAY_FAST_POLICY;
}

export function ptsNativeMinimum(version: PtsVersion, resolution: number) {
  const periods: Record<number, PtsPeriod> = {
    86400: "1d",
    14400: "4h",
    3600: "1h",
    900: "15m",
    300: "5m",
  };
  const profile = ptsTemporalProfile(version);
  const period = periods[resolution];
  if (!period || !profile.native.includes(resolution)) {
    throw new PilotError(
      "INVALID_INPUT",
      "Native resolution does not belong to the selected PTS candidate",
    );
  }
  return profile.minimum[period]!;
}
