import type { PerpsDecisionContext, PerpsProposal } from "../perps-study/types.js";
export interface PerpsModelHooks {
  before(request: { sha256: string; bytes: number }): Promise<void>;
  diagnostic?(value: unknown): Promise<void>;
  usage(input: number, output: number): Promise<void>;
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
