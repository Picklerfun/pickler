import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createPaperService,
  evaluateDecision,
  type Market,
  type ModelAssessment,
  type PaperMarketData,
  type PaperRepository,
} from "@pickler/core";
import { PostgresPaperStore } from "../src/persistence/paper-store.js";
import { createTestStore } from "./database.js";

async function setup(t: TestContext) {
  let now = Date.parse("2026-09-28T12:00:00Z");
  const store = await createTestStore(t, () => now);
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  await store.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    categoryIds: ["1"],
    plugins: { version: 1, enabled: ["polymarket", "exa", "paper-trading"] },
  });
  const market = (id: string): Market => ({
    id,
    question: `Fixture ${id}`,
    rules: "Fixture",
    categoryIds: ["1"],
    active: true,
    closesAt: new Date(now + 3600000).toISOString(),
    liquidity: 1,
    outcomes: [{ id: `${id}0`, label: "Yes" }],
  });
  const assessment = (marketId: string): ModelAssessment => ({
    action: "TRADE",
    marketId,
    outcomeId: `${marketId}0`,
    thesis: "Synthetic evidence",
    counterEvidence: "Synthetic downside",
    uncertainty: "Low",
    sourceIds: ["fixture"],
    probability: { lower: 0.7, estimate: 0.75, upper: 0.8 },
    uncertaintyLevel: "LOW",
    missingInformation: [],
    observedPrice: "0.4",
    limitPrice: "0.45",
    expiresAt: new Date(now + 300000).toISOString(),
    abstentionReason: null,
  });
  const makeRun = async (marketId: string) => {
    await store.enqueue(scope, `run-${marketId}`, marketId, now);
    const run = (await store.claim(now))!;
    await store.finish(
      run,
      evaluateDecision(assessment(marketId), "0.4", undefined, now),
      null,
      now,
    );
    return run;
  };
  const markets: PaperMarketData = {
    categories: async () => [],
    list: async () => [],
    get: async (id) => market(id),
    book: async (outcomeId) => ({
      outcomeId,
      observedAt: new Date(now).toISOString(),
      bids: [],
      asks: [{ price: "0.4", size: "100" }],
    }),
    conditions: async (marketId, outcomeId) => ({
      marketId,
      outcomeId,
      observedAt: new Date(now).toISOString(),
      minimumNotional: "1",
      resolution: { conditionId: "0x" + "a".repeat(64), outcomeIndex: 0, outcomeCount: 2 },
      tickSize: "0.01",
      feeRate: "0.05",
      feeExponent: 1,
      provenance: `https://example.com/${marketId}`,
    }),
  };
  const paper = new PostgresPaperStore(store.pool, () => now);
  const service = createPaperService(paper, markets, () => now);
  return {
    store,
    scope,
    makeRun,
    paper,
    markets,
    now: () => now,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("without caps an order spends the fixed 10 AUSD budget", async (t) => {
  const f = await setup(t);
  const run = await f.makeRun("1");
  const order = await f.service.create("alpha", run.id, "k1");
  assert.equal(order.status, "filled");
  assert.ok(Number(order.fill!.totalCost) > 9.99);
});

test("an order is sized at the per-trade cap", async (t) => {
  const f = await setup(t);
  await f.store.updateSpend(f.scope, { perCallAusd: 5, perDayAusd: 20 });
  const run = await f.makeRun("1");
  const order = await f.service.create("alpha", run.id, "k1");
  assert.equal(order.status, "filled");
  assert.ok(Number(order.fill!.totalCost) <= 5);
  assert.ok(Number(order.fill!.totalCost) >= 4.99);
});

test("the order past the day's cap is refused, and a new UTC day starts a new sum", async (t) => {
  const f = await setup(t);
  await f.store.updateSpend(f.scope, { perCallAusd: 5, perDayAusd: 10 });
  for (const id of ["1", "2"]) {
    const run = await f.makeRun(id);
    assert.equal((await f.service.create("alpha", run.id, `k${id}`)).status, "filled");
  }
  const third = await f.makeRun("3");
  await assert.rejects(f.service.create("alpha", third.id, "k3"), { code: "DAILY_CAP_REACHED" });

  f.advance(12 * 3600_000 + 1_000); // 2026-09-29T00:00:01Z
  const next = await f.makeRun("4");
  assert.equal((await f.service.create("alpha", next.id, "k4")).status, "filled");
});

test("a pending order counts toward the day's sum and blocks the next", async (t) => {
  const f = await setup(t);
  await f.store.updateSpend(f.scope, { perCallAusd: 5, perDayAusd: 5 });
  const first = await f.makeRun("1");
  const pending = await f.paper.begin("alpha", first.id, "k1");
  assert.equal(pending.order.status, "pending");
  const second = await f.makeRun("2");
  await assert.rejects(f.service.create("alpha", second.id, "k2"), { code: "DAILY_CAP_REACHED" });
});

test("the fill spends the budget the daily check admitted, even if the cap rises after", async (t) => {
  const f = await setup(t);
  await f.store.updateSpend(f.scope, { perCallAusd: 5, perDayAusd: 10 });
  const raised: PaperRepository = {
    begin: async (tenantId, runId, key) => {
      const begun = await f.paper.begin(tenantId, runId, key);
      await f.store.updateSpend(f.scope, { perCallAusd: 10, perDayAusd: 10 });
      return begun;
    },
    get: (tenantId, runId) => f.paper.get(tenantId, runId),
    guard: (order) => f.paper.guard(order),
    finish: (order, status, fill, reason) => f.paper.finish(order, status, fill, reason),
  };
  const run = await f.makeRun("1");
  const order = await createPaperService(raised, f.markets, f.now).create("alpha", run.id, "k1");
  assert.equal(order.status, "filled");
  assert.ok(Number(order.fill!.totalCost) <= 5);
  assert.ok(Number(order.fill!.totalCost) >= 4.99);
});
