import type { PtsAnalysis, PtsChannel, PtsDirection, PtsHistory, PtsPivot } from "./types.js";

export type PtsResearchCandidateId =
  "primary-er20" | "persistent-setups" | "ready-band-entry" | "retracement-control";
export type PtsResearchArm = "reference" | PtsResearchCandidateId;
export type PtsResearchGateStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_EVALUABLE_DEPENDENCY";

/** Research evidence, deliberately unrelated to executable proposals and account policies. */
export interface PtsResearchGate {
  code: string;
  status: PtsResearchGateStatus;
  dependsOn: string[];
  values: unknown;
}

export interface PtsResearchGeometry {
  abId: string;
  abcId: string;
  direction: PtsDirection;
  a: PtsPivot;
  b: PtsPivot;
  c: PtsPivot;
  knownAt: number;
  channel: PtsChannel;
  atrNumerator: string;
  atrDenominator: "14";
  toleranceNumerator: string;
  toleranceDenominator: "56";
  structuralStop: string;
}

export interface PtsResearchSignal {
  /** Candidate-specific identity. Only an explicit confirmed fixture may consume this ID. */
  id: string;
  /** Shared, candidate-independent geometry/cross identity for gained/lost comparisons. */
  comparisonId: string;
  episodeId: string;
  candidate: PtsResearchArm;
  direction: PtsDirection;
  abId: string;
  abcId: string;
  triggerAt: number;
  expiresAt: number;
  entryKind: "cross" | "ready-band";
  observedClose: string;
  geometry: PtsResearchGeometry;
}

export interface PtsResearchTiming {
  aConfirmedAt: number | null;
  bConfirmedAt: number | null;
  cConfirmedAt: number | null;
  channelConfirmedAt: number | null;
  primaryReadyAt: number | null;
  alignmentReadyAt: number | null;
  prerequisitesReadyAt: number | null;
  admittedAt: number | null;
  triggerAt: number | null;
  expiresAt: number | null;
}

export interface PtsResearchOutcome {
  candidate: PtsResearchArm;
  version: "0.1.0" | "0.2.0-fast.2";
  action: "hold" | "signal-long" | "signal-short";
  reason: string;
  firstBlocker: string | null;
  validationStatus: "VALID" | "NOT_VERIFIABLE";
  direction: PtsDirection | "neutral" | "unknown";
  abId: string | null;
  abcId: string | null;
  episodeId: string | null;
  signal: PtsResearchSignal | null;
  gates: PtsResearchGate[];
  timing: PtsResearchTiming;
  activeSetups: number;
}

export interface PtsResearchInspection {
  format: "pts-causal-research-v1";
  at: number;
  marketId: number;
  symbol: string;
  baseline: PtsAnalysis;
  candidates: PtsResearchOutcome[];
  /** Reference followed by four independent, single-change candidates. */
  outcomes: PtsResearchOutcome[];
}

export interface PtsResearchOptions {
  /** Controlled fixture confirmations only. Never pass a proposed/rejected order here. */
  confirmedFixtureSignalIds?: readonly string[];
}

export interface PtsResearchSession {
  inspect(at: number): PtsResearchInspection;
}

export interface PtsResearchReplayInput extends PtsResearchOptions {
  from: number;
  to: number;
}

export interface PtsResearchReplay {
  format: "pts-causal-signal-replay-v1";
  marketId: number;
  symbol: string;
  from: number;
  to: number;
  windows: number;
  rows: { at: number; outcomes: PtsResearchOutcome[] }[];
  signals: PtsResearchSignal[];
  comparisons: {
    candidate: PtsResearchCandidateId;
    gained: string[];
    lost: string[];
    shared: string[];
    uniqueEpisodes: number;
  }[];
  interpretation: "OFFLINE_SIGNALS_ONLY_NO_FINANCIAL_RESULTS";
}

export type PtsResearchHistory = PtsHistory;
