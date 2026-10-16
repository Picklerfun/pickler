import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "@pickler/core";
import { PostgresExecutionReads } from "../src/persistence/execution-reads.js";
import { createTestStore } from "./database.js";

test("summary keysets bound large historical snapshots and preserve tied timestamps", async (t) => {
  const store = await createTestStore(t);
  await store.pool.query(
    `INSERT INTO pickler.runs(id,tenant_id,agent_id,request_key,trigger,status,created_at,config_version,config)
    SELECT 'history-'||lpad(i::text,4,'0'),'alpha','pickle-alpha','history-'||i,'manual','completed',10,1,$1 FROM generate_series(1,125) i`,
    [{ ...DEFAULT_CONFIG, brief: "x".repeat(200000) }],
  );
  const reads = new PostgresExecutionReads(store.pool);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await reads.summaries("alpha", "pickle-alpha", { cursor });
    assert.ok(page.items.length <= 20);
    assert.ok(page.items.every((row) => !("config" in row) && !("decision" in row)));
    ids.push(...page.items.map((row) => row.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(ids.length, 125);
  assert.equal(new Set(ids).size, 125);
  assert.ok(
    Buffer.byteLength(JSON.stringify(await reads.summaries("alpha", "pickle-alpha", {}))) < 20000,
  );
  assert.equal(ids[0], "history-0125");
  assert.equal(ids.at(-1), "history-0001");
  const first = await reads.summaries("alpha", "pickle-alpha", {});
  await assert.rejects(reads.summaries("beta", "pickle-beta", { cursor: first.nextCursor! }), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(reads.status("research", "beta", ids[0]!, 100), { code: "NOT_FOUND" });
});

test("event pages bound bytes and rows, reference oversized evidence and include appended events", async (t) => {
  const store = await createTestStore(t);
  await store.updateConfig({ tenantId: "alpha", agentId: "pickle-alpha" }, 1, {
    ...DEFAULT_CONFIG,
    categoryIds: ["1"],
  });
  const run = await store.enqueue(
    { tenantId: "alpha", agentId: "pickle-alpha" },
    "events",
    null,
    10,
  );
  await store.pool.query(
    `INSERT INTO pickler.events(run_id,type,data,created_at) SELECT $1,'source',jsonb_build_object('body',repeat('x',12000)),10 FROM generate_series(1,120)`,
    [run.id],
  );
  await store.pool.query(
    "INSERT INTO pickler.events(run_id,type,data,created_at) VALUES($1,'document',$2,10)",
    [run.id, { body: "BIG".repeat(200000) }],
  );
  const reads = new PostgresExecutionReads(store.pool);
  const ids: string[] = [];
  let after = "0";
  let pages = 0;
  let oversized: string | undefined;
  do {
    const page = await reads.events("research", "alpha", run.id, { after, limit: 100 }, 100);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 256 * 1024);
    assert.ok(page.items.length <= 100);
    for (const event of page.items) {
      ids.push(event.id);
      if ("oversized" in event && event.oversized) {
        oversized = event.id;
      }
    }
    pages++;
    after = page.nextCursor ?? after;
    if (!page.hasMore) {
      break;
    }
  } while (pages < 20);
  assert.ok(pages > 1);
  assert.equal(ids.length, 121);
  assert.equal(new Set(ids).size, 121);
  assert.ok(oversized);
  const detail = await reads.event("research", "alpha", run.id, oversized, 100);
  assert.equal("data" in detail && (detail.data as { body: string }).body.length, 600000);
  await store.pool.query(
    "INSERT INTO pickler.events(run_id,type,data,created_at) VALUES($1,'finished','{}',11)",
    [run.id],
  );
  const tail = await reads.events("research", "alpha", run.id, { after }, 100);
  assert.equal(tail.items.length, 1);
  assert.equal(tail.items[0]?.type, "finished");
  await assert.rejects(reads.event("research", "beta", run.id, oversized, 100), {
    code: "NOT_FOUND",
  });
  await assert.rejects(
    reads.events("research", "alpha", run.id, { after: "9999999999999999999" }, 100),
    { code: "INVALID_INPUT" },
  );
  await assert.rejects(reads.events("research", "alpha", run.id, { limit: 101 }, 100), {
    code: "INVALID_INPUT",
  });
});

test("preview status/events preserve owner and expiry and result reads exclude config and trace", async (t) => {
  const store = await createTestStore(t);
  const owner = "11111111-1111-4111-8111-111111111111";
  const workspace = "22222222-2222-4222-8222-222222222222";
  await store.pool.query(
    "INSERT INTO identity.workspaces(id,owner_user_id,name) VALUES($1,$2,'Preview')",
    [workspace, owner],
  );
  await store.pool.query(
    `INSERT INTO pickler.preview_runs(id,user_id,workspace_id,tenant_id,status,created_at,expires_at,config,fingerprint)
    VALUES('preview',$1,$2,'alpha','queued',10,1000,$3,'fixture')`,
    [owner, workspace, DEFAULT_CONFIG],
  );
  await store.pool.query(
    "INSERT INTO pickler.preview_events(preview_run_id,type,data,created_at) VALUES('preview','source','{}',10)",
  );
  const reads = new PostgresExecutionReads(store.pool);
  const state = await reads.status("preview", owner, "preview", 11);
  assert.equal(state.status, "queued");
  assert.ok(state.lastEventId);
  assert.ok(!("config" in state));
  assert.equal((await reads.events("preview", owner, "preview", {}, 11)).items.length, 1);
  assert.ok(!("config" in (await reads.previewResult(owner, "preview", 11))));
  await assert.rejects(reads.status("preview", workspace, "preview", 11), { code: "NOT_FOUND" });
  await assert.rejects(reads.events("preview", owner, "preview", {}, 1000), { code: "NOT_FOUND" });
});

test("Studio snapshots and wallet links use one authorized batch query each, without unrelated configs", async (t) => {
  const store = await createTestStore(t);
  await store.pool.query(
    `INSERT INTO pickler.agents(tenant_id,id,version,config,paused,schedule_enabled,next_due)
    SELECT 'alpha','batch-'||i,1,$1,false,false,0 FROM generate_series(1,45) i`,
    [{ ...DEFAULT_CONFIG, brief: "x".repeat(100000) }],
  );
  let statements = 0;
  let rows = 0;
  const pool = {
    query: async (text: string, values: unknown[]) => {
      statements++;
      const result = await store.pool.query(text, values);
      rows += result.rows.length;
      return result;
    },
  } as unknown as import("pg").Pool;
  const reads = new PostgresExecutionReads(pool);
  const identities = Array.from({ length: 40 }, (_, i) => `batch-${i + 1}`);
  const snapshots = await reads.studioRecords("alpha", identities);
  assert.equal(statements, 1);
  assert.equal(rows, 40);
  assert.equal(snapshots.length, 40);
  assert.ok(snapshots.every((item) => identities.includes(item.agent.id)));
  const foreign = await reads.studioRecords("beta", identities);
  assert.deepEqual(foreign, []);
  statements = 0;
  await reads.studioWallets(["11111111-1111-4111-8111-111111111111"]);
  assert.equal(statements, 1);
});
