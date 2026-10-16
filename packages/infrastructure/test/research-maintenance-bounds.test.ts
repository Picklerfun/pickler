import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "@pickler/core";
import { createTestStore } from "./database.js";

const config = { ...DEFAULT_CONFIG, categoryIds: ["1"] };

async function seed(
  store: Awaited<ReturnType<typeof createTestStore>>,
  status: "running" | "queued",
) {
  await store.pool.query(
    `INSERT INTO pickler.agents(tenant_id,id,config)
     SELECT 'batch','agent-' || lpad(n::text,3,'0'),$1::jsonb FROM generate_series(1,125) n`,
    [JSON.stringify(config)],
  );
  await store.pool.query(
    `INSERT INTO pickler.runs(id,tenant_id,agent_id,request_key,trigger,status,created_at,
       config_version,config,lease_owner,lease_expires_at)
     SELECT 'run-' || lpad(n::text,3,'0'),'batch','agent-' || lpad(n::text,3,'0'),
       'request','manual',$1,n,1,$2::jsonb,
       CASE WHEN $1='running' THEN 'expired-owner' END,
       CASE WHEN $1='running' THEN 100 END
     FROM generate_series(1,125) n`,
    [status, JSON.stringify(config)],
  );
}

async function counts(store: Awaited<ReturnType<typeof createTestStore>>) {
  return (
    await store.pool.query(
      `SELECT (SELECT count(*)::int FROM pickler.runs WHERE status='failed') AS failed,
      (SELECT count(*)::int FROM pickler.paper_orders WHERE status='interrupted') AS interrupted`,
    )
  ).rows[0];
}

test("research and paper recovery commit at most 50 expired rows per category and preserve evidence", async (t) => {
  const store = await createTestStore(t, () => 1000);
  await seed(store, "running");
  await store.pool.query(
    `INSERT INTO pickler.paper_orders(id,tenant_id,agent_id,run_id,market_id,outcome_id,
       request_key,config_version,status,created_at,snapshot,lease_owner,lease_expires_at)
     SELECT 'order-' || id,tenant_id,agent_id,id,'market','yes','paper-' || id,1,
       'pending',created_at,'{}'::jsonb,'expired-paper',100 FROM pickler.runs`,
  );
  await store.pool.query(
    `INSERT INTO pickler.events(run_id,type,data,created_at)
     SELECT id,'partial','{"kept":true}'::jsonb,10 FROM pickler.runs`,
  );
  // An unrelated renewed lease survives even when the caller supplies a far-future clock.
  await store.pool.query(
    `INSERT INTO pickler.runs(id,tenant_id,agent_id,request_key,trigger,status,created_at,
       config_version,config,lease_owner,lease_expires_at)
     VALUES('healthy','alpha','pickle-alpha','healthy','manual','running',1,1,$1,'owner',2000)`,
    [JSON.stringify(config)],
  );

  for (const expected of [50, 100, 125]) {
    await store.recover(Number.MAX_SAFE_INTEGER);
    assert.deepEqual(await counts(store), { failed: expected, interrupted: expected });
  }
  await store.recover(0);
  assert.deepEqual(await counts(store), { failed: 125, interrupted: 125 });
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM pickler.events")).rows[0].n,
    125,
  );
  assert.equal((await store.run("alpha", "healthy")).status, "running");
  assert.equal(await store.claim(1000), null);
});

test("scheduler progresses 50/50/25 with stable ties and does not duplicate scheduled runs", async (t) => {
  const store = await createTestStore(t);
  await seed(store, "queued");
  // Existing queued work suppresses a duplicate, while due markers still advance.
  await store.pool.query(
    "UPDATE pickler.agents SET schedule_enabled=true,next_due=100 WHERE tenant_id='batch'",
  );

  for (const expected of [50, 100, 125]) {
    await store.tick(1000);
    const moved = await store.pool.query(
      "SELECT id FROM pickler.agents WHERE tenant_id='batch' AND next_due>1000 ORDER BY id",
    );
    assert.equal(moved.rowCount, expected);
    assert.equal(moved.rows.at(-1).id, `agent-${String(expected).padStart(3, "0")}`);
  }
  await store.tick(1000);
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM pickler.runs")).rows[0].n,
    125,
  );
});

test("scheduler commits an earlier batch across a later transaction failure and resumes idempotently", async (t) => {
  const store = await createTestStore(t);
  await seed(store, "queued");
  await store.pool.query("DELETE FROM pickler.runs");
  await store.pool.query(
    "UPDATE pickler.agents SET schedule_enabled=true,next_due=100 WHERE tenant_id='batch'",
  );
  await store.tick(1000);
  await store.pool
    .query(`CREATE FUNCTION pickler.fail_schedule_batch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='agent-075' THEN RAISE EXCEPTION 'injected batch failure'; END IF; RETURN NEW; END $$`);
  await store.pool.query(`CREATE TRIGGER fail_schedule_batch BEFORE UPDATE ON pickler.agents
    FOR EACH ROW EXECUTE FUNCTION pickler.fail_schedule_batch()`);

  await assert.rejects(store.tick(1000), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(String(error.cause), /injected batch failure/);
    return true;
  });
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM pickler.runs")).rows[0].n,
    50,
  );
  await store.pool.query("DROP TRIGGER fail_schedule_batch ON pickler.agents");
  await store.tick(1000);
  await store.tick(1000);
  await store.tick(1000);
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM pickler.runs")).rows[0].n,
    125,
  );
  assert.equal(
    (await store.pool.query("SELECT count(DISTINCT request_key)::int AS n FROM pickler.runs"))
      .rows[0].n,
    1,
  );
});

test("failed research recovery leaves previous batches committed and resumes after restart", async (t) => {
  const store = await createTestStore(t, () => 1000);
  await seed(store, "running");
  await store.recover(1000);
  await store.pool
    .query(`CREATE FUNCTION pickler.fail_recovery_batch() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.id='run-075' THEN RAISE EXCEPTION 'injected recovery failure'; END IF; RETURN NEW; END $$`);
  await store.pool.query(`CREATE TRIGGER fail_recovery_batch BEFORE UPDATE ON pickler.runs
    FOR EACH ROW EXECUTE FUNCTION pickler.fail_recovery_batch()`);

  await assert.rejects(store.recover(1000), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(String(error.cause), /injected recovery failure/);
    return true;
  });
  assert.equal((await counts(store)).failed, 50);
  await store.pool.query("DROP TRIGGER fail_recovery_batch ON pickler.runs");
  const restarted = store.connectPeer();
  await restarted.recover(1000);
  assert.equal((await counts(store)).failed, 100);
  await restarted.recover(1000);
  assert.equal((await counts(store)).failed, 125);
});

test("recovery skips a locked renewal and never interrupts its renewed lease", async (t) => {
  const store = await createTestStore(t, () => 1000);
  await seed(store, "running");
  const renewal = await store.pool.connect();
  try {
    await renewal.query("BEGIN");
    await renewal.query("SELECT id FROM pickler.runs WHERE id='run-001' FOR UPDATE");
    await renewal.query("UPDATE pickler.runs SET lease_expires_at=2000 WHERE id='run-001'");

    await store.recover(1000);
    assert.equal((await counts(store)).failed, 50);
    await renewal.query("COMMIT");
  } finally {
    await renewal.query("ROLLBACK");
    renewal.release();
  }
  await store.recover(1000);
  await store.recover(1000);
  assert.equal((await counts(store)).failed, 124);
  assert.equal((await store.run("batch", "run-001")).status, "running");
});
