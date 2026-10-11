import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createTokenOperationService,
  type TokenOperationDriver,
  type TokenLaunchRepository,
  prepareDraft,
  DEFAULT_BRIEF,
  STARTER_CAPS,
} from "@pickler/core";
import { tokenFixture, controlledMaster } from "./token-fixture.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { runTokenIndexer } from "../src/launch/indexer.js";
import { launchPolicy } from "./launch-policy-fixture.js";
const signed = {
  url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
  body: "controlled",
  stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
};
function driver() {
  let signs = 0,
    sends = 0;
  const result: TokenOperationDriver = {
    ready: true,
    async prepare(_s, i) {
      return {
        operationId: i.id,
        chainId: 10143,
        sender: controlledMaster,
        destination: "0x1111111111111111111111111111111111111111",
        unsignedTransaction: "0x02",
        transactionNonce: 0,
        gas: "1",
        maxFeePerGas: "1",
        maximumGasCost: "1",
        deadline: i.deadline,
        activity: { ...signed, organizationId: "controlled", timestampMs: "1" },
      };
    },
    async sign() {
      signs++;
      return { activityId: "controlled", status: "completed", rawTransaction: "0x02aa" };
    },
    async activity() {
      throw new Error("No automatic calls");
    },
    async verify() {
      return "0x" + "a".repeat(64);
    },
    async preflight() {},
    async broadcast() {
      sends++;
      return "0x" + "a".repeat(64);
    },
    async receipt() {
      return { status: "finalized", blockHash: "0x" + "b".repeat(64) };
    },
  };
  return { result, counts: () => ({ signs, sends }) };
}
test("durable intent, compare-and-set signing and recovery survive a new service instance", async (t) => {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, { expectedVersion: 0, name: "Controlled", ticker: "CTRL" });
  const d = driver();
  const service = () =>
    createTokenOperationService({
      repository: f.repository,
      tokens: f.service,
      chainId: 10143,
      driver: d.result,
    });
  const p = await service().prepare(
    f.scope,
    { action: "launch", expectedVersion: 1 },
    "controlled_operation_001",
  );
  const attempts = await Promise.allSettled([
    service().confirm(f.scope, p.operation.id, p.operation.version, signed),
    service().confirm(f.scope, p.operation.id, p.operation.version, signed),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.deepEqual(d.counts(), { signs: 1, sends: 1 });
  assert.equal((await service().status(f.scope, p.operation.id)).status, "finalized");
  const state = await f.service.state(f.scope);
  assert.equal(state.confirmation, "pending");
  assert.equal(state.operation?.status, "finalized");
  await assert.rejects(service().status({ ...f.scope, userId: randomUUID() }, p.operation.id));
  const privateTables = await f.store.pool.query(
    "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('launch.operations'::regclass,'launch.indexer_admission'::regclass,'market.kuru_graduations'::regclass)",
  );
  assert.ok(privateTables.rows.every((r) => r.relrowsecurity));
});
test("two agents of one master wallet cannot prepare competing nonces", async (t) => {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, { expectedVersion: 0, name: "First", ticker: "FIRST" });
  const walletId = "controlled-" + randomUUID();
  await f.store.pool.query(
    "INSERT INTO wallets.wallets(user_id,wallet_id,sub_organization_id,kind,name,approved_policy_ids) VALUES($1,$2,'controlled','agent','Second',ARRAY['p1','p2','p3'])",
    [f.scope.userId, walletId],
  );
  const prepared = prepareDraft({
    name: "Second",
    handle: "second_" + randomUUID().slice(0, 8),
    markets: ["BTC"],
    voice: "analyst",
    avatar: { accent: "lime", pattern: 1 },
    sources: { web: null },
    brief: DEFAULT_BRIEF,
    caps: STARTER_CAPS,
    walletId,
  });
  const agent = await f.directory.createDraft(f.access, f.scope.userId, {
    ...prepared,
    walletId,
    name: "Second",
    handle: "second_" + randomUUID().slice(0, 8),
  });
  const second = { ...f.scope, agentId: agent.productId };
  await f.store.pool.query(
    "UPDATE agents.agents SET visibility='public',published_at=now() WHERE id=$1",
    [second.agentId],
  );
  await f.service.saveDraft(second, { expectedVersion: 0, name: "Second", ticker: "SCND" });
  const d = driver();
  const ops = createTokenOperationService({
    repository: f.repository,
    tokens: f.service,
    chainId: 10143,
    driver: d.result,
  });
  const attempts = await Promise.allSettled([
    ops.prepare(f.scope, { action: "launch", expectedVersion: 1 }, "controlled_operation_001"),
    ops.prepare(second, { action: "launch", expectedVersion: 1 }, "controlled_operation_002"),
  ]);
  assert.equal(attempts.filter((a) => a.status === "fulfilled").length, 1);
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM launch.operations")).rows[0].count,
    "1",
  );
  assert.deepEqual(d.counts(), { signs: 0, sends: 0 });
});
test("indexer admission fences concurrent passes and reserves its UTC daily budget before RPC", async (t) => {
  const f = await tokenFixture(t);
  const store = new PostgresLaunchIndexStore(f.store.pool.options.connectionString!);
  try {
    const chain = "eip155:10143";
    await store.pool.query(
      "INSERT INTO launch.indexer_admission(chain,owner,expires_at,day,requests) VALUES($1,$2,now()+interval '1 minute',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'),0)",
      [chain, randomUUID()],
    );
    let calls = 0;
    const rpc = {
      async call() {
        calls++;
        throw new Error("RPC must not run");
      },
    };
    const input = {
      store,
      rpc,
      launchPolicy: JSON.stringify(launchPolicy()),
      indexerPolicy: JSON.stringify({
        version: 1,
        maxBlocks: 100,
        rpcRequestsPerPass: 400,
        rpcRequestsPerDay: 1,
        leaseSeconds: 30,
        maxCurvesPerPass: 10,
      }),
    };
    assert.deepEqual(await runTokenIndexer(input), { kind: "busy" });
    assert.equal(calls, 0);
    await store.pool.query(
      "UPDATE launch.indexer_admission SET owner=NULL,expires_at=NULL,requests=1",
    );
    await assert.rejects(runTokenIndexer(input), /INDEX_LEASE_OR_DAILY_BUDGET/);
    assert.equal(calls, 0);
    const row = (await store.pool.query("SELECT owner,requests FROM launch.indexer_admission"))
      .rows[0];
    assert.equal(row.owner, null);
    assert.equal(row.requests, 1);
  } finally {
    await store.close();
  }
});

