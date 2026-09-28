import { z } from "zod";

/** Protocol-independent shape and arithmetic; routing thresholds belong to core/runtime. */
export function jevChoiceSchema<const T extends readonly [string, ...string[]]>(labels: T) {
  return z
    .object({
      type: z.literal("choice"),
      choice: z.enum(labels),
      confidence: z.number().min(0).max(1),
      probabilities: z.record(z.enum(labels), z.number().min(0).max(1)),
    })
    .strict()
    .superRefine((answer, ctx) => {
      const ps = Object.values(answer.probabilities) as number[];
      if (Math.abs(ps.reduce((sum, p) => sum + p, 0) - 1) > 0.001) {
        ctx.addIssue({ code: "custom", message: "PROBABILITY_SUM_INVALID" });
      }
      if (
        (answer.probabilities as Record<string, number>)[answer.choice]! + 1e-6 <
        Math.max(...ps)
      ) {
        ctx.addIssue({ code: "custom", message: "CHOICE_NOT_MAXIMUM" });
      }
    });
}
export function jevEnvelopeSchema(model: string) {
  return z.object({
    model: z.literal(model),
    usage: z.object({
      input_tokens: z.number().int().nonnegative(),
      output_tokens: z.number().int().nonnegative(),
    }),
  });
}
