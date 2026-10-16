import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_CONFIG, DEFAULT_BRIEF, STARTER_CAPS, prepareDraft } from "@pickler/core";
import { PostgresPreviewStore } from "../src/persistence/preview-store.js";
import { PostgresAdviceStore } from "../src/persistence/advice-store.js";
import { createTestStore } from "./database.js";

const NOW = 4_000_000_000;

async function setup(t: TestContext) {
  const store = await createTestStore(t);
  const workspace = randomUUID();
  const user = randomUUID();
  const tenant = `recovery-${randomUUID()}`;
  await store.pool.query(
    "INSERT INTO identity.workspaces(id,owner_user_id,name) VALUES($1,$2,'Recovery fixture')",
    [workspace, user],
  );
  await store.pool.query(
    "INSERT INTO pickler.workspace_tenants(workspace_id,tenant_id) VALUES($1,$2)",
    [workspace, tenant],
  );
  const previews = new PostgresPreviewStore(store.pool, () => NOW);
  const advice = new PostgresAdviceStore(store.pool, () => NOW);
  return { store, workspace, user, tenant, previews, advice };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function seedPreviews(f: Fixture, count: number, running: boolean) {
  await f.store.pool.query(
    `INSERT INTO pickler.preview_runs
      (id,user_id,workspace_id,tenant_id,status,created_at,expires_at,config,fingerprint,lease_owner,lease_expires_at)
    SELECT 'preview-' || lpad(n::text,4,'0'),$1,$2,$3,
      CASE WHEN $4 THEN 'running' ELSE 'completed' END,$5::bigint-n,
      CASE WHEN $4 THEN $5::bigint+86400000 ELSE $5::bigint-1 END,$6::jsonb,'fixture',
      CASE WHEN $4 THEN 'old-owner' ELSE NULL END,
      CASE WHEN $4 THEN $5::bigint-1 ELSE NULL END
    FROM generate_series(1,$7::int) n`,
    [f.user, f.workspace, f.tenant, running, NOW, JSON.stringify(DEFAULT_CONFIG), count],
  );
  await f.store.pool.query(
    `INSERT INTO pickler.preview_events(preview_run_id,type,data,created_at)
    SELECT id,'evidence','{"retained":true}'::jsonb,$1 FROM pickler.preview_runs`,
    [NOW - 1],
  );
}

async function seedAdvice(f: Fixture, count: number) {
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    publicId: randomUUID(),
    userId: randomUUID(),
    agentId: `rec_agent_${index}`,
    running: index % 2 === 0,
  }));
  const data = JSON.stringify(rows);
  const source = `jsonb_to_recordset($1::jsonb)
    AS x(id uuid,"publicId" uuid,"userId" uuid,"agentId" text,running boolean)`;
  const client = await f.store.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents(id,workspace_id,name,handle,status)
      SELECT "publicId",$2,'Recovery',"agentId",'active' FROM ${source}`,
      [data, f.workspace],
    );
    await client.query(
      `INSERT INTO identity.handles(handle,agent_id)
      SELECT "agentId","publicId" FROM ${source}`,
      [data],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await f.store.pool.query(
    `INSERT INTO pickler.agents(tenant_id,id,config)
    SELECT $2,"agentId",$3::jsonb FROM ${source}`,
    [data, f.tenant, JSON.stringify(DEFAULT_CONFIG)],
  );
  await f.store.pool.query(
    `INSERT INTO pickler.product_agents
      (product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
    SELECT "publicId",$2,$3,"agentId","agentId",'{}'::jsonb FROM ${source}`,
    [data, f.workspace, f.tenant],
  );
  await f.store.pool.query(
    `INSERT INTO pickler.advice_jobs
      (id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,status,
       created_at,started_at,lease_owner,lease_expires_at,config_version,config,policy)
    SELECT id,"publicId",$2,"agentId","userId",'fixture','BTC',
      CASE WHEN running THEN 'running' ELSE 'queued' END,
      $3::bigint-700000,CASE WHEN running THEN $3::bigint-100000 ELSE NULL END,
      CASE WHEN running THEN gen_random_uuid() ELSE NULL END,
      CASE WHEN running THEN $3::bigint-1 ELSE NULL END,1,$4::jsonb,'{}'::jsonb
    FROM ${source}`,
    [data, f.tenant, NOW, JSON.stringify(DEFAULT_CONFIG)],
  );
  await f.store.pool.query(
    `INSERT INTO pickler.advice_calls
      (job_id,lane,model,provider,status,reserved_micros,cost_micros,request_hash)
    SELECT j.id,c.lane,'fixture','fixture',c.status,100,
      CASE WHEN c.status='completed' THEN 42 ELSE NULL END,
      CASE WHEN c.status='started' THEN repeat('a',64) ELSE NULL END
    FROM pickler.advice_jobs j CROSS JOIN
      (VALUES ('jev','reserved'),('deepseek','started'),('web','completed'),('web-fallback','released'))
      c(lane,status)`,
  );
  await f.store.pool.query(
    `INSERT INTO pickler.advice_events(job_id,sequence,at,kind,data)
    SELECT id,1,$1,'evidence','{"retained":true}'::jsonb FROM pickler.advice_jobs`,
    [NOW - 1],
  );
  return rows;
}

async function count(f: Fixture, sql: string) {
  return Number((await f.store.pool.query<{ n: string }>(sql)).rows[0]!.n);
}

test("preview recovery commits 50/50/25 lease failures and 50/50/25 cascading deletions", async (t) => {
  const f = await setup(t);
  await seedPreviews(f, 125, true);

  for (const expected of [50, 100, 125]) {
    await f.previews.recover(NOW);
    assert.equal(
      await count(
        f,
        "SELECT count(*) AS n FROM pickler.preview_runs WHERE status='failed' AND error='INTERRUPTED'",
      ),
      expected,
    );
    assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_events"), 125);
  }

  await f.store.pool.query("UPDATE pickler.preview_runs SET expires_at=$1", [NOW - 1]);
  for (const remaining of [75, 25, 0]) {
    await f.previews.recover(NOW);
    assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_runs"), remaining);
    assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_events"), remaining);
  }
});

test("preview lease recovery uses the database clock even when caller retention time is ahead", async (t) => {
  const f = await setup(t);
  await seedPreviews(f, 1, true);
  await f.store.pool.query("UPDATE pickler.preview_runs SET lease_expires_at=$1", [NOW + 60_000]);

  await f.previews.recover(NOW + 120_000);

  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.preview_runs WHERE status='running'"),
    1,
  );
});

test("preview recovery skips renewal and adoption locks and rechecks their committed state", async (t) => {
  const f = await setup(t);
  await seedPreviews(f, 3, true);
  await f.store.pool.query(
    "UPDATE pickler.preview_runs SET status='completed',lease_owner=NULL,lease_expires_at=NULL,expires_at=$1 WHERE id='preview-0002'",
    [NOW - 1],
  );
  const locker = await f.store.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query(
      "UPDATE pickler.preview_runs SET lease_expires_at=$1 WHERE id='preview-0001'",
      [NOW + 60_000],
    );
    await locker.query(
      "UPDATE pickler.preview_runs SET adopted_at=$1,adopted_agent_id='adopted-agent' WHERE id='preview-0002'",
      [NOW],
    );

    await f.previews.recover(NOW);
    assert.equal(
      await count(f, "SELECT count(*) AS n FROM pickler.preview_runs WHERE status='failed'"),
      1,
    );
    await locker.query("COMMIT");
    await f.previews.recover(NOW);
    assert.equal(
      await count(f, "SELECT count(*) AS n FROM pickler.preview_runs WHERE status='running'"),
      1,
    );
    assert.equal(
      await count(f, "SELECT count(*) AS n FROM pickler.preview_runs WHERE id='preview-0002'"),
      1,
    );
    assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_events"), 3);
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
});

test("preview deletion rollback retains every parent and evidence for a subsequent bounded pass", async (t) => {
  const f = await setup(t);
  await seedPreviews(f, 125, false);
  await f.store.pool.query(`
    CREATE FUNCTION pickler.reject_preview_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled cleanup interruption'; END $$;
    CREATE TRIGGER reject_preview_cleanup BEFORE DELETE ON pickler.preview_events
    FOR EACH ROW EXECUTE FUNCTION pickler.reject_preview_cleanup()
  `);

  await assert.rejects(f.previews.recover(NOW), /controlled cleanup interruption/);
  assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_runs"), 125);
  assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_events"), 125);

  await f.store.pool.query("DROP TRIGGER reject_preview_cleanup ON pickler.preview_events");
  await f.previews.recover(NOW);
  assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_runs"), 75);
  assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.preview_events"), 75);
});

test("advice recovery fails 50/50/25 jobs atomically and preserves started, settled and unknown costs", async (t) => {
  const f = await setup(t);
  await seedAdvice(f, 125);

  for (const expected of [50, 100, 125]) {
    const remainingQueued = await f.advice.recover();
    const queued = await count(
      f,
      "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='queued'",
    );
    assert.equal(remainingQueued, queued > 0);
    assert.equal(
      await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed'"),
      expected,
    );
    assert.equal(
      await count(
        f,
        "SELECT count(*) AS n FROM pickler.advice_calls WHERE lane='jev' AND status='released'",
      ),
      expected,
    );
    assert.equal(
      await count(
        f,
        "SELECT count(*) AS n FROM pickler.advice_calls WHERE lane='deepseek' AND status='started' AND cost_micros IS NULL AND request_hash=repeat('a',64)",
      ),
      125,
    );
    assert.equal(
      await count(
        f,
        "SELECT count(*) AS n FROM pickler.advice_calls WHERE lane='web' AND status='completed' AND cost_micros=42",
      ),
      125,
    );
    assert.equal(await count(f, "SELECT count(*) AS n FROM pickler.advice_events"), 125);
  }
  assert.equal(
    await count(
      f,
      "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed' AND (lease_owner IS NOT NULL OR lease_expires_at IS NOT NULL)",
    ),
    0,
  );
  assert.equal(
    await count(
      f,
      "SELECT count(*) AS n FROM pickler.advice_jobs WHERE error='ANALYSIS_INTERRUPTED'",
    ),
    63,
  );
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE error='ANALYSIS_EXPIRED'"),
    62,
  );
});

test("advice claim never executes expired jobs left behind a bounded recovery batch", async (t) => {
  const f = await setup(t);
  await seedAdvice(f, 125);
  const { config } = prepareDraft({
    markets: ["BTC", "ETH"],
    name: "Recovery",
    handle: "recovery",
    voice: "analyst",
    avatar: { accent: "lime", pattern: 0 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId: "unused",
  });
  // Make every candidate otherwise admissible: an unfiltered claim would start paid work.
  await f.store.pool.query("INSERT INTO pickler.research_access(user_id,enabled) VALUES($1,true)", [
    f.user,
  ]);
  await f.store.pool.query("UPDATE agents.agents SET visibility='public',published_at=now()");
  await f.store.pool.query("UPDATE pickler.agents SET config=$1::jsonb WHERE tenant_id=$2", [
    JSON.stringify(config),
    f.tenant,
  ]);
  await f.store.pool.query(
    `UPDATE pickler.advice_jobs
    SET status='queued',started_at=NULL,lease_owner=NULL,lease_expires_at=NULL,config=$1::jsonb`,
    [JSON.stringify(config)],
  );

  assert.equal(await f.advice.claim(), null);

  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed'"),
    50,
  );
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='queued'"),
    75,
  );
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='running'"),
    0,
  );

  const fresh = await f.store.pool.query<{ id: string }>(
    `UPDATE pickler.advice_jobs SET created_at=$1
    WHERE id=(SELECT id FROM pickler.advice_jobs WHERE status='queued' ORDER BY id DESC LIMIT 1)
    RETURNING id`,
    [NOW],
  );
  const claimed = await f.advice.claim();
  assert.equal(claimed?.id, fresh.rows[0]!.id);
});

test("advice recovery skips a locked renewal and cannot interrupt the committed valid lease", async (t) => {
  const f = await setup(t);
  const rows = await seedAdvice(f, 3);
  const target = rows[0]!;
  const locker = await f.store.pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("UPDATE pickler.advice_jobs SET lease_expires_at=$2 WHERE id=$1", [
      target.id,
      NOW + 60_000,
    ]);

    await f.advice.recover();
    assert.equal(
      await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed'"),
      2,
    );
    await locker.query("COMMIT");
    assert.equal(await f.advice.recover(), false);
    assert.equal((await f.advice.get(target.id)).status, "running");
    assert.equal(
      await count(
        f,
        "SELECT count(*) AS n FROM pickler.advice_calls WHERE lane='jev' AND status='reserved'",
      ),
      1,
    );
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
});

test("advice recovery rolls back both job failures and reserve releases on an interrupted statement", async (t) => {
  const f = await setup(t);
  await seedAdvice(f, 125);
  await f.store.pool.query(`
    CREATE FUNCTION pickler.reject_advice_recovery() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled recovery interruption'; END $$;
    CREATE TRIGGER reject_advice_recovery BEFORE UPDATE ON pickler.advice_calls
    FOR EACH ROW WHEN (NEW.status='released' AND OLD.status='reserved')
    EXECUTE FUNCTION pickler.reject_advice_recovery()
  `);

  await assert.rejects(f.advice.recover(), /controlled recovery interruption/);
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed'"),
    0,
  );
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_calls WHERE status='reserved'"),
    125,
  );

  await f.store.pool.query("DROP TRIGGER reject_advice_recovery ON pickler.advice_calls");
  await f.advice.recover();
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_jobs WHERE status='failed'"),
    50,
  );
  assert.equal(
    await count(f, "SELECT count(*) AS n FROM pickler.advice_calls WHERE status='reserved'"),
    75,
  );
});
