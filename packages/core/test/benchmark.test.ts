import test from "node:test";
import assert from "node:assert/strict";
import {
  runBenchmarkCase,
  PilotError,
  benchmarkEvaluationReady,
  recoverBenchmark,
  benchmarkReserved,
  settleBenchmarkCase,
  variantMetrics,
  forecastMetrics,
  pairedBootstrap,
  pairedObservations,
  reviewMetrics,
  type BenchmarkState,
  type BenchmarkPorts,
  type QuantInput,
} from "../src/index.js";
function fixture() {
  const now = 1790501470000,
    start = now - 70000;
  const input: QuantInput = {
    item: {
      kind: "btc-5m",
      slug: `btc-updown-5m-${start / 1000}`,
      windowStart: start,
      windowEnd: start + 300000,
      market: {
        id: "1",
        question: "Bitcoin Up or Down",
        rules: "Chainlink TWAP Up if greater than or equal",
        active: true,
        categoryIds: [],
        liquidity: 100,
        closesAt: new Date(start + 300000).toISOString(),
        outcomes: [
          { id: "up", label: "Up" },
          { id: "down", label: "Down" },
        ],
      },
    },
    rule: { version: 1, lookbackSeconds: 60, provenance: "fixture", tie: "up" },
    opening: { price: 100, observedAt: start, url: "fixture" },
    ticker: { price: 101, bid: 100.99, ask: 101.01, observedAt: now, url: "fixture" },
    candles: Array.from({ length: 61 }, (_, i) => ({
      time: start - (60 - i) * 60000,
      close: 100 * Math.exp((i % 2) * 0.0005),
    })),
    books: ["up", "down"].map((outcomeId) => ({
      outcomeId,
      observedAt: new Date(now).toISOString(),
      asks: [{ price: "0.40", size: "100" }],
      bids: [{ price: "0.39", size: "100" }],
    })),
    conditions: ["up", "down"].map((outcomeId, index) => ({
      marketId: "1",
      outcomeId,
      observedAt: new Date(now).toISOString(),
      minimumNotional: "1",
      tickSize: "0.01",
      feeRate: "0.07",
      feeExponent: 1,
      provenance: "fixture",
      resolution: { conditionId: `0x${"a".repeat(64)}`, outcomeIndex: index, outcomeCount: 2 },
    })),
    observedAt: now,
  };
  const state: BenchmarkState = {
    version: 4,
    protocol: "btc-decision-benchmark-v1",
    id: "test",
    createdAt: now,
    deadline: now + 7200000,
    settlementDeadline: now + 86400000,
    priorReservedUsd: 1,
    maxNewReservedUsd: 1.25,
    jevInputPerMillion: 0.042,
    paidStopped: null,
    evaluation: "completed",
    reviews: [],
    cases: [],
    slots: [],
    interruptions: [],
  };
  let calls = 0,
    snapshots = 0,
    tail: Promise<unknown> = Promise.resolve();
  const ports: BenchmarkPorts = {
    now: () => now,
    save: async () => {},
    guard: async () => {},
    versions: { current: "fixture-current", compact: "fixture-compact" },
    hash: async (s) => s,
    exclusive: <T>(fn: () => Promise<T>) => {
      const next = tail.then(fn);
      tail = next.catch(() => {});
      return next;
    },
    input: async () => {
      snapshots++;
      return structuredClone(input);
    },
    refresh: async (i) => i,
    review: async (_reviewer, _i, _f, _p, _s, report) => {
      calls++;
      const r = { status: "completed" as const, inputTokens: 100, outputTokens: 5, veto: false };
      await report(r);
      return r;
    },
  };
  return { now, input, state, ports, calls: () => calls, snapshots: () => snapshots };
}
test("four variants share forecast and refresh, but never share reviewer versions", async () => {
  const f = fixture();
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const r = f.state.cases[0]!;
  assert.equal(f.calls(), 2);
  assert.equal(f.snapshots(), 2);
  assert.equal(r.variants.length, 4);
  assert.ok(r.variants.every((d) => d.fill));
  assert.deepEqual(
    r.variants.map((d) => d.fill),
    Array(4).fill(r.variants[0]!.fill),
  );
  assert.equal(r.variants[0]!.reviewId, r.variants[1]!.reviewId);
  assert.notEqual(r.variants[1]!.reviewId, r.variants[2]!.reviewId);
  assert.equal(r.variants[3]!.reviewId, undefined);
  assert.equal(benchmarkReserved(f.state), (2 * 65536 * 0.042) / 1e6);
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 2);
});
test("central variants buy while conservative abstains without altering shared forecast", async () => {
  const f = fixture();
  f.input.ticker = { ...f.input.ticker, price: 100, bid: 99.99, ask: 100.01 };
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.equal(f.state.cases[0]!.variants[0]!.status, "abstained");
  assert.ok(
    f.state.cases[0]!.variants.slice(1).every((d) => d.fill && d.proposal!.decisionEdge! > 0.03),
  );
  assert.equal(f.calls(), 2);
});
test("valid poor vetos continue; D waits for same refresh and only determinism permits its fill", async () => {
  const f = fixture();
  let reviewed = 0;
  const original = f.ports.input;
  f.ports.review = async () => {
    reviewed++;
    return { status: "completed", inputTokens: 100, outputTokens: 5, veto: true };
  };
  f.ports.input = async (i, s) => {
    if (f.snapshots()) {
      assert.equal(reviewed, 2);
    }
    return original(i, s);
  };
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const r = f.state.cases[0]!;
  assert.equal(f.state.paidStopped, null);
  assert.equal(f.snapshots(), 2);
  assert.ok(
    r.variants
      .slice(0, 3)
      .every((d) => d.reasons.includes("JEV_MATERIAL_CONTRADICTION") && d.finalEdge !== undefined),
  );
  assert.equal(r.variants[3]!.status, "filled");
});
test("uncertainty does not veto; technical errors block all four variants and retain usage", async () => {
  for (const failed of [false, true]) {
    const f = fixture();
    f.ports.review = async (_r, _i, _f, _p, _s, report) => {
      const result = {
        status: "completed" as const,
        inputTokens: 100,
        outputTokens: 7,
        veto: false,
        answers: { example: { choice: "NOT_STATED", confidence: 0.2 } },
      };
      await report(result);
      if (failed) {
        throw new Error("secret must not appear");
      }
      return result;
    };
    await runBenchmarkCase(f.state, f.input.item, f.ports);
    assert.ok(
      f.state.cases[0]!.variants.every((d) =>
        failed ? d.status === "blocked" : d.status === "filled",
      ),
    );
    if (failed) {
      assert.equal(f.state.reviews[0]!.result!.outputTokens, 7);
      assert.equal(f.state.reviews[1]!.startedAt, null);
      assert.equal(f.snapshots(), 1);
      assert.equal(JSON.stringify(f.state).includes("secret must"), false);
    }
  }
});
test("joint budget and concurrent admission cannot favor D or overspend", async () => {
  const f = fixture();
  f.state.maxNewReservedUsd = 0.003;
  await Promise.all([
    runBenchmarkCase(f.state, f.input.item, f.ports),
    runBenchmarkCase(f.state, f.input.item, f.ports),
  ]);
  assert.equal(f.state.cases.length, 1);
  assert.equal(f.calls(), 0);
  assert.equal(benchmarkReserved(f.state), 0);
  assert.ok(f.state.cases[0]!.variants.every((d) => d.status === "blocked"));
  f.input.item.market.id = "free-next";
  f.input.conditions.forEach((c) => {
    c.marketId = "free-next";
  });
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.ok(f.state.cases[1]!.forecast);
  assert.equal(f.calls(), 0);
});
test("shared refreshed side, cap, edge and timing failures also exclude D", async () => {
  for (const change of ["side", "cap", "no-edge", "rules", "stale"]) {
    const f = fixture();
    let n = 0;
    f.ports.input = async () => {
      const input = structuredClone(f.input);
      if (n++) {
        if (change === "side") {
          input.ticker = { ...input.ticker, price: 99, bid: 98.99, ask: 99.01 };
        }
        if (change === "cap" || change === "no-edge") {
          input.books.forEach((b) => {
            b.asks = [{ price: "0.99", size: "100" }];
          });
        }
        if (change === "rules") {
          input.rule.lookbackSeconds = 30;
        }
        if (change === "stale") {
          input.ticker.observedAt -= 11000;
        }
      }
      return input;
    };
    await runBenchmarkCase(f.state, f.input.item, f.ports);
    assert.ok(f.state.cases[0]!.variants.every((d) => !d.fill));
  }
});
test("plugin revocation before refresh prevents all fills", async () => {
  const f = fixture();
  f.ports.review = async () => {
    f.ports.guard = async () => {
      throw new Error("revoked");
    };
    return { status: "completed", inputTokens: 1, outputTokens: 1, veto: false };
  };
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.ok(f.state.cases[0]!.variants.every((d) => !d.fill));
});
test("pending results, independent settlement and Brier are never quadruple-counted", async () => {
  const f = fixture();
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const r = f.state.cases[0]!;
  assert.equal(variantMetrics([r], "C").returnOnSettledCost, null);
  assert.equal(variantMetrics([r], "C").pendingPositions, 1);
  assert.equal(variantMetrics([r], "C").realizedPnl, null);
  assert.equal(variantMetrics([], "C").realizedPnl, null);
  assert.equal(pairedObservations([r], "C", "D").length, 0);
  r.resolutions = r.identities!.map((i) => ({
    ...i,
    numerator: i.outcomeId === "up" ? "1" : "0",
    denominator: "1",
    observedAt: new Date(f.now).toISOString(),
    chainId: 137,
    contract: `0x${"b".repeat(40)}`,
    blockNumber: "1",
    blockHash: `0x${"c".repeat(64)}`,
  }));
  settleBenchmarkCase(r, f.now);
  assert.ok(r.variants.every((d) => d.settlement));
  const metrics = forecastMetrics([r])[0]!;
  assert.equal(metrics.resolvedBinary, 1);
  assert.equal(
    metrics.calibration.reduce((s, b) => s + b.n, 0),
    1,
  );
  assert.equal(
    pairedObservations([r], "C", "D")[0]!.left,
    pairedObservations([r], "C", "D")[0]!.right,
  );
  const before = structuredClone(r.variants[0]!.settlement);
  settleBenchmarkCase(r, f.now + 1000);
  assert.deepEqual(r.variants[0]!.settlement, before);
});
test("known realized return and drawdown ignore pending capital and technical failures", async () => {
  const f = fixture();
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const rows = [5, -3, -4, 2].map((pnl, i) => {
    const row = structuredClone(f.state.cases[0]!);
    const d = row.variants[0]!;
    d.fill!.totalCost = "10";
    d.settlement = {
      version: 1,
      settledAt: f.now + i,
      payout: String(10 + pnl),
      realizedPnl: String(pnl),
      resolution: {} as never,
    };
    return row;
  });
  rows.push(f.state.cases[0]!);
  const result = variantMetrics(rows, "A");
  assert.equal(result.realizedPnl, 0);
  assert.equal(result.returnOnSettledCost, 0);
  assert.equal(result.maxRealizedDrawdown, 7);
  assert.equal(result.pendingPositions, 1);
  assert.equal(result.curve.length, 4);
});
test("paired UTC-hour bootstrap is seeded, excludes missing cases and enforces minimum sample", () => {
  const points = Array.from({ length: 6 }, (_, i) => ({
    market: String(i),
    at: i * 3600000,
    left: 2,
    right: 1,
    traded: true,
  }));
  const a = pairedBootstrap(points);
  assert.deepEqual(a, pairedBootstrap(points));
  assert.deepEqual(a.interval95, [1, 1]);
  assert.equal(a.supportedEconomicImprovement, false);
  assert.equal(a.classification, "favorable-exploratory");
  assert.throws(() => pairedBootstrap([...points, points[0]!]), /DUPLICATE/);
  assert.equal(pairedBootstrap([]).meanDifference, null);
});
test("review confusion metrics use valid labeled denominators and uncertainty is not approval", () => {
  const reviews = [true, false, true, false].map((veto, i) => ({
    id: String(i),
    phase: "heldout" as const,
    caseId: String(i),
    reviewer: "compact" as const,
    version: "1",
    contextHash: "hash",
    reservedUsd: 1,
    startedAt: 1,
    result: {
      status: "completed" as const,
      inputTokens: 1,
      outputTokens: 2,
      veto,
      answers: {
        test: { choice: "NOT_STATED", confidence: 0.5, probabilities: { NOT_STATED: 0.5 } },
      },
    },
  }));
  const r = reviewMetrics(
    reviews,
    new Map([
      ["0", true],
      ["1", true],
      ["2", false],
      ["3", false],
    ]),
  );
  assert.equal(r.detected, 1);
  assert.equal(r.missed, 1);
  assert.equal(r.falseVetos, 1);
  assert.equal(r.uncertain, 4);
  assert.equal(r.sensitivity, 0.5);
  assert.equal(r.falseVetoRate, 0.5);
});

