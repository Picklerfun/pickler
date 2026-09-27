import test from "node:test";
import assert from "node:assert/strict";
import {
  quantForecast,
  quantProposal,
  normalCdf,
  runQuantCase,
  type QuantInput,
  type QuantState,
  type QuantPorts,
} from "../src/index.js";
function fixture(side = "up") {
  const start = 1790501400000,
    now = start + 70000;
  const input: QuantInput = {
    item: {
      kind: "btc-5m",
      slug: `btc-updown-5m-${start / 1000}`,
      windowStart: start,
      windowEnd: start + 300000,
      market: {
        id: "1",
        question: "Bitcoin Up or Down",
        rules: "Chainlink BTC/USD TWAP: Up if greater than or equal",
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
    ticker: {
      price: side === "up" ? 101 : 99,
      bid: side === "up" ? 100.99 : 98.99,
      ask: side === "up" ? 101.01 : 99.01,
      observedAt: now,
      url: "fixture",
    },
    candles: Array.from({ length: 61 }, (_, i) => ({
      time: start - (60 - i) * 60000,
      close: 100 * Math.exp((i % 2) * 0.0005),
    })),
    books: ["up", "down"].map((outcomeId) => ({
      outcomeId,
      observedAt: new Date(now).toISOString(),
      asks: [
        { price: "0.40", size: "100" },
        { price: "0.42", size: "100" },
      ],
      bids: [{ price: "0.39", size: "100" }],
    })),
    conditions: ["up", "down"].map((outcomeId, index) => ({
      marketId: "1",
      outcomeId,
      observedAt: new Date(now).toISOString(),
      minimumNotional: "1",
      minimumShares: "1",
      tickSize: "0.01",
      feeRate: "0.07",
      feeExponent: 1 as const,
      provenance: "fixture",
      resolution: { conditionId: `0x${"a".repeat(64)}`, outcomeIndex: index, outcomeCount: 2 },
    })),
    observedAt: now,
  };
  const state: QuantState = {
    version: 2,
    protocol: "btc-quant-jev-v1",
    id: "test",
    createdAt: now,
    deadline: now + 7200000,
    settlementDeadline: now + 86400000,
    priorReservedUsd: 1,
    maxNewReservedUsd: 0.1,
    jevInputPerMillion: 0.042,
    cases: [],
    paidStopped: false,
  };
  let reviews = 0;
  const ports: QuantPorts = {
    now: () => now,
    save: async () => {},
    guard: async () => {},
    input: async () => structuredClone(input),
    refresh: async () => input.item,
    review: async (_i, _f, _p, _s, report) => {
      reviews++;
      const r = { status: "completed" as const, inputTokens: 100, outputTokens: 34, veto: false };
      await report(r);
      return r;
    },
  };
  return { now, input, state, ports, reviews: () => reviews };
}
test("normal CDF, exact tie, complement and sensitivity are reproducible", () => {
  assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normalCdf(1.96) - 0.9750021048517795) < 1e-6);
  const f = fixture();
  f.input.ticker.price = 100;
  f.input.ticker.bid = 99.99;
  f.input.ticker.ask = 100.01;
  const a = quantForecast(f.input, f.now),
    p = a.probabilities;
  assert.ok(Math.abs(p[0]!.estimate - 0.5) < 1e-7);
  assert.equal(p[0]!.estimate + p[1]!.estimate, 1);
  assert.ok(p[0]!.lower < p[0]!.estimate && p[0]!.upper > p[0]!.estimate);
  assert.deepEqual(a, quantForecast(f.input, f.now));
  f.input.rule.lookbackSeconds = 30;
  assert.notEqual(a.probabilities[0]!.lower, quantForecast(f.input, f.now).probabilities[0]!.lower);
});
for (const side of ["up", "down"]) {
  test(`quantitative ${side} purchase is reviewed and filled once`, async () => {
    const f = fixture(side);
    await runQuantCase(f.state, f.input.item, f.ports);
    assert.equal(f.state.cases[0]!.status, "filled");
    assert.equal(f.state.cases[0]!.fill!.book.outcomeId, side);
    assert.ok(Number(f.state.cases[0]!.fill!.fees) > 0);
    await runQuantCase(f.state, f.input.item, f.ports);
    assert.equal(f.reviews(), 1);
  });
}
test("no edge persists forecast without calling Jev", async () => {
  const f = fixture();
  for (const b of f.input.books) {
    b.asks = [{ price: "0.99", size: "1000" }];
  }
  await runQuantCase(f.state, f.input.item, f.ports);
  assert.equal(f.state.cases[0]!.status, "abstained");
  assert.ok(f.state.cases[0]!.forecast);
  assert.equal(f.reviews(), 0);
});
test("stale ticker, gaps and zero volatility fail explicitly", () => {
  for (const mutate of [
    (i: QuantInput) => {
      i.ticker.observedAt -= 10001;
    },
    (i: QuantInput) => {
      i.candles[2]!.time += 60000;
    },
    (i: QuantInput) => {
      i.candles.forEach((c) => (c.close = 100));
    },
  ]) {
    const f = fixture();
    mutate(f.input);
    assert.throws(() => quantForecast(f.input, f.now));
  }
});
test("veto and budget reject purchases; failure preserves reservation and stops paid work", async () => {
  const a = fixture();
  a.ports.review = async () => ({
    status: "completed",
    inputTokens: 3,
    outputTokens: 34,
    veto: true,
  });
  await runQuantCase(a.state, a.input.item, a.ports);
  assert.equal(a.state.cases[0]!.reason, "JEV_MATERIAL_CONTRADICTION");
  const b = fixture();
  b.state.priorReservedUsd = 5;
  await runQuantCase(b.state, b.input.item, b.ports);
  assert.equal(b.reviews(), 0);
  assert.equal(b.state.cases[0]!.reason, "API_BUDGET_EXHAUSTED");
  const c = fixture();
  c.ports.review = async () => {
    throw new Error("fixture");
  };
  await runQuantCase(c.state, c.input.item, c.ports);
  assert.equal(c.state.paidStopped, true);
  assert.ok(c.state.cases[0]!.reservedUsd > 0);
});
test("refresh loses edge and revocation blocks final fill", async () => {
  const a = fixture();
  let calls = 0;
  a.ports.input = async () => {
    const i = structuredClone(a.input);
    if (calls++) {
      i.ticker.price = 100;
      i.ticker.bid = 99.99;
      i.ticker.ask = 100.01;
    }
    return i;
  };
  await runQuantCase(a.state, a.input.item, a.ports);
  assert.equal(a.state.cases[0]!.status, "abstained");
  const b = fixture();
  b.ports.review = async () => {
    b.ports.guard = async () => {
      throw new Error("revoked");
    };
    return { status: "completed", inputTokens: 3, outputTokens: 3, veto: false };
  };
  await runQuantCase(b.state, b.input.item, b.ports);
  assert.equal(b.state.cases[0]!.status, "failed");
  assert.equal(b.state.cases[0]!.fill, undefined);
});
test("depth and minimum are respected", () => {
  const f = fixture();
  f.input.books[0]!.asks = [{ price: "0.4", size: "1" }];
  assert.equal(quantProposal(f.input, quantForecast(f.input, f.now), f.now).proposal, null);
});
