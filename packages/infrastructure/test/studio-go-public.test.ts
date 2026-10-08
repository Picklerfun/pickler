import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import {
  DEFAULT_BRIEF,
  PilotError,
  PublishBlockedError,
  STARTER_CAPS,
  prepareDraft,
  reviseSetup,
  setupChangeSummary,
  type AgentDirectory,
  type PublishCheck,
} from "@pickler/core";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { listTransfers } from "../src/studio/ledger.js";
import { createTestStore } from "./database.js";

const { config, profile } = prepareDraft({
  markets: ["BTC", "ETH"],
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
  const owner = await draftOwner(store.pool, studio, { profile: "owner_one", handle: "halftime" });
  return { pool: store.pool, store, studio, directory, ...owner };
}

/** A person with their own profile, workspace, agent wallet and a draft named Halftime. */
async function draftOwner(
  pool: Pool,
  studio: PostgresStudioDirectory,
  names: { profile: string; handle: string },
) {
  const userId = randomUUID();
  if ((await pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  await pool.query("SELECT identity.create_profile($1,'Maker',$2)", [userId, names.profile]);
  await studio.onboard(userId);
  await pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [userId]);
  const access = (await studio.access(userId, null))!;
  const walletId = `wallet-${hex(12)}`;
  await pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
     VALUES ($1, $2, $3, 'agent', 'Agent wallet 1', ARRAY['p1','p2','p3'])`,
    [userId, walletId, `sub-${hex(12)}`],
  );
  const walletAddress = `0x${hex(40)}`;
  await pool.query(
    `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
     VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', 'm/44')`,
    [walletId, walletAddress],
  );
  const created = await studio.createDraft(access, userId, {
    name: "Halftime",
    handle: names.handle,
    config,
    profile,
    walletId,
  });
  return { access, userId, walletId, walletAddress, agentId: created.productId };
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
  assert.equal(draft?.avatarPattern, 3);
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
  // The same X account for another agent, under another handle.
  await assert.rejects(
    f.pool.query(
      `INSERT INTO agents.x_accounts (agent_id, x_user_id, handle, verified_at, verification_post_id)
       VALUES ($1, '42', 'RenamedBot', now(), '1002')`,
      [other],
    ),
    /x_accounts_x_user_id_key/,
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

test("0024 publishes every agent that is not a draft, as of when it was created, and leaves updated_at", async (t) => {
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
  const updatedAt = new Date("2026-09-15T00:00:00Z");
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
        `INSERT INTO agents.agents
           (id, workspace_id, name, handle, status, killed_at, created_at, updated_at)
         VALUES ($1, $2, 'Halftime', $3, $4, $5, $6, $7)`,
        [id, workspaceId, handle, status, killed ? new Date() : null, createdAt, updatedAt],
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
    "SELECT handle, visibility, published_at, updated_at FROM agents.agents ORDER BY handle",
  );
  // The backfill is not an edit: `updated_at` stays as it was.
  assert.deepEqual(rows, [
    { handle: "draft_one", visibility: "private", published_at: null, updated_at: updatedAt },
    { handle: "killed_one", visibility: "public", published_at: createdAt, updated_at: updatedAt },
    { handle: "live_one", visibility: "public", published_at: createdAt, updated_at: updatedAt },
  ]);
  // And the trigger is back on for every later edit.
  const trigger = await pool.query(
    "SELECT tgenabled FROM pg_trigger WHERE tgname = 'agents_updated_at'",
  );
  assert.deepEqual(trigger.rows, [{ tgenabled: "O" }]);
});

const isCode = (code: string) => (error: unknown) =>
  error instanceof PilotError && error.code === code;

test("publish checks the agent's state, then makes a draft public and active", async (t) => {
  const f = await setup(t);
  await seedOAuth(f);
  const seen: unknown[] = [];
  const check: PublishCheck = async (state) => {
    seen.push(state);
    return [];
  };

  const result = await f.studio.publish(f.access, f.agentId, check);

  assert.deepEqual(seen, [{ killed: false, walletAddress: f.walletAddress }]);
  assert.equal(result.visibility, "public");
  assert.ok(result.publishedAt instanceof Date);
  const { rows } = await f.pool.query(
    "SELECT status::text, visibility::text, published_at FROM agents.agents WHERE id=$1",
    [f.agentId],
  );
  assert.deepEqual(rows[0], {
    status: "active",
    visibility: "public",
    published_at: result.publishedAt,
  });

  // Again: the current state, without checking.
  const again = await f.studio.publish(f.access, f.agentId, async () => {
    throw new Error("an already public agent is not checked");
  });
  assert.deepEqual(again, result);
});

test("a setup saves new caps with writeSpend, and keeps the stored spend without it", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);
  const caps = { perTradeAusd: 7, perDayAusd: 30, maxLeverage: 2 };
  assert.notDeepEqual(first.config.spend, { perCallAusd: 7, perDayAusd: 30 });

  // As `PUT /agents/:id/setup` writes caps: the revised config, with `writeSpend`.
  const saved = await f.store.updateConfig(
    scope,
    first.version,
    reviseSetup(first.config, { caps }),
    { perplOnly: true, writeSpend: true },
  );
  assert.equal(saved.version, first.version + 1);
  const read = await f.store.agent(scope);
  assert.deepEqual(read.config.spend, { perCallAusd: 7, perDayAusd: 30 });
  assert.equal(read.config.maxLeverage, 2);

  // Without the option, a config's spend is not this write's: the stored caps stay.
  await f.store.updateConfig(
    scope,
    read.version,
    reviseSetup(read.config, { caps: { perTradeAusd: 9, perDayAusd: 50, maxLeverage: 3 } }),
    { perplOnly: true },
  );
  assert.deepEqual((await f.store.agent(scope)).config.spend, { perCallAusd: 7, perDayAusd: 30 });
});

