import {
  DEFAULT_UNCERTAINTY_POLICY,
  PilotError,
  assertUncertaintyPolicy,
  type AgentBrief,
  type BriefEvaluation,
  type ModelAssessment,
  type DecisionV2,
  type PolicyReason,
  type UncertaintyPolicy,
} from "./types.js";
import { decimalPrice } from "./policy.js";

export interface BriefVerdict {
  entriesFired: boolean;
  neverRespected: boolean;
  /** The first rule that stopped the trade, for the run to show; null when none did. */
  stoppedBy: { kind: "entry" | "never"; rule: string } | null;
}

/**
 * The model's answer to the brief, checked against it (§3.2). One entry per `entersWhen` line and
 * one check per `never` line, each copying its rule, in order; an armed exit is one of `exitsWhen`.
 * Anything else is a failed decision: a block that does not line up is never read as "all fired".
 */
export function briefVerdict(
  brief: AgentBrief,
  evaluation: BriefEvaluation | undefined,
): BriefVerdict {
  const aligned = (got: unknown, want: readonly string[]) =>
    Array.isArray(got) &&
    got.length === want.length &&
    got.every((item, i) => typeof item === "object" && item !== null && item.rule === want[i]);
  if (
    !evaluation ||
    !aligned(evaluation.entries, brief.entersWhen) ||
    !aligned(evaluation.neverChecked, brief.never) ||
    evaluation.entries.some((entry) => typeof entry.fired !== "boolean") ||
    evaluation.neverChecked.some((check) => typeof check.respected !== "boolean") ||
    !(evaluation.exitArmed === null || brief.exitsWhen.includes(evaluation.exitArmed))
  ) {
    throw new PilotError(
      "INVALID_DECISION",
      "The brief evaluation must answer every rule, in order",
    );
  }
  const held = evaluation.entries.find((entry) => !entry.fired);
  const broken = evaluation.neverChecked.find((check) => !check.respected);
  let stoppedBy: BriefVerdict["stoppedBy"] = null;
  if (held) {
    stoppedBy = { kind: "entry", rule: held.rule };
  } else if (broken) {
    stoppedBy = { kind: "never", rule: broken.rule };
  }
  return { entriesFired: !held, neverRespected: !broken, stoppedBy };
}

/** Model assessments are estimates, not statistically calibrated confidence intervals. */
export function evaluateDecision(
  assessment: ModelAssessment,
  observedPrice: string | null,
  configuredPolicy: UncertaintyPolicy | undefined,
  now: number,
  brief?: AgentBrief,
): DecisionV2 {
  const config = { ...(configuredPolicy ?? DEFAULT_UNCERTAINTY_POLICY) };
  assertUncertaintyPolicy(config);
  const probability = assessment.probability;
  if (
    !["LOW", "MEDIUM", "HIGH"].includes(assessment.uncertaintyLevel) ||
    !Array.isArray(assessment.missingInformation) ||
    assessment.missingInformation.some((item) => typeof item !== "string" || !item.trim()) ||
    (probability !== null &&
      (!probability ||
        [probability.lower, probability.estimate, probability.upper].some(
          (value) => !Number.isFinite(value) || value < 0 || value > 1,
        ) ||
        probability.lower > probability.estimate ||
        probability.estimate > probability.upper))
  ) {
    throw new PilotError("INVALID_DECISION", "Invalid structured uncertainty assessment");
  }
  // Checked for every action, so a run with a brief always shows which rules fired.
  const verdict = brief ? briefVerdict(brief, assessment.brief) : null;

  const reasonCodes: PolicyReason[] = [];
  if (assessment.action === "ABSTAIN") {
    if (!assessment.abstentionReason) {
      throw new PilotError("INVALID_DECISION", "Abstention requires a reason");
    }
    reasonCodes.push("MODEL_ABSTAINED");
  } else {
    if (observedPrice === null || assessment.limitPrice === null) {
      throw new PilotError("NO_QUOTE", "Trade evaluation requires a verified quote and limit");
    }
    if (verdict && !verdict.entriesFired) {
      reasonCodes.push("BRIEF_ENTRY_NOT_MET");
    }
    if (verdict && !verdict.neverRespected) {
      reasonCodes.push("BRIEF_NEVER_BROKEN");
    }
    const ask = decimalPrice(observedPrice);
    const limit = decimalPrice(assessment.limitPrice);
    if (ask > limit) {
      reasonCodes.push("PRICE_EXCEEDS_LIMIT");
    }
    if (config.blockHighUncertainty && assessment.uncertaintyLevel === "HIGH") {
      reasonCodes.push("HIGH_UNCERTAINTY");
    }
    if (config.requireCompleteInformation && assessment.missingInformation.length) {
      reasonCodes.push("MISSING_INFORMATION");
    }
    if (probability === null) {
      reasonCodes.push("MISSING_PROBABILITY");
    } else {
      if (probability.upper - probability.lower > config.maxProbabilityRangeWidth + 1e-12) {
        reasonCodes.push("WIDE_PROBABILITY_RANGE");
      }
      // Compare against the worse of the live ask and proposed limit, including a safety margin.
      const price = Math.max(Number(observedPrice), Number(assessment.limitPrice));
      if (probability.lower - price <= config.minProbabilityMargin + 1e-12) {
        reasonCodes.push("INSUFFICIENT_CONSERVATIVE_MARGIN");
      }
    }
  }
  const finalAction = reasonCodes.length ? "ABSTAIN" : "TRADE";
  let abstentionReason: string | null = null;
  if (finalAction === "ABSTAIN") {
    abstentionReason = `Policy rejected proposal: ${reasonCodes.join(", ")}`;
    if (assessment.action === "ABSTAIN") {
      abstentionReason = assessment.abstentionReason;
    }
  }
  return {
    marketId: assessment.marketId,
    outcomeId: assessment.outcomeId,
    thesis: assessment.thesis,
    counterEvidence: assessment.counterEvidence,
    uncertainty: assessment.uncertainty,
    sourceIds: [...assessment.sourceIds],
    limitPrice: assessment.limitPrice,
    expiresAt: assessment.expiresAt,
    schemaVersion: 2,
    action: finalAction,
    estimatedProbability: probability?.estimate ?? null,
    observedPrice,
    abstentionReason,
    modelAssessment: structuredClone(assessment),
    policyEvaluation: {
      version: "1.0.0",
      config,
      finalAction,
      reasonCodes,
      evaluatedAt: new Date(now).toISOString(),
    },
  };
}
