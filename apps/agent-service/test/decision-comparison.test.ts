import { test } from "node:test";
import assert from "node:assert/strict";
import { compareDecisionAttempts } from "../src/evaluation/decision-comparison";
import { fingerprint } from "../src/evaluation/decision-evaluation";

const rubric = { version: "test" };
const manifest = {
  rubric,
  rubricHash: fingerprint(rubric),
  datasetHash: "frozen-dataset",
  cases: ["clear", "inconsistent", "unresolved"].map((id) => ({
    id,
    state: { canResearch: true },
  })),
};
function inputs() {
  return [
    {
      manifest,
      results: manifest.cases.flatMap(({ id }) => [
        {
          caseId: id,
          provider: "jev",
          status: "completed",
          elapsedMs: 2,
          estimatedCostUsd: 0.1,
          assessment: {
            evidence: id === "unresolved" ? "INSUFFICIENT" : "SUPPORTED",
            next: id === "clear" ? "FINALIZE" : "RESEARCH",
          },
        },
        {
          caseId: id,
          provider: "llm",
          status: "completed",
          elapsedMs: 10,
          estimatedCostUsd: 1,
          assessment: { evidence: "SUPPORTED", next: "FINALIZE" },
        },
      ]),
    },
  ];
}

test("cascade counts Jev plus fallback cost, preserves answers and distinguishes spend from simulation", () => {
  const input = inputs();
  const before = structuredClone(input);
  const report = compareDecisionAttempts(input);
  assert.equal(report.paired, 3);
  assert.equal(report.fallbacks, 2);
  assert.equal(report.jevInconsistencies, 1);
  assert.ok(Math.abs(report.simulatedPairedCascadeUsd - 2.3) < 1e-12);
  assert.ok(Math.abs(report.pairedComparisonSpendUsd - 3.3) < 1e-12);
  assert.equal(report.cascadeAgreements, 3);
  assert.equal(report.additionalResearchCostUsd, null);
  assert.equal(report.accuracy, null);
  assert.deepEqual(input, before);
});

test("missing pair suppresses global savings, without inventing zero-cost failed calls", () => {
  const input = inputs();
  input[0]!.results.pop();
  const report = compareDecisionAttempts(input);
  assert.equal(report.missingPairs, 1);
  assert.equal(report.complete, false);
  assert.equal(report.simulatedSavingsFraction, null);
});

test("mixed datasets, rubric tampering, duplicate results and missing usage fail closed", () => {
  const input = inputs();
  assert.throws(() => compareDecisionAttempts([...input, ...input]), {
    code: "DUPLICATE_COMPARISON_RESULT",
  });
  const mixed = structuredClone(input);
  mixed[0]!.manifest.datasetHash = "different";
  assert.throws(() => compareDecisionAttempts([...input, ...mixed]), {
    code: "INCOMPATIBLE_COMPARISON_ATTEMPTS",
  });
  const changed = structuredClone(input);
  changed[0]!.manifest.rubric.version = "changed";
  assert.throws(() => compareDecisionAttempts(changed), {
    code: "INCOMPATIBLE_COMPARISON_ATTEMPTS",
  });
  const invalid = inputs();
  invalid[0]!.results[0]!.estimatedCostUsd = Number.NaN;
  assert.throws(() => compareDecisionAttempts(invalid), { code: "INVALID_COMPARISON_RESULT" });
});
