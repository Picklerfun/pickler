import { PilotError } from "@pickler/core";
import type { PtsResearchCandidateId } from "./research-types.js";

const common = {
  format: "pts-offline-causal-policy-v1",
  version: "0.1.0",
  reference: "pts-intraday@0.2.0-fast.2",
  offlineOnly: true,
  enabled: false,
  nativeSeconds: [3600, 900, 300],
  minimumClosedBars: { "1h": 24, "15m": 240, "5m": 180 },
  formationMs: 259200000,
  correctionMs: 86400000,
  triggerMs: 300000,
  executionAdmission: "NONE",
  financialResults: "NONE",
} as const;

/** These identities cannot be resolved as executable PTS versions or account policies. */
export const PTS_RESEARCH_CANDIDATES = [
  {
    ...common,
    id: "primary-er20",
    changedFactor: "primary-trend",
    primary: {
      nativeSeconds: 3600,
      closedBars: 21,
      changes: 20,
      efficiencyMinimumInclusive: "0.30",
      formula: "abs(close[20]-close[0])/sum(abs(close[i]-close[i-1]),i=1..20)",
      direction: "SIGN_OF_NET_CHANGE",
      zeroDenominator: "neutral",
      insufficientHistory: "unknown",
    },
  },
  {
    ...common,
    id: "persistent-setups",
    changedFactor: "setup-selection-and-lifecycle",
    maximumPerMarketDirection: 32,
    eviction: "OLDEST_C_CONFIRMATION_THEN_ASCENDING_ABC_ID",
    selection: "EARLIEST_FULLY_READY_ADMISSIBLE_THEN_ASCENDING_ABC_ID",
    frozen: ["A", "B", "C", "channel", "ATR14", "structural-stop"],
    retirement: ["C_EXPIRY", "VERIFIED_NEUTRAL_OR_OPPOSITE_PRIMARY", "CLOSED_5M_STOP_TOUCH"],
    missingLifecycleHistory: "NOT_VERIFIABLE",
    consumption: "EXPLICIT_CONFIRMED_FIXTURE_SIGNAL_ID_ONLY",
  },
  {
    ...common,
    id: "ready-band-entry",
    changedFactor: "entry-trigger",
    recoveryExclusive: ["0.38", "0.495"],
    firstEligibleClose: "STRICTLY_AFTER_ALL_UNCHANGED_PREREQUISITES_READY",
    readinessIncludes: ["A", "B", "C", "primary", "alignment", "channel", "ATR14", "confluence"],
    expiry: "MIN_TRIGGER_PLUS_5M_C_CONFIRMATION_PLUS_24H",
    laterReferenceCrosses: "PRESERVED",
    repeatedPoll: "NEVER_REFRESH_TRIGGER_OR_TTL",
  },
  {
    ...common,
    id: "retracement-control",
    changedFactor: "retracement-band",
    referenceInclusive: ["0.61", "0.78"],
    candidateInclusive: ["0.40", "0.57"],
    width: "0.17",
  },
] as const;

export function ptsResearchPolicy(id: string, version = "0.1.0") {
  const policy = PTS_RESEARCH_CANDIDATES.find((item) => item.id === id);
  if (!policy || version !== "0.1.0") {
    throw new PilotError("INVALID_INPUT", "Unknown offline PTS research policy");
  }
  return policy;
}

export function isPtsResearchCandidate(id: string): id is PtsResearchCandidateId {
  return PTS_RESEARCH_CANDIDATES.some((item) => item.id === id);
}
