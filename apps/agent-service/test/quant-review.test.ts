import test from "node:test";
import assert from "node:assert/strict";
import { createQuantReviewer } from "@pickler/agent-runtime/composition/quant-review";
import type { QuantInput, QuantForecast, QuantProposal, QuantReview } from "@pickler/core";
const input = { books: [] } as unknown as QuantInput,
  forecast = {} as QuantForecast,
  proposal = {} as QuantProposal;
function response(veto = false, confidence = 1) {
  const answer = (values: string[], selected: string) => ({
    type: "choice",
    choice: selected,
    confidence,
    probabilities: Object.fromEntries(values.map((v) => [v, v === selected ? 1 : 0])),
  });
  return {
    model: "jev-1.13.0",
    usage: { input_tokens: 500, output_tokens: 137 },
    answers: {
      readiness: answer(["READY", "INSUFFICIENT", "UNKNOWN"], "READY"),
      gap: answer(["NONE", "MISSING_BASIS", "CONFLICT", "UNKNOWN"], veto ? "CONFLICT" : "NONE"),
      scope: answer(["MATCH", "MISMATCH", "UNKNOWN"], "MATCH"),
    },
  };
}
test("Jev vetoes clear contradictions; low confidence does not veto; no fallback", async () => {
  for (const [veto, confidence, expected] of [
    [true, 1, true],
    [true, 0.2, false],
    [false, 1, false],
  ] as const) {
    let calls = 0;
    const records: QuantReview[] = [];
    const reviewer = createQuantReviewer(
      "fixture",
      async () => {},
      async () => {
        calls++;
        return Response.json(response(veto, confidence));
      },
    );
    const r = await reviewer.review(
      input,
      forecast,
      proposal,
      new AbortController().signal,
      async (r) => {
        records.push(r);
      },
    );
    assert.equal(r.veto, expected);
    assert.equal(r.outputTokens, 137);
    assert.equal(calls, 1);
    assert.equal(records[0]!.status, "started");
  }
});
test("invalid answers preserve usage and sanitized diagnostics without retry", async () => {
  let calls = 0;
  const records: QuantReview[] = [];
  const raw = response();
  Object.assign(raw.answers.gap, { secret_unknown: "never persist" });
  const reviewer = createQuantReviewer(
    "fixture",
    async () => {},
    async () => {
      calls++;
      return Response.json(raw);
    },
  );
  await assert.rejects(
    reviewer.review(input, forecast, proposal, new AbortController().signal, async (r) => {
      records.push(r);
    }),
  );
  assert.equal(calls, 1);
  const last = records.at(-1)!;
  assert.equal(last.status, "failed");
  assert.equal(last.inputTokens, 500);
  assert.ok(last.diagnostics);
  assert.equal(JSON.stringify(records).includes("secret_unknown"), false);
  assert.equal(JSON.stringify(records).includes("never persist"), false);
});
