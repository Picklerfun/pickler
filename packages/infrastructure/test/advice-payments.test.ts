import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { PilotError, type Authorization } from "@pickler/core";
import { PostgresAdvicePayments } from "../src/persistence/advice-payments.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

const hex = (bytes: number) => randomBytes(bytes).toString("hex");
const CHECKSUMMED = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";

async function setup(t: TestContext) {
  const db = await createTestStore(t);
  const pool = db.pool;
  const owner = randomUUID();
  const buyer = randomUUID();
  const agentId = randomUUID();
  await pool.query("SELECT identity.create_profile($1,'Maker','pay_owner')", [owner]);
  await pool.query("SELECT identity.create_profile($1,'Buyer','pay_buyer')", [buyer]);
  const studio = new PostgresStudioDirectory(pool);
  await studio.onboard(owner);
  const access = (await studio.access(owner, null))!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at)
       VALUES($1,$2,'Analyst','analyst','active','public',now())`,
      [agentId, access.workspaceId],
    );
    await client.query("INSERT INTO identity.handles(handle,agent_id) VALUES('analyst',$1)", [
      agentId,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await pool.query(
    "INSERT INTO pickler.agents(tenant_id,id,version,config) VALUES($1,'runtime-pay',1,'{}')",
    [access.tenantId],
  );
  await pool.query(
    `INSERT INTO pickler.product_agents(product_agent_id,workspace_id,tenant_id,runtime_agent_id,request_key,request)
     VALUES($1,$2,$3,'runtime-pay','pay-create','{}')`,
    [agentId, access.workspaceId, access.tenantId],
  );
  await pool.query(
    `INSERT INTO identity.wallet_links(user_id,namespace,verified_chain,address,method,kind,verified_at)
     VALUES($1,'eip155','eip155:10143',$2,'siwe','external',now())`,
    [buyer, CHECKSUMMED.toLowerCase()],
  );
  const walletId = `wallet-${hex(12)}`;
  const payTo = `0x${hex(20)}`;
  const link = async () => {
    await pool.query(
      `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
       VALUES ($1,$2,$3,'agent','Agent wallet 1',ARRAY['p1','p2','p3'])`,
      [owner, walletId, `sub-${hex(12)}`],
    );
    await pool.query(
      `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
       VALUES ($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/44')`,
      [walletId, payTo],
    );
    await pool.query(
      "INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,ARRAY['p1','p2','p3'])",
      [agentId, walletId],
    );
  };
  const price = (micro: string | null) =>
    pool.query("UPDATE agents.agents SET advice_price_micro_ausd=$2 WHERE id=$1", [agentId, micro]);
  const auth = (nonce = `0x${hex(32)}`, from = CHECKSUMMED): Authorization => ({
    from,
    to: payTo,
    value: "1500000",
    validAfter: "0",
    validBefore: "1900000000",
    nonce,
  });
  const store = new PostgresAdvicePayments(pool);
  const insert = (key: string, authorization: Authorization, userId = buyer) =>
    store.insertPending({ userId, publicAgentId: agentId, key, authorization });
  const row = async (key: string) =>
    (
      await pool.query(
        "SELECT * FROM pickler.advice_payments WHERE public_agent_id=$1 AND request_key=$2",
        [agentId, key],
      )
    ).rows[0];
  return {
    pool,
    store,
    tenantId: access.tenantId,
    agentId,
    owner,
    buyer,
    payTo,
    link,
    price,
    auth,
    insert,
    row,
  };
}

const conflict = (error: unknown) => error instanceof PilotError && error.code === "CONFLICT";

test("saleTerms returns price, wallet and handle, and null when not for sale", async (t) => {
  const f = await setup(t);
  assert.equal(await f.store.saleTerms(f.agentId), null, "no price, no wallet");
  await f.price("1500000");
  assert.equal(await f.store.saleTerms(f.agentId), null, "priced but no wallet account");
  await f.link();
  assert.deepEqual(await f.store.saleTerms(f.agentId), {
    priceMicro: 1500000n,
    payTo: f.payTo,
    handle: "analyst",
  });
  await f.price(null);
  assert.equal(await f.store.saleTerms(f.agentId), null, "null price");
  await f.price("1500000");
  await f.pool.query(
    "UPDATE agents.agents SET visibility='private', published_at=NULL WHERE id=$1",
    [f.agentId],
  );
  assert.equal(await f.store.saleTerms(f.agentId), null, "not public");
});