/** The agent's recorded versions as the table holds them, oldest first. */
async function versionRows(pool: Pool, agentId: string) {
  const { rows } = await pool.query<{ version: number; summary: string }>(
    "SELECT version, summary FROM agents.setup_versions WHERE agent_id = $1 ORDER BY version",
    [agentId],
  );
  return rows;
}

const setupOptions = { perplOnly: true, versionSummary: setupChangeSummary };

test("a brief saved on a public Perpl agent is a new version with one recorded row", async (t) => {
  const f = await setup(t);
  await seedOAuth(f);
  await f.studio.publish(f.access, f.agentId, async () => []);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);
  assert.deepEqual(await versionRows(f.pool, f.agentId), []);

  const saved = await f.store.updateConfig(
    scope,
    first.version,
    reviseSetup(first.config, { brief: { ...DEFAULT_BRIEF, thesis: "Funding leads price." } }),
    setupOptions,
  );

  assert.equal(saved.version, first.version + 1);
  assert.equal(saved.config.brief?.thesis, "Funding leads price.");
  assert.deepEqual(await versionRows(f.pool, f.agentId), [
    { version: saved.version, summary: "Thesis changed" },
  ]);
});

test("a save without a summary records no version", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);

  const saved = await f.store.updateConfig(scope, first.version, first.config);

  assert.equal(saved.version, first.version + 1);
  assert.deepEqual(await versionRows(f.pool, f.agentId), []);
});

test("the summary compares the stored configs, so caps not written are not a change", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);

  // Without `writeSpend` the stored spend stays, and only the leverage is new.
  const saved = await f.store.updateConfig(
    scope,
    first.version,
    reviseSetup(first.config, {
      caps: { perTradeAusd: 9, perDayAusd: 50, maxLeverage: first.config.maxLeverage! },
    }),
    setupOptions,
  );

  assert.deepEqual(saved.config.spend, first.config.spend);
  assert.deepEqual(await versionRows(f.pool, f.agentId), [
    { version: saved.version, summary: "No change" },
  ]);
});

