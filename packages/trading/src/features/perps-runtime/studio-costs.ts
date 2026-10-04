import { PilotError } from "@pickler/core";
import type { PerpsCheckLease } from "../perps-paper/checks.js";
import type { PerpsStrategySelection } from "../perps-strategies/types.js";

/** Frozen internal USD policy. Micros are USD, never virtual AUSD. */
export interface StudioCostPolicy {
  version: 1;
  enabled: boolean;
  reviewedAt: string;
  perOperationMicros: string;
  perDayMicros: string;
}
export interface StudioCallPlan {
  key: string;
  provider: string;
  model: string;
  promptVersion: string;
  promptSha256: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  inputMicrosPerMillion: string;
  outputMicrosPerMillion: string;
  /** Search calls use an explicit maximum charge instead of a token tariff. */
  maximumMicros?: string;
}
export interface StudioCostScope {
  checkId: string;
  tenantId: string;
  agentId: string;
  configVersion: number;
  lease: PerpsCheckLease;
}
export interface StudioCostReservation {
  checkId: string;
  reservedMicros: string;
  strategy: PerpsStrategySelection;
}
export interface StudioCostRepository {
  reserve(
    scope: StudioCostScope,
    strategy: PerpsStrategySelection,
    policy: StudioCostPolicy,
    calls: readonly StudioCallPlan[],
  ): Promise<StudioCostReservation>;
  start(
    scope: StudioCostScope,
    key: string,
    request: { sha256: string; bytes: number },
  ): Promise<void>;
  complete(
    scope: StudioCostScope,
    key: string,
    usage: { input: number; output: number } | { costMicros: string },
  ): Promise<void>;
  unknown(scope: StudioCostScope, key: string): Promise<void>;
  finish(scope: StudioCostScope): Promise<{ costMicros: string | null; accountedMicros: string }>;
  evidence(scope: StudioCostScope, key: string, hash: string, document: unknown): Promise<void>;
}
const micros = (value: string) => {
  if (!/^\d{1,24}$/.test(value)) {
    throw new PilotError("COST_POLICY_INVALID", "Cost must be explicit nonnegative USD micros");
  }
  return BigInt(value);
};
export function studioTokenCost(plan: StudioCallPlan, input: number, output: number): string {
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    input < 0 ||
    output < 0 ||
    input > plan.maxInputTokens ||
    output > plan.maxOutputTokens
  ) {
    throw new PilotError("MODEL_USAGE_INVALID", "Usage exceeds the frozen call reservation");
  }
  const numerator =
    BigInt(input) * micros(plan.inputMicrosPerMillion) +
    BigInt(output) * micros(plan.outputMicrosPerMillion);
  return ((numerator + 999999n) / 1000000n).toString();
}
export function studioMaximumCost(plan: StudioCallPlan): string {
  if (
    !plan.key ||
    !plan.provider ||
    !plan.model ||
    !plan.promptVersion ||
    !/^[a-f0-9]{64}$/.test(plan.promptSha256)
  ) {
    throw new PilotError("COST_POLICY_INVALID", "Call metadata must be reviewed and attributable");
  }
  if (plan.maximumMicros !== undefined) {
    return micros(plan.maximumMicros).toString();
  }
  return studioTokenCost(plan, plan.maxInputTokens, plan.maxOutputTokens);
}
export function assertStudioCostPolicy(
  policy: StudioCostPolicy,
  plans: readonly StudioCallPlan[],
): string {
  if (policy.version !== 1 || !policy.enabled || !Number.isFinite(Date.parse(policy.reviewedAt))) {
    throw new PilotError(
      "COST_POLICY_DISABLED",
      "Paid Studio decisions require a reviewed enabled USD policy",
    );
  }
  if (new Set(plans.map((plan) => plan.key)).size !== plans.length) {
    throw new PilotError("COST_POLICY_INVALID", "Duplicate reserved call identity");
  }
  const maximum = plans.reduce((sum, plan) => sum + BigInt(studioMaximumCost(plan)), 0n);
  const operation = micros(policy.perOperationMicros);
  const day = micros(policy.perDayMicros);
  if (operation <= 0n || day < operation || maximum > operation) {
    throw new PilotError("COST_BUDGET_EXCEEDED", "Frozen call maximum exceeds internal USD limits");
  }
  return maximum.toString();
}
