import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createPaperService,
  createPaperSettlementService,
  type PaperResolution,
  evaluateDecision,
  type ModelAssessment,
  type PaperMarketData,
} from "@pickler/core";
import { PostgresPaperStore } from "../src/persistence/paper-store.js";
import { createTestStore } from "./database.js";
async function setup(t: TestContext) {
  let now = Date.now();
  const store = await createTestStore(t, () => now);
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  await store.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    categoryIds: ["1"],
    plugins: { version: 1, enabled: ["polymarket", "exa", "paper-trading"] },
  });
  const assessment: ModelAssessment = {
    action: "TRADE",
    marketId: "1",
    outcomeId: "2",
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
  };
  const makeRun = async (key: string) => {
    await store.enqueue(scope, key, "1", now);
    const run = (await store.claim(now))!;
    await store.finish(
      run,
      evaluateDecision(
        { ...assessment, expiresAt: new Date(now + 300000).toISOString() },
        "0.4",
        undefined,
        now,
      ),
      null,
      now,
    );
    return run;
  };
  const run = await makeRun("fixture");
  const repository = new PostgresPaperStore(store.pool, () => now);
  let providerCalls = 0;
  const markets: PaperMarketData = {
    categories: async () => [],
    list: async () => [],
    get: async () => {
      providerCalls++;
      return {
        id: "1",
        question: "Fixture",
        rules: "Fixture",
        categoryIds: ["1"],
        active: true,
        closesAt: new Date(now + 3600000).toISOString(),
        liquidity: 1,
        outcomes: [{ id: "2", label: "Yes" }],
      };
    },
    book: async () => {
      providerCalls++;
      return {
        outcomeId: "2",
        observedAt: new Date(now).toISOString(),
        bids: [],
        asks: [{ price: "0.4", size: "100" }],
      };
    },
    conditions: async () => {
      providerCalls++;
      return {
        marketId: "1",
        outcomeId: "2",
        observedAt: new Date(now).toISOString(),
        minimumNotional: "1",
        resolution: { conditionId: "0x" + "a".repeat(64), outcomeIndex: 0, outcomeCount: 2 },
        tickSize: "0.01",
        feeRate: "0.05",
        feeExponent: 1,
        provenance: "https://example.com/1",
      };
    },
  };
  return {
    store,
    repository,
    scope,
    run,
    markets,
    makeRun,
    time: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    calls: () => providerCalls,
    service: createPaperService(repository, markets, () => now),
  };
}
test("one idempotent fill with public isolation and unchanged research", async (t) => {
  const f = await setup(t);
  const original = await f.store.run("alpha", f.run.id);
  const first = await f.service.create("alpha", f.run.id, "key");
  assert.equal(first.status, "filled");
  assert.equal(f.calls(), 3);
  assert.deepEqual(await f.service.create("alpha", f.run.id, "key"), first);
  assert.equal(f.calls(), 3);
  await assert.rejects(f.service.create("alpha", f.run.id, "other"), { code: "CONFLICT" });
  await assert.rejects(f.service.get("beta", f.run.id), { code: "NOT_FOUND" });
  await assert.rejects(f.service.create("beta", f.run.id, "key"), { code: "NOT_FOUND" });
  assert.deepEqual(await f.store.run("alpha", f.run.id), original);
  assert.equal(JSON.stringify(first).includes("lease"), false);
});
test("independent consumers cannot duplicate pending reservations or open positions", async (t) => {
  const f = await setup(t);
  const peer = new PostgresPaperStore(f.store.connectPeer().pool, f.time);
  const claims = await Promise.all([
    f.repository.begin("alpha", f.run.id, "key"),
    peer.begin("alpha", f.run.id, "key"),
  ]);
  assert.equal(claims.filter((c) => c.owned).length, 1);
  const second = await f.makeRun("second");
  await assert.rejects(peer.begin("alpha", second.id, "second"), { code: "CONFLICT" });
});
test("expired reservations become interrupted; stale owners cannot finalize or reacquire", async (t) => {
  const f = await setup(t);
  const claim = await f.repository.begin("alpha", f.run.id, "key");
  f.advance(60001);
  await assert.rejects(f.repository.guard(claim.order), { code: "LEASE_LOST" });
  await assert.rejects(f.repository.finish(claim.order, "failed", null, "test"), {
    code: "LEASE_LOST",
  });
  assert.equal((await f.repository.get("alpha", f.run.id)).status, "interrupted");
  assert.equal((await f.repository.begin("alpha", f.run.id, "key")).owned, false);
});
test("plugin disablement in flight blocks a new fill and preserves historical research", async (t) => {
  const f = await setup(t);
  const original = await f.store.run("alpha", f.run.id);
  const book = f.markets.book;
  f.markets.book = async (...args) => {
    const result = await book(...args);
    const agent = await f.store.agent(f.scope);
    await f.store.updateConfig(f.scope, agent.version, {
      ...agent.config,
      plugins: { version: 1, enabled: ["polymarket", "exa"] },
    });
    return result;
  };
  const order = await f.service.create("alpha", f.run.id, "key");
  assert.equal(order.status, "failed");
  assert.equal(order.fill, null);
  assert.equal(order.reason, "PLUGIN_DISABLED");
  assert.deepEqual(await f.store.run("alpha", f.run.id), original);
  assert.equal((await f.service.get("alpha", f.run.id)).status, "failed");
});
test("provider failures and absent depth do not manufacture positions", async (t) => {
  const f = await setup(t);
  f.markets.book = async () => {
    throw new Error("provider unavailable");
  };
  const order = await f.service.create("alpha", f.run.id, "key");
  assert.equal(order.status, "failed");
  assert.equal(order.fill, null);
  const second = await f.makeRun("second");
  f.markets.book = async () => ({
    outcomeId: "2",
    observedAt: new Date(f.time()).toISOString(),
    asks: [],
    bids: [],
  });
  assert.equal((await f.service.create("alpha", second.id, "second")).status, "not_filled");
});

