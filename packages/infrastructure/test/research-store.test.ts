import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG, type Decision } from "@pickler/core";
import { createTestStore } from "./database";
const scope = { tenantId: "alpha", agentId: "pickle-alpha" };
const config = { ...DEFAULT_CONFIG, categoryIds: ["1"] };
const abstention: Decision = {
  action: "ABSTAIN",
  marketId: "1",
  outcomeId: null,
  thesis: "Test evidence",
  counterEvidence: "Opposing evidence",
  uncertainty: "Uncertain",
  sourceIds: ["test-source"],
  estimatedProbability: null,
  observedPrice: null,
  limitPrice: null,
  expiresAt: null,
  abstentionReason: "Insufficient evidence",
};
async function setup(t: TestContext) {
  const store = await createTestStore(t);
  await store.updateConfig(scope, 1, config);
  return store;
}
test("tenant scope protects agents, configuration, runs and evidence", async (t) => {
  const store = await setup(t);

  assert.equal((await store.agents("beta"))[0]?.id, "pickle-beta");
  await assert.rejects(store.agent({ ...scope, tenantId: "beta" }), { code: "NOT_FOUND" });
  await assert.rejects(store.updateConfig({ ...scope, tenantId: "beta" }, 2, config), {
    code: "NOT_FOUND",
  });
  await store.enqueue(scope, "manual-1", null, 1000);
  const run = (await store.claim(1001))!;
  await store.event(run, "source", { url: "https://example.com" }, 1001);

  await assert.rejects(store.run("beta", run.id), { code: "NOT_FOUND" });
  await assert.rejects(store.events("beta", run.id), { code: "NOT_FOUND" });
  assert.equal((await store.events("alpha", run.id)).length, 1);
});

test("idempotency, concurrency, rolling quota and version conflicts", async (t) => {
  const store = await setup(t);
  const runs = await Promise.all([
    store.enqueue(scope, "same", null, 1000),
    store.enqueue(scope, "same", null, 1000),
  ]);

  assert.equal(runs[0]!.id, runs[1]!.id);
  await assert.rejects(store.enqueue(scope, "same", "2", 1000), { code: "CONFLICT" });
  await store.enqueue(scope, "second", null, 1001);
  const claims = await Promise.all([store.claim(1002), store.claim(1002)]);

  assert.equal(claims.filter(Boolean).length, 1);
  for (let i = 2; i < 6; i++) {
    await store.enqueue(scope, `q-${i}`, null, 1003);
  }

  await assert.rejects(store.enqueue(scope, "over-quota", null, 1004), { code: "QUOTA" });
  await store.enqueue(scope, "new-day", null, 86_402_000);

  await assert.rejects(store.updateConfig(scope, 1, config), { code: "CONFLICT" });
});

test("schedule readiness, coalescing, deduplication, pause and recovery use a controlled clock", async (t) => {
  const store = await setup(t);

  await assert.rejects(store.schedule(scope, true, 0), { code: "NOT_READY" });
  await store.setConnectionsChecked(true);
  await store.enqueue(scope, "manual", null, 0);
  const manual = (await store.claim(1))!;
  await store.finish(manual, abstention, null, 2);
  await store.schedule(scope, true, 3);
  const due = (await store.agent(scope)).nextDueAt!;
  await store.tick(due + 9 * 3_600_000);
  await store.tick(due + 9 * 3_600_000);
  const scheduled = (await store.claim(due + 9 * 3_600_000))!;

  assert.equal(scheduled.trigger, "schedule");
  assert.equal(await store.claim(due + 9 * 3_600_000), null);
  await store.event(scheduled, "partial-evidence", { id: "kept" }, due);
  await store.pool.query("UPDATE pickler.runs SET lease_expires_at = 0 WHERE status = 'running'");
  await store.recover(due + 9 * 3_600_000 + 1);

  assert.equal((await store.run("alpha", scheduled.id)).error, "INTERRUPTED");
  assert.equal((await store.events("alpha", scheduled.id)).length, 1);
  assert.equal(await store.claim(due + 9 * 3_600_000 + 2), null);
  const pending = await store.enqueue(scope, "pending", null, due + 9 * 3_600_000 + 3);
  await store.pause(scope, true);

  assert.equal((await store.run("alpha", pending.id)).status, "cancelled");
  await store.tick(due + 24 * 3_600_000);

  assert.equal(await store.claim(due + 24 * 3_600_000), null);
  await store.pause(scope, false);
  await store.tick(due + 24 * 3_600_000);

  assert.equal((await store.claim(due + 24 * 3_600_000))?.trigger, "schedule");
});

