import { grade } from "../decision-evaluation";
import type { CaseV2 } from "../v2/context";
import type { Observation } from "../v2/report";
const variants = ["llm-original", "jev-v2", "cascade-v2"] as const;
const names = { "llm-original": "llm-format-v3", "jev-v2": "jev-v4", "cascade-v2": "cascade-v4" };
export function report(
  cases: CaseV2[],
  observations: Observation[],
  stopCode: string | null,
  unknownCharges: number,
) {
  function rows(group: CaseV2[]) {
    return variants.map((variant) => {
      const selected = observations.filter(
        (r) => r.strategy === variant && group.some((c) => c.base.id === r.caseId),
      );
      const grades = selected.map((r) =>
        grade(r.assessment, group.find((c) => c.base.id === r.caseId)!.proposal!.assessment),
      );
      return {
        variant: names[variant],
        planned: group.length,
        completed: selected.length,
        exact: grades.filter((g) => g.exactMatch).length,
        premature: grades.filter((g) => g.unsafeFinalize).length,
        correctClosures: selected.filter(
          (r, i) => r.assessment.next === "FINALIZE" && grades[i]!.exactMatch,
        ).length,
        unresolved: selected.filter((r) => r.assessment.next !== "FINALIZE").length,
        backups: selected.reduce((s, r) => s + r.backupCalls, 0),
        cost: selected.reduce((s, r) => s + r.cost, 0),
        elapsedMs: selected.reduce((s, r) => s + r.elapsedMs, 0),
      };
    });
  }
  const summary = rows(cases);
  const base = summary[0]!;
  const cascade = summary[2]!;
  const complete =
    !stopCode && !unknownCharges && summary.every((r) => r.completed === cases.length);
  const checks = {
    zeroPremature: cascade.premature === 0,
    matches: cascade.exact >= base.exact,
    retention: base.correctClosures > 0 && cascade.correctClosures / base.correctClosures >= 0.8,
    savings: base.cost > 0 && 1 - cascade.cost / base.cost >= 0.2,
  };
  return {
    version: "4.0.0",
    summary,
    byEvent: Object.fromEntries(
      [...new Set(cases.map((c) => c.base.origin.eventId!))].map((id) => [
        id,
        rows(cases.filter((c) => c.base.origin.eventId === id)),
      ]),
    ),
    complete,
    checks,
    numericCriteriaPassed: complete && Object.values(checks).every(Boolean),
    independentValidation: false,
    note: "Fresh retrospective cases with delegated references; this small batch does not replace the original 32-case independent validation gate. Costs are published-rate estimates; research cost is unmeasured. Internal observation labels retain v2 adapter keys; displayed policy variants are v4; model instructions remain v3.",
    stopCode,
  };
}
export function markdown(r: ReturnType<typeof report>) {
  const table = (rows: typeof r.summary) => [
    "| Variant | Completed/planned | Exact | Premature | Correct closes | Unresolved | Backups | USD | Total ms |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (s) =>
        `| ${s.variant} | ${s.completed}/${s.planned} | ${s.exact} | ${s.premature} | ${s.correctClosures} | ${s.unresolved} | ${s.backups} | ${s.cost.toFixed(9)} | ${s.elapsedMs} |`,
    ),
  ];
  return [
    "# Evaluator v4 fresh-case laboratory",
    "",
    r.note,
    "",
    ...table(r.summary),
    "",
    `Complete: ${r.complete}. Numeric criteria: ${JSON.stringify(r.checks)}. Numeric criteria passed: ${r.numericCriteriaPassed}. Independent validation: false. Stop: ${r.stopCode ?? "none"}.`,
    "",
    ...Object.entries(r.byEvent).flatMap(([id, rows]) => [`## ${id}`, "", ...table(rows), ""]),
  ].join("\n");
}