test("versions lists an agent's saved setups newest first, at most 20", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  assert.deepEqual(await f.studio.versions(f.access, f.agentId), []);
  const first = await f.store.agent(scope);

  const second = await f.store.updateConfig(
    scope,
    first.version,
    reviseSetup(first.config, { brief: { ...DEFAULT_BRIEF, thesis: "Funding leads price." } }),
    setupOptions,
  );
  const third = await f.store.updateConfig(
    scope,
    second.version,
    reviseSetup(second.config, { voice: "hype" }),
    setupOptions,
  );

  const listed = await f.studio.versions(f.access, f.agentId);
  assert.deepEqual(
    listed.map(({ version, summary }) => ({ version, summary })),
    [
      { version: third.version, summary: "Voice · Hype" },
      { version: second.version, summary: "Thesis changed" },
    ],
  );
  assert.ok(listed.every((row) => row.at instanceof Date));

  let latest = third;
  for (let save = 0; save < 20; save += 1) {
    latest = await f.store.updateConfig(
      scope,
      latest.version,
      reviseSetup(latest.config, { voice: save % 2 ? "hype" : "analyst" }),
      setupOptions,
    );
  }
  const capped = await f.studio.versions(f.access, f.agentId);
  assert.equal(capped.length, 20);
  assert.equal(capped[0]!.version, latest.version);
  assert.equal(capped[19]!.version, latest.version - 19);
});

test("a config without perpl is refused NOT_A_PERPL_AGENT, with no version and no row", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);
  // A legacy agent: its stored config has no `perpl`.
  await f.pool.query("UPDATE pickler.agents SET config = config - 'perpl' WHERE id = $1", [
    scope.agentId,
  ]);

  await assert.rejects(
    f.store.updateConfig(scope, first.version, first.config, setupOptions),
    isCode("NOT_A_PERPL_AGENT"),
  );

  const after = await f.store.agent(scope);
  assert.equal(after.version, first.version);
  assert.equal(after.config.perpl, undefined);
  assert.deepEqual(await versionRows(f.pool, f.agentId), []);
});

test("a stale expectedVersion writes no version row", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);

  await assert.rejects(
    f.store.updateConfig(
      scope,
      first.version + 3,
      reviseSetup(first.config, { voice: "hype" }),
      setupOptions,
    ),
    isCode("CONFLICT"),
  );

  assert.equal((await f.store.agent(scope)).version, first.version);
  assert.deepEqual(await versionRows(f.pool, f.agentId), []);
});

test("a version that cannot be recorded leaves the config as it was", async (t) => {
  const f = await setup(t);
  const scope = await f.studio.agentScope(f.access, f.agentId);
  const first = await f.store.agent(scope);

  // The table bounds a summary to 200 characters; the config and its version share the fate.
  await assert.rejects(
    f.store.updateConfig(scope, first.version, reviseSetup(first.config, { voice: "hype" }), {
      perplOnly: true,
      versionSummary: () => "x".repeat(201),
    }),
    (error: unknown) =>
      (error as { cause?: { constraint?: string } }).cause?.constraint ===
      "setup_versions_summary_length",
  );

  const after = await f.store.agent(scope);
  assert.equal(after.version, first.version);
  assert.equal(after.config.voice, first.config.voice);
  assert.deepEqual(await versionRows(f.pool, f.agentId), []);
});

test("versions refuses another workspace's agent", async (t) => {
  const f = await setup(t);
  const theirs = await draftOwner(f.pool, f.studio, { profile: "owner_two", handle: "theirs" });
  const scope = await f.studio.agentScope(theirs.access, theirs.agentId);
  const first = await f.store.agent(scope);
  await f.store.updateConfig(
    scope,
    first.version,
    reviseSetup(first.config, { voice: "hype" }),
    setupOptions,
  );

  await assert.rejects(f.studio.versions(f.access, theirs.agentId), isCode("NOT_FOUND"));

  assert.equal((await f.studio.versions(theirs.access, theirs.agentId)).length, 1);
});

test("publish refuses with the check's blockers and writes nothing", async (t) => {
  const f = await setup(t);
  await f.pool.query("DELETE FROM wallets.agent_wallets WHERE agent_id=$1", [f.agentId]);
  let state: unknown;

  await assert.rejects(
    f.studio.publish(f.access, f.agentId, async (s) => {
      state = s;
      return ["WALLET"];
    }),
    (error) => error instanceof PublishBlockedError && error.blockers.join() === "WALLET",
  );
  assert.deepEqual(state, { killed: false, walletAddress: null });
  await assert.rejects(
    f.studio.publish(f.access, f.agentId, async () => {
      throw new Error("chain down");
    }),
    /chain down/,
  );
  const { rows } = await f.pool.query("SELECT visibility::text FROM agents.agents WHERE id=$1", [
    f.agentId,
  ]);
  assert.equal(rows[0].visibility, "private");
});