test("interrupted calls and slots retain reservations and never return to pending", async () => {
  const f = fixture();
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const reserved = benchmarkReserved(f.state),
    deadline = f.state.deadline;
  f.state.cases[0]!.status = "started";
  f.state.reviews[0]!.result!.status = "started";
  f.state.slots = [
    { kind: "btc-5m", start: f.now - 70000, status: "started" },
    { kind: "btc-15m", start: f.now - 100000, status: "pending" },
  ];
  recoverBenchmark(f.state, f.now);
  assert.equal(f.state.cases[0]!.status, "interrupted");
  assert.deepEqual(
    f.state.slots.map((s) => s.status),
    ["interrupted", "missed"],
  );
  assert.equal(f.state.reviews[0]!.result!.status, "failed");
  assert.equal(benchmarkReserved(f.state), reserved);
  assert.equal(f.state.deadline, deadline);
  assert.equal(f.state.paidStopped, "INTERRUPTED");
});

test("different policy caps reserve all three reviews; no-edge markets call nobody", async () => {
  const f = fixture();
  f.input.ticker = { ...f.input.ticker, price: 100.02, bid: 100.019, ask: 100.021 };
  f.input.books.forEach((b) => {
    b.asks = [{ price: "0.01", size: "2000" }];
  });
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 3);
  assert.equal(new Set(f.state.cases[0]!.variants.slice(0, 3).map((d) => d.reviewId)).size, 3);
  const g = fixture();
  g.input.books.forEach((b) => {
    b.asks = [{ price: "0.99", size: "1000" }];
  });
  await runBenchmarkCase(g.state, g.input.item, g.ports);
  assert.equal(g.calls(), 0);
  assert.ok(g.state.cases[0]!.variants.every((d) => d.status === "abstained"));
});

