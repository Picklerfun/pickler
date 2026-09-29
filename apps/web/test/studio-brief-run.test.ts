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