test("publish re-checks when the agent changes during the check, and gives up on a second change", async (t) => {
  const f = await setup(t);
  // The check sees the wallet; while it reads the chain the agent is killed. The second check sees
  // the kill and blocks.
  const states: { killed: boolean }[] = [];
  await assert.rejects(
    f.studio.publish(f.access, f.agentId, async (state) => {
      states.push(state);
      if (states.length === 1) {
        await f.pool.query(
          "UPDATE agents.agents SET status='killed', killed_at=now() WHERE id=$1",
          [f.agentId],
        );
        return [];
      }
      return state.killed ? ["KILLED"] : [];
    }),
    PublishBlockedError,
  );
  assert.deepEqual(
    states.map((s) => s.killed),
    [false, true],
  );

  // A wallet that keeps changing under every check: PUBLISH_CONFLICT, still private.
  const g = await setup(t);
  let calls = 0;
  await assert.rejects(
    g.studio.publish(g.access, g.agentId, async () => {
      calls += 1;
      // Unlinked during the first check, linked again during the second.
      if (calls === 1) {
        await g.pool.query("DELETE FROM wallets.agent_wallets WHERE agent_id=$1", [g.agentId]);
      } else {
        await g.pool.query(
          "INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1,$2,ARRAY['p1','p2','p3'])",
          [g.agentId, g.walletId],
        );
      }
      return [];
    }),
    isCode("PUBLISH_CONFLICT"),
  );
  assert.equal(calls, 2);
  const { rows } = await g.pool.query("SELECT visibility::text FROM agents.agents WHERE id=$1", [
    g.agentId,
  ]);
  assert.equal(rows[0].visibility, "private");
});

test("publish, identity and activity refuse another person's agent and leave it as it was", async (t) => {
  const f = await setup(t);
  const theirs = await draftOwner(f.pool, f.studio, { profile: "owner_two", handle: "theirs" });
  const before = await f.pool.query(
    `SELECT a.name, a.status::text, a.visibility::text, a.published_at, p.accent::text, p.avatar_pattern
     FROM agents.agents a JOIN agents.agent_profiles p ON p.agent_id=a.id WHERE a.id=$1`,
    [theirs.agentId],
  );
  let checked = false;

  await assert.rejects(
    f.studio.publish(f.access, theirs.agentId, async () => {
      checked = true;
      return [];
    }),
    isCode("NOT_FOUND"),
  );
  await assert.rejects(
    f.studio.updateIdentity(f.access, theirs.agentId, { name: "Mine now", avatarPattern: 5 }),
    isCode("NOT_FOUND"),
  );
  await assert.rejects(f.studio.activity(f.access, theirs.agentId), isCode("NOT_FOUND"));

  assert.equal(checked, false);
  const after = await f.pool.query(
    `SELECT a.name, a.status::text, a.visibility::text, a.published_at, p.accent::text, p.avatar_pattern
     FROM agents.agents a JOIN agents.agent_profiles p ON p.agent_id=a.id WHERE a.id=$1`,
    [theirs.agentId],
  );
  assert.deepEqual(after.rows, before.rows);
  assert.equal(after.rows[0].visibility, "private");
  // Their own access still reaches it.
  const theirEvents = await f.studio.activity(theirs.access, theirs.agentId);
  assert.ok(theirEvents.some((event) => event.kind === "created"));
});

test("publish refuses a killed agent itself, whatever the check answered", async (t) => {
  const f = await setup(t);

  await assert.rejects(
    f.studio.publish(f.access, f.agentId, async () => {
      // Killed while the check reads the chain; this check (wrongly) ignores it on the retry too.
      await f.pool.query("UPDATE agents.agents SET status='killed', killed_at=now() WHERE id=$1", [
        f.agentId,
      ]);
      return [];
    }),
    (error) => error instanceof PublishBlockedError && error.blockers.join() === "KILLED",
  );

  const { rows } = await f.pool.query("SELECT visibility::text FROM agents.agents WHERE id=$1", [
    f.agentId,
  ]);
  assert.equal(rows[0].visibility, "private");
});

