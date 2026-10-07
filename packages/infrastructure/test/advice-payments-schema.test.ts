import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

async function setup(t: import("node:test").TestContext) {
  const db = await createTestStore(t);
  const owner = randomUUID();
  const agentId = randomUUID();
  await db.pool.query("SELECT identity.create_profile($1,'Maker','payments_owner')", [owner]);
  const studio = new PostgresStudioDirectory(db.pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at) VALUES($1,$2,'Analyst','analyst','active','public',now())",
      [agentId, access.workspaceId],
    );
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES('analyst',$1)", [
      agentId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await db.pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,'runtime-payments',1,'{}')",
    [access.tenantId],
  );
  await db.pool.query(
    "INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request) VALUES($1,$2,$3,'runtime-payments','payments-create','{}')",
    [agentId, access.workspaceId, access.tenantId],
  );
  return { pool: db.pool, agentId, userId: owner };
}

test("a price outside 0.10–100 AUSD is refused by the database", async (t) => {
  const { pool, agentId } = await setup(t);
  await assert.rejects(
    pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 99999 WHERE id = $1", [agentId]),
    /agents_advice_price_bounds/,
  );
  await assert.rejects(
    pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 100000001 WHERE id = $1", [
      agentId,
    ]),
    /agents_advice_price_bounds/,
  );
  await pool.query("UPDATE agents.agents SET advice_price_micro_ausd = 1500000 WHERE id = $1", [
    agentId,
  ]);
});

test("one nonce pays once, and one key buys once", async (t) => {
  const { pool, agentId, userId } = await setup(t);
  const row = (nonce: string, key: string) =>
    pool.query(
      `INSERT INTO pickler.advice_payments
         (user_id, public_agent_id, request_key, payer, pay_to, amount_micro_ausd, nonce, valid_before, status)
       VALUES ($1,$2,$3,'0xa','0xb',1500000,$4, now() + interval '5 minutes','pending')`,
      [userId, agentId, key, nonce],
    );
  await row("0x01", "key-1");
  await assert.rejects(row("0x01", "key-2"), /advice_payments_nonce_key/);
  await assert.rejects(row("0x02", "key-1"), /advice_payments_request_key/);
});
