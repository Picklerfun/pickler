import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { createTokenLaunchService } from "@pickler/core";
import { PostgresLaunchProjector } from "../src/persistence/product/launch-projector.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { tokenFixture, controlledFactory, controlledMaster } from "./token-fixture.js";
const draft = { expectedVersion: 0, name: "Controlled", ticker: "CTRL" };
const requestKey = "controlled_launch_001";

test("private drafts can be saved; publishing, access and master registration gate authorization", async (t) => {
  const f = await tokenFixture(t);
  await f.store.pool.query(
    "UPDATE agents.agents SET visibility='private',published_at=NULL WHERE id=$1",
    [f.scope.agentId],
  );
  await f.service.saveDraft(f.scope, draft);
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_LAUNCH_BLOCKED/);
  assert.equal(f.signer.calls(), 0);
  await f.store.pool.query(
    "UPDATE agents.agents SET visibility='public',published_at=now() WHERE id=$1",
    [f.scope.agentId],
  );
  await f.store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    f.scope.userId,
  ]);
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_LAUNCH_BLOCKED/);
  await f.store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    f.scope.userId,
  ]);
  await f.store.pool.query("DELETE FROM wallets.turnkey_orgs WHERE user_id=$1", [f.scope.userId]);
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_LAUNCH_BLOCKED/);
  assert.equal(f.signer.calls(), 0);
});

