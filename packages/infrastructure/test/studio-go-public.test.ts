import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { DEFAULT_BRIEF, STARTER_CAPS, prepareDraft, type AgentDirectory } from "@pickler/core";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

const { config, profile } = prepareDraft({
  name: "Halftime",
  handle: "halftime",
  voice: "analyst",
  avatar: { accent: "cyan", pattern: 3 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "unused",
});

const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

/** A draft made the way the studio makes one: through `createDraft`, with its agent wallet. */
async function setup(t: TestContext) {
  const store = await createTestStore(t);
  const studio = new PostgresStudioDirectory(store.pool);
  const directory: AgentDirectory = new PostgresAgentDirectory(store.pool);
  const userId = randomUUID();
  if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  await store.pool.query("SELECT identity.create_profile($1,'Maker',$2)", [userId, "owner_one"]);
  await studio.onboard(userId);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const access = (await studio.access(userId, null))!;
  const walletId = `wallet-${hex(12)}`;
  await store.pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
     VALUES ($1, $2, $3, 'agent', 'Agent wallet 1', ARRAY['p1','p2','p3'])`,
    [userId, walletId, `sub-${hex(12)}`],
  );
  await store.pool.query(
    `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
     VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', 'm/44')`,
    [walletId, `0x${hex(40)}`],
  );
  const created = await studio.createDraft(access, userId, {
    name: "Halftime",
    handle: "halftime",
    config,
    profile,
    walletId,
  });
  return { pool: store.pool, studio, directory, access, agentId: created.productId };
}

test("a draft is private and unpublished", async (t) => {
  const f = await setup(t);

  const { rows } = await f.pool.query(
    "SELECT visibility, published_at FROM agents.agents WHERE id=$1",
    [f.agentId],
  );

  assert.deepEqual(rows[0], { visibility: "private", published_at: null });
});

test("a published agent must say when, and a private one must not", async (t) => {
  const f = await setup(t);

  await assert.rejects(
    f.pool.query("UPDATE agents.agents SET visibility='public' WHERE id=$1", [f.agentId]),
    /agents_published_consistent/,
  );
  await assert.rejects(
    f.pool.query("UPDATE agents.agents SET published_at=now() WHERE id=$1", [f.agentId]),
    /agents_published_consistent/,
  );
});

test("the marketplace reads a private agent nowhere, and a public one everywhere", async (t) => {
  const f = await setup(t);
  // A launched token, so the profile page has something to resolve through.
  await f.pool.query(
    `INSERT INTO market.tokens
       (agent_id, ticker, name, chain, status, address, launched_at, total_supply, quote_decimals)
     VALUES ($1, '$HALF', 'Halftime', 'eip155:10143', 'pre_graduation', $2, now(),
             '1000000000000000000000000', 18)`,
    [f.agentId, `0x${hex(40)}`],
  );
  // Visibility, not status, decides: an active agent that was never published stays off the board.
  await f.pool.query("UPDATE agents.agents SET status='active' WHERE id=$1", [f.agentId]);

  assert.deepEqual(await f.directory.listAgents(), []);
  assert.equal(await f.directory.getProfile("$HALF"), null);
  assert.equal(await f.directory.getPersona("halftime"), null);

  await f.pool.query(
    "UPDATE agents.agents SET visibility='public', published_at=now() WHERE id=$1",
    [f.agentId],
  );

  assert.deepEqual(
    (await f.directory.listAgents()).map((agent) => agent.handle),
    ["halftime"],
  );
  assert.equal((await f.directory.getProfile("$HALF"))?.handle, "halftime");
  assert.equal((await f.directory.getPersona("halftime"))?.handle, "halftime");
});

