import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { QuantState } from "@pickler/core";
import { quantRows, saveQuant } from "../src/paper-study/quant-report.js";
function state(): QuantState {
  return {
    version: 2,
    protocol: "btc-quant-jev-v1",
    id: "report",
    createdAt: 0,
    deadline: 1,
    settlementDeadline: 2,
    priorReservedUsd: 1,
    maxNewReservedUsd: 0.1,
    jevInputPerMillion: 0.042,
    paidStopped: false,
    cases: [
      {
        id: "x",
        kind: "btc-5m",
        marketId: "1",
        startedAt: 0,
        finishedAt: 1,
        status: "abstained",
        reason: "<script>unsafe</script>",
        reservedUsd: 0,
        nextResolutionAt: 1,
        forecast: {
          protocol: "btc-quant-jev-v1",
          observedAt: 0,
          formula: "normal-arithmetic-terminal-average-v1",
          sigmaPerSecond: 1,
          trend60Minutes: 0,
          horizonSeconds: 240,
          lookbackSeconds: 60,
          basisFraction: 0.0005,
          probabilities: [
            { outcomeId: "up", label: "Up", lower: 0.6, estimate: 0.7, upper: 0.8 },
            { outcomeId: "down", label: "Down", lower: 0.2, estimate: 0.3, upper: 0.4 },
          ],
          limitations: [],
        },
      },
    ],
  };
}
test("abstained forecasts receive binary Brier; pending/split payouts do not", () => {
  const s = state();
  assert.equal(quantRows(s)[0]!.brier, null);
  s.cases[0]!.resolution = {
    marketId: "1",
    outcomeId: "up",
    conditionId: "fixture",
    outcomeIndex: 0,
    numerator: "1",
    denominator: "1",
    observedAt: new Date().toISOString(),
    chainId: 137,
    contract: "fixture",
    blockNumber: "1",
    blockHash: "fixture",
  };
  assert.ok(Math.abs(quantRows(s)[0]!.brier! - 0.09) < 1e-10);
  assert.equal(quantRows(s)[0]!.pnl, null);
  s.cases[0]!.resolution!.denominator = "2";
  assert.equal(quantRows(s)[0]!.brier, null);
  assert.equal(quantRows(s)[0]!.outcome, "nonbinary");
});
test("failed inputs without forecast render safely and HTML escapes external text", async () => {
  const s = state();
  const dir = await mkdtemp(join(tmpdir(), "quant-report-"));
  try {
    await saveQuant(dir, s);
    const html = await readFile(join(dir, "index.html"), "utf8");
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(!html.includes("<script>unsafe"));
    delete s.cases[0]!.forecast;
    s.cases[0]!.status = "failed";
    await saveQuant(dir, s);
    assert.equal(quantRows(s)[0]!.up, null);
    assert.equal(quantRows(s)[0]!.outcome, "not_evaluated");
  } finally {
    await rm(dir, { recursive: true });
  }
});

test("saved-book costs explain abstention without creating a fill", async () => {
  const s = state();
  s.cases[0]!.input = {
    item: {
      kind: "btc-5m",
      slug: "fixture",
      windowStart: 0,
      windowEnd: 300000,
      market: {
        id: "1",
        question: "fixture",
        rules: "fixture",
        active: true,
        categoryIds: [],
        liquidity: 100,
        closesAt: new Date(300000).toISOString(),
        outcomes: [
          { id: "up", label: "Up" },
          { id: "down", label: "Down" },
        ],
      },
    },
    rule: { version: 1, lookbackSeconds: 60, provenance: "fixture", tie: "up" },
    opening: { price: 100, observedAt: 0, url: "fixture" },
    ticker: { price: 101, bid: 100.99, ask: 101.01, observedAt: 0, url: "fixture" },
    candles: [],
    books: ["up", "down"].map((outcomeId) => ({
      outcomeId,
      observedAt: new Date(0).toISOString(),
      asks: [{ price: "0.4", size: "100" }],
      bids: [{ price: "0.39", size: "100" }],
    })),
    conditions: ["up", "down"].map((outcomeId) => ({
      marketId: "1",
      outcomeId,
      observedAt: new Date(0).toISOString(),
      minimumNotional: "1",
      minimumShares: "1",
      tickSize: "0.01",
      feeRate: "0.07",
      feeExponent: 1,
      provenance: "fixture",
    })),
    observedAt: 0,
  };
  const before = structuredClone(s);
  const row = quantRows(s)[0]!;
  assert.equal(row.attemptedAtUtc, "1970-01-01T00:00:00.000Z");
  assert.equal(row.windowEndUtc, "1970-01-01T00:05:00.000Z");
  assert.equal(row.lookbackSeconds, 60);
  assert.equal(row.closedCandleAgeSeconds, null);
  assert.ok(row.quotedEffectiveCostUp! > 0.4);
  assert.ok(row.quotedConservativeEdgeUp! > 0.17 && row.quotedConservativeEdgeUp! < 0.19);
  assert.equal(row.cost, null);
  assert.equal(row.pnl, null);
  assert.deepEqual(s, before);

  s.cases[0]!.resolution = {
    marketId: "1",
    outcomeId: "up",
    conditionId: "fixture",
    outcomeIndex: 0,
    numerator: "1",
    denominator: "1",
    observedAt: new Date(0).toISOString(),
    chainId: 137,
    contract: "fixture",
    blockNumber: "1",
    blockHash: "fixture",
  };
  const other = structuredClone(s.cases[0]!);
  other.id = "other";
  delete other.input;
  other.forecast!.probabilities[0]!.estimate = 0.2;
  s.cases.push(other);
  const dir = await mkdtemp(join(tmpdir(), "quant-coverage-"));
  try {
    await saveQuant(dir, s);
    const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8")).summaries[0];
    assert.equal(summary.resolved, 2);
    assert.equal(summary.bookComparisonCount, 1);
    assert.ok(Math.abs(summary.modelBrierOnBookSubset - 0.09) < 1e-10);
    assert.ok(Math.abs(summary.brier - 0.365) < 1e-10);
  } finally {
    await rm(dir, { recursive: true });
  }
});
