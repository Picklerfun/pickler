import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResult } from "pg";
import { DEFAULT_CONFIG } from "@pickler/core";
import { createTestStore } from "./database";

const snapshot = { ...DEFAULT_CONFIG, brief: "Archived configuration ".repeat(8000) };
type Store = Awaited<ReturnType<typeof createTestStore>>;

function observeQueries(
  store: Store,
  observe: (statement: string, result: QueryResult) => void | Promise<void>,
) {
  const wrapped = new WeakSet<PoolClient>();
  store.pool.on("acquire", (client) => {
    if (wrapped.has(client)) {
      return;
    }
    wrapped.add(client);
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    client.query = ((...args: unknown[]) => {
      // pg also supports callbacks: preserve those calls unchanged, including pool.query's
      // release callback. Drizzle transaction queries use the promise form observed here.
      const pending = original(...args);
      if (!(pending instanceof Promise)) {
        return pending;
      }
      return pending.then(async (result: QueryResult) => {
        const input = args[0];
        const statement = typeof input === "string" ? input : (input as { text: string }).text;
        await observe(statement, result);
        return result;
      });
    }) as typeof client.query;
  });
}

async function agent(store: Store, tenant: string, id: string, paused = false) {
  await store.pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,config,paused) VALUES($1,$2,$3,$4)",
    [tenant, id, snapshot, paused],
  );
}

async function queue(
  store: Store,
  tenant: string,
  id: string,
  prefix: string,
  size = 1,
  version = 1,
) {
  await store.pool.query(
    `INSERT INTO pickler.runs(id,tenant_id,agent_id,request_key,trigger,status,created_at,config_version,config)
     SELECT $1 || lpad(i::text,4,'0'),$2,$3,$1 || i::text,'manual','queued',10,$5,$6
     FROM generate_series(1,$4::int) i`,
    [prefix, tenant, id, size, version, snapshot],
  );
}