test("empty categories never allow discovery and edited configs cancel pending jobs", async (t) => {
  const store = await setup(t);
  const run = await store.enqueue(scope, "old-version", null, 0);
  await store.updateConfig(scope, 2, { ...config, categoryIds: [] });

  assert.equal(await store.claim(1), null);
  assert.equal((await store.run("alpha", run.id)).error, "CONFIG_CHANGED");
  await assert.rejects(store.enqueue(scope, "empty", null, 2), { code: "CATEGORIES_REQUIRED" });
});

test("provider identity changes invalidate readiness, but ordinary restarts preserve it", async (t) => {
  const store = await setup(t);
  await store.bindConnectionIdentity("first");
  await store.setConnectionsChecked(true);
  await store.enqueue(scope, "manual-ready", null, 0);
  const run = (await store.claim(1))!;
  await store.finish(run, abstention, null, 2);
  await store.schedule(scope, true, 3);
  await store.bindConnectionIdentity("first");

  assert.equal((await store.agent(scope)).scheduleEnabled, true);
  await store.bindConnectionIdentity("second");

  assert.equal((await store.agent(scope)).scheduleEnabled, false);
  await assert.rejects(store.schedule(scope, true, 4), { code: "NOT_READY" });
});

test("independent PostgreSQL connections serialize quota admission and idempotency", async (t) => {
  const store = await setup(t);
  const other = store.connectPeer();
  const attempts = await Promise.allSettled(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? store : other).enqueue(scope, `concurrent-${i}`, null, 100),
    ),
  );
  assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 6);
  for (const result of attempts) {
    if (result.status === "rejected") {
      assert.equal(result.reason.code, "QUOTA");
    }
  }
  const claims = await Promise.all([store.claim(101), other.claim(101)]);
  assert.equal(claims.filter(Boolean).length, 1);
});

test("execution ownership is private to the claiming repository", async (t) => {
  const store = await setup(t);
  const peer = store.connectPeer();
  await store.enqueue(scope, "owned", null, 0);
  const run = (await store.claim(1))!;
  await store.assertOwnership(run);
  await assert.rejects(peer.assertOwnership(run), { code: "LEASE_LOST" });
  await peer.recover(1000000);
  assert.equal((await peer.run("alpha", run.id)).status, "running");
});

test("simultaneous schedule ticks coalesce into one persisted occurrence", async (t) => {
  const store = await setup(t);
  await store.setConnectionsChecked(true);
  await store.enqueue(scope, "manual-ready", null, 0);
  const manual = (await store.claim(1))!;
  await store.finish(manual, abstention, null, 2);
  await store.schedule(scope, true, 3);
  const due = (await store.agent(scope)).nextDueAt!;
  await Promise.all(Array.from({ length: 5 }, () => store.tick(due + 1000)));
  const scheduled = (await store.claim(due + 1001))!;
  assert.equal(scheduled.trigger, "schedule");
  await store.finish(scheduled, abstention, null, due + 1002);
  assert.equal(await store.claim(due + 1003), null);
});

test("policy config updates are versioned and do not rewrite historical decisions", async (t) => {
  const store = await setup(t);
  await store.enqueue(scope, "legacy", null, 10);
  const run = (await store.claim(11))!;
  await store.finish(run, abstention, null, 12);
  const agent = await store.agent(scope);
  const changed = {
    ...agent.config,
    uncertaintyPolicy: {
      blockHighUncertainty: true,
      requireCompleteInformation: true,
      minProbabilityMargin: 0.02,
      maxProbabilityRangeWidth: 0.1,
    },
  };
  const updated = await store.updateConfig(scope, agent.version, changed);
  assert.equal(updated.version, agent.version + 1);
  assert.deepEqual(updated.config.uncertaintyPolicy, changed.uncertaintyPolicy);
  assert.equal(updated.scheduleEnabled, false);
  const historical = await store.run("alpha", run.id);
  assert.deepEqual(historical.decision, abstention);
  assert.deepEqual(historical.config, run.config);
  const next = await store.enqueue(scope, "new-policy", null, 13);
  assert.deepEqual(next.config.uncertaintyPolicy, changed.uncertaintyPolicy);
});
