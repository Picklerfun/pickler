import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createPaperService,
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
    await store.finish(run, evaluateDecision(assessment, "0.4", undefined, now), null, now);
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
