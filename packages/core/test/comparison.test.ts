import test from "node:test";
import assert from "node:assert/strict";
import {
  runComparisonCase,
  quantForecast,
  quantProposal,
  comparisonReserved,
  comparisonSlots,
  markMissedSlots,
  settleComparisonCase,
  type ComparisonState,
  type ComparisonPorts,
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
  const state: ComparisonState = {
    version: 3,
    protocol: "btc-policy-comparison-v1",
    id: "test",
    createdAt: now,
    deadline: now + 7200000,
    settlementDeadline: now + 86400000,
    priorReservedUsd: 1,
    maxNewReservedUsd: 0.25,
    jevInputPerMillion: 0.042,
    paidStopped: null,
    cases: [],
    slots: [],
    interruptions: [],
  };
  let calls = 0,
    snapshots = 0,
    tail: Promise<unknown> = Promise.resolve();
  const ports: ComparisonPorts = {
    now: () => now,
    save: async () => {},
    guard: async () => {},
    reviewerVersion: "fixture-v1",
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
    review: async (_i, _f, _p, _s, report) => {
      calls++;
      const r = { status: "completed" as const, inputTokens: 100, outputTokens: 5, veto: false };
      await report(r);
      return r;
    },
  };
  return { now, input, state, ports, calls: () => calls, snapshots: () => snapshots };
}
test("explicit policies leave forecast immutable, central buys when conservative abstains", () => {
  const f = fixture();
  f.input.ticker = { ...f.input.ticker, price: 100, bid: 99.99, ask: 100.01 };
  const forecast = quantForecast(f.input, f.now),
    original = structuredClone(forecast);
  const central = quantProposal(f.input, forecast, f.now, "central-v1");
  const conservative = quantProposal(f.input, forecast, f.now, "conservative-v1");
  assert.ok(central.proposal);
  assert.equal(conservative.proposal, null);
  assert.ok(central.proposal.decisionEdge! > 0.03);
  assert.ok(central.proposal.conservativeEdge < 0.03);
  assert.deepEqual(forecast, original);
});
test("identical proposals share one review and independently fill and settle", async () => {
  const f = fixture();
  await runComparisonCase(f.state, f.input.item, f.ports);
  const row = f.state.cases[0]!;
  assert.equal(f.calls(), 1);
  assert.equal(f.snapshots(), 2);
  assert.equal(row.policies.filter((d) => d.fill).length, 2);
  assert.equal(comparisonReserved(f.state), (65536 * 0.042) / 1e6);
  row.resolutions = row.identities!.map((i) => ({
    ...i,
    numerator: i.outcomeId === "up" ? "1" : "0",
    denominator: "1",
    observedAt: new Date(f.now).toISOString(),
    chainId: 137,
    contract: `0x${"b".repeat(40)}`,
    blockNumber: "1",
    blockHash: `0x${"c".repeat(64)}`,
  }));
  settleComparisonCase(row, f.now);
  assert.ok(row.policies.every((p) => p.settlement));
  assert.deepEqual(row.policies[0]!.settlement, row.policies[1]!.settlement);
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 1);
});
test("different limits require separate reviews with joint reservations", async () => {
  const f = fixture();
  f.input.ticker = { ...f.input.ticker, price: 100.02, bid: 100.019, ask: 100.021 };
  f.input.books.forEach((b) => {
    b.asks = [{ price: "0.01", size: "2000" }];
    b.bids = [];
  });
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 2);
  assert.equal(f.state.cases[0]!.reviews.length, 2);
  assert.notEqual(
    f.state.cases[0]!.policies[0]!.proposal!.limitPrice,
    f.state.cases[0]!.policies[1]!.proposal!.limitPrice,
  );
});
test("policies can select different outcomes without rewriting sensitivity", () => {
  const f = fixture(),
    forecast = quantForecast(f.input, f.now);
  forecast.probabilities = [
    { outcomeId: "up", label: "Up", lower: 0.2, estimate: 0.7, upper: 0.75 },
    { outcomeId: "down", label: "Down", lower: 0.25, estimate: 0.3, upper: 0.8 },
  ];
  f.input.books[1]!.asks = [{ price: "0.10", size: "1000" }];
  assert.equal(quantProposal(f.input, forecast, f.now, "central-v1").proposal!.outcomeId, "up");
  assert.equal(
    quantProposal(f.input, forecast, f.now, "conservative-v1").proposal!.outcomeId,
    "down",
  );
});
test("budget rejection blocks both policies but keeps subsequent free forecasts", async () => {
  const f = fixture();
  f.state.maxNewReservedUsd = 0.001;
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 0);
  assert.ok(f.state.cases[0]!.policies.every((p) => p.status === "blocked"));
  f.input.item.market.id = "2";
  f.input.conditions.forEach((c) => (c.marketId = "2"));
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.ok(f.state.cases[1]!.forecast);
  assert.equal(f.calls(), 0);
});
test("concurrent markets cannot overspend or duplicate market admission", async () => {
  const f = fixture();
  f.state.maxNewReservedUsd = (65536 * 0.042) / 1e6;
  await Promise.all([
    runComparisonCase(f.state, f.input.item, f.ports),
    runComparisonCase(f.state, f.input.item, f.ports),
    runComparisonCase(
      f.state,
      { ...f.input.item, market: { ...f.input.item.market, id: "2" } },
      {
        ...f.ports,
        input: async (item) => ({
          ...structuredClone(f.input),
          item,
          conditions: f.input.conditions.map((c) => ({ ...c, marketId: item.market.id })),
        }),
      },
    ),
  ]);
  assert.equal(f.state.cases.length, 2);
  assert.equal(f.calls(), 1);
  assert.ok(comparisonReserved(f.state) <= f.state.maxNewReservedUsd);
});
test("Jev technical failure stops paid calls and preserves reservation", async () => {
  const f = fixture();
  f.ports.review = async () => {
    throw new Error("secret");
  };
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.state.paidStopped, "JEV_REVIEW_FAILED");
  assert.ok(comparisonReserved(f.state) > 0);
  assert.equal(JSON.stringify(f.state).includes("secret"), false);
  assert.ok(f.state.cases[0]!.policies.every((p) => !p.fill));
});
test("veto prevents fill while valid uncertainty proceeds", async () => {
  const f = fixture();
  f.ports.review = async () => ({
    status: "completed",
    inputTokens: 1,
    outputTokens: 5,
    veto: true,
  });
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.ok(
    f.state.cases[0]!.policies.every((d) => d.reasons.includes("JEV_MATERIAL_CONTRADICTION")),
  );
  assert.equal(f.state.paidStopped, null);
});
test("refresh side changes and prices exceeding the original cap do not fill", async () => {
  for (const change of ["side", "price", "edge"]) {
    const f = fixture();
    let calls = 0;
    f.ports.input = async () => {
      const i = structuredClone(f.input);
      if (calls++) {
        if (change === "side") {
          i.ticker = { ...i.ticker, price: 99, bid: 98.99, ask: 99.01 };
        } else if (change === "edge") {
          i.ticker = { ...i.ticker, price: 100, bid: 99.99, ask: 100.01 };
          i.books.forEach((b) => (b.asks = [{ price: "0.99", size: "1000" }]));
        } else {
          i.books.forEach((b) => (b.asks = [{ price: "0.99", size: "1000" }]));
        }
      }
      return i;
    };
    await runComparisonCase(f.state, f.input.item, f.ports);
    assert.ok(f.state.cases[0]!.policies.every((d) => !d.fill));
  }
});
test("one-second future skew is allowed without altering timestamps; larger skew fails", () => {
  const f = fixture();
  f.input.ticker.observedAt = f.now + 1000;
  assert.ok(quantForecast(f.input, f.now));
  assert.equal(f.input.ticker.observedAt, f.now + 1000);
  f.input.ticker.observedAt++;
  assert.throws(() => quantForecast(f.input, f.now), /QUANT_TICKER_CLOCK_AHEAD/);
});
test("durable slots include both horizons, skip missed windows and never extend deadline", () => {
  const f = fixture(),
    start = f.input.item.windowStart!;
  f.state.slots = comparisonSlots(start, start + 7200000);
  assert.equal(f.state.slots.filter((s) => s.kind === "btc-5m").length, 24);
  assert.equal(f.state.slots.filter((s) => s.kind === "btc-15m").length, 8);
  const deadline = f.state.deadline;
  markMissedSlots(f.state, start + 7200000);
  assert.ok(f.state.slots.every((s) => s.status === "missed"));
  assert.equal(f.state.deadline, deadline);
});

test("no opportunity calls no reviewer and retains both policy reasons", async () => {
  const f = fixture();
  f.input.books.forEach((b) => (b.asks = [{ price: "0.99", size: "1000" }]));
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.calls(), 0);
  assert.ok(f.state.cases[0]!.policies.every((d) => d.status === "abstained" && d.reasons.length));
});

test("revocation after a review prevents either policy from filling", async () => {
  const f = fixture();
  f.ports.review = async () => {
    f.ports.guard = async () => {
      throw new Error("revoked");
    };
    return { status: "completed", inputTokens: 10, outputTokens: 5, veto: false };
  };
  await runComparisonCase(f.state, f.input.item, f.ports);
  assert.equal(f.state.cases[0]!.status, "failed");
  assert.ok(f.state.cases[0]!.policies.every((d) => !d.fill));
});