test("payerLinked ignores address case and the buyer's identity", async (t) => {
  const f = await setup(t);
  assert.equal(await f.store.payerLinked(f.buyer, CHECKSUMMED), true);
  assert.equal(
    await f.store.payerLinked(f.buyer, CHECKSUMMED.toUpperCase().replace("0X", "0x")),
    true,
  );
  assert.equal(await f.store.payerLinked(f.owner, CHECKSUMMED), false);
  assert.equal(await f.store.payerLinked(f.buyer, `0x${hex(20)}`), false);
});

test("insertPending stores lowercase and byKey returns payer, nonce and validBefore", async (t) => {
  const f = await setup(t);
  const nonce = `0x${hex(32).toUpperCase()}`;
  const created = await f.insert("k1", f.auth(nonce));
  assert.equal(created.status, "pending");
  assert.equal(created.payer, CHECKSUMMED.toLowerCase());
  assert.equal(created.nonce, nonce.toLowerCase());
  assert.equal(created.validBefore, "1900000000");
  const stored = await f.row("k1");
  assert.equal(stored.pay_to, f.payTo.toLowerCase());
  assert.equal(stored.amount_micro_ausd, "1500000");
  assert.deepEqual(await f.store.byKey(f.buyer, f.agentId, "k1"), created);
  assert.equal(await f.store.byKey(f.buyer, f.agentId, "other"), null);
  assert.equal(await f.store.byKey(f.owner, f.agentId, "k1"), null);
});

test("a reused nonce under another key is CONFLICT", async (t) => {
  const f = await setup(t);
  const nonce = `0x${hex(32)}`;
  await f.insert("k1", f.auth(nonce));
  await assert.rejects(f.insert("k2", f.auth(nonce.toUpperCase().replace("0X", "0x"))), conflict);
});

test("settled, attachJob and refundOwed update the row", async (t) => {
  const f = await setup(t);
  const { id } = await f.insert("k1", f.auth());
  const txHash = `0x${hex(32)}`;
  await f.store.settled(id, txHash, 42n);
  let stored = await f.row("k1");
  assert.equal(stored.status, "settled");
  assert.equal(stored.block_number, "42");
  const read = await f.store.byKey(f.buyer, f.agentId, "k1");
  assert.equal(read?.status, "settled");
  assert.equal(read?.txHash, txHash);

  const jobId = randomUUID();
  await f.pool.query(
    `INSERT INTO pickler.advice_jobs
       (id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,status,created_at,config_version,config,policy)
     VALUES ($1,$2,$3,'runtime-pay',$4,'job-key','BTC','queued',1,1,'{}','{}')`,
    [jobId, f.agentId, f.tenantId, f.buyer],
  );
  await f.store.attachJob(id, jobId);
  assert.equal((await f.row("k1")).job_id, jobId);

  await f.store.refundOwed(id, "queue closed");
  stored = await f.row("k1");
  assert.equal(stored.status, "refund_owed");
  assert.equal(stored.error, "queue closed");
});

test("insertPending over a pending or settled row is CONFLICT and leaves it unchanged", async (t) => {
  const f = await setup(t);
  const first = f.auth();
  await f.insert("pending", first);
  await assert.rejects(f.insert("pending", f.auth()), conflict);
  assert.equal((await f.row("pending")).nonce, first.nonce.toLowerCase());
  assert.equal((await f.row("pending")).status, "pending");

  const { id } = await f.insert("done", f.auth());
  await f.store.settled(id, `0x${hex(32)}`, 7n);
  await assert.rejects(f.insert("done", f.auth()), conflict);
  const stored = await f.row("done");
  assert.equal(stored.status, "settled");
  assert.equal(stored.block_number, "7");
});

