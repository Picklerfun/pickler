import assert from "node:assert/strict";
import { test } from "node:test";
import { traceLines } from "../src/features/studio/create/trace";
import { runResult } from "../src/features/studio/brief/result";
import type { PreviewRun, RunEvent } from "../src/features/studio/api";

const event = (id: number, type: string, data: unknown): RunEvent => ({
  id,
  type,
  data,
  createdAt: 1_000 + id * 1_000,
});
const entries = (...fired: boolean[]) =>
  fired.map((value, i) => ({ rule: `rule ${i + 1}`, fired: value, why: "because" }));

test("the brief line says which entries fired and how many held", () => {
  const lines = traceLines(
    [
      event(1, "brief_evaluation", { entries: entries(true, true, false) }),
      event(2, "brief_evaluation", { entries: entries(false, false) }),
      event(3, "brief_evaluation", { entries: entries(true) }),
    ],
    1_000,
  );
  assert.deepEqual(
    lines.map((line) => [line.text, line.tint]),
    [
      ["Entry 1 and 2 fired · 1 held", "blue"],
      ["Checked 2 entries · none fired", "magenta"],
      ["Entry 1 fired", "blue"],
    ],
  );
});

const run = (decision: unknown, status: PreviewRun["status"] = "completed"): PreviewRun =>
  ({
    id: "p1",
    status,
    createdAt: 0,
    startedAt: 0,
    finishedAt: 1,
    expiresAt: 2,
    adopted: false,
    decision,
    error: null,
  }) as PreviewRun;
const market = event(1, "market", {
  question: "Chiefs vs. Bills",
  outcomes: [
    { id: "chiefs", label: "Chiefs" },
    { id: "bills", label: "Bills" },
  ],
});

test("a trade is ITS TRADE: our pick, sized at the per-trade cap within the paper budget", () => {
  const result = runResult(
    run({ action: "TRADE", outcomeId: "chiefs", abstentionReason: null }),
    [
      market,
      event(2, "brief_evaluation", { entries: entries(true), exitArmed: "The line moves back" }),
    ],
    25,
  );
  assert.deepEqual(result, {
    trade: true,
    eyebrow: "ITS TRADE",
    title: "BUY CHIEFS · 10 AUSD",
    meta: "CHIEFS VS. BILLS · EXIT · THE LINE MOVES BACK",
  });
  assert.equal(
    runResult(run({ action: "TRADE", outcomeId: "chiefs", abstentionReason: null }), [market], 5)
      ?.title,
    "BUY CHIEFS · 5 AUSD",
  );
});

test("a stand-down is STOOD DOWN · NO TRADE with the rule that stopped it", () => {
  const result = runResult(
    run({ action: "ABSTAIN", outcomeId: null, abstentionReason: "Policy rejected proposal" }),
    [
      market,
      event(2, "brief_evaluation", {
        entries: entries(true, false),
        exitArmed: null,
        stoppedBy: { kind: "entry", rule: "The market has not moved" },
      }),
    ],
    5,
  );
  assert.deepEqual(result, {
    trade: false,
    eyebrow: "STOOD DOWN",
    title: "NO TRADE",
    meta: "HELD BY · THE MARKET HAS NOT MOVED",
  });
});

test("without a stopping rule it gives the model's reason", () => {
  const result = runResult(
    run({ action: "ABSTAIN", outcomeId: null, abstentionReason: "Nothing fired yet" }),
    [],
    5,
  );
  assert.equal(result?.meta, "NOTHING FIRED YET");
});

test("no result until the run completed with a decision", () => {
  assert.equal(runResult(run(null, "running"), [], 5), null);
  assert.equal(runResult(run(null, "failed"), [], 5), null);
});

test("a stand-down the policy made reads as a person would say it, not its code", () => {
  const policy = (codes: string[]) =>
    run({
      action: "ABSTAIN",
      outcomeId: null,
      abstentionReason: `Policy rejected proposal: ${codes.join(", ")}`,
      policyEvaluation: { finalAction: "ABSTAIN", reasonCodes: codes },
    });
  assert.equal(
    runResult(policy(["PRICE_EXCEEDS_LIMIT"]), [market], 5)?.meta,
    "THE PRICE MOVED PAST ITS LIMIT",
  );
  assert.equal(
    runResult(policy(["WIDE_PROBABILITY_RANGE", "HIGH_UNCERTAINTY"]), [market], 5)?.meta,
    "ITS RANGE WAS TOO WIDE",
  );
  assert.equal(
    runResult(policy(["SOMETHING_NEW"]), [market], 5)?.meta,
    "ITS RULES STOPPED THE TRADE",
  );
  // An older decision without policyEvaluation still carries the codes in its reason.
  assert.equal(
    runResult(
      run({
        action: "ABSTAIN",
        outcomeId: null,
        abstentionReason: "Policy rejected proposal: HIGH_UNCERTAINTY",
      }),
      [],
      5,
    )?.meta,
    "TOO UNCERTAIN TO CALL",
  );
});

test("every policy reason code has its own words", async () => {
  const { policyReasonText } = await import("../src/features/studio/brief/result");
  const schema = await import("@pickler/api-schema");
  // The enum the stored decision is parsed with: a code added there without words here fails.
  const codes = schema.decisionV2Schema.shape.policyEvaluation.shape.reasonCodes.element.options;
  assert.ok(codes.length >= 9);
  for (const code of codes) {
    assert.notEqual(policyReasonText(code), policyReasonText("SOMETHING_NEW"), code);
  }
});

test("a model that stood down on its own keeps its own words, whatever codes came with it", () => {
  const result = runResult(
    run({
      action: "ABSTAIN",
      outcomeId: null,
      abstentionReason: "The injury news is already priced",
      policyEvaluation: {
        finalAction: "ABSTAIN",
        reasonCodes: ["MODEL_ABSTAINED", "HIGH_UNCERTAINTY"],
      },
    }),
    [market],
    5,
  );
  assert.equal(result?.meta, "THE INJURY NEWS IS ALREADY PRICED");
});
