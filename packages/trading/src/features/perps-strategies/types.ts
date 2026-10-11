import type { PerpCandles, PerpSymbol } from "@pickler/core";
import type { PerpsPaperFrame } from "../perps-paper/simulation.js";
import type { PerpsPaperAccount } from "../perps-paper/types.js";
export type PerpsCallLane =
  | "direct"
  | "jev"
  | "fallback"
  | "review"
  | "sma-review"
  | "news-review"
  | "exa"
  | `${"sma-review" | "news-review" | "exa"}:${PerpSymbol}`;
export interface PerpsEvidence {
  observedAt: number;
  frames: PerpsPaperFrame[];
  candles: PerpCandles[];
  sourceIds: string[];
  excluded?: { symbol: PerpSymbol; code: string; phase: string }[];
}
export interface PerpsProposal {
  pts?: import("../pts/types.js").PtsIntentEvidence;
  notional?: string;
  rank?: number | null;
  trace?: unknown;
  symbol: PerpSymbol;
  action: "hold" | "open-long" | "open-short" | "close";
  reason: string;
  sourceIds: string[];
}
export interface PerpsDecisionContext {
  evidence: PerpsEvidence;
  account: PerpsPaperAccount;
}
export interface PerpsModelHooks {
  before(request: { sha256: string; bytes: number }): Promise<void>;
  diagnostic?(value: unknown): Promise<void>;
  usage(input: number, output: number): Promise<void>;
  cost?(usd: string): Promise<void>;
}
export interface PerpsModels {
  metadata: unknown;
  direct(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<PerpsProposal[]>;
  decide?(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ proposals: PerpsProposal[]; answers: unknown }>;
  review?(
    context: PerpsDecisionContext,
    proposals: PerpsProposal[],
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ proposals: PerpsProposal[]; answers: unknown }>;
  readiness(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ skip: boolean; answers: unknown }>;
}

export type PerpsStrategyId = "rules" | "deepseek" | "jev" | "combined";
export type PerpsStrategyCapability = "direct" | "decide" | "review";
export interface PerpsStrategySelection {
  readonly id: string;
  readonly version: string;
}
export interface PerpsStrategyDescriptor {
  readonly id: PerpsStrategyId;
  readonly version: "1.0.0" | "2.0.0" | "2.1.0";
  readonly capabilities: readonly PerpsStrategyCapability[];
}
export type PerpsStrategyInput = DeepReadonly<PerpsDecisionContext>;
export type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
/** Must reserve before invocation and persist each request/usage through the hooks. */
export interface PerpsStrategyCalls {
  run<T>(lane: PerpsCallLane, operation: (hooks: PerpsModelHooks) => Promise<T>): Promise<T>;
}
export interface PerpsStrategyDependencies {
  models: Partial<PerpsModels>;
  calls: PerpsStrategyCalls;
  signal: AbortSignal;
}
