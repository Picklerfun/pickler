import type { EnrichedState } from "../v2/context";
import type { AnswerV2 } from "../v2/provider";
import { applyPolicy as previousPolicy } from "../v3/policy";

export const policy = {
  version: "4.0.0",
  description:
    "Keep v3 closure checks. Preserve coherent insufficient evidence without buying a second classification.",
};
export function applyPolicy(state: EnrichedState, jev: AnswerV2, backup?: AnswerV2) {
  const preserve =
    jev.evidence === "INSUFFICIENT" &&
    jev.next === (state.canResearch ? "RESEARCH" : "ABSTAIN") &&
    jev.scope === "MATCH" &&
    jev.conflict === "NONE" &&
    jev.fragmentId === "NONE";
  const result = previousPolicy(state, jev, preserve ? undefined : backup);
  return {
    ...result,
    backupRequired: result.backupRequired && !preserve,
    backupSkippedForUncertainty: preserve,
  };
}
