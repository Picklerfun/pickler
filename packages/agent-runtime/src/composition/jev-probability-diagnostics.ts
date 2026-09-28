import type { z } from "zod";

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
