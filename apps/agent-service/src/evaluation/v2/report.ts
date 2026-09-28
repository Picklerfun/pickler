import { grade, type Assessment } from "../decision-evaluation";
import type { CaseV2 } from "./context";
export const strategies = ["llm-original", "jev-original", "jev-v2", "cascade-v2"] as const;
export type Strategy = (typeof strategies)[number];
export type Observation = {
  caseId: string;
  strategy: Strategy;
  assessment: Assessment;
  cost: number;
  elapsedMs: number;
  backupCalls: number;
};
export type FailureRow = { caseId: string; variant: Strategy | "llm-backup"; code: string };
export function summarize(
  cases: CaseV2[],
  observations: Observation[],
  complete: boolean,
  unknownCharges: number,
  failures: FailureRow[] = [],
) {
  const ids = new Set<string>();
  for (const row of observations) {
    const key = `${row.caseId}:${row.strategy}`;
    if (ids.has(key) || !cases.some((item) => item.base.id === row.caseId)) {
      throw new Error("Invalid observation identity");
    }
    ids.add(key);
  }
  function rows(group: CaseV2[]) {
    return strategies.map((strategy) => {
      const selected = observations.filter(
        (row) => row.strategy === strategy && group.some((item) => item.base.id === row.caseId),
      );
      const grades = selected.map((row) => {
        const item = group.find((item) => item.base.id === row.caseId)!;
        return item.review && item.proposal
          ? grade(row.assessment, item.proposal.assessment)
          : null;
      });
      const reviewed = group.every((item) => item.review && item.proposal);
      return {
        strategy,
        planned: group.length,
        completed: selected.length,
        missing: group.length - selected.length,
        failures: failures.filter(
          (failure) =>
            group.some((item) => item.base.id === failure.caseId) &&
            (failure.variant === strategy ||
              (strategy === "cascade-v2" && ["jev-v2", "llm-backup"].includes(failure.variant))),
        ).length,
        exactMatches: reviewed ? grades.filter((g) => g?.exactMatch).length : null,
        prematureClosures: reviewed ? grades.filter((g) => g?.unsafeFinalize).length : null,
        correctClosures: reviewed
          ? selected.filter((row, i) => grades[i]?.exactMatch && row.assessment.next === "FINALIZE")
              .length
          : null,
        unresolved: selected.filter((row) => row.assessment.next !== "FINALIZE").length,
        cost: selected.reduce((sum, row) => sum + row.cost, 0),
        elapsedMs: selected.reduce((sum, row) => sum + row.elapsedMs, 0),
        backupCalls: selected.reduce((sum, row) => sum + row.backupCalls, 0),
      };
    });
  }
  const summary = rows(cases);
  const baseline = summary[0]!;
  const cascade = summary[3]!;
  const eligible =
    complete &&
    unknownCharges === 0 &&
    cases.length === 32 &&
    cases.every(
      (item) =>
        item.base.split === "holdout" && item.review && item.review.kind !== "assistant-delegated",
    ) &&
    new Set(cases.map((item) => item.base.origin.eventId)).size >= 8 &&
    summary.every((row) => row.completed === 32);
  const denominator = baseline.correctClosures ?? 0;
  const gate =
    eligible && denominator > 0 && baseline.cost > 0
      ? {
          prematureClosures: cascade.prematureClosures === 0,
          jointMatches: cascade.exactMatches! >= baseline.exactMatches!,
          correctClosureRetention: cascade.correctClosures! / denominator >= 0.8,
          savings: 1 - cascade.cost / baseline.cost >= 0.2,
        }
      : null;
  return {
    reviewBasis: {
      delegated: cases.filter((item) => item.review?.kind === "assistant-delegated").length,
      human: cases.filter((item) => item.review && item.review.kind !== "assistant-delegated")
        .length,
    },
    summary,
    byEvent: Object.fromEntries(
      [...new Set(cases.map((item) => item.base.origin.eventId!))].map((eventId) => [
        eventId,
        rows(cases.filter((item) => item.base.origin.eventId === eventId)),
      ]),
    ),
    gate: gate
      ? { ...gate, passed: Object.values(gate).every(Boolean) }
      : { passed: false, reason: "INCOMPLETE_UNREVIEWED_UNKNOWN_COST_OR_INELIGIBLE_CORPUS" },
    researchCost: null,
    note: "Strategy cost reuses the Jev v2 response. Experimental spend is recorded separately. Citation validity does not establish semantic truth. Passing permits proposing shadow observation only.",
  };
}
export function markdownReport(report: ReturnType<typeof summarize>): string {
  function table(rows: typeof report.summary) {
    return [
      "| Strategy | Planned | Complete | Missing | Failures | Exact | Premature | Correct closures | Unresolved | Backup calls | Latency total (ms) | USD |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map(
        (r) =>
          `| ${r.strategy} | ${r.planned} | ${r.completed} | ${r.missing} | ${r.failures} | ${r.exactMatches ?? "n/a"} | ${r.prematureClosures ?? "n/a"} | ${r.correctClosures ?? "n/a"} | ${r.unresolved} | ${r.backupCalls} | ${r.elapsedMs} | ${r.cost.toFixed(9)} |`,
      ),
    ];
  }
  return [
    "# Evaluator v2 comparison",
    "",
    report.note,
    `Review basis: ${JSON.stringify(report.reviewBasis)}. Delegated assistant review is not independent human validation.`,
    "",
    ...table(report.summary),
    "",
    ...Object.entries(report.byEvent).flatMap(([id, rows]) => ["## " + id, "", ...table(rows), ""]),
    `Gate: ${JSON.stringify(report.gate)}`,
    "",
    "Research/search cost: unmeasured. Failed requests, unknown-charge reservations and total experimental spend are recorded in summary.json; missing comparisons must not be treated as successful zero-cost results.",
    "",
  ].join("\n");
}