test("publishing a private agent that is not a draft leaves its status alone", async (t) => {
  const f = await setup(t);
  await f.pool.query("UPDATE agents.agents SET status='paused' WHERE id=$1", [f.agentId]);

  await seedOAuth(f);
  await f.studio.publish(f.access, f.agentId, async () => []);

  const { rows } = await f.pool.query(
    "SELECT status::text, visibility::text FROM agents.agents WHERE id=$1",
    [f.agentId],
  );
  assert.deepEqual(rows[0], { status: "paused", visibility: "public" });
});

test("two concurrent publishes answer the same publishedAt", async (t) => {
  const f = await setup(t);
  await seedOAuth(f);

  const [one, two] = await Promise.all([
    f.studio.publish(f.access, f.agentId, async () => []),
    f.studio.publish(f.access, f.agentId, async () => []),
  ]);

  assert.deepEqual(one, two);
  const { rows } = await f.pool.query("SELECT published_at FROM agents.agents WHERE id=$1", [
    f.agentId,
  ]);
  assert.deepEqual(rows[0].published_at, one.publishedAt);
});

test("identity edits the name, avatar and voice, and the database bounds them", async (t) => {
  const f = await setup(t);

  await f.studio.updateIdentity(f.access, f.agentId, {
    name: "Second Half",
    accent: "magenta",
    avatarPattern: 5,
    voice: "Analyst",
  });
  await f.studio.updateIdentity(f.access, f.agentId, { avatarPattern: 1 });

  const { rows } = await f.pool.query(
    `SELECT a.name, p.accent::text, p.avatar_pattern, p.voice
     FROM agents.agents a JOIN agents.agent_profiles p ON p.agent_id=a.id WHERE a.id=$1`,
    [f.agentId],
  );
  assert.deepEqual(rows[0], {
    name: "Second Half",
    accent: "magenta",
    avatar_pattern: 1,
    voice: "Analyst",
  });

  for (const bad of [
    { name: "" },
    { name: "x".repeat(41) },
    { avatarPattern: 6 },
    { avatarPattern: 70_000 },
  ]) {
    await assert.rejects(
      f.studio.updateIdentity(f.access, f.agentId, bad),
      isCode("INVALID_INPUT"),
    );
  }
  await assert.rejects(
    // A value outside the palette, as a caller that skipped validation would send it.
    f.studio.updateIdentity(f.access, f.agentId, { accent: "pink" as "lime" }),
    isCode("INVALID_INPUT"),
  );
  assert.equal((await f.studio.list(f.access))[0]?.name, "Second Half");
});

test("identity gives an agent without a profile one, so its avatar and voice are saved", async (t) => {
  const f = await setup(t);
  // An older agent, made before profiles were written with it.
  await f.pool.query("DELETE FROM agents.agent_profiles WHERE agent_id = $1", [f.agentId]);

  await f.studio.updateIdentity(f.access, f.agentId, { accent: "magenta", avatarPattern: 4 });
  await f.studio.updateIdentity(f.access, f.agentId, { voice: "Deadpan" });

  const { rows } = await f.pool.query(
    "SELECT accent::text, avatar_pattern, voice FROM agents.agent_profiles WHERE agent_id = $1",
    [f.agentId],
  );
  assert.deepEqual(rows, [{ accent: "magenta", avatar_pattern: 4, voice: "Deadpan" }]);
});

type Fixture = Awaited<ReturnType<typeof setup>>;

/** The person's master wallet and a transfer between it and the agent's. */
async function master(f: Fixture) {
  const walletId = `master-${hex(12)}`;
  await f.pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
     VALUES ($1, $2, $3, 'master', 'Master')`,
    [f.userId, walletId, `sub-${hex(12)}`],
  );
  return walletId;
}

async function transfer(
  f: Fixture,
  move: { from: string; to: string; token: "ausd" | "mon"; amount: bigint; at: string },
) {
  const txHash = `0x${hex(64)}`;
  await f.pool.query(
    `INSERT INTO wallets.transfers (user_id, from_wallet_id, to_wallet_id, token, amount, tx_hash, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [f.userId, move.from, move.to, move.token, move.amount.toString(), txHash, move.at],
  );
  return txHash;
}

