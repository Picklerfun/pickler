import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CONFIG,
  createTradingService,
  moneyMicros,
  assertLivePreview,
  type LivePreview,
  type TradingProvider,
  type Reconciliation,
  type Decision,
} from "@pickler/core";
import { PostgresTradingStore } from "../src/persistence/trading-store.js";
import { createTestStore } from "./database.js";

const identity = { wallet: `0x${"a".repeat(40)}`, signer: `0x${"b".repeat(40)}` };
const hash = `0x${"1".repeat(64)}`;
const settled: Reconciliation = {
  status: "settled",
  fill: { shares: "10", costUpperBound: "5", transactionHashes: [`0x${"2".repeat(64)}`] },
};
async function setup(t: TestContext) {
  let now = Date.now();
  const store = await createTestStore(t, () => now);
  const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
  await store.updateConfig(scope, 1, {
    ...DEFAULT_CONFIG,
    categoryIds: ["1"],
    researchProtocol: "nfl-winner-v1",
    discoveryPolicy: { version: 1, mode: "pre-event", minLeadMinutes: 15, maxHorizonDays: 7 },
    plugins: { version: 1, enabled: ["polymarket", "exa", "polymarket-trading"] },
    trading: { version: 1, mode: "manual" },
  });
  const repository = new PostgresTradingStore(store.pool, () => now);
  await repository.bind(scope, identity);
  const preview = (): LivePreview => ({
    marketId: "1",
    outcomeId: "2",
    limitPrice: "0.5",
    budget: "5",
    estimatedFee: "0.1",
    estimatedShares: "10",
    observedAt: now,
    market: {
      id: "1",
      question: "NFL Lions vs Bills",
      rules: "Full game NFL winner",
      sportsMarketType: "moneyline",
      startsAt: new Date(now + 1800000).toISOString(),
      timingSource: "polymarket.gameStartTime",
      categoryIds: ["1"],
      active: true,
      closesAt: new Date(now + 3600000).toISOString(),
      liquidity: 100,
      outcomes: [{ id: "2", label: "Lions" }],
    },
  });
  const calls = { sign: 0, submit: 0, preview: 0 };
  const provider: TradingProvider = {
    identity: () => identity,
    check: async () => ({ balance: "10", approved: true, blocked: false }),
    preview: async () => {
      calls.preview++;
      return preview();
    },
    sign: async () => {
      calls.sign++;
      return { hash, payload: { controlled: true } };
    },
    submit: async () => {
      calls.submit++;
    },
    reconcile: async () => settled,
  };
  const service = createTradingService(repository, provider, () => now);
  const prepare = () => service.prepare(scope, preview(), "manual");
  const disable = async () => {
    const agent = await store.agent(scope);
    await store.updateConfig(scope, agent.version, {
      ...agent.config,
      trading: { version: 1, mode: "off" },
    });
  };
  return {
    store,
    repository,
    scope,
    preview,
    provider,
    service,
    calls,
    prepare,
    disable,
    time: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
test("trading uses exact decimal limits and rejects invalid quote timestamps", async (t) => {
  const f = await setup(t);
  assert.equal(moneyMicros("4.123456"), 4123456);
  for (const value of ["-1", "1e2", "0.0000001", "9007199254740992"]) {
    assert.throws(() => moneyMicros(value));
  }
  const agent = await f.store.agent(f.scope);
  assert.throws(() => assertLivePreview({ ...f.preview(), observedAt: NaN }, agent, f.time()), {
    code: "STALE_QUOTE",
  });
  assert.throws(() => assertLivePreview({ ...f.preview(), budget: "5.000001" }, agent, f.time()), {
    code: "TRADING_LIMIT",
  });
  assert.throws(() =>
    assertLivePreview(
      { ...f.preview(), market: { ...f.preview().market, sportsMarketType: "spread" } },
      agent,
      f.time(),
    ),
  );
});
test("duplicate requests and independent claimers execute one manual order with isolated history", async (t) => {
  const f = await setup(t);
  const [a, b] = await Promise.all([f.prepare(), f.prepare()]);
  assert.equal(a.id, b.id);
  await Promise.all([
    f.service.submit("alpha", a.id, "submit"),
    f.service.submit("alpha", a.id, "submit"),
  ]);
  const peer = new PostgresTradingStore(f.store.connectPeer().pool, f.time);
  const claims = await Promise.all([f.repository.claim(), peer.claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const owner = claims[0] ? f.repository : peer;
  await assert.rejects(f.service.get("beta", a.id), { code: "NOT_FOUND" });
  await assert.rejects(f.service.submit("beta", a.id, "submit"), { code: "NOT_FOUND" });
  await owner.markSubmitting(claims.find(Boolean)!, hash);
  await owner.complete({ ...a, orderHash: hash }, settled);
  assert.equal((await f.service.get("alpha", a.id)).status, "settled");
  const account = await f.repository.account(f.scope);
  assert.equal(account.spentMicros, 5000000);
  assert.equal(account.reservedMicros, 0);
  assert.equal(JSON.stringify(await f.service.get("alpha", a.id)).includes("lease"), false);
  await assert.rejects(f.repository.bind(f.scope, { ...identity, wallet: `0x${"c".repeat(40)}` }), {
    code: "TRADING_IDENTITY_CHANGED",
  });
});
test("ambiguous submission is never resent and reconciliation survives revocation and restart", async (t) => {
  const f = await setup(t);
  f.provider.submit = async () => {
    f.calls.submit++;
    throw new Error("lost response containing sensitive provider data");
  };
  f.provider.reconcile = async () => ({ status: "unknown" });
  const order = await f.prepare();
  await f.service.submit("alpha", order.id, "submit");
  await f.service.tick();
  assert.equal((await f.service.get("alpha", order.id)).status, "submitting");
  assert.equal((await f.repository.account(f.scope)).reservedMicros, 5000000);
  await f.disable();
  f.advance(120000);
  const restarted = createTradingService(
    new PostgresTradingStore(f.store.connectPeer().pool, f.time),
    f.provider,
    f.time,
  );
  await restarted.tick();
  assert.equal((await restarted.get("alpha", order.id)).status, "unknown");
  f.provider.reconcile = async () => settled;
  await restarted.tick();
  assert.equal((await restarted.get("alpha", order.id)).status, "settled");
  assert.equal(f.calls.submit, 1);
  assert.equal(f.calls.sign, 1);
});
test("revocation before signing blocks new submission and unsent expiry releases its reservation", async (t) => {
  const f = await setup(t);
  const order = await f.prepare();
  await f.service.submit("alpha", order.id, "submit");
  f.provider.preview = async () => {
    await f.disable();
    return f.preview();
  };
  await f.service.tick();
  assert.equal(f.calls.sign, 0);
  assert.equal(f.calls.submit, 0);
  assert.equal((await f.service.get("alpha", order.id)).status, "failed");
  assert.equal((await f.repository.account(f.scope)).reservedMicros, 0);
});
test("expired claims cannot sign or transition to submitting", async (t) => {
  const f = await setup(t);
  const order = await f.prepare();
  await f.service.submit("alpha", order.id, "submit");
  const claimed = (await f.repository.claim())!;
  f.advance(60001);
  await assert.rejects(f.repository.guard(claimed));
  await assert.rejects(f.repository.markSubmitting(claimed, hash));
  assert.equal(await f.repository.claim(), null);
  assert.equal((await f.repository.account(f.scope)).reservedMicros, 0);
  assert.equal((await f.service.get("alpha", order.id)).status, "expired");
});
test("manual settlement precedes automatic admission and both share one persistent pilot budget", async (t) => {
  const f = await setup(t);
  const manual = await f.prepare();
  await f.service.submit("alpha", manual.id, "submit");
  await f.service.tick();
  const agent = await f.store.agent(f.scope);
  await f.store.updateConfig(f.scope, agent.version, {
    ...agent.config,
    trading: { version: 1, mode: "automatic" },
  });
  await f.store.enqueue(f.scope, "research", "3", f.time());
  const run = (await f.store.claim(f.time()))!;
  // Controlled storage fixture; the research policy is independently covered by its existing suite.
  const decision = {
    schemaVersion: 4,
    protocol: "nfl-winner-v1",
    action: "TRADE",
    marketId: "3",
    outcomeId: "4",
    limitPrice: "0.5",
    expiresAt: new Date(f.time() + 600000).toISOString(),
    policyEvaluation: { finalAction: "TRADE" },
  } as unknown as Decision;
  await f.store.finish(run, decision, null, f.time());
  f.provider.preview = async (request) => ({
    ...f.preview(),
    ...request,
    market: { ...f.preview().market, id: "3", outcomes: [{ id: "4", label: "Bills" }] },
  });
  f.provider.sign = async () => {
    f.calls.sign++;
    return { hash: `0x${"3".repeat(64)}`, payload: { controlled: true } };
  };
  assert.equal((await f.repository.automaticCandidates()).length, 1);
  f.advance(600001);
  assert.equal((await f.repository.automaticCandidates()).length, 0);
  f.advance(-600001);
  await f.service.tick();
  assert.equal((await f.repository.account(f.scope)).spentMicros, 10000000);
  assert.equal((await f.repository.automaticCandidates()).length, 0);
  await f.service.tick();
  assert.equal(f.calls.submit, 2);
  const another = await f.repository.prepare(
    f.scope,
    { ...f.preview(), marketId: "5", market: { ...f.preview().market, id: "5" } },
    "third",
  );
  await assert.rejects(f.repository.enqueue("alpha", another.id, "third"), {
    code: "TRADING_BUDGET",
  });
});
