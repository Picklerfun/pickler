import { test } from "node:test";
import assert from "node:assert/strict";
import { briefVerdict, evaluateDecision } from "../src/features/research/decision-policy.js";
import type {
  AgentBrief,
  BriefEvaluation,
  ModelAssessment,
} from "../src/features/research/types.js";

const brief: AgentBrief = {
  thesis: "",
  reads: [],
  entersWhen: ["A starter is ruled out", "The market has not moved"],
  exitsWhen: ["The line moves back"],
  never: ["Trade within an hour of kickoff"],
};

const allFired: BriefEvaluation = {
  entries: [
    { rule: "A starter is ruled out", fired: true, why: "The Thursday report lists him out." },
    { rule: "The market has not moved", fired: true, why: "0.54 all week." },
  ],
  exitArmed: "The line moves back",
  neverChecked: [{ rule: "Trade within an hour of kickoff", respected: true }],
};

const trade: ModelAssessment = {
  action: "TRADE",
  marketId: "1",
  outcomeId: "yes",
  thesis: "Edge",
  counterEvidence: "Some",
  uncertainty: "Some",
  uncertaintyLevel: "LOW",
  missingInformation: [],
  probability: { lower: 0.6, estimate: 0.65, upper: 0.7 },
  sourceIds: ["s"],
  observedPrice: "0.4",
  limitPrice: "0.5",
  expiresAt: "2026-09-23T00:00:00Z",
  abstentionReason: null,
  brief: allFired,
};

test("every entry fired and every never respected: the trade stands", () => {
  const result = evaluateDecision(trade, "0.4", undefined, 100, brief);
  assert.equal(result.action, "TRADE");
  assert.deepEqual(result.policyEvaluation.reasonCodes, []);
  assert.deepEqual(briefVerdict(brief, allFired), {
    entriesFired: true,
    neverRespected: true,
    stoppedBy: null,
  });
});

test("one entry held: the trade becomes an abstention that names the rule", () => {
  const held = structuredClone(allFired);
  held.entries[1]!.fired = false;
  const result = evaluateDecision({ ...trade, brief: held }, "0.4", undefined, 100, brief);
  assert.equal(result.action, "ABSTAIN");
  assert.deepEqual(result.policyEvaluation.reasonCodes, ["BRIEF_ENTRY_NOT_MET"]);
  assert.deepEqual(briefVerdict(brief, held).stoppedBy, {
    kind: "entry",
    rule: "The market has not moved",
  });
});

test("a never line broken: the trade becomes an abstention", () => {
  const broken = structuredClone(allFired);
  broken.neverChecked[0]!.respected = false;
  const result = evaluateDecision({ ...trade, brief: broken }, "0.4", undefined, 100, brief);
  assert.equal(result.action, "ABSTAIN");
  assert.deepEqual(result.policyEvaluation.reasonCodes, ["BRIEF_NEVER_BROKEN"]);
  assert.deepEqual(briefVerdict(brief, broken).stoppedBy, {
    kind: "never",
    rule: "Trade within an hour of kickoff",
  });
});

test("a missing block is a failed decision, not all fired", () => {
  const rest: ModelAssessment = { ...trade };
  delete rest.brief;
  assert.throws(() => evaluateDecision(rest, "0.4", undefined, 100, brief), {
    code: "INVALID_DECISION",
  });
});

test("a wrong count or a different order is a failed decision", () => {
  const short = { ...allFired, entries: allFired.entries.slice(0, 1) };
  const swapped = { ...allFired, entries: [...allFired.entries].reverse() };
  const noNever = { ...allFired, neverChecked: [] };
  for (const evaluation of [short, swapped, noNever]) {
    assert.throws(() => briefVerdict(brief, evaluation), { code: "INVALID_DECISION" });
  }
});

test("an armed exit must be one of the brief's exits", () => {
  assert.throws(() => briefVerdict(brief, { ...allFired, exitArmed: "Something else" }), {
    code: "INVALID_DECISION",
  });
  assert.doesNotThrow(() => briefVerdict(brief, { ...allFired, exitArmed: null }));
});

test("an abstention is still checked, and stays an abstention", () => {
  const abstain: ModelAssessment = {
    ...trade,
    action: "ABSTAIN",
    outcomeId: null,
    limitPrice: null,
    expiresAt: null,
    abstentionReason: "Nothing fired",
  };
  const result = evaluateDecision(abstain, null, undefined, 100, brief);
  assert.equal(result.action, "ABSTAIN");
  assert.deepEqual(result.policyEvaluation.reasonCodes, ["MODEL_ABSTAINED"]);
  const rest: ModelAssessment = { ...abstain };
  delete rest.brief;
  assert.throws(() => evaluateDecision(rest, null, undefined, 100, brief), {
    code: "INVALID_DECISION",
  });
});

test("without a brief the block is ignored", () => {
  const result = evaluateDecision({ ...trade, brief: undefined }, "0.4", undefined, 100);
  assert.equal(result.action, "TRADE");
});
