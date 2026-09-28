import test from "node:test";
import assert from "node:assert/strict";
import {
  quantForecast,
  quantProposal,
  runComparisonCase,
  type ComparisonState,
  type QuantState,
} from "@pickler/trading/strategies";
import {
  comparisonProbeInput,
  settleComparisonProbe,
} from "../src/paper-study/comparison-probe.js";
import {
  replayComparison,
  comparisonSummary,
  comparisonReport,
} from "../src/paper-study/comparison-report.js";
import { serialExecutor, lidClosed } from "../src/paper-study/comparison-host.js";

test("synthetic probe runs the real deterministic pipeline with exactly one review", async () => {
  const input = comparisonProbeInput(Date.now()),
    now = input.observedAt;
  const state: ComparisonState = {
    version: 3,
    protocol: "btc-policy-comparison-v1",
    id: "fixture",
    createdAt: now,
    deadline: null,
    settlementDeadline: null,
    priorReservedUsd: 1,
    maxNewReservedUsd: 0.25,
    jevInputPerMillion: 0.042,
    cases: [],
    slots: [],
    interruptions: [],
    paidStopped: null,
  };
  let calls = 0;
  await runComparisonCase(
    state,
    input.item,
    {
      now: () => now,
      input: async () => structuredClone(input),
      refresh: async () => input.item,
      save: async () => {},
      guard: async () => {},
      exclusive: serialExecutor(),
      reviewerVersion: "fixture",
      review: async () => {
        calls++;
        return { status: "completed", inputTokens: 100, outputTokens: 5, veto: false };
      },
    },
    true,
  );
  assert.equal(calls, 1);
  assert.ok(state.probe!.policies.every((p) => p.fill));
  settleComparisonProbe(state.probe!, now);
  assert.ok(state.probe!.policies.every((p) => p.settlement));
  const summary = comparisonSummary(state);
  assert.equal(summary.reviews, 1);
  assert.equal(summary.inputTokens, 100);
  assert.equal(summary.outputTokens, 5);
  assert.ok(summary.forecasts.every((f) => f.forecasts === 0));
  assert.ok(summary.policies.every((p) => p.filled === 0));
  state.cases.push(structuredClone(state.probe!));
  delete state.probe;
  assert.equal(comparisonSummary(state).forecasts[0]!.scored, 1);
  assert.ok(comparisonReport(state).html.includes("Synthetic probe excluded"));
});
test("replay uses saved forecasts and contemporaneous books only; no fills/P&L", () => {
  const input = comparisonProbeInput(Date.now()),
    forecast = quantForecast(input, input.observedAt);
  const raw = {
    version: 2,
    protocol: "btc-quant-jev-v1",
    cases: [
      {
        marketId: "1",
        kind: "btc-5m",
        input,
        forecast,
        resolution: { numerator: "1" },
        refreshedInput: {},
      },
    ],
  } as unknown as QuantState;
  const first = replayComparison(raw);
  raw.cases[0]!.resolution!.numerator = "0";
  assert.deepEqual(replayComparison(raw), first);
  assert.ok(first[0]!.policies.every((p) => p.proposal));
  assert.equal(JSON.stringify(first).includes("fill"), false);
  assert.equal(JSON.stringify(first).includes("payout"), false);
  assert.ok(quantProposal(input, forecast, input.observedAt));
});
test("macOS lid guard rejects unknown and closed state", () => {
  assert.equal(lidClosed('"AppleClamshellState" = Yes'), true);
  assert.equal(lidClosed('"AppleClamshellState" = No'), false);
  assert.throws(() => lidClosed("unknown"), /UNAVAILABLE/);
});
test("serial executor keeps writes exclusive and survives a rejected operation", async () => {
  const execute = serialExecutor();
  const seen: number[] = [];
  const a = execute(async () => {
    seen.push(1);
    await Promise.resolve();
    seen.push(2);
    throw new Error("expected");
  });
  const b = execute(async () => {
    seen.push(3);
  });
  await Promise.allSettled([a, b]);
  assert.deepEqual(seen, [1, 2, 3]);
});