test("paused agents and expired decisions reject before provider calls", async (t) => {
  const f = await setup(t);
  await f.store.pause(f.scope, true);
  await assert.rejects(f.service.create("alpha", f.run.id, "key"), { code: "CONFIG_CHANGED" });
  assert.equal(f.calls(), 0);
  await f.store.pause(f.scope, false);
  f.advance(300001);
  await assert.rejects(f.service.create("alpha", f.run.id, "key"), { code: "PAPER_NOT_ELIGIBLE" });
  assert.equal(f.calls(), 0);
});
test("finalization atomically rechecks plugin authorization and scheduler recovers only expired paper attempts", async (t) => {
  const f = await setup(t);
  const claim = await f.repository.begin("alpha", f.run.id, "key");
  const agent = await f.store.agent(f.scope);
  await f.store.updateConfig(f.scope, agent.version, {
    ...agent.config,
    plugins: { version: 1, enabled: ["exa"] },
  });
  await assert.rejects(f.repository.finish(claim.order, "not_filled", null, "fixture"), {
    code: "PLUGIN_DISABLED",
  });
  await f.store.recover(f.time());
  assert.equal((await f.repository.get("alpha", f.run.id)).status, "pending");
  f.advance(60001);
  await f.store.recover(f.time());
  assert.equal((await f.repository.get("alpha", f.run.id)).status, "interrupted");
});

function resolution(now: number, numerator = "1", denominator = "1"): PaperResolution {
  return {
    marketId: "1",
    outcomeId: "2",
    conditionId: "0x" + "a".repeat(64),
    outcomeIndex: 0,
    numerator,
    denominator,
    observedAt: new Date(now).toISOString(),
    chainId: 137,
    contract: "0x" + "c".repeat(40),
    blockNumber: "100",
    blockHash: "0x" + "b".repeat(64),
  };
}

test("full paper lifecycle: immutable buy, pending resolution, concurrent idempotent settlement and isolated P&L", async (t) => {
  const f = await setup(t);
  const bought = await f.service.create("alpha", f.run.id, "buy");
  const research = await f.store.run("alpha", f.run.id);
  let resolved = false;
  let calls = 0;
  const provider = {
    resolution: async () => {
      calls++;
      return resolved ? resolution(f.time()) : null;
    },
  };
  const service = createPaperSettlementService(f.repository, provider);
  assert.equal((await service.settle("alpha", f.run.id)).settlement, null);
  let summary = await service.summary(f.scope);
  assert.equal(summary.open, 1);
  assert.equal(summary.realizedPnl, "0.00000000");
  assert.equal(summary.totalCost, bought.fill!.totalCost);
  await assert.rejects(service.settle("beta", f.run.id), { code: "NOT_FOUND" });
  assert.equal(calls, 1);
  resolved = true;
  // A result is allowed after the research proposal expires; it cannot authorize another buy.
  f.advance(400000);
  const peer = new PostgresPaperStore(f.store.connectPeer().pool, f.time);
  const other = createPaperSettlementService(peer, provider);
  const [first, duplicate] = await Promise.all([
    service.settle("alpha", f.run.id),
    other.settle("alpha", f.run.id),
  ]);
  assert.deepEqual(first, duplicate);
  assert.equal(first.status, "filled");
  assert.deepEqual(first.fill, bought.fill);
  assert.ok(Number(first.settlement!.realizedPnl) > 0);
  const called = calls;
  assert.deepEqual(await service.settle("alpha", f.run.id), first);
  assert.equal(calls, called);
  summary = await service.summary(f.scope);
  assert.equal(summary.open, 0);
  assert.equal(summary.settled, 1);
  assert.equal(summary.payouts, first.settlement!.payout);
  assert.equal((await service.summary({ tenantId: "beta", agentId: "pickle-beta" })).filled, 0);
  await assert.rejects(service.summary({ tenantId: "beta", agentId: "pickle-alpha" }), {
    code: "NOT_FOUND",
  });
  assert.deepEqual(await f.store.run("alpha", f.run.id), research);
  const next = await f.makeRun("next");
  assert.equal((await f.service.create("alpha", next.id, "next")).status, "filled");
});