test("activity: created, its wallet, and each transfer, newest first", async (t) => {
  const f = await setup(t);
  const masterId = await master(f);
  await f.pool.query("UPDATE agents.agents SET created_at=$2 WHERE id=$1", [
    f.agentId,
    "2026-10-01T10:00:00Z",
  ]);
  await f.pool.query("UPDATE wallets.wallets SET created_at=$2 WHERE wallet_id=$1", [
    f.walletId,
    "2026-10-01T09:59:00Z",
  ]);
  await transfer(f, {
    from: masterId,
    to: f.walletId,
    token: "ausd",
    amount: 10_000_000n,
    at: "2026-10-01T11:00:00Z",
  });
  await transfer(f, {
    from: f.walletId,
    to: masterId,
    token: "ausd",
    amount: 1_500_000n,
    at: "2026-10-01T12:00:00Z",
  });
  // Another wallet's transfer is not this agent's activity.
  const elsewhere = `wallet-${hex(12)}`;
  await transfer(f, {
    from: masterId,
    to: elsewhere,
    token: "mon",
    amount: 10n ** 18n,
    at: "2026-10-01T13:00:00Z",
  });

  // A row recorded under another person that names this wallet is not this person's activity.
  await f.pool.query(
    `INSERT INTO wallets.transfers (user_id, from_wallet_id, to_wallet_id, token, amount, tx_hash, created_at)
     VALUES ($1, 'someone-else', $2, 'ausd', 7000000, $3, '2026-10-01T14:00:00Z')`,
    [randomUUID(), f.walletId, `0x${hex(64)}`],
  );

  const events = await f.studio.activity(f.access, f.agentId);

  const short = `${f.walletAddress.slice(0, 6)}…${f.walletAddress.slice(-4)}`;
  assert.deepEqual(events, [
    {
      kind: "transfer",
      text: "Back to master · 1.5 AUSD",
      at: new Date("2026-10-01T12:00:00Z"),
    },
    {
      kind: "transfer",
      text: "To Halftime's wallet · 10 AUSD",
      at: new Date("2026-10-01T11:00:00Z"),
    },
    { kind: "created", text: "Halftime created", at: new Date("2026-10-01T10:00:00Z") },
    {
      kind: "wallet",
      text: `Agent wallet created · ${short}`,
      at: new Date("2026-10-01T09:59:00Z"),
    },
  ]);
});