async function managed(store: Store, tenant: string, id: string) {
  const owner = randomUUID();
  const workspace = randomUUID();
  const product = randomUUID();
  await store.pool.query(
    "INSERT INTO identity.workspaces(id,owner_user_id,name) VALUES($1,$2,'Claim test')",
    [workspace, owner],
  );
  await store.pool.query("INSERT INTO pickler.workspace_tenants VALUES($1,$2)", [
    workspace,
    tenant,
  ]);
  const handle = `claim_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const client = await store.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES($1,$2)", [
      handle,
      product,
    ]);
    await client.query(
      "INSERT INTO agents.agents(id,workspace_id,name,handle) VALUES($1,$2,'Claim test',$3)",
      [product, workspace, handle],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await store.pool.query(
    `INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
     VALUES($1,$2,$3,$4,'claim-test','{}')`,
    [product, workspace, tenant, id],
  );
  return { owner, workspace, product };
}

test("claim filters a large tied backlog before selecting the first eligible run", async (t) => {
  const store = await createTestStore(t, () => 100);
  await store.setConcurrency(3, 1);
  await agent(store, "saturated", "busy");
  await agent(store, "paused", "paused", true);
  await agent(store, "revoked", "revoked");
  await agent(store, "eligible", "ready");
  await managed(store, "revoked", "revoked");
  await queue(store, "saturated", "busy", "a-saturated-", 80);
  await queue(store, "paused", "paused", "b-paused-", 80);
  await queue(store, "revoked", "revoked", "c-revoked-", 80);
  await queue(store, "eligible", "ready", "z-ready-", 2);
  await store.pool.query(
    `UPDATE pickler.runs SET status='running',lease_owner='fixture',lease_expires_at=1000
     WHERE id='a-saturated-0001'`,
  );

  let measuring = true;
  const measured: { statement: string; rows: number; configs: number }[] = [];
  observeQueries(store, (statement, result) => {
    if (measuring) {
      measured.push({
        statement,
        rows: result.rows.length,
        configs: result.fields.some((field) => field.name === "config") ? result.rows.length : 0,
      });
    }
  });

  const claimed = await store.claim(100);
  measuring = false;

  assert.equal(measured.length, 6, "claim statement count is independent of backlog length");
  assert.equal(Math.max(...measured.map((query) => query.rows)), 1);
  assert.equal(
    measured.reduce((sum, query) => sum + query.configs, 0),
    1,
  );
  assert.equal(
    measured.filter((query) => /^\s*(with|select)/i.test(query.statement) && query.configs > 0)
      .length,
    0,
    "only UPDATE RETURNING transfers the chosen configuration snapshot",
  );
  assert.equal(claimed?.id, "z-ready-0001");
  assert.deepEqual(claimed?.config, snapshot);
  assert.equal(await store.claim(101), null);
  const queued = await store.pool.query(
    "SELECT count(*)::int AS n FROM pickler.runs WHERE status='queued'",
  );
  assert.equal(queued.rows[0].n, 240);
});

test("claim cancels at most fifty stale snapshots and still reaches an eligible run", async (t) => {
  const store = await createTestStore(t, () => 100);
  await agent(store, "stale", "stale");
  await agent(store, "ready", "ready");
  await store.pool.query("UPDATE pickler.agents SET version=2 WHERE tenant_id='stale'");
  await queue(store, "stale", "stale", "a-stale-", 205);
  await queue(store, "ready", "ready", "z-ready-");

  assert.equal((await store.claim(100))?.id, "z-ready-0001");
  const first = await store.pool.query(
    "SELECT count(*)::int AS n FROM pickler.runs WHERE status='cancelled' AND error='CONFIG_CHANGED'",
  );
  assert.equal(first.rows[0].n, 50);
  assert.equal(await store.claim(101), null);
  const second = await store.pool.query(
    "SELECT count(*)::int AS n FROM pickler.runs WHERE status='cancelled'",
  );
  assert.equal(second.rows[0].n, 100);
  const ordered = await store.pool.query(
    "SELECT max(id) AS id FROM pickler.runs WHERE status='cancelled'",
  );
  assert.equal(ordered.rows[0].id, "a-stale-0100");
});

test("claim skips an agent locked by another transaction without consuming its queue", async (t) => {
  const store = await createTestStore(t, () => 100);
  await agent(store, "locked", "locked");
  await agent(store, "ready", "ready");
  await queue(store, "locked", "locked", "a-locked-");
  await queue(store, "ready", "ready", "z-ready-");
  const locker = await store.connectPeer().pool.connect();
  try {
    await locker.query("BEGIN");
    await locker.query("SELECT id FROM pickler.agents WHERE tenant_id='locked' FOR UPDATE");

    assert.equal((await store.claim(100))?.id, "z-ready-0001");

    await locker.query("ROLLBACK");
    assert.equal((await store.claim(101))?.id, "a-locked-0001");
  } finally {
    await locker.query("ROLLBACK");
    locker.release();
  }
});

test("parallel claims serialize shared capacity and preserve private lease ownership", async (t) => {
  const store = await createTestStore(t, () => 100);
  const peer = store.connectPeer();
  await store.setConcurrency(1, 1);
  await agent(store, "first", "first");
  await agent(store, "second", "second");
  await queue(store, "first", "first", "a-first-");
  await queue(store, "second", "second", "b-second-");

  const results = await Promise.all([store.claim(100), peer.claim(100)]);

  assert.equal(results.filter(Boolean).length, 1);
  const index = results.findIndex(Boolean);
  const claimed = results[index]!;
  assert.equal(claimed.id, "a-first-0001");
  await (index === 0 ? store : peer).assertOwnership(claimed);
  await assert.rejects((index === 0 ? peer : store).assertOwnership(claimed), {
    code: "LEASE_LOST",
  });
});

test("research claims count preview and advice running capacity across lanes", async (t) => {
  const store = await createTestStore(t, () => 100);
  await store.setConcurrency(3, 1);
  await agent(store, "preview", "preview");
  await agent(store, "advice", "advice");
  await agent(store, "ready", "ready");
  const preview = await managed(store, "preview", "preview");
  const advice = await managed(store, "advice", "advice");
  await store.pool.query(
    `INSERT INTO pickler.preview_runs(id,user_id,workspace_id,tenant_id,status,created_at,expires_at,
      lease_owner,lease_expires_at,config,fingerprint)
     VALUES('preview',$1,$2,'preview','running',0,1000,'fixture',1000,$3,'fixture')`,
    [preview.owner, preview.workspace, snapshot],
  );
  await store.pool.query(
    `INSERT INTO pickler.advice_jobs(id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,
      status,created_at,config_version,config,policy,lease_owner,lease_expires_at)
     VALUES($1,$2,'advice','advice',$3,'fixture','BTC','running',0,1,$4,'{}',$5,1000)`,
    [randomUUID(), advice.product, advice.owner, snapshot, randomUUID()],
  );
  await store.pool.query(
    "INSERT INTO pickler.research_access(user_id,enabled) VALUES($1,true),($2,true)",
    [preview.owner, advice.owner],
  );
  await queue(store, "preview", "preview", "a-preview-");
  await queue(store, "advice", "advice", "b-advice-");
  await queue(store, "ready", "ready", "z-ready-");

  assert.equal((await store.claim(100))?.id, "z-ready-0001");
  assert.equal(await store.claim(101), null);
});

test("same-agent exclusion holds even with spare tenant capacity", async (t) => {
  const store = await createTestStore(t, () => 100);
  await store.setConcurrency(3, 2);
  await agent(store, "tenant", "busy");
  await agent(store, "tenant", "ready");
  await queue(store, "tenant", "busy", "a-busy-", 2);
  await queue(store, "tenant", "ready", "z-ready-");
  await store.pool.query(
    `UPDATE pickler.runs SET status='running',lease_owner='fixture',lease_expires_at=1000
     WHERE id='a-busy-0001'`,
  );

  assert.equal((await store.claim(100))?.id, "z-ready-0001");
  assert.equal((await store.run("tenant", "a-busy-0002")).status, "queued");
});

test("claim rechecks creator authorization after candidate selection", async (t) => {
  const store = await createTestStore(t, () => 100);
  const peer = store.connectPeer();
  await agent(store, "managed", "managed");
  const identity = await managed(store, "managed", "managed");
  await store.pool.query("INSERT INTO pickler.research_access(user_id,enabled) VALUES($1,true)", [
    identity.owner,
  ]);
  await queue(store, "managed", "managed", "managed-");
  let revoked = false;
  observeQueries(store, async (_statement, result) => {
    if (!revoked && result.rows[0]?.tenantId === "managed" && result.rows[0]?.configVersion === 1) {
      revoked = true;
      await peer.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
        identity.owner,
      ]);
    }
  });

  assert.equal(await store.claim(100), null);
  assert.equal(revoked, true);
  assert.equal((await store.run("managed", "managed-0001")).status, "queued");
});
