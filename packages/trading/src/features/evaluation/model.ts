import type { PerpsDecisionContext, PerpsProposal } from "../perps-study/types.js";
export interface PerpsModelHooks {
  before(request: { sha256: string; bytes: number }): Promise<void>;
  usage(input: number, output: number): Promise<void>;
}
export interface PerpsModels {
  metadata: unknown;
  direct(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<PerpsProposal[]>;
  readiness(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<{ skip: boolean; answers: unknown }>;
}
