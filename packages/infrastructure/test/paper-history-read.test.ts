import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { PaperHistoryEntities } from "@pickler/trading/perps";
import { createTestStore } from "./database.js";
import { historyPage, position } from "../src/persistence/paper-history-read.js";
const scope = {
  tenantId: "alpha",
  agentId: "pickle-alpha",
  sessionId: "history",
  network: "testnet" as const,
};
async function fixture(t: Parameters<typeof createTestStore>[0]) {
  const store = await createTestStore(t);
  // Raw fixture writes use the same writer marker enforced on financial adapters.
  await store.pool.query("SELECT set_config('pickler.paper_writer','2',false)");
  await store.pool.query(
    `INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document) VALUES('history','alpha','pickle-alpha','history','testnet','{}')`,
  );
  await store.pool.query(
    "INSERT INTO pickler.paper_storage(account_id,mode) VALUES('history','operational')",
  );
  await store.pool
    .query(`INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document)
    SELECT 'history','p-'||i,'BTC',1,jsonb_build_object('id','p-'||i,'sizeUps',jsonb_build_array(jsonb_build_object('at',1,'margin','1'))) FROM generate_series(1,125) i`);
  await store.pool.query(`INSERT INTO pickler.perps_paper_attempts(account_id,key,document)
    SELECT 'history','a-'||i,jsonb_build_object('key','a-'||i,'status','filled','createdAt',1) FROM generate_series(1,125) i`);
  await store.pool
    .query(`INSERT INTO pickler.paper_position_sizeups(account_id,position_id,key,at,margin)
    SELECT 'history','p-1','s-'||i,1,'1' FROM generate_series(1,125) i`);
  await store.pool.query(`INSERT INTO pickler.perps_paper_movements(account_id,key,document)
    SELECT 'history','m-'||i,jsonb_build_object('key','m-'||i,'kind','fee','delta','-1','at',1,'evidence',jsonb_build_object('proof',i)) FROM generate_series(1,125) i`);
  await store.pool.query(`INSERT INTO pickler.paper_record_facts(account_id,key,at,kind,delta)
    SELECT 'history','m-'||i,1,'fee','-1' FROM generate_series(1,125) i`);
  return store;
}
test("all four archives page tied timestamps exactly once with a fixed watermark", async (t) => {
  const store = await fixture(t);
  for (const kind of ["positions", "attempts", "movements", "sizeUps"] as const) {
    const seen: PaperHistoryEntities[typeof kind][] = [];
    let page = await historyPage(store.pool, scope, kind);
    assert.equal(page.items.length, 50);
    if (kind === "sizeUps") {
      assert.equal((page.items[0] as PaperHistoryEntities["sizeUps"]).margin, "1");
    }
    const watermark = page.watermark;
    seen.push(...page.items);
    if (kind === "positions") {
      await store.pool.query(
        `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,document) VALUES('history','new-head','BTC','{"id":"new-head"}')`,
      );
    }
    while (page.nextCursor) {
      page = await historyPage(store.pool, scope, kind, { cursor: page.nextCursor });
      assert.equal(page.watermark, watermark);
      assert.ok(page.items.length <= 50);
      seen.push(...page.items);
    }
    assert.equal(seen.length, 125, kind);
    const ids = seen.map((item) => ("id" in item ? item.id : item.key));
    assert.equal(new Set(ids).size, 125, kind);
    if (kind === "positions") {
      assert.ok(seen.every((item) => !("sizeUps" in item)));
      assert.ok(!ids.includes("new-head"));
    }
  }
  assert.equal((await position(store.pool, scope, "p-1"))!.id, "p-1");
  assert.equal(
    await position(store.pool, { ...scope, tenantId: "beta" }, "p-1").catch((e) => e.code),
    "NOT_FOUND",
  );
  const first = await historyPage(store.pool, scope, "positions");
  await assert.rejects(historyPage(store.pool, scope, "attempts", { cursor: first.nextCursor! }), {
    code: "INVALID_INPUT",
  });
  await assert.rejects(historyPage(store.pool, scope, "positions", { limit: 101 }), {
    code: "INVALID_INPUT",
  });
});
test("staged epoch visibility cannot slip behind an existing ledger cursor", async (t) => {
  const store = await fixture(t);
  const epoch = randomUUID();
  await store.pool.query(
    `INSERT INTO pickler.paper_funding_epochs(id,account_id,cutoff_at,max_sequence,anchor)
    VALUES($1,'history',1,0,'{"number":1,"hash":"test","timestamp":1}')`,
    [epoch],
  );
  await store.pool.query(
    `INSERT INTO pickler.paper_funding_postings(account_id,key,epoch_id,delta,document)
    VALUES('history','funding:old-key',$1,'2','{"key":"funding:old-key","kind":"funding","delta":"2","at":1,"evidence":{"original":true}}')`,
    [epoch],
  );
  const first = await historyPage(store.pool, scope, "movements");
  const client = await store.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('pickler.paper_writer','2',true)");
    await client.query(
      "UPDATE pickler.paper_funding_epochs SET status='committed',committed_at=100 WHERE id=$1",
      [epoch],
    );
    await client.query(
      "INSERT INTO pickler.paper_record_facts(account_id,key,at,kind,delta) VALUES('history',$1,100,'funding','2')",
      [`epoch:${epoch}`],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  const items = [...first.items];
  let cursor = first.nextCursor;
  while (cursor) {
    const next = await historyPage(store.pool, scope, "movements", { cursor });
    items.push(...next.items);
    cursor = next.nextCursor;
  }
  assert.equal(items.length, 125);
  assert.ok(items.every((item) => item.key !== "funding:old-key"));
  const fresh = await historyPage(store.pool, scope, "movements");
  assert.equal(fresh.items[0]!.key, "funding:old-key");
  assert.equal(fresh.items[0]!.at, 100);
  assert.deepEqual(fresh.items[0]!.evidence, { original: true });
  await store.pool.query(
    "UPDATE pickler.paper_storage SET mode='legacy' WHERE account_id='history'",
  );
  await assert.rejects(historyPage(store.pool, scope, "movements"), {
    code: "PAPER_MIGRATION_REQUIRED",
  });
});