test("ownership isolation, disabled hosted composition, optimistic saves and idempotent retries", async (t) => {
  const f = await tokenFixture(t);
  await assert.rejects(
    f.service.state({ ...f.scope, userId: randomUUID() }),
    /TOKEN_OWNER_REQUIRED/,
  );
  const results = await Promise.allSettled([
    f.service.saveDraft(f.scope, draft),
    f.service.saveDraft(f.scope, { ...draft, name: "Changed" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const current = (await f.service.state(f.scope)).draft!;
  assert.equal(current.version, 1);
  assert.deepEqual(
    await f.service.saveDraft(f.scope, {
      expectedVersion: 0,
      name: current.name,
      ticker: current.ticker,
    }),
    current,
  );
  await assert.rejects(
    f.service.saveDraft(f.scope, { ...draft, name: "Conflict" }),
    /TOKEN_DRAFT_CONFLICT/,
  );
  const hosted = createTokenLaunchService({ repository: f.repository, chainId: 10143 });
  assert.equal((await hosted.state(f.scope)).available, false);
  await assert.rejects(hosted.authorize(f.scope, 1, requestKey), /TOKEN_LAUNCH_BLOCKED/);
  assert.equal(f.signer.calls(), 0);
});

test("concurrent authorization retries return one stored five-minute grant; a new request cannot duplicate it", async (t) => {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, draft);
  const requests = await Promise.allSettled([
    f.service.authorize(f.scope, 1, requestKey),
    f.service.authorize(f.scope, 1, requestKey),
  ]);
  assert.equal(requests.filter((r) => r.status === "fulfilled").length, 1);
  const a = await f.service.authorize(f.scope, 1, requestKey);
  assert.deepEqual(
    a,
    (requests.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<typeof a>).value,
  );
  assert.equal(f.signer.calls(), 1);
  assert.equal(a.params.creator, controlledMaster);
  assert.equal(a.params.creatorFeeRecipient, controlledMaster);
  assert.equal(BigInt(a.grantDeadline) - BigInt(a.params.deadline), 0n);
  const grants = await f.store.pool.query(
    "SELECT expires_at-created_at AS lifetime FROM launch.grants",
  );
  assert.equal(grants.rowCount, 1);
  await assert.rejects(
    f.service.authorize(f.scope, 1, "controlled_launch_002"),
    /TOKEN_DRAFT_CONFLICT/,
  );
  await assert.rejects(
    f.service.saveDraft(f.scope, { ...draft, expectedVersion: 1 }),
    /TOKEN_DRAFT_CONFLICT/,
  );
  await f.store.pool.query(
    "UPDATE launch.grants SET created_at=now()-interval '10 minutes', expires_at=now()-interval '5 minutes', payload=jsonb_set(payload,'{grantDeadline}',to_jsonb((extract(epoch from now()-interval '5 minutes')::bigint)::text))",
  );
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_AUTHORIZATION_EXPIRED/);
  assert.equal(f.signer.calls(), 1);
  await f.store.pool.query(
    "UPDATE launch.operations SET expires_at=now()-interval '1 second' WHERE status='preparing'",
  );
  await f.service.saveDraft(f.scope, { ...draft, expectedVersion: 1, name: "Second version" });
  await assert.rejects(f.service.authorize(f.scope, 2, requestKey), /TOKEN_IDEMPOTENCY_CONFLICT/);
});

test("migration adds private records without changing historical balances or launch data", async (t) => {
  const f = await tokenFixture(t);
  const before = await f.store.pool.query("SELECT * FROM wallets.wallet_accounts ORDER BY id");
  await f.service.saveDraft(f.scope, draft);
  await f.service.authorize(f.scope, 1, requestKey);
  assert.deepEqual(
    (await f.store.pool.query("SELECT * FROM wallets.wallet_accounts ORDER BY id")).rows,
    before.rows,
  );
  const privacy = await f.store.pool.query(
    "SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('launch.agent_keys'::regclass,'launch.grants'::regclass)",
  );
  assert.ok(privacy.rows.every((r) => r.relrowsecurity));
  assert.equal((await f.store.pool.query("SELECT count(*) FROM market.tokens")).rows[0].count, "0");
});

test("only a canonical confirmed event from the granted factory attributes a token; orphaning removes confirmation", async (t) => {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, draft);
  const grant = await f.service.authorize(f.scope, 1, requestKey);
  const connection = f.store.pool.options.connectionString!;
  const index = new PostgresLaunchIndexStore(connection);
  const projector = new PostgresLaunchProjector(connection);
  try {
    const blockHash = `0x${"b".repeat(64)}`;
    const token = `0x${"2".repeat(40)}`;
    // EVM timestamps have whole-second precision, including a launch in its grant's second.
    const issued = await f.store.pool.query<{ blockTime: Date }>(
      `SELECT date_trunc('second',created_at) AS "blockTime" FROM launch.grants`,
    );
    const now = issued.rows[0]!.blockTime;
    await index.applyBatch({
      chain: "eip155:10143",
      contract: controlledFactory,
      stream: "launches",
      blocks: [{ number: 10n, hash: blockHash, parentHash: `0x${"c".repeat(64)}`, blockTime: now }],
      events: [
        {
          blockHash,
          blockNumber: 10n,
          txHash: `0x${"d".repeat(64)}`,
          logIndex: 0,
          emitter: controlledFactory,
          eventName: "LaunchCreated",
          abiHash: "a".repeat(64),
          topics: [],
          data: "0x",
          decoded: {
            token,
            curve: `0x${"3".repeat(40)}`,
            agentKey: grant.params.agentKey,
            creator: controlledMaster,
            quoteToken: grant.params.metadataHash.slice(0, 42),
            presetHash: grant.params.expectedConfigHash,
            metadataHash: grant.params.metadataHash,
          },
        },
      ],
    });
    const metadata = async () => ({
      name: draft.name,
      symbol: draft.ticker,
      decimals: 18,
      totalSupply: 21_000_000n * 10n ** 18n,
    });
    await projector.project("eip155:10143", metadata);
    assert.equal((await f.service.state(f.scope)).confirmation, "pending");
    assert.equal(
      (await f.store.pool.query("SELECT agent_id FROM market.tokens")).rows[0].agent_id,
      null,
    );
    await f.store.pool.query("UPDATE market.chain_blocks SET finality='confirmed'");
    await f.store.pool.query("UPDATE market.chain_events SET emitter=$1", [`0x${"9".repeat(40)}`]);
    await projector.project("eip155:10143", metadata);
    assert.equal(
      (await f.store.pool.query("SELECT agent_id FROM market.tokens")).rows[0].agent_id,
      null,
    );
    await f.store.pool.query("UPDATE market.chain_events SET emitter=$1", [controlledFactory]);
    await projector.project("eip155:10143", metadata);
    const state = await f.service.state(f.scope);
    assert.equal(state.token?.address, token);
    assert.equal(state.confirmation, "confirmed");
    assert.deepEqual(state.token?.avatar, { accent: "lime", pattern: 1 });
    const profile = await new PostgresAgentDirectory(f.store.pool, 10143).getPersona(f.handle);
    assert.equal(profile?.launchedToken?.address, token);
    assert.equal(
      (await new PostgresAgentDirectory(f.store.pool, 143).getPersona(f.handle))?.launchedToken,
      null,
    );
    await assert.rejects(
      f.service.authorize(f.scope, 1, "controlled_launch_003"),
      /TOKEN_LAUNCH_BLOCKED/,
    );
    await assert.rejects(
      f.store.pool.query(
        `INSERT INTO market.tokens(agent_id,ticker,name,chain,address,decimals,total_supply,status,quote_address,quote_decimals,launch_tx_hash,launched_at)
      VALUES($1,'$SECOND','Second','eip155:10143',$2,18,1000,'pre_graduation',$3,6,$4,now())`,
        [f.scope.agentId, `0x${"7".repeat(40)}`, `0x${"4".repeat(40)}`, `0x${"e".repeat(64)}`],
      ),
      (error: unknown) => (error as { code?: string }).code === "23505",
    );
    await f.store.pool.query("UPDATE market.chain_blocks SET orphaned=true");
    assert.equal((await f.service.state(f.scope)).confirmation, "pending");
    const count = await f.store.pool.query("SELECT count(*) FROM market.tokens");
    assert.equal(count.rows[0].count, "1");
  } finally {
    await index.close();
    await projector.close();
  }
});

test("appending token migrations to main preserves saved drafts, metadata, transactions and wallets", async (t) => {
  const f = await tokenFixture(t);
  // Roll back only the new, empty structures in this test-owned disposable database.
  await f.store.pool.query("DROP TABLE launch.grants,launch.agent_keys");
  await f.store.pool.query(
    "DROP INDEX launch.drafts_agent_chain_key,launch.drafts_identity_key,market.tokens_agent_chain_launch_key",
  );
  const migrations = readMigrationFiles({ migrationsFolder }).slice(36, 38);
  await f.store.pool.query(
    "DELETE FROM pickler_migrations.__drizzle_migrations WHERE hash=ANY($1::text[])",
    [migrations.map((m) => m.hash)],
  );
  await f.store.pool.query(
    "INSERT INTO launch.drafts(owner_id,agent_id,chain,params,version) VALUES($1,$2,'eip155:10143',$3,4)",
    [
      f.scope.userId,
      f.scope.agentId,
      { name: "Historical", ticker: "HIST", evidence: { preserved: true } },
    ],
  );
  await f.store.pool.query(
    "INSERT INTO launch.metadata_versions(chain,token,uri,content_hash,author_id) VALUES('eip155:10143',$1,'ipfs://historical',$2,$3)",
    [`0x${"8".repeat(40)}`, `0x${"a".repeat(64)}`, f.scope.userId],
  );
  await f.store.pool.query(
    "INSERT INTO launch.transaction_requests(owner_id,chain,sender,destination,params_hash,idempotency_key) VALUES($1,'eip155:10143',$2,$3,$4,'historical-request')",
    [f.scope.userId, controlledMaster, controlledFactory, `0x${"b".repeat(64)}`],
  );
  const tables = [
    "launch.drafts",
    "launch.metadata_versions",
    "launch.transaction_requests",
    "wallets.wallet_accounts",
    "market.tokens",
  ];
  const read = async () =>
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
  const before = await read();
  // Explicit revocation must win even when an operator configured permissive defaults.
  await f.store.pool.query(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA launch GRANT SELECT ON TABLES TO PUBLIC",
  );
  await Promise.all([migrateDatabase(f.store.pool), migrateDatabase(f.store.pool)]);
  assert.deepEqual(await read(), before);
  assert.equal((await f.service.state(f.scope)).draft?.version, 4);
  assert.equal((await f.store.pool.query("SELECT count(*) FROM launch.grants")).rows[0].count, "0");
  const access = await f.store.pool.query(`SELECT acl.grantee,acl.privilege_type FROM pg_class c,
    LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
    WHERE c.oid IN ('launch.agent_keys'::regclass,'launch.grants'::regclass) AND acl.grantee=0`);
  assert.equal(access.rowCount, 0, "PUBLIC cannot read private launch records");
});

test("ownership revocation and ambiguous master accounts cannot issue or retrieve an authorization", async (t) => {
  const f = await tokenFixture(t);
  await f.service.saveDraft(f.scope, draft);
  const master = await f.store.pool.query(
    "SELECT master_wallet_id FROM wallets.turnkey_orgs WHERE user_id=$1",
    [f.scope.userId],
  );
  await f.store.pool.query(
    "INSERT INTO wallets.wallet_accounts(wallet_id,chain,address,address_format,path) VALUES($1,'monad',$2,'ADDRESS_FORMAT_ETHEREUM','m/45')",
    [master.rows[0].master_wallet_id, `0x${"9".repeat(40)}`],
  );
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_LAUNCH_BLOCKED/);
  assert.equal(f.signer.calls(), 0);
  await f.store.pool.query("DELETE FROM wallets.wallet_accounts WHERE path='m/45'");
  await f.service.authorize(f.scope, 1, requestKey);
  const changedOwner = randomUUID();
  await f.store.pool.query("SELECT identity.create_profile($1,'Changed',$2)", [
    changedOwner,
    `changed_${randomUUID().slice(0, 8)}`,
  ]);
  await f.store.pool.query("UPDATE identity.workspaces SET owner_user_id=$1 WHERE id=$2", [
    changedOwner,
    f.scope.workspaceId,
  ]);
  await assert.rejects(f.service.authorize(f.scope, 1, requestKey), /TOKEN_OWNER_REQUIRED/);
  assert.equal(f.signer.calls(), 1);
});
