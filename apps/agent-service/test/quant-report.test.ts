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
  } finally {
    await rm(dir, { recursive: true });
  }
});