test("known Brier/calibration and paired valid abstentions do not use future quotes", async () => {
  const f = fixture();
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  const row = f.state.cases[0]!;
  row.forecast!.probabilities[0]!.estimate = 0.75;
  row.resolutions = [
    {
      ...row.identities![0]!,
      numerator: "1",
      denominator: "1",
      observedAt: new Date(f.now).toISOString(),
      chainId: 137,
      contract: `0x${"b".repeat(40)}`,
      blockNumber: "1",
      blockHash: `0x${"c".repeat(64)}`,
    },
  ];
  const first = forecastMetrics([row])[0]!;
  assert.equal(first.brier, 0.0625);
  assert.equal(first.baseline50, 0.25);
  assert.equal(first.calibration[7]!.predicted, 0.75);
  row.input!.books[0]!.observedAt = new Date(f.now + 1).toISOString();
  assert.equal(forecastMetrics([row])[0]!.matchedQuotes, 0);
  row.variants.forEach((d) => {
    delete d.fill;
    d.status = "abstained";
  });
  assert.equal(pairedObservations([row], "C", "D")[0]!.left, 0);
  row.variants[2]!.status = "failed";
  assert.equal(pairedObservations([row], "C", "D").length, 0);
});

test("explicit continuation retains previous benchmark money and call ceilings", async () => {
  for (const prior of [{ priorBenchmarkReviewCount: 386 }, { priorBenchmarkReservedUsd: 1.25 }]) {
    const f = fixture();
    Object.assign(f.state, prior);
    await runBenchmarkCase(f.state, f.input.item, f.ports);
    assert.equal(f.calls(), 0);
    assert.equal(f.state.paidStopped, "API_BUDGET_EXHAUSTED");
    assert.equal(benchmarkReserved(f.state), 0);
  }
});

