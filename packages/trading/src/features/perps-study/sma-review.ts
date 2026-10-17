import { PilotError, type Source } from "@pickler/core";
import { perpsRules, perpsJevReviewed, type PerpsJevAnswers } from "../perps-strategies/policy.js";
import type {
  PerpsDecisionContext,
  PerpsProposal,
  PerpsModelHooks,
  PerpsStrategyCalls,
} from "../perps-strategies/types.js";
export interface SmaNews {
  sources: Source[];
  excluded: { id: string; reason: string }[];
  cutoff: number;
}
export interface SmaReviewModels {
  metadata: unknown;
  news(
    context: PerpsDecisionContext,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<SmaNews>;
  review(
    context: PerpsDecisionContext,
    proposals: PerpsProposal[],
    news: SmaNews | null,
    signal: AbortSignal,
    hooks: PerpsModelHooks,
  ): Promise<PerpsJevAnswers>;
}
/** Same hourly strategy, own portfolio. Only openings can be vetoed; exits never wait for a review. */
export async function executeSmaReviewVariant(
  variant: "sma-jev" | "sma-exa-jev",
  context: PerpsDecisionContext,
  models: SmaReviewModels,
  calls: PerpsStrategyCalls,
  signal: AbortSignal,
): Promise<PerpsProposal[]> {
  const frozen = structuredClone(context);
  const original = perpsRules(frozen);
  if (!original.some((p) => p.action.startsWith("open-"))) {
    return original;
  }
  const news =
    variant === "sma-exa-jev"
      ? await calls.run("exa", (h) => models.news(frozen, signal, h))
      : null;
  signal.throwIfAborted();
  const answers = await calls.run(variant === "sma-jev" ? "sma-review" : "news-review", (h) =>
    models.review(frozen, original, news, signal, h),
  );
  const reviewed = perpsJevReviewed(original, answers);
  return original.map((p, i) => (p.action.startsWith("open-") ? reviewed[i]! : p));
}
export function smaFinalProposals(
  initial: PerpsProposal[],
  context: PerpsDecisionContext,
): PerpsProposal[] {
  const refreshed = perpsRules(context);
  if (initial.length !== 2 || new Set(initial.map((p) => p.symbol)).size !== 2) {
    throw new PilotError("INVALID_INPUT", "Two SMA asset proposals required");
  }
  return initial.map((p) => {
    const final = refreshed.find((v) => v.symbol === p.symbol)!;
    return p.action.startsWith("open-") && final.action !== p.action
      ? { ...p, action: "hold", reason: "SMA_FINAL_GATE_CHANGED" }
      : p;
  });
}
