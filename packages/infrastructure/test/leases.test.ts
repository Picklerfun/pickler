import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "@pickler/core";
import { createTestStore } from "./database.js";

async function seed(store: Awaited<ReturnType<typeof createTestStore>>) {
  for (const tenantId of ["alpha", "beta", "gamma"]) {
    for (let i = 0; i < 3; i++) {
      const agentId = `${tenantId}-${i}`;
      await store.pool.query("INSERT INTO pickler.agents (tenant_id,id,config) VALUES ($1,$2,$3)", [
        tenantId,
        agentId,
        { ...DEFAULT_CONFIG, categoryIds: ["1"] },
      ]);
      await store.enqueue(
        { tenantId, agentId },
        "job",
        null,
        ["alpha", "beta", "gamma"].indexOf(tenantId) * 10 + i,
      );
    }
  }
}

test("independent consumers enforce global, tenant and agent limits with private lease metadata", async (t) => {
  const store = await createTestStore(t);
  await seed(store);
  const peers = Array.from({ length: 12 }, () => store.connectPeer());
  const claims = await Promise.all(peers.map((peer) => peer.claim(10)));
  const active = claims.filter((run) => run !== null);
  assert.equal(active.length, 5);
  for (const tenant of ["alpha", "beta", "gamma"]) {
    assert.ok(active.filter((run) => run.tenantId === tenant).length <= 2);
  }
  assert.equal(new Set(active.map((run) => `${run.tenantId}/${run.agentId}`)).size, 5);
  assert.equal("leaseOwner" in active[0]!, false);
  assert.equal("leaseExpiresAt" in (await store.run(active[0]!.tenantId, active[0]!.id)), false);
  await store.setConcurrency(1, 1);
  assert.equal(await store.claim(11), null);
  for (let i = 0; i < claims.length; i++) {
    if (claims[i]) {
      await peers[i]!.finish(claims[i]!, null, "TEST_DONE", 12);
    }
  }
  assert.ok(await store.claim(13));
  assert.equal(await store.connectPeer().claim(14), null);
});

test("renewal and expiry are per run; stale executors cannot write or revive expired work", async (t) => {
  let clock = 1000;
  const store = await createTestStore(t, () => clock);
  await seed(store);
  const peer = store.connectPeer();
  const a = (await store.claim(1))!;
  const b = (await peer.claim(2))!;
  await store.event(a, "partial", { preserved: true }, 3);
  clock = 31000;
  await peer.renew(b);
  clock = 61000;
  await assert.rejects(store.event(a, "late", {}, 4), { code: "LEASE_LOST" });
  await assert.rejects(store.finish(a, null, "LATE", 4), { code: "LEASE_LOST" });
  await assert.rejects(store.renew(a), { code: "LEASE_LOST" });
  await store.recover(0);
  assert.equal((await store.run(a.tenantId, a.id)).error, "INTERRUPTED");
  assert.equal((await store.run(b.tenantId, b.id)).status, "running");
  assert.equal((await store.events(a.tenantId, a.id)).length, 1);
  await peer.finish(b, null, "TEST_DONE", 5);
  await assert.rejects(store.event(a, "late-again", {}, 6), { code: "LEASE_LOST" });
});

test("a tenant at capacity does not block another tenant and duplicate jobs for an agent wait", async (t) => {
  const store = await createTestStore(t);
  await seed(store);
  await store.setConcurrency(5, 1);
  const a = (await store.claim(10))!;
  assert.equal(a.tenantId, "alpha");
  await store.enqueue(a, "another-same-agent", null, 11);
  const b = (await store.connectPeer().claim(12))!;
  assert.equal(b.tenantId, "beta");
  const c = (await store.connectPeer().claim(12))!;
  assert.equal(c.tenantId, "gamma");
  assert.equal(await store.claim(13), null);
  await store.recover(9999999999999);
  assert.equal((await store.run(a.tenantId, a.id)).status, "running");
});

test("a failed renewal revokes local authority even if the database becomes available again", async (t) => {
  const store = await createTestStore(t);
  await seed(store);
  const run = (await store.claim(1))!;
  const failure = t.mock.method(store.db, "transaction", async () => {
    throw new Error("connection failed");
  });
  await assert.rejects(store.renew(run), /connection failed/);
  failure.mock.restore();
  await assert.rejects(store.assertOwnership(run), { code: "LEASE_LOST" });
  await assert.rejects(store.event(run, "late", {}, 2), { code: "LEASE_LOST" });
  assert.equal((await store.run(run.tenantId, run.id)).status, "running");
});

test("database rejects legacy global recovery against a valid lease", async (t) => {
  const store = await createTestStore(t);
  await seed(store);
  const run = (await store.claim(Date.now()))!;
  await assert.rejects(
    store.pool.query(
      "UPDATE pickler.runs SET status = 'failed', error = 'INTERRUPTED' WHERE status = 'running'",
    ),
    /Execution owner required/,
  );
  assert.equal((await store.run(run.tenantId, run.id)).status, "running");
  await store.finish(run, null, "TEST_DONE", Date.now());
});