test("opt-in invalid answers block all variant purchases only for the affected market", async () => {
  const f = fixture();
  f.state.invalidAnswerPolicy = "block-case";
  const original = f.ports.review;
  let malformed = true;
  f.ports.review = async (...args) => {
    if (malformed && args[0] === "current") {
      await args[5]({
        status: "failed",
        reason: "JEV_INVALID_ANSWERS",
        inputTokens: 100,
        outputTokens: 5,
      });
      throw new PilotError("JEV_INVALID_ANSWERS", "Invalid answer");
    }
    return original(...args);
  };
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.equal(f.state.paidStopped, null);
  assert.equal(f.state.cases[0]!.status, "failed");
  assert.ok(f.state.cases[0]!.variants.every((d) => d.status === "blocked" && !d.fill));
  assert.equal(f.snapshots(), 1);
  malformed = false;
  f.input.item.market.id = "next-independent-market";
  f.input.conditions.forEach((c) => {
    c.marketId = f.input.item.market.id;
  });
  await runBenchmarkCase(f.state, f.input.item, f.ports);
  assert.ok(f.state.cases[1]!.variants.every((d) => d.status === "filled"));
  assert.equal(f.state.reviews.filter((r) => r.result?.status === "failed").length, 1);
});

test("unknown usage and transport failures still stop the entire opted-in study", async () => {
  for (const reason of ["JEV_INVALID_ANSWERS", "JEV_HTTP_FAILURE"]) {
    const f = fixture();
    f.state.invalidAnswerPolicy = "block-case";
    f.ports.review = async (...args) => {
      await args[5]({ status: "failed", reason, inputTokens: null, outputTokens: null });
      throw new PilotError(reason, "Failed");
    };
    await runBenchmarkCase(f.state, f.input.item, f.ports);
    assert.equal(f.state.paidStopped, reason);
    assert.ok(f.state.cases[0]!.variants.every((d) => !d.fill));
  }
});

test("a completed evaluation with errors is explicit and requires two valid contract probes", () => {
  const f = fixture();
  f.state.invalidAnswerPolicy = "block-case";
  f.state.evaluation = "completed_with_errors";
  f.state.reviews = Array.from({ length: 98 }, (_, i) => ({
    id: String(i),
    phase: i < 2 ? "contract" : "heldout",
    caseId: String(i),
    reviewer: i % 2 ? "compact" : "current",
    version: "fixture",
    contextHash: "fixture",
    reservedUsd: 0.003,
    startedAt: f.now,
    result: {
      status: i === 2 ? "failed" : "completed",
      reason: "JEV_INVALID_ANSWERS",
      inputTokens: 100,
      outputTokens: 5,
    },
  }));
  assert.equal(benchmarkEvaluationReady(f.state), true);
  f.state.invalidAnswerPolicy = "stop-study";
  assert.equal(benchmarkEvaluationReady(f.state), false);
  f.state.invalidAnswerPolicy = "block-case";
  f.state.reviews[0]!.result!.status = "failed";
  assert.equal(benchmarkEvaluationReady(f.state), false);
});
