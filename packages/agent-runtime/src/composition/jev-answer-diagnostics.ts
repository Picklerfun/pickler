import type { StudyRouting } from "@pickler/core";
import type { z } from "zod";

type Diagnostics = NonNullable<StudyRouting["jev"]["answerDiagnostics"]>;
const labels = {
  readiness: ["READY", "INSUFFICIENT", "UNKNOWN"],
  gap: ["NONE", "MISSING_BASIS", "CONFLICT", "UNKNOWN"],
  scope: ["MATCH", "MISMATCH", "UNKNOWN"],
};
const fields = ["type", "choice", "confidence", "probabilities"] as const;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function shape(value: unknown): Diagnostics["answersShape"] {
  if (value === undefined) {
    return "missing";
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  switch (typeof value) {
    case "object":
    case "string":
    case "number":
    case "boolean":
      return typeof value as Diagnostics["answersShape"];
    default:
      return "other";
  }
}
/** Only fixed labels, shapes and counts may escape rejected provider JSON. */
export function answerDiagnostics(raw: unknown, issues: z.core.$ZodIssue[]): Diagnostics {
  const answers = object(raw).answers;
  const entries = object(answers);
  const questions = {} as Diagnostics["questions"];
  for (const question of ["readiness", "gap", "scope"] as const) {
    const answer = object(entries[question]);
    const probabilities = Object.keys(object(answer.probabilities));
    questions[question] = {
      shape: shape(entries[question]),
      fields: {
        type: shape(answer.type),
        choice: shape(answer.choice),
        confidence: shape(answer.confidence),
        probabilities: shape(answer.probabilities),
      },
      unknownFieldCount: Object.keys(answer).filter((key) => !fields.some((f) => f === key)).length,
      probabilityKeyCount: probabilities.length,
      unknownProbabilityKeyCount: probabilities.filter((key) => !labels[question].includes(key))
        .length,
    };
  }
  return {
    version: 1,
    answersShape: shape(answers),
    unknownQuestionCount: Object.keys(entries).filter((key) => !Object.hasOwn(labels, key)).length,
    questions,
    issueCount: issues.length,
    issuesTruncated: issues.length > 16,
    issues: issues.slice(0, 16).map((issue) => {
      const [, question, field] = issue.path;
      const safeQuestion =
        issue.path[0] === "answers" &&
        (question === "readiness" || question === "gap" || question === "scope")
          ? question
          : "unknown";
      const safeField =
        field === undefined ? "object" : (fields.find((f) => f === field) ?? "unknown");
      const codes = [
        "invalid_type",
        "invalid_value",
        "unrecognized_keys",
        "too_small",
        "too_big",
        "custom",
        "invalid_key",
      ] as const;
      return {
        question: safeQuestion,
        field: safeField,
        code: codes.find((code) => code === issue.code) ?? "other",
      };
    }),
  };
}
