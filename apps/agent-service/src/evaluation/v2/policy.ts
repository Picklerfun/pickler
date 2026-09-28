import { needsConsistencyReview, type Assessment } from "../decision-evaluation";
import type { EnrichedState } from "./context";
import { policyVersion, type AnswerV2 } from "./provider";

export const policy = {
  version: policyVersion,
  closure:
    "Coherent finalization with existing fragment, known equal event/date, matching model scope and no unresolved conflict.",
  backup:
    "At most one blind backup. Known event mismatch or Jev conflict vetoes backup closure. Otherwise unresolved -> research/abstain. Citation provenance is not semantic proof.",
};
export function knownMismatch(state: EnrichedState): boolean {
  return state.documentContext.some(
    (doc) =>
      (state.target.eventId !== null &&
        doc.event.eventId !== null &&
        state.target.eventId !== doc.event.eventId) ||
      (state.target.date !== null &&
        doc.event.date !== null &&
        state.target.date !== doc.event.date),
  );
}
export function admissible(answer: AnswerV2, state: EnrichedState): boolean {
  const fragment = state.fragments.find((fragment) => fragment.id === answer.fragmentId);
  const doc = state.documentContext.find((doc) => doc.sourceId === fragment?.sourceId);
  return (
    !knownMismatch(state) &&
    !needsConsistencyReview(answer, state) &&
    answer.next === "FINALIZE" &&
    answer.scope === "MATCH" &&
    answer.conflict === "NONE" &&
    Boolean(
      doc &&
      state.target.eventId &&
      state.target.date &&
      doc.event.eventId === state.target.eventId &&
      doc.event.date === state.target.date,
    )
  );
}
export function applyPolicy(state: EnrichedState, jev: AnswerV2, backup?: AnswerV2) {
  const backupRequired = !admissible(jev, state);
  let selected: AnswerV2 | undefined;
  if (!backupRequired) {
    selected = jev;
  } else if (
    backup &&
    !knownMismatch(state) &&
    jev.conflict === "NONE" &&
    jev.evidence !== "CONFLICTING" &&
    jev.scope !== "MISMATCH" &&
    admissible(backup, state)
  ) {
    selected = backup;
  }
  const unresolved: Assessment = {
    evidence:
      jev.conflict === "PRESENT" ||
      jev.evidence === "CONFLICTING" ||
      backup?.conflict === "PRESENT" ||
      backup?.evidence === "CONFLICTING"
        ? "CONFLICTING"
        : "INSUFFICIENT",
    next: state.canResearch ? "RESEARCH" : "ABSTAIN",
  };
  const citation = selected
    ? state.fragments.find((fragment) => fragment.id === selected.fragmentId)!
    : null;
  return {
    assessment: selected ? { evidence: selected.evidence, next: selected.next } : unresolved,
    backupRequired,
    usedBackup: Boolean(selected && selected === backup),
    citation,
    reason: selected ? "ADMISSIBLE_PROPOSAL_NOT_SEMANTIC_PROOF" : "PRESERVED_UNCERTAINTY",
  };
}