test("the studio lists visibility, when it was published, and the verified X handle", async (t) => {
  const f = await setup(t);

  const [draft] = await f.studio.list(f.access);
  assert.equal(draft?.visibility, "private");
  assert.equal(draft?.publishedAt, null);
  assert.equal(draft?.xHandle, null);

  const publishedAt = new Date("2026-10-02T12:00:00Z");
  await f.pool.query(
    "UPDATE agents.agents SET status='active', visibility='public', published_at=$2 WHERE id=$1",
    [f.agentId, publishedAt],
  );
  await f.pool.query(
    `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
     VALUES ($1, '42', 'HalftimeBot', now(), '1001')`,
    [f.agentId],
  );

  const [live] = await f.studio.list(f.access);
  assert.equal(live?.visibility, "public");
  assert.deepEqual(live?.publishedAt, publishedAt);
  assert.equal(live?.xHandle, "HalftimeBot");
});

test("an X account verifies one agent, and its handle is unique whatever its case", async (t) => {
  const f = await setup(t);
  // A second agent in the same workspace; it and its handle reference each other (deferred).
  const other = randomUUID();
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents (id, workspace_id, name, handle, status)
       SELECT $1, workspace_id, 'Other', 'other_one', 'draft' FROM agents.agents WHERE id=$2`,
      [other, f.agentId],
    );
    await client.query("INSERT INTO identity.handles (handle, agent_id) VALUES ('other_one', $1)", [
      other,
    ]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  await f.pool.query(
    `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
     VALUES ($1, '42', 'HalftimeBot', now(), '1001')`,
    [f.agentId],
  );

  // A second account for the same agent, then the same handle under another case.
  await assert.rejects(
    f.pool.query(
      `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
       VALUES ($1, '43', 'OtherBot', now(), '1002')`,
      [f.agentId],
    ),
    /x_accounts_pkey/,
  );
  await assert.rejects(
    f.pool.query(
      `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
       VALUES ($1, '43', 'halftimebot', now(), '1002')`,
      [other],
    ),
    /x_accounts_handle_key/,
  );
  await assert.rejects(
    f.pool.query(
      `INSERT INTO agents.x_challenges (agent_id, handle, code, expires_at)
       VALUES ($1, 'not a handle', 'pk-ABCDEFGH', now() + interval '1 hour')`,
      [f.agentId],
    ),
    /x_challenges_handle_format/,
  );
});

test("0024 publishes every agent that is not a draft, as of when it was created", async (t) => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  const name = `pickler_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  const folder = await mkdtemp(join(tmpdir(), "pickler-migration-"));
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  });
  // The history as it stood before 0024.
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 23);
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  await migrateDatabase(pool, folder);

  const userId = randomUUID();
  const workspaceId = randomUUID();
  await pool.query("SELECT identity.create_profile($1,'Maker','owner_one')", [userId]);
  await pool.query(
    "INSERT INTO identity.workspaces (id, owner_user_id, name) VALUES ($1, $2, 'w')",
    [workspaceId, userId],
  );
  const createdAt = new Date("2026-09-01T00:00:00Z");
  const ids: Record<string, string> = {};
  for (const [handle, status, killed] of [
    ["live_one", "active", false],
    ["killed_one", "killed", true],
    ["draft_one", "draft", false],
  ] as const) {
    const id = randomUUID();
    ids[handle] = id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO agents.agents (id, workspace_id, name, handle, status, killed_at, created_at)
         VALUES ($1, $2, 'Halftime', $3, $4, $5, $6)`,
        [id, workspaceId, handle, status, killed ? new Date() : null, createdAt],
      );
      await client.query("INSERT INTO identity.handles (handle, agent_id) VALUES ($1, $2)", [
        handle,
        id,
      ]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }

  await migrateDatabase(pool);

  const { rows } = await pool.query(
    "SELECT handle, visibility, published_at FROM agents.agents ORDER BY handle",
  );
  assert.deepEqual(rows, [
    { handle: "draft_one", visibility: "private", published_at: null },
    { handle: "killed_one", visibility: "public", published_at: createdAt },
    { handle: "live_one", visibility: "public", published_at: createdAt },
  ]);
});
