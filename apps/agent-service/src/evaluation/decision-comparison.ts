import { z } from "zod";
import {
  assessmentSchema,
  EvaluationFailure,
  fingerprint,
  needsConsistencyReview,
} from "./decision-evaluation";

// Exploratory policy selected after the initial pilot, not a validated production gate.
export const cascadePolicy = {
  version: "1.0.0-exploratory",
  accept: "Use Jev only for consistent SUPPORTED/CONTRADICTED + FINALIZE answers.",
  fallback: "Use the paired LLM answer for all other Jev answers; do not repair labels.",
};
const resultSchema = z.object({
  caseId: z.string(),
  provider: z.enum(["jev", "llm"]),
  status: z.literal("completed"),
  assessment: assessmentSchema,
  elapsedMs: z.number().finite().nonnegative(),
  estimatedCostUsd: z.number().finite().nonnegative(),
});
const manifestSchema = z.object({
  rubric: z.unknown(),
  rubricHash: z.string(),
  datasetHash: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{1,80}$/),
        state: z.object({ canResearch: z.boolean() }).passthrough(),
      }),
    )
    .min(1),
});
export type AttemptInput = { manifest: unknown; results: unknown[] };

export function compareDecisionAttempts(attempts: AttemptInput[]) {
  if (!attempts.length) {
    throw new EvaluationFailure("COMPARISON_REQUIRES_ATTEMPTS");
  }
  const cases = new Map<
    string,
    {
      canResearch: boolean;
      stateHash: string;
      jev?: z.infer<typeof resultSchema>;
      llm?: z.infer<typeof resultSchema>;
    }
  >();
  let datasetHash: string | undefined;
  let rubricHash: string | undefined;
  for (const input of attempts) {
    const parsed = manifestSchema.safeParse(input.manifest);
    if (!parsed.success) {
      throw new EvaluationFailure("INVALID_COMPARISON_MANIFEST");
    }
    const manifest = parsed.data;
    if (
      fingerprint(manifest.rubric) !== manifest.rubricHash ||
      (datasetHash && datasetHash !== manifest.datasetHash) ||
      (rubricHash && rubricHash !== manifest.rubricHash)
    ) {
      throw new EvaluationFailure("INCOMPATIBLE_COMPARISON_ATTEMPTS");
    }
    datasetHash = manifest.datasetHash;
    rubricHash = manifest.rubricHash;
    const ids = new Set<string>();
    for (const item of manifest.cases) {
      if (ids.has(item.id)) {
        throw new EvaluationFailure("DUPLICATE_COMPARISON_CASE");
      }
      ids.add(item.id);
      const existing = cases.get(item.id);
      if (existing && existing.stateHash !== fingerprint(item.state)) {
        throw new EvaluationFailure("INCOMPATIBLE_COMPARISON_CASE");
      }
      if (!existing) {
        cases.set(item.id, {
          canResearch: item.state.canResearch,
          stateHash: fingerprint(item.state),
        });
      }
    }
    for (const raw of input.results) {
      const result = resultSchema.safeParse(raw);
      if (!result.success || !ids.has(result.data.caseId)) {
        throw new EvaluationFailure("INVALID_COMPARISON_RESULT");
      }
      const item = cases.get(result.data.caseId)!;
      if (item[result.data.provider]) {
        throw new EvaluationFailure("DUPLICATE_COMPARISON_RESULT");
      }
      item[result.data.provider] = result.data;
    }
  }
  const rows = Array.from(cases, ([caseId, item]) => {
    const { jev, llm } = item;
    if (!jev || !llm) {
      return { caseId, paired: false as const };
    }
    const inconsistent = needsConsistencyReview(jev.assessment, item);
    const fallback = inconsistent || jev.assessment.next !== "FINALIZE";
    const selected = fallback ? llm : jev;
    return {
      caseId,
      paired: true as const,
      jev: jev.assessment,
      llm: llm.assessment,
      selected: selected.assessment,
      fallback,
      jevInconsistent: inconsistent,
      llmInconsistent: needsConsistencyReview(llm.assessment, item),
      evidenceAgreement: jev.assessment.evidence === llm.assessment.evidence,
      nextAgreement: jev.assessment.next === llm.assessment.next,
      cascadeAgreement:
        selected.assessment.evidence === llm.assessment.evidence &&
        selected.assessment.next === llm.assessment.next,
      jevUsd: jev.estimatedCostUsd,
      llmUsd: llm.estimatedCostUsd,
      simulatedCascadeUsd: jev.estimatedCostUsd + (fallback ? llm.estimatedCostUsd : 0),
      simulatedSequentialMs: jev.elapsedMs + (fallback ? llm.elapsedMs : 0),
    };
  });
  const paired = rows.filter((row) => row.paired);
  const total = (field: "jevUsd" | "llmUsd" | "simulatedCascadeUsd") =>
    paired.reduce((sum, row) => sum + row[field], 0);
  const complete = paired.length === cases.size;
  return {
    policy: cascadePolicy,
    policyHash: fingerprint(cascadePolicy),
    datasetHash,
    rubricHash,
    planned: cases.size,
    paired: paired.length,
    missingPairs: cases.size - paired.length,
    complete,
    evidenceAgreements: paired.filter((row) => row.evidenceAgreement).length,
    nextAgreements: paired.filter((row) => row.nextAgreement).length,
    cascadeAgreements: paired.filter((row) => row.cascadeAgreement).length,
    fallbacks: paired.filter((row) => row.fallback).length,
    jevInconsistencies: paired.filter((row) => row.jevInconsistent).length,
    llmInconsistencies: paired.filter((row) => row.llmInconsistent).length,
    pairedJevUsd: total("jevUsd"),
    pairedLlmUsd: total("llmUsd"),
    pairedComparisonSpendUsd: total("jevUsd") + total("llmUsd"),
    simulatedPairedCascadeUsd: total("simulatedCascadeUsd"),
    // Missing pairs can hide errors or charges; never project savings for an incomplete run.
    simulatedSavingsFraction:
      complete && total("llmUsd") > 0 ? 1 - total("simulatedCascadeUsd") / total("llmUsd") : null,
    additionalResearchCostUsd: null,
    accuracy: null,
    note: "Offline counterfactual using paired calls, not a measured runtime cascade. Agreement is not accuracy. Full research cost and unknown failed-request charges are unmeasured. No calls or routing changes are made.",
    rows,
  };
}