test("bounded token indexer catches up all four streams with shared block reads and explicit RPC reserves", async (t) => {
  const f = await tokenFixture(t),
    store = new PostgresLaunchIndexStore(f.store.pool.options.connectionString!);
  const p = launchPolicy(),
    hash = (n: bigint) => "0x" + n.toString(16).padStart(64, "0");
  let calls = 0,
    blockCalls = 0;
  let active = 0;
  let peak = 0;
  const rpc = {
    async call(method: string, params: unknown[]) {
      active++;
      peak = Math.max(peak, active);
      try {
        const ordinal = ++calls;
        const reserved = (await store.pool.query("SELECT requests FROM launch.indexer_admission"))
          .rows[0].requests;
        assert.ok(reserved >= ordinal);
        if (method === "eth_chainId") {
          return "0x279f";
        }
        if (method === "eth_getCode") {
          return "0x6000";
        }
        if (method === "eth_getBlockByNumber") {
          blockCalls++;
          const n = params[0] === "latest" ? 220n : BigInt(String(params[0]));
          return {
            number: "0x" + n.toString(16),
            hash: hash(n),
            parentHash: hash(n - 1n),
            timestamp: "0x" + (1700000000n + n).toString(16),
          };
        }
        if (method === "eth_getLogs") {
          const q = params[0] as { fromBlock: string; toBlock: string };
          assert.ok(BigInt(q.toBlock) - BigInt(q.fromBlock) < 100n);
          return [];
        }
        throw new Error("Unexpected RPC: " + method);
      } finally {
        active--;
      }
    },
  };
  try {
    for (let i = 0; i < 4; i++) {
      const result = await runTokenIndexer({
        store,
        rpc,
        launchPolicy: JSON.stringify(p),
        indexerPolicy: JSON.stringify({
          version: 1,
          maxBlocks: 100,
          rpcRequestsPerPass: 400,
          rpcRequestsPerDay: 2000,
          leaseSeconds: 30,
          maxCurvesPerPass: 10,
        }),
      });
      assert.equal(result.kind, "completed");
    }
    for (const d of [p.factory, p.adapter, p.escrow, p.locker]) {
      assert.equal(
        (await store.readCursor("eip155:10143", d.address, "token-launch-v1"))?.lastBlock,
        218n,
      );
    }
    assert.ok(peak > 1 && peak <= 4, "RPC concurrency exceeded four calls");
    assert.equal(active, 0, "RPC calls outlived their lease");
    assert.ok(blockCalls < 300, "shared ancestry was fetched again for each contract");
    assert.ok(calls < 400, "controlled catch-up exceeded its reserved RPC budget");
  } finally {
    await store.close();
  }
});

