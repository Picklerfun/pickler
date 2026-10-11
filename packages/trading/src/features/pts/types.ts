import type { PerpCandles, PerpMarketInfo } from "@pickler/core";
import type { PerpsPaperFrame } from "../perps-paper/simulation.js";
import type { PerpsProposal } from "../perps-strategies/types.js";
export const PTS_VERSION = "0.2.0" as const;
export const PTS_ACCOUNT_POLICY = "pts-basic-1x-0.2.0" as const;
export const PTS_VARIANTS = ["sma-reference", "pts-basic"] as const;
export type PtsVariant = (typeof PTS_VARIANTS)[number];
export type PtsDirection = "long" | "short";
export type PtsPeriod = "1M" | "1w" | "1d" | "4h" | "1h";
export type PtsBar = PerpCandles["candles"][number] & { closeTime: number };
export interface PtsPivot {
  kind: "high" | "low";
  openTime: number;
  closeTime: number;
  confirmedAt: number;
  price: string;
}
export interface PtsPivotEvent {
  at: number;
  kind: "confirmed" | "replaced" | "ignored" | "ambiguous";
  pivot: PtsPivot | null;
  previous: PtsPivot | null;
}
export interface PtsChannel {
  direction: PtsDirection;
  first: PtsPivot;
  second: PtsPivot;
  opposite: PtsPivot;
  frozenAt: number;
  /** Rational width in 10^18 price units; no floating point comparisons. */
  widthNumerator: string;
  widthDenominator: string;
}
export interface PtsSetup {
  version: typeof PTS_VERSION;
  id: string;
  marketId: number;
  symbol: string;
  direction: PtsDirection;
  a: PtsPivot;
  b: PtsPivot;
  c: PtsPivot;
  knownAt: number;
  triggerAt: number;
  expiresAt: number;
  channel: PtsChannel;
  atrNumerator: string;
  atrDenominator: "14";
  tolerance: string;
  toleranceNumerator: string;
  toleranceDenominator: "56";
  initialStop: string;
  recovery: { from: string; to: string; ratios: readonly ["0.38", "0.495", "0.61", "0.78", "1"] };
}
export interface PtsCheck {
  code: string;
  passed: boolean | null;
  values: unknown;
}
export interface PtsCoverage {
  period: PtsPeriod;
  required: number;
  available: number;
  consecutive: boolean;
  completeThrough: number | null;
  eligible: boolean;
  reason: string | null;
}
export interface PtsAnalysis {
  version: typeof PTS_VERSION;
  at: number;
  symbol: string;
  action: "hold" | "open-long" | "open-short";
  reason: string;
  setup: PtsSetup | null;
  checks: PtsCheck[];
  coverage: PtsCoverage[];
}
export interface PtsHistory {
  market: PerpMarketInfo;
  series: PerpCandles[];
  capturedAt: number;
}
export interface PtsPositionState {
  version: typeof PTS_VERSION;
  setup: PtsSetup;
  initialQuantity: string;
  initialNotional: string;
  stop: string;
  initialStop: string;
  feeRate: string;
  consumedTargets: number[];
  reductions: {
    key: string;
    at: number;
    block: number;
    quantity: string;
    costBasis: string;
    price: string;
    fee: string;
    targets: number[];
  }[];
  stopChanges: { at: number; stop: string; frameHash: string }[];
}
export interface PtsIntentEvidence {
  version: typeof PTS_VERSION;
  roundKey?: string;
  setup?: PtsSetup;
  quantity?: string;
  targets?: number[];
  reason?: string;
}
export interface PtsProposal extends PerpsProposal {
  pts?: PtsIntentEvidence;
  notional?: string;
  rank?: number;
  trace?: PtsAnalysis;
}
export interface PtsManagement {
  action: "hold" | "close";
  reason: string;
  quantity: string | null;
  targets: number[];
}
export interface PtsReplayInput {
  format: "perps-pts-history-v1";
  capturedAt: number;
  from: number;
  to: number;
  commit: string;
  markets: PtsHistory[];
  /** Candles alone never establish financial results. */
  financial?: {
    at: number;
    frames: PerpsPaperFrame[];
    funding: import("@pickler/core").PerpFundingHistory[];
  }[];
}
