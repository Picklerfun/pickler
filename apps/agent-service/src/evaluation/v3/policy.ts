import type { EnrichedState } from "../v2/context";
import type { AnswerV2 } from "../v2/provider";
import { admissible, applyPolicy as previousPolicy, knownMismatch } from "../v2/policy";

export const policy = {
  version: "3.0.0",
  description: "Retain v2 closure checks; never request a backup that cannot pass those checks.",
};
export function applyPolicy(state: EnrichedState, jev: AnswerV2, backup?: AnswerV2) {
  const canClose = admissible(jev, state);
  const compatibleDocument = Boolean(
    state.target.eventId &&
    state.target.date &&
    state.documentContext.some(
      (doc) => doc.event.eventId === state.target.eventId && doc.event.date === state.target.date,
    ),
  );
  const eligible =
    !canClose &&
    compatibleDocument &&
    !knownMismatch(state) &&
    jev.conflict === "NONE" &&
    jev.evidence !== "CONFLICTING" &&
    jev.scope !== "MISMATCH";
  const result = previousPolicy(state, jev, eligible ? backup : undefined);
  return { ...result, backupRequired: eligible, backupSkippedByVeto: !canClose && !eligible };
}
