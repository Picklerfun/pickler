import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPerpsDiagnosticStore } from "../src/persistence/perps-diagnostic-store.js";
import { PostgresPerpsStudyStore } from "../src/persistence/perps-study-store.js";
import { createTestStore } from "./database.js";

test("standalone diagnostic uses one existing permission agent and creates no financial authority", async (t) => {
  let now = Date.UTC(2026, 9, 16);
  const database = await createTestStore(t, () => now);
  const store = new PostgresPerpsDiagnosticStore(database.pool, () => now);
  const input = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "controlled-source-journal",
    network: "mainnet" as const,
    protocolId: "t5-a5-hourly-breakout-fixed-screen@0.2.0",
    protocolSha256: "a".repeat(64),
    metadata: { controlled: true },
  };
  const before = await database.pool.query("SELECT id,config FROM pickler.agents ORDER BY id");

  await store.initialize(input);
  await store.initialize(input);
  const lease = await store.claim(input);
  await store.guard(input, lease);
  await assert.rejects(store.claim(input), { code: "CONFLICT" });
  const sample = await store.sampleDatabaseClock();
  assert.ok(Number.isSafeInteger(sample.databaseAt));
  assert.ok(Math.abs(sample.databaseAt - Date.now()) < 5000);
  now += 20000;
  await store.renew(input, lease);
  await store.event(input, lease, "minute-0", "source-operation", { outcome: "COMPLETE" });
  await store.event(input, lease, "minute-0", "source-operation", { outcome: "COMPLETE" });
  await assert.rejects(
    store.event(input, lease, "minute-0", "source-operation", { outcome: "MISSED" }),
    { code: "CONFLICT" },
  );
  const view = await store.view(input);
  assert.equal(view.accountCount, 0);
  assert.equal(view.eventCount, 1);
  assert.equal(view.record.financiallyExecutable, false);
  assert.deepEqual(
    (await database.pool.query("SELECT id,config FROM pickler.agents ORDER BY id")).rows,
    before.rows,
  );
  assert.equal(
    (await database.pool.query("SELECT count(*)::int AS count FROM pickler.perps_paper_attempts"))
      .rows[0].count,
    0,
  );
  await assert.rejects(new PostgresPerpsStudyStore(database.pool, () => now).claim(input), {
    code: "VERSIONED_STORE_REQUIRED",
  });
  await store.release(input, lease);
  await assert.rejects(store.event(input, lease, "late", "source-operation", {}), {
    code: "LEASE_LOST",
  });
  await assert.rejects(store.claim(input), { code: "STUDY_COMPLETE" });
});

test("lost diagnostic owner performs no event, renewal, release or recovery writes", async (t) => {
  let now = Date.UTC(2026, 9, 16);
  const database = await createTestStore(t, () => now);
  const store = new PostgresPerpsDiagnosticStore(database.pool, () => now);
  const scope = {
    tenantId: "alpha",
    agentId: "pickle-alpha",
    sessionId: "controlled-diagnostic-expiry",
    network: "mainnet" as const,
    protocolId: "controlled-diagnostic-v1",
    protocolSha256: "b".repeat(64),
    metadata: {},
  };
  await store.initialize(scope);
  const lease = await store.claim(scope);
  const before = (
    await database.pool.query(
      "SELECT document,owner,expires_at FROM pickler.perps_studies WHERE session_id=$1",
      [scope.sessionId],
    )
  ).rows;
  now += 90000;

  await assert.rejects(store.event(scope, lease, "lost", "source-operation", {}), {
    code: "LEASE_LOST",
  });
  await assert.rejects(store.renew(scope, lease), { code: "LEASE_LOST" });
  await assert.rejects(store.release(scope, lease, "LEASE_LOST"), { code: "LEASE_LOST" });
  await assert.rejects(new PostgresPerpsDiagnosticStore(database.pool, () => now).claim(scope), {
    code: "STUDY_COMPLETE",
  });
  assert.deepEqual(
    (
      await database.pool.query(
        "SELECT document,owner,expires_at FROM pickler.perps_studies WHERE session_id=$1",
        [scope.sessionId],
      )
    ).rows,
    before,
  );
  assert.equal((await store.view(scope)).eventCount, 0);
});