test("the ledger lists the person's transfers, newest first, in token units", async (t) => {
  const f = await setup(t);
  const masterId = await master(f);
  const first = await transfer(f, {
    from: masterId,
    to: f.walletId,
    token: "ausd",
    amount: 10_000_000n,
    at: "2026-10-01T11:00:00Z",
  });
  const second = await transfer(f, {
    from: f.walletId,
    to: masterId,
    token: "mon",
    amount: 250_000_000_000_000_000n,
    at: "2026-10-01T12:00:00Z",
  });
  // An agent wallet no agent holds any longer: the entry stays, without a name.
  const loose = `wallet-${hex(12)}`;
  await f.pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
     VALUES ($1, $2, $3, 'agent', 'Agent wallet 2')`,
    [f.userId, loose, `sub-${hex(12)}`],
  );
  const third = await transfer(f, {
    from: masterId,
    to: loose,
    token: "ausd",
    amount: 1n,
    at: "2026-10-01T13:00:00Z",
  });
  // Someone else's transfer is not in this person's ledger.
  await f.pool.query(
    `INSERT INTO wallets.transfers (user_id, from_wallet_id, to_wallet_id, token, amount, tx_hash)
     VALUES ($1, 'a', 'b', 'ausd', 5, $2)`,
    [randomUUID(), `0x${hex(64)}`],
  );

  assert.deepEqual(await listTransfers(f.pool, f.userId), [
    {
      direction: "to_agent",
      token: "AUSD",
      amount: "0.000001",
      agentName: null,
      txHash: third,
      at: new Date("2026-10-01T13:00:00Z"),
    },
    {
      direction: "to_master",
      token: "MON",
      amount: "0.25",
      agentName: "Halftime",
      txHash: second,
      at: new Date("2026-10-01T12:00:00Z"),
    },
    {
      direction: "to_agent",
      token: "AUSD",
      amount: "10",
      agentName: "Halftime",
      txHash: first,
      at: new Date("2026-10-01T11:00:00Z"),
    },
  ]);
});

async function seedOAuth(f: Awaited<ReturnType<typeof setup>>) {
  await f.pool.query(
    "INSERT INTO agents.x_accounts (agent_id,x_user_id,handle,verification_method,verified_at) VALUES ($1,$2,$3,'oauth',now())",
    [f.agentId, randomUUID(), `x_${hex(10)}`],
  );
  await f.pool.query(
    `INSERT INTO agents.x_oauth_grants (agent_id,user_id,workspace_id,tenant_id,status,tokens,key_version,scopes,expires_at,validated_at)
    VALUES ($1,$2,$3,$4,'connected','controlled-fixture',1,'["users.read","tweet.read","offline.access"]',now()+interval '1 hour',now())`,
    [f.agentId, f.userId, f.access.workspaceId, f.access.tenantId],
  );
}

test("0034 preserves historical X proof and public visibility while creating private OAuth tables", async (t) => {
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
  );
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
  const admin = new Pool({ connectionString: url.toString(), max: 1 });
  const name = `pickler_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 1 });
  const folder = await mkdtemp(join(tmpdir(), "pickler-x-migration-"));
  t.after(async () => {
    await pool.end();
    await admin.query(`DROP DATABASE "${name}"`);
    await admin.end();
    await rm(folder, { recursive: true, force: true });
  });
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"));
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 34);
  await mkdir(join(folder, "meta"));
  await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) {
    await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
  }
  await migrateDatabase(pool, folder);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const agentId = randomUUID();
  await pool.query("SELECT identity.create_profile($1,'Maker','legacy_owner')", [userId]);
  await pool.query(
    "INSERT INTO identity.workspaces(id,owner_user_id,name) VALUES ($1,$2,'Legacy')",
    [workspaceId, userId],
  );
  await pool.query("BEGIN");
  await pool.query(
    "INSERT INTO agents.agents(id,workspace_id,name,handle,status,visibility,published_at) VALUES ($1,$2,'Legacy','legacy_oauth','active','public',now())",
    [agentId, workspaceId],
  );
  await pool.query("INSERT INTO identity.handles(handle,agent_id) VALUES ('legacy_oauth',$1)", [
    agentId,
  ]);
  await pool.query("COMMIT");
  await pool.query(
    "INSERT INTO agents.x_accounts(agent_id,x_user_id,handle,verification_post_id,verified_at) VALUES ($1,'456','LegacyX','789',now())",
    [agentId],
  );
  const before = (await pool.query("SELECT * FROM agents.agents WHERE id=$1", [agentId])).rows[0];
  await migrateDatabase(pool);
  assert.deepEqual(
    (await pool.query("SELECT * FROM agents.agents WHERE id=$1", [agentId])).rows[0],
    before,
  );
  const old = (
    await pool.query(
      "SELECT verification_method,verification_post_id FROM agents.x_accounts WHERE agent_id=$1",
      [agentId],
    )
  ).rows[0];
  assert.deepEqual(old, { verification_method: "post", verification_post_id: "789" });
  assert.deepEqual(
    (
      await pool.query(
        "SELECT verification_method,verification_post_id FROM agents.x_account_history WHERE agent_id=$1",
        [agentId],
      )
    ).rows[0],
    old,
  );
  assert.equal((await pool.query("SELECT count(*) FROM agents.x_oauth_grants")).rows[0].count, "0");
  const tables = await pool.query(
    "SELECT relname,relrowsecurity FROM pg_class JOIN pg_namespace n ON n.oid=relnamespace WHERE n.nspname='agents' AND relname IN ('x_oauth_attempts','x_oauth_grants','x_oauth_revocations','x_api_usage','x_api_calls','x_account_history')",
  );
  assert.equal(tables.rows.length, 6);
  assert.ok(tables.rows.every((row) => row.relrowsecurity));
  await assert.rejects(
    pool.query("UPDATE agents.x_account_history SET handle='Changed'"),
    /append-only/,
  );
});
