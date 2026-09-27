import test from "node:test";
import assert from "node:assert/strict";
import {
  assertStudyMarket,
  caseReservation,
  recoverStudy,
  runStudyCase,
  settleStudy,
  type StudyState,
  type StudyMarket,
  type StudyPorts,
  type ModelAssessment,
  PilotError,
} from "../src/index.js";

function fixture() {
  const start = 1790501400000;
  let now = start + 10000;
  const item: StudyMarket = {
    kind: "btc-5m",
    slug: `btc-updown-5m-${start / 1000}`,
    windowStart: start,
    windowEnd: start + 300000,
    market: {
      id: "123",
      question: "Bitcoin Up or Down",
      rules: "Chainlink: Up if greater than or equal to the opening price",
      categoryIds: [],
      active: true,
      closesAt: new Date(start + 300000).toISOString(),
      liquidity: 100,
      outcomes: [
        { id: "up", label: "Up" },
        { id: "down", label: "Down" },
      ],
    },
  };
  const state: StudyState = {
    version: 1,
    config: {
      version: 1,
      id: "test",
      hours: 2,
      settlementGraceHours: 2,
      maxCases: 10,
      maxApiUsd: 5,
      pricing: { inputPerMillion: 1, outputPerMillion: 1, exaPerSearch: 0.01 },
      agents: [{ kind: "btc-5m", enabled: true, plugins: ["polymarket", "coinbase"] }],
    },
    createdAt: now,
    updatedAt: now,
    model: null,
    cases: [],
    events: [],
  };
  const assessment: ModelAssessment = {
    action: "TRADE",
    marketId: "123",
    outcomeId: "up",
    thesis: "Controlled favorable evidence",
    counterEvidence: "Reversal remains possible",
    uncertainty: "Fixture only",
    sourceIds: ["source"],
    observedPrice: "0.4",
    limitPrice: "0.5",
    expiresAt: new Date(now + 60000).toISOString(),
    abstentionReason: null,
    probability: { lower: 0.7, estimate: 0.75, upper: 0.8 },
    uncertaintyLevel: "LOW",
    missingInformation: [],
  };
  let calls = 0;
  const book = {
    outcomeId: "up",
    observedAt: new Date(now).toISOString(),
    bids: [],
    asks: [{ price: "0.4", size: "1000" }],
  };
  const ports: StudyPorts = {
    now: () => now,
    save: async () => {},
    guard: async () => {},
    discover: async () => [item],
    refresh: async () => item,
    evidence: async () => {
      assert.equal(state.cases[0]?.status, "started");
      return {
        sources: [
          {
            id: "source",
            url: "https://example.com",
            title: "Fixture",
            content: "Evidence",
            provider: "fixture",
            retrievedAt: new Date(now).toISOString(),
            publishedAt: null,
            truncated: false,
          },
        ],
        books: [book],
        limitations: [],
      };
    },
    forecast: async () => {
      calls++;
      return assessment;
    },
    book: async () => book,
    conditions: async () => ({
      marketId: "123",
      outcomeId: "up",
      observedAt: new Date(now).toISOString(),
      minimumNotional: "1",
      tickSize: "0.01",
      feeRate: "0",
      feeExponent: 1,
      provenance: "fixture",
      resolution: { conditionId: `0x${"1".repeat(64)}`, outcomeIndex: 0, outcomeCount: 2 },
    }),
    resolution: async () => null,
  };
  return {
    state,
    item,
    ports,
    assessment,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("prospective virtual fill, no duplicate paid research and pending resolution", async () => {
  const f = fixture();
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.state.cases[0]?.status, "filled");
  assert.equal(f.state.cases[0]?.paper?.fill?.totalCost, "10.00000000");
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.calls(), 1);
  f.advance(300000);
  await settleStudy(f.state, f.ports);
  assert.equal(f.state.cases[0]?.paper?.settlement, null);
  assert.equal(f.state.cases[0]?.resolutionAttempts, 1);
});
test("abstention retains forecast without inventing a buy", async () => {
  const f = fixture();
  f.assessment.action = "ABSTAIN";
  f.assessment.abstentionReason = "Insufficient edge";
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.state.cases[0]?.status, "abstained");
  assert.equal(f.state.cases[0]?.decision?.estimatedProbability, 0.75);
  assert.equal(f.state.cases[0]?.paper, undefined);
});
test("API reservation caps calls and interrupted attempts are not replayed", async () => {
  const f = fixture();
  f.state.config.maxApiUsd = caseReservation(f.state.config, "btc-5m") - 0.001;
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.calls(), 0);
  f.state.config.maxApiUsd = 5;
  await runStudyCase(f.state, f.item, f.ports);
  f.state.cases[0]!.status = "started";
  recoverStudy(f.state, f.ports.now());
  assert.equal(f.state.cases[0]?.status, "interrupted");
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.calls(), 1);
});
test("revocation after evidence prevents the model and preserves sources", async () => {
  const f = fixture();
  let guards = 0;
  f.ports.guard = async () => {
    if (++guards >= 3) {
      throw new PilotError("PLUGIN_DISABLED", "Disabled");
    }
  };
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.calls(), 0);
  assert.equal(f.state.cases[0]?.reason, "PLUGIN_DISABLED");
  assert.equal(f.state.cases[0]?.evidence?.sources.length, 1);
});
test("unknown citations and expiry beyond the window fail explicitly", async () => {
  for (const field of ["citations", "expiry"]) {
    const f = fixture();
    if (field === "citations") {
      f.assessment.sourceIds = ["invented"];
    } else {
      f.assessment.expiresAt = new Date(f.item.windowEnd + 1).toISOString();
    }
    await runStudyCase(f.state, f.item, f.ports);
    assert.equal(f.state.cases[0]?.status, "failed");
    assert.equal(f.state.cases[0]?.paper, undefined);
  }
});
test("crypto eligibility requires real-time window, exact slug and reviewed tie rule", () => {
  const f = fixture();
  assertStudyMarket(f.item, f.ports.now());
  for (const mutation of [
    (x: StudyMarket) => {
      x.slug = "invented";
    },
    (x: StudyMarket) => {
      x.market.rules = "Guess the price";
    },
    (x: StudyMarket) => {
      x.market.closesAt = null;
    },
  ]) {
    const item = structuredClone(f.item);
    mutation(item);
    assert.throws(() => assertStudyMarket(item, f.ports.now()));
  }
  assert.throws(() => assertStudyMarket(f.item, f.item.windowEnd - 89000));
  assert.throws(() => assertStudyMarket(f.item, f.item.windowStart! - 1));
});
test("provider errors are failures, not abstentions", async () => {
  const f = fixture();
  f.ports.forecast = async () => {
    throw new PilotError("MODEL_EMPTY_OUTPUT", "Empty");
  };
  await runStudyCase(f.state, f.item, f.ports);
  assert.equal(f.state.cases[0]?.status, "failed");
  assert.equal(f.state.cases[0]?.reason, "MODEL_EMPTY_OUTPUT");
});