test("insertPending over a failed row reuses it with the new nonce", async (t) => {
  const f = await setup(t);
  const { id } = await f.insert("k1", f.auth());
  await f.store.failed(id, "rejected");
  assert.equal((await f.row("k1")).status, "failed");

  const next = f.auth();
  const again = await f.insert("k1", next);
  assert.notEqual(again.id, id);
  assert.equal(again.status, "pending");
  assert.equal(again.nonce, next.nonce.toLowerCase());
  const stored = await f.row("k1");
  assert.equal(stored.error, null);
  assert.equal(stored.tx_hash, null);
});

async function settle(promises: Promise<unknown>[]) {
  const results = await Promise.allSettled(promises);
  const won = results.filter((r) => r.status === "fulfilled");
  const lost = results.filter((r) => r.status === "rejected");
  return { won, lost };
}

test("two concurrent insertPending on a fresh key: exactly one wins", async (t) => {
  const f = await setup(t);
  const { won, lost } = await settle([f.insert("race", f.auth()), f.insert("race", f.auth())]);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(conflict((lost[0] as PromiseRejectedResult).reason));
});

test("two concurrent insertPending over a failed row: exactly one wins", async (t) => {
  const f = await setup(t);
  const { id } = await f.insert("race", f.auth());
  await f.store.failed(id, "rejected");
  const { won, lost } = await settle([f.insert("race", f.auth()), f.insert("race", f.auth())]);
  assert.equal(won.length, 1);
  assert.equal(lost.length, 1);
  assert.ok(conflict((lost[0] as PromiseRejectedResult).reason));
  assert.equal((await f.row("race")).status, "pending");
});

test("a stale failed(oldId) after reuse leaves the newer pending attempt untouched", async (t) => {
  const f = await setup(t);
  const { id: oldId } = await f.insert("k1", f.auth());
  await f.store.failed(oldId, "expired_unsettled");
  const next = f.auth();
  await f.insert("k1", next);

  await f.store.failed(oldId, "settlement_failed");

  const stored = await f.row("k1");
  assert.equal(stored.status, "pending");
  assert.equal(stored.nonce, next.nonce.toLowerCase());
  assert.equal(stored.error, null);
});

test("settled, failed and refundOwed are no-ops outside their expected status", async (t) => {
  const f = await setup(t);
  const { id } = await f.insert("k1", f.auth());
  await f.store.refundOwed(id, "too early");
  assert.equal((await f.row("k1")).status, "pending");

  const txHash = `0x${hex(32)}`;
  await f.store.settled(id, txHash, 1n);
  await f.store.settled(id, `0x${hex(32)}`, 2n);
  await f.store.failed(id, "late");
  const stored = await f.row("k1");
  assert.equal(stored.status, "settled");
  assert.equal(stored.tx_hash, txHash);
  assert.equal(stored.block_number, "1");
  assert.equal(stored.error, null);
});

test("attachJob is a no-op on a row that already has a job or is not settled", async (t) => {
  const f = await setup(t);
  const { id } = await f.insert("k1", f.auth());
  const jobs = [randomUUID(), randomUUID()];
  for (const [index, jobId] of jobs.entries()) {
    await f.pool.query(
      `INSERT INTO pickler.advice_jobs
         (id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,status,created_at,config_version,config,policy)
       VALUES ($1,$2,$3,'runtime-pay',$4,$5,'BTC',$6,1,1,'{}','{}')`,
      [jobId, f.agentId, f.tenantId, f.buyer, `job-${index}`, index === 0 ? "queued" : "failed"],
    );
  }

  await f.store.attachJob(id, jobs[0]!);
  assert.equal((await f.row("k1")).job_id, null);

  await f.store.settled(id, `0x${hex(32)}`, 1n);
  await f.store.attachJob(id, jobs[0]!);
  await f.store.attachJob(id, jobs[1]!);
  assert.equal((await f.row("k1")).job_id, jobs[0]);
});
