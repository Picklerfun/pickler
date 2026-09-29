import type { z } from "zod";

type Shape = "missing" | "null" | "array" | "object" | "string" | "number" | "boolean" | "other";
const fields = ["type", "choice", "confidence", "probabilities"] as const;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function shape(value: unknown): Shape {
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
      return typeof value as Shape;
    default:
      return "other";
  }
}
/** Only fixed labels, shapes and counts may escape rejected provider JSON. */
export function jevAnswerDiagnostics(
  raw: unknown,
  issues: z.core.$ZodIssue[],
  labels: Record<string, readonly string[]>,
) {
  const answers = object(raw).answers;
  const entries = object(answers);
  const questions: Record<
    string,
    {
      shape: Shape;
      fields: Record<(typeof fields)[number], Shape>;
      unknownFieldCount: number;
      probabilityKeyCount: number;
      unknownProbabilityKeyCount: number;
    }
  > = {};
  for (const question of Object.keys(labels)) {
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
      unknownProbabilityKeyCount: probabilities.filter((key) => !labels[question]!.includes(key))
        .length,
    };
  }
  return {
    version: 1 as const,
    probabilityIssues: probabilityIssues(issues, Object.keys(labels)),
    answersShape: shape(answers),
    unknownQuestionCount: Object.keys(entries).filter((key) => !Object.hasOwn(labels, key)).length,
    questions,
    issueCount: issues.length,
    issuesTruncated: issues.length > 16,
    issues: issues.slice(0, 16).map((issue) => {
      const [, question, field] = issue.path;
      const safeQuestion =
        issue.path[0] === "answers" &&
        typeof question === "string" &&
        Object.hasOwn(labels, question)
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

/** Fixed failure labels only; never persist rejected values or provider messages. */
export function probabilityIssues(issues: z.core.$ZodIssue[], questions: readonly string[]) {
  const reasons = ["PROBABILITY_SUM_INVALID", "CHOICE_NOT_MAXIMUM"] as const;
  return issues
    .flatMap((issue) => {
      const reason = reasons.find((value) => issue.code === "custom" && value === issue.message);
      const question = questions.find((value) => value === issue.path[1]);
      return reason && question && issue.path[0] === "answers" ? [{ question, reason }] : [];
    })
    .slice(0, 16);
}