for (const [numerator, denominator, expected] of [
  ["0", "1", "loss"],
  ["1", "2", "split"],
]) {
  test(`paper ${expected} uses the payout fraction, not a fabricated refund`, async (t) => {
    const f = await setup(t);
    const order = await f.service.create("alpha", f.run.id, "buy");
    const service = createPaperSettlementService(f.repository, {
      resolution: async () => resolution(f.time(), numerator, denominator),
    });
    const settled = await service.settle("alpha", f.run.id);
    if (expected === "loss") {
      assert.equal(settled.settlement!.payout, "0.00000000");
      assert.equal(settled.settlement!.realizedPnl, "-" + order.fill!.totalCost);
    } else {
      assert.ok(
        Math.abs(Number(settled.settlement!.payout) - Number(order.fill!.quantity) / 2) < 0.000001,
      );
    }
  });
}

test("plugin revocation during settlement blocks commit; history remains readable", async (t) => {
  const f = await setup(t);
  const original = await f.service.create("alpha", f.run.id, "buy");
  let calls = 0;
  const service = createPaperSettlementService(f.repository, {
    resolution: async () => {
      calls++;
      const agent = await f.store.agent(f.scope);
      await f.store.updateConfig(f.scope, agent.version, {
        ...agent.config,
        plugins: { version: 1, enabled: ["exa"] },
      });
      return resolution(f.time());
    },
  });
  await assert.rejects(service.settle("alpha", f.run.id), { code: "PLUGIN_DISABLED" });
  assert.deepEqual(await f.service.get("alpha", f.run.id), original);
  await assert.rejects(service.settle("alpha", f.run.id), { code: "PLUGIN_DISABLED" });
  assert.equal(calls, 1);
  assert.equal((await service.summary(f.scope)).open, 1);
});

test("invalid resolution and provider failures preserve an open position", async (t) => {
  const f = await setup(t);
  const original = await f.service.create("alpha", f.run.id, "buy");
  for (const invalid of [
    { outcomeId: "other" },
    { denominator: "0" },
    { numerator: "2" },
    { observedAt: "bad" },
  ]) {
    const service = createPaperSettlementService(f.repository, {
      resolution: async () => ({ ...resolution(f.time()), ...invalid }),
    });
    await assert.rejects(service.settle("alpha", f.run.id), { code: "PAPER_INVALID_SETTLEMENT" });
  }
  const failed = createPaperSettlementService(f.repository, {
    resolution: async () => {
      throw new Error("offline");
    },
  });
  await assert.rejects(failed.settle("alpha", f.run.id));
  assert.deepEqual(await f.service.get("alpha", f.run.id), original);
});

test("scoped soccer trade passes buy, final scope checks and the public response schema", async (t) => {
  const f = await setup(t);
  const agent = await f.store.agent(f.scope);
  const { categoryIds, ...config } = agent.config;
  assert.ok(categoryIds);
  await f.store.updateConfig(f.scope, agent.version, {
    ...config,
    marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
  });
  const run = await f.makeRun("soccer");
  const get = f.markets.get;
  f.markets.get = async (...args) => ({
    ...(await get(...args)),
    sportsMarketType: "moneyline",
    timingSource: "polymarket.gameStartTime",
    startsAt: new Date(f.time() + 3600000).toISOString(),
    rules: "Team A wins in regulation time (90 minutes). A draw resolves No.",
    classification: {
      version: 1,
      category: "sports",
      subcategory: "soccer",
      temporalClass: "match",
      provenance: {
        provider: "polymarket",
        mappingVersion: "1.0.0",
        tagIds: ["100350"],
        temporalBasis: "sportsMarketType",
      },
    },
  });
  const result = await f.service.create("alpha", run.id, "soccer");
  assert.equal(result.status, "filled", result.reason ?? "");
  const { paperOrderSchema } = await import("@pickler/api-schema");
  assert.equal(paperOrderSchema.safeParse(result).success, true);
});
