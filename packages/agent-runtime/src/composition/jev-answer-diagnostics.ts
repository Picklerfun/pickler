import type { StudyRouting } from "@pickler/trading/strategies";
import type { z } from "zod";
import { jevAnswerDiagnostics } from "@pickler/infrastructure/model-providers/jev";
export function answerDiagnostics(raw: unknown, issues: z.core.$ZodIssue[]) {
  return jevAnswerDiagnostics(raw, issues, {
    readiness: ["READY", "INSUFFICIENT", "UNKNOWN"],
    gap: ["NONE", "MISSING_BASIS", "CONFLICT", "UNKNOWN"],
    scope: ["MATCH", "MISMATCH", "UNKNOWN"],
  }) as NonNullable<StudyRouting["jev"]["answerDiagnostics"]>;
}
