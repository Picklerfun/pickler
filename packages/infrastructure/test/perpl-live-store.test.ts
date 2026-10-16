import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_BRIEF, STARTER_CAPS, prepareDraft } from "@pickler/core";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { createPerplLiveService, type PerplLiveDriver } from "@pickler/trading/perpl-live";
import { PostgresPerplLiveStore } from "../src/persistence/perpl-live-store.js";
import { tokenFixture } from "./token-fixture.js";

const unavailableDriver: PerplLiveDriver = {
  async prepareSetup() {
    throw new Error("No provider requests allowed");
  },
  async confirmSetup() {
    throw new Error("No provider requests allowed");
  },
  async reconcileSetup() {
    return { confirmed: false };
  },
  async snapshot() {
    throw new Error("No provider requests allowed");
  },
  async submit() {
    throw new Error("No orders allowed");
  },
  async verifyTransaction() {
    return false;
  },
};
test("real PostgreSQL ownership and concurrent starts admit one bounded session", async (t) => {
  const f = await tokenFixture(t);
  const scope = { userId: f.scope.userId, productAgentId: f.scope.agentId };
  const repository = new PostgresPerplLiveStore(f.store.pool);
  const peer = new PostgresPerplLiveStore(f.store.connectPeer().pool);
  assert.equal((await repository.read(scope)).document, null);
  await assert.rejects(repository.read({ ...scope, userId: randomUUID() }), { code: "NOT_FOUND" });
  await connect(repository, scope);
  const monitored = await f.store.pool.connect();
  const statements: string[] = [];
  const originalQuery = monitored.query;
  const spy = t.mock.method(
    monitored,
    "query",
    function (this: typeof monitored, ...args: unknown[]) {
      if (typeof args[0] === "string") {
        statements.push(args[0]);
      }
      return Reflect.apply(originalQuery, this, args);
    },
  );
  monitored.release();
  try {
    await repository.claimLease(scope, { owner: "controlled-narrow-lease" });
    await repository.releaseLease(scope, { owner: "controlled-narrow-lease" });
    assert.equal(
      statements.some((sql) => sql.includes("FOR UPDATE")),
      true,
    );
    assert.equal(
      statements.some(
        (sql) => sql.includes("product_agent_id<>$1") || sql.includes("pg_advisory_xact_lock"),
      ),
      false,
    );
  } finally {
    spy.mock.restore();
  }

  const terms = { symbol: "BTC", marginMicros: "5000000", leverage: 1, cycles: 1, holdSeconds: 60 };
  const services = [repository, peer].map((repo) =>
    createPerplLiveService({
      repository: repo,
      driver: unavailableDriver,
      admissions: true,
      randomId: randomUUID,
    }),
  );
  const outcomes = await Promise.allSettled(
    services.map((service) => service.start(scope, terms, randomUUID())),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal((await repository.read(scope)).document!.sessions.length, 1);
  const key = (await repository.read(scope)).document!.sessions[0]!.key;
  assert.equal(
    (await services[0]!.start(scope, terms, key)).id,
    (await repository.read(scope)).document!.sessions[0]!.id,
  );

  await f.store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    scope.userId,
  ]);
  await assert.rejects(services[0]!.control(scope, "resume"), { code: "PERPL_ENTRIES_PAUSED" });
  assert.equal((await services[0]!.control(scope, "stop")).status, "stopping");
});
test("private state uses RLS and new migrations preserve existing token grants", async (t) => {
  const f = await tokenFixture(t);
  const saved = await f.service.saveDraft(f.scope, {
    expectedVersion: 0,
    name: "Preserved",
    ticker: "PRSV",
  });
  assert.equal(saved.name, "Preserved");
  const table = await f.store.pool.query<{ relrowsecurity: boolean }>(
    "SELECT relrowsecurity FROM pg_class WHERE oid='pickler.perpl_live_accounts'::regclass",
  );
  assert.equal(table.rows[0]!.relrowsecurity, true);
  const before = await f.store.pool.query("SELECT count(*)::int AS n FROM launch.drafts");
  await new PostgresPerplLiveStore(f.store.pool).inspectKeyChange(
    { userId: f.scope.userId, productAgentId: f.scope.agentId },
    {},
  );
  assert.equal(
    (await f.store.pool.query("SELECT count(*)::int AS n FROM launch.drafts")).rows[0]!.n,
    before.rows[0]!.n,
  );
});
test("upgrade from main's 0047 preserves token draft, grant and migration identities", async (t) => {
  const baseline = await mkdtemp(join(tmpdir(), "pickler-perpl-migration-"));
  t.after(() => rm(baseline, { recursive: true, force: true }));
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 47);
  await mkdir(join(baseline, "meta"));
  await writeFile(join(baseline, "meta/_journal.json"), JSON.stringify(journal));
  await Promise.all(
    journal.entries.map((entry: { tag: string }) =>
      copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(baseline, `${entry.tag}.sql`)),
    ),
  );
  const f = await tokenFixture(t, baseline);
  await f.service.saveDraft(f.scope, { expectedVersion: 0, name: "Keep token", ticker: "KEEP" });
  await f.service.authorize(f.scope, 1, "preserved_grant_001");
  const before = await f.store.pool.query(
    "SELECT hash,created_at FROM pickler_migrations.__drizzle_migrations ORDER BY id",
  );
  const draft = await f.store.pool.query("SELECT * FROM launch.drafts");
  const grant = await f.store.pool.query("SELECT * FROM launch.grants");
  assert.equal(
    (await f.store.pool.query("SELECT to_regclass('pickler.perpl_live_accounts') AS name")).rows[0]!
      .name,
    null,
  );

  await migrateDatabase(f.store.pool);
  await migrateDatabase(f.store.pool);

  assert.deepEqual((await f.store.pool.query("SELECT * FROM launch.drafts")).rows, draft.rows);
  assert.deepEqual((await f.store.pool.query("SELECT * FROM launch.grants")).rows, grant.rows);
  const after = await f.store.pool.query(
    "SELECT hash,created_at FROM pickler_migrations.__drizzle_migrations ORDER BY id",
  );
  assert.deepEqual(after.rows.slice(0, before.rowCount!), before.rows);
  assert.equal(after.rowCount, before.rowCount! + 3);
  assert.equal(
    (
      await f.store.pool.query(
        "SELECT relrowsecurity FROM pg_class WHERE oid='pickler.perpl_live_accounts'::regclass",
      )
    ).rows[0]!.relrowsecurity,
    true,
  );
});

