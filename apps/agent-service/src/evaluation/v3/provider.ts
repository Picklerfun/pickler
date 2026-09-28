import { costUsd, type Rates } from "../decision-evaluation";
import type { EnrichedState } from "../v2/context";
import {
  makePlanV2,
  questions as originalQuestions,
  v2Instructions,
  type Variant,
} from "../v2/provider";
export const instructions = {
  version: "3.0.0",
  common: v2Instructions.common,
  scope:
    "Determine EVENT RELEVANCE ONLY, independently of truth. MATCH means the source addresses the same target event, even when it CONTRADICTS the claim. A player being OUT contradicts availability but does not make the event MISMATCH. A Friday practice report for a Sunday game concerns that game's event; practice date need not equal kickoff date. Use explicit event IDs and dates in metadata. MISMATCH requires evidence of a different target event; missing identity is UNKNOWN.",
  conflict:
    "Compare source statements about the SAME FACT at the same relevant time. Conflict means incompatible source statements, not disagreement between a claim and a source. Full practice and an OUT game status are compatible: practice participation and game availability are different facts. A single OUT listing against a claim of availability means CONTRADICTED with conflict NONE. Do not invent a second source or silently resolve genuine competing statuses.",
  baselineFormat:
    'Return exactly one JSON object with two string fields. Schema: {"type":"object","additionalProperties":false,"required":["evidence","next"],"properties":{"evidence":{"type":"string","enum":["SUPPORTED","CONTRADICTED","CONFLICTING","INSUFFICIENT"]},"next":{"type":"string","enum":["FINALIZE","RESEARCH","ABSTAIN"]}}}. No nested objects, confidence, explanation, markdown or extra fields. Example of shape only: {"evidence":"INSUFFICIENT","next":"RESEARCH"}. Choose values from the evidence and canResearch, not from the example.',
};
export function makePlanV3(
  variant: Variant,
  state: EnrichedState,
  env: NodeJS.ProcessEnv,
  rates: Rates,
) {
  const plan = makePlanV2(variant, state, env, rates);
  const body = JSON.parse(plan.body);
  if (variant === "llm-original") {
    body.messages[0].content += ` ${instructions.baselineFormat}`;
  } else if (variant !== "jev-original") {
    const q = originalQuestions(state);
    q.scope.instructions = instructions.scope;
    q.conflict.instructions = instructions.conflict;
    q.scope.criteria.MATCH =
      "Source concerns the same event, whether supporting or contradicting the claim.";
    q.conflict.criteria.NONE =
      "No incompatible source statements about the same fact; contradiction of the claim alone is not source conflict.";
    if (variant === "jev-v2") {
      body.questions = q;
    } else {
      body.messages[0].content = `Return JSON with exactly five string fields: evidence, next, scope, conflict, fragmentId. No nested objects, prose or extra fields. Each value must be a criteria key. Questions: ${JSON.stringify(q)}`;
    }
  }
  const serialized = JSON.stringify(body);
  return {
    ...plan,
    body: serialized,
    reservedUsd: costUsd(
      { input: Buffer.byteLength(serialized) + 4096, output: variant.startsWith("jev") ? 0 : 4096 },
      plan.rates,
    ),
  };
}