import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
test("operational migrations preserve historical records and revoke permissive public defaults", async (t) => {
  const f = await tokenFixture(t);
  await f.store.pool.query(
    "INSERT INTO launch.drafts(owner_id,agent_id,chain,params,version) VALUES($1,$2,'eip155:10143',$3,4)",
    [f.scope.userId, f.scope.agentId, { name: "Historical", ticker: "HIST", preserved: true }],
  );
  const tables = ["launch.drafts", "launch.grants", "launch.agent_keys", "wallets.wallet_accounts"];
  const rows = () =>
    Promise.all(
      tables.map(
        async (table) =>
          (
            await f.store.pool.query(
              `SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`,
            )
          ).rows,
      ),
    );
  const before = await rows();
  const migrations = readMigrationFiles({ migrationsFolder }).slice(41, 45);
  await f.store.pool.query(
    "DROP TABLE launch.operations,launch.indexer_admission,market.kuru_graduations",
  );
  await f.store.pool.query("ALTER TABLE market.pools DROP CONSTRAINT pools_venue");
  await f.store.pool.query(
    "ALTER TABLE market.pools ADD CONSTRAINT pools_venue CHECK(venue IN ('pickler_curve','pons','uniswap_v4'))",
  );
  await f.store.pool.query(
    "DELETE FROM pickler_migrations.__drizzle_migrations WHERE hash=ANY($1::text[])",
    [migrations.map((m) => m.hash)],
  );
  await f.store.pool.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA launch GRANT SELECT ON TABLES TO PUBLIC",
  );
  await f.store.pool.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA market GRANT SELECT ON TABLES TO PUBLIC",
  );
  await Promise.all([migrateDatabase(f.store.pool), migrateDatabase(f.store.pool)]);
  assert.deepEqual(await rows(), before);
  const privacy = await f.store.pool.query(
    `SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('launch.operations'::regclass,'launch.indexer_admission'::regclass,'market.kuru_graduations'::regclass)`,
  );
  assert.ok(privacy.rows.every((r) => r.relrowsecurity));
  const grants = await f.store.pool.query(
    `SELECT acl.grantee FROM pg_class c,LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl WHERE c.oid IN ('launch.operations'::regclass,'launch.indexer_admission'::regclass,'market.kuru_graduations'::regclass) AND acl.grantee=0`,
  );
  assert.equal(grants.rowCount, 0);
});

test("trade intents persist exact parameters, isolate owners and survive concurrent confirmation", async (t) => {
  const f = await tokenFixture(t);
  // This test controls the confirmed projection; canonical event attribution is covered separately.
  const repository: TokenLaunchRepository = {
    transaction: (scope, chain, work) =>
      f.repository.transaction(scope, chain, (tx) =>
        work({
          ...tx,
          context: {
            ...tx.context,
            token: {
              name: "Controlled",
              ticker: "CTRL",
              address: "0x" + "2".repeat(40),
              chainId: 10143,
              imageUri: null,
              avatar: { accent: "lime", pattern: 1 },
            },
          },
        }),
      ),
  };
  const d = driver();
  const service = () =>
    createTokenOperationService({
      repository,
      tokens: f.service,
      chainId: 10143,
      driver: d.result,
    });
  for (const action of ["approve_buy", "buy", "approve_sell", "sell"] as const) {
    const trade = {
      amount: action.endsWith("sell") ? "1000000000000000000000" : "1000000",
      slippageBps: 50,
    };
    const input = { action, trade, expectedVersion: 0 };
    const key = "controlled_trade_" + action;
    const p = await service().prepare(f.scope, input, key);
    assert.equal((await service().prepare(f.scope, input, key)).operation.id, p.operation.id);
    await assert.rejects(
      service().prepare(f.scope, { ...input, trade: { ...trade, amount: "1" } }, key),
      /TOKEN_IDEMPOTENCY_CONFLICT/,
    );
    const payload = (
      await f.store.pool.query("SELECT payload FROM launch.operations WHERE id=$1", [
        p.operation.id,
      ])
    ).rows[0].payload;
    assert.deepEqual(payload.trade, trade);
    await assert.rejects(
      service().confirm(
        { ...f.scope, userId: randomUUID() },
        p.operation.id,
        p.operation.version,
        signed,
      ),
      /TOKEN_OWNER_REQUIRED/,
    );
    const confirmations = await Promise.allSettled([
      service().confirm(f.scope, p.operation.id, p.operation.version, signed),
      service().confirm(f.scope, p.operation.id, p.operation.version, signed),
    ]);
    assert.equal(confirmations.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await service().status(f.scope, p.operation.id)).status, "finalized");
  }
  assert.deepEqual(d.counts(), { signs: 4, sends: 4 });
  assert.equal(
    (await f.store.pool.query("SELECT count(*) FROM launch.operations")).rows[0].count,
    "4",
  );
  await assert.rejects(
    f.store.pool.query("UPDATE launch.operations SET action='arbitrary'"),
    (e: unknown) => (e as { code: string }).code === "23514",
  );
  assert.equal(
    (
      await f.store.pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='launch.operations'::regclass",
      )
    ).rows[0].relrowsecurity,
    true,
  );
});