test("key wallets retain custody ownership and a shared account can connect to only one agent", async (t) => {
  const f = await tokenFixture(t);
  const userId = f.scope.userId;
  const walletId = `controlled-${randomUUID()}`;
  await f.store.pool.query(
    "INSERT INTO wallets.wallets(user_id,wallet_id,sub_organization_id,kind,name,approved_policy_ids) VALUES($1,$2,'controlled','agent','Peer',ARRAY['p1','p2','p3'])",
    [userId, walletId],
  );
  await f.store.pool.query(
    "INSERT INTO wallets.wallet_accounts(wallet_id,chain,address,address_format,path) VALUES($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/44')",
    [walletId, "0x" + "77".repeat(20)],
  );
  const handle = `peer_${randomUUID().slice(0, 8)}`;
  const second = await f.directory.createDraft(f.access, userId, {
    ...prepareDraft({
      name: "Peer",
      handle,
      markets: ["BTC"],
      voice: "analyst",
      avatar: { accent: "lime", pattern: 1 },
      sources: { web: null },
      brief: DEFAULT_BRIEF,
      caps: STARTER_CAPS,
      walletId,
    }),
    name: "Peer",
    handle,
    walletId,
  });
  const repository = new PostgresPerplLiveStore(f.store.pool);
  const scopes = [f.scope.agentId, second.productId].map((productAgentId) => ({
    userId,
    productAgentId,
  }));
  const address = "0x" + "22".repeat(20);
  const attempts = await Promise.allSettled(
    scopes.map((scope) => connect(repository, scope, address)),
  );

  assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
  const rejected = attempts.find((r) => r.status === "rejected") as PromiseRejectedResult;
  assert.equal(rejected.reason.code, "PERPL_ACCOUNT_IN_USE");
  const winner = scopes[attempts.findIndex((r) => r.status === "fulfilled")]!;
  const state = await repository.read(winner);
  assert.equal(state.authority.address, address);
  assert.notEqual(state.authority.custodyAddress, address);
  await assert.rejects(repository.read({ ...winner, userId: randomUUID() }), { code: "NOT_FOUND" });
  await f.store.pool.query(
    "UPDATE wallets.wallet_accounts SET address=$1 WHERE wallet_id=(SELECT wallet_id FROM wallets.agent_wallets WHERE agent_id=$2)",
    ["0x" + "33".repeat(20), winner.productAgentId],
  );
  await assert.rejects(repository.read(winner), { code: "PERPL_ACCOUNT_CHANGED" });
});

async function connect(
  repository: PostgresPerplLiveStore,
  scope: { userId: string; productAgentId: string },
  address?: string,
) {
  const original = await repository.inspectKeyChange(scope, {});
  await repository.connectKey(scope, {
    original,
    useKeyWallet: Boolean(address),
    connected: {
      address: address ?? original.authority.address,
      accountId: 7,
      publicKey: "controlled-public",
      encryptedKey: "controlled-encrypted",
      encryptedToken: "controlled-encrypted",
      snapshot: {
        instanceId: 1,
        lockedMicros: "0",
        unmanagedOrders: false,
        accountId: 7,
        forwarding: true,
        frozen: false,
        balanceMicros: "100000000",
        lastRequestId: 0,
        head: 100,
        at: Date.now(),
        markets: [],
        positions: [],
        orders: [],
      },
    },
  });
}
