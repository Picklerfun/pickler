import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import type { PoolClient, QueryResult } from "pg";
import { prepareDraft, DEFAULT_BRIEF, STARTER_CAPS, assertAdviceAgent } from "@pickler/core";
import { PostgresAdviceStore } from "../src/persistence/advice-store.js";
import { createTestStore } from "./database.js";

const NOW = 4_000_000_000;
const { config } = prepareDraft({
  markets: ["BTC", "ETH"],
  name: "Analyst",
  handle: "analyst",
  voice: "analyst",
  avatar: { accent: "lime", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "unused",
});

async function setup(t: TestContext, groups: Array<{ tenant: string; count: number }>) {
  let clock = NOW;
  const db = await createTestStore(t);
  const store = new PostgresAdviceStore(db.pool, () => clock);
  const peer = new PostgresAdviceStore(db.pool, () => clock);
  const tenants = groups.map((g) => ({ ...g, owner: randomUUID(), workspace: randomUUID() }));
  const jobs = tenants.flatMap((g) =>
    Array.from({ length: g.count }, (_, i) => ({
      id: randomUUID(),
      publicId: randomUUID(),
      user: randomUUID(),
      tenant: g.tenant,
      agent: `${g.tenant}_${i}`,
      workspace: g.workspace,
    })),
  );
  const source = `jsonb_to_recordset($1::jsonb) AS x(id uuid,"publicId" uuid,"user" uuid,
    tenant text,agent text,workspace uuid)`;
  for (const g of tenants) {
    await db.pool.query(
      "INSERT INTO identity.workspaces(id,owner_user_id,name) VALUES($1,$2,'Claim')",
      [g.workspace, g.owner],
    );
    await db.pool.query(
      "INSERT INTO pickler.workspace_tenants(workspace_id,tenant_id) VALUES($1,$2)",
      [g.workspace, g.tenant],
    );
    await db.pool.query("INSERT INTO pickler.research_access(user_id,enabled) VALUES($1,true)", [
      g.owner,
    ]);
  }
  const data = JSON.stringify(jobs);
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at)
      SELECT "publicId",workspace,agent,agent,'active','public',now() FROM ${source}`,
      [data],
    );
    await client.query(
      `INSERT INTO identity.handles(handle,agent_id) SELECT agent,"publicId" FROM ${source}`,
      [data],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await db.pool.query(
    `INSERT INTO pickler.agents(tenant_id,id,config) SELECT tenant,agent,$2::jsonb FROM ${source}`,
    [data, JSON.stringify(config)],
  );
  await db.pool.query(
    `INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
    SELECT "publicId",workspace,tenant,agent,agent,'{}' FROM ${source}`,
    [data],
  );
  await db.pool.query(
    `INSERT INTO pickler.advice_jobs(id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,status,
    created_at,config_version,config,policy)
    SELECT id,"publicId",tenant,agent,"user",agent,'BTC','queued',$2,1,$3::jsonb,'{}' FROM ${source}`,
    [data, NOW - 1000, JSON.stringify(config)],
  );
  await db.pool
    .query(`INSERT INTO pickler.advice_calls(job_id,lane,model,provider,status,reserved_micros)
    SELECT id,'jev','fixture','fixture','reserved',10 FROM pickler.advice_jobs`);
  return {
    db,
    store,
    peer,
    jobs,
    tenants,
    advance: (n: number) => {
      clock += n;
    },
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

function trace(f: Fixture, after?: (text: string, result: QueryResult) => Promise<void>) {
  const statements: Array<{ text: string; rows: Record<string, unknown>[] }> = [];
  const wrapped = new WeakSet<PoolClient>();
  f.db.pool.on("acquire", (client) => {
    if (wrapped.has(client)) {
      return;
    }
    wrapped.add(client);
    const original = client.query.bind(client);
    client.query = ((...args: unknown[]) => {
      const result = Reflect.apply(original, client, args);
      if (!result || typeof result.then !== "function") {
        return result;
      }
      return result.then(async (r: QueryResult) => {
        const text =
          typeof args[0] === "string" ? args[0] : String((args[0] as { text?: string }).text);
        statements.push({ text, rows: r.rows });
        await after?.(text, r);
        return r;
      });
    }) as typeof client.query;
  });
  return statements;
}

test("saturated and invalid backlogs do not hide eligible advice; one full document is returned", async (t) => {
  const f = await setup(t, [
    { tenant: "busy", count: 81 },
    { tenant: "invalid", count: 80 },
    { tenant: "ready", count: 1 },
  ]);
  await f.db.pool.query("UPDATE pickler.execution_policy SET global_limit=3,tenant_limit=1");
  await f.db.pool.query("UPDATE pickler.advice_jobs SET created_at=$1 WHERE tenant_id='ready'", [
    NOW,
  ]);
  const busy = f.jobs.find((j) => j.tenant === "busy")!;
  await f.db.pool.query(
    "UPDATE pickler.advice_jobs SET status='running',started_at=$2,lease_owner=$3,lease_expires_at=$2::bigint+60000 WHERE id=$1",
    [busy.id, NOW, randomUUID()],
  );
  await f.db.pool.query("UPDATE pickler.agents SET paused=true WHERE tenant_id='invalid'");
  const statements = trace(f);

  const claimed = await f.store.claim();

  assert.equal(claimed?.tenantId, "ready");
  const full = statements.flatMap((s) => s.rows).filter((r) => "config" in r);
  assert.equal(full.length, 1);
  assert.equal(full[0]!.id, claimed!.id);
  assert.ok(statements.length <= 12, `${statements.length} statements`);
  assert.ok(statements.every((s) => s.rows.length <= 1));
  const failed = await f.db.pool.query(
    "SELECT count(*)::int AS n FROM pickler.advice_jobs WHERE status='failed'",
  );
  assert.equal(failed.rows[0].n, 50);
  const released = await f.db.pool.query(
    "SELECT count(*)::int AS n FROM pickler.advice_calls WHERE status='released'",
  );
  assert.equal(released.rows[0].n, 50);
});

test("locked job and locked agent both allow another eligible job to start", async (t) => {
  for (const target of ["job", "agent"]) {
    const f = await setup(t, [
      { tenant: `locked_${target}`, count: 1 },
      { tenant: `ready_${target}`, count: 1 },
    ]);
    const first = f.jobs[0]!;
    await f.db.pool.query("UPDATE pickler.advice_jobs SET created_at=$2 WHERE id=$1", [
      first.id,
      NOW - 2000,
    ]);
    const client = await f.db.pool.connect();
    try {
      await client.query("BEGIN");
      if (target === "job") {
        await client.query("SELECT id FROM pickler.advice_jobs WHERE id=$1 FOR UPDATE", [first.id]);
      } else {
        await client.query(
          "SELECT id FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [first.tenant, first.agent],
        );
      }
      assert.equal((await f.store.claim())?.tenantId, `ready_${target}`);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  }
});

test("SQL eligibility mirrors business advice permissions and snapshot/config fences", async (t) => {
  const changes = [
    "UPDATE agents.agents SET visibility='private',published_at=NULL",
    "UPDATE agents.agents SET status='paused'",
    "UPDATE pickler.agents SET paused=true",
    "UPDATE pickler.research_access SET enabled=false",
    "UPDATE pickler.agents SET config=config-'perpl'",
    "UPDATE pickler.agents SET config=config-'plugins'",
    `UPDATE pickler.agents SET config=jsonb_set(config,'{plugins,enabled}','null')`,
    `UPDATE pickler.agents SET config=jsonb_set(config,'{tools}','[]')`,
    `UPDATE pickler.agents SET config=jsonb_set(config,'{perpl,markets}','["ETH"]')`,
  ];
  for (const [index, change] of changes.entries()) {
    await t.test(`permission case ${index}`, async (child) => {
      const f = await setup(child, [{ tenant: "eligibility", count: 1 }]);
      await f.db.pool.query(change);
      // Align the stored snapshot so permission rejection is not merely an equality mismatch.
      await f.db.pool.query(
        "UPDATE pickler.advice_jobs SET config=(SELECT config FROM pickler.agents WHERE tenant_id='eligibility')",
      );
      const current = await f.store.resolve(f.jobs[0]!.publicId);
      assert.throws(() => assertAdviceAgent(current, "BTC"));
      assert.equal(await f.store.claim(), null);
      assert.equal((await f.store.get(f.jobs[0]!.id)).error, "ANALYSIS_FAILED");
    });
  }
  for (const change of ["version=2", `config=jsonb_set(config,'{brief}','"changed"')`]) {
    const f = await setup(t, [{ tenant: "changed", count: 1 }]);
    await f.db.pool.query(`UPDATE pickler.agents SET ${change} WHERE tenant_id='changed'`);
    assert.equal(await f.store.claim(), null);
    assert.equal((await f.store.get(f.jobs[0]!.id)).error, "ANALYSIS_FAILED");
  }
});

test("authorization and exact expiry boundary are rechecked after selection", async (t) => {
  for (const mode of ["revoked", "expired"]) {
    const f = await setup(t, [{ tenant: `race_${mode}`, count: 1 }]);
    let changed = false;
    trace(f, async (text, r) => {
      if (!changed && text.includes("WITH active AS MATERIALIZED") && r.rows.length) {
        changed = true;
        if (mode === "revoked") {
          const client = await f.db.pool.connect();
          try {
            await client.query("UPDATE pickler.research_access SET enabled=false");
          } finally {
            client.release();
          }
        } else {
          f.advance(599000);
        }
      }
    });
    assert.equal(await f.store.claim(), null);
    assert.equal(changed, true);
    assert.equal((await f.store.get(f.jobs[0]!.id)).status, "queued");
  }
});

test("invalid cleanup atomically rolls back failure and reserved-call release", async (t) => {
  const f = await setup(t, [{ tenant: "rollback", count: 2 }]);
  await f.db.pool.query("UPDATE pickler.agents SET paused=true WHERE tenant_id='rollback'");
  await f.db.pool
    .query(`CREATE FUNCTION pickler.reject_release() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'controlled release failure'; END $$`);
  await f.db.pool.query(`CREATE TRIGGER reject_release BEFORE UPDATE ON pickler.advice_calls
    FOR EACH ROW EXECUTE FUNCTION pickler.reject_release()`);
  await assert.rejects(f.store.claim(), /controlled release failure/);
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM pickler.advice_jobs WHERE status='queued'",
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM pickler.advice_calls WHERE status='reserved'",
      )
    ).rows[0].n,
    2,
  );
  await f.db.pool.query("DROP TRIGGER reject_release ON pickler.advice_calls");
  assert.equal(await f.store.claim(), null);
  assert.equal(
    (
      await f.db.pool.query(
        "SELECT count(*)::int AS n FROM pickler.advice_jobs WHERE error='ANALYSIS_FAILED'",
      )
    ).rows[0].n,
    2,
  );
});

test("workspace activity is not silently added to the existing advice authorization policy", async (t) => {
  const f = await setup(t, [{ tenant: "workspace", count: 1 }]);
  await f.db.pool.query("UPDATE identity.workspaces SET is_active=false");
  assert.doesNotThrow(() =>
    assertAdviceAgent(
      {
        tenantId: "workspace",
        agentId: "workspace_0",
        publicId: f.jobs[0]!.publicId,
        version: 1,
        config,
        published: true,
        enabled: true,
      },
      "BTC",
    ),
  );
  assert.equal((await f.store.claim())?.id, f.jobs[0]!.id);
});

test("research running capacity and concurrent advice claims cannot oversubscribe", async (t) => {
  const f = await setup(t, [
    { tenant: "first", count: 1 },
    { tenant: "second", count: 1 },
  ]);
  await f.db.pool.query("UPDATE pickler.execution_policy SET global_limit=1,tenant_limit=1");
  await f.db.pool.query(
    `INSERT INTO pickler.runs(id,tenant_id,agent_id,request_key,trigger,status,
    created_at,started_at,config_version,config,lease_owner,lease_expires_at)
    VALUES('research','alpha','pickle-alpha','research','manual','running',$1,$1,1,$2,'owner',$1::bigint+60000)`,
    [NOW, JSON.stringify(config)],
  );
  assert.equal(await f.store.claim(), null);
  await f.db.pool.query("UPDATE pickler.runs SET lease_expires_at=0 WHERE id='research'");
  await f.db.recover(NOW);

  const claims = await Promise.all([f.store.claim(), f.peer.claim()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const winner = claims[0] ? f.store : f.peer;
  const loser = claims[0] ? f.peer : f.store;
  const job = claims.find(Boolean)!;
  await winner.guard(job);
  await assert.rejects(loser.guard(job), { code: "LEASE_LOST" });
});
