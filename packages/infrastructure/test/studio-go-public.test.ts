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
  XHandleTakenError,
  prepareDraft,
  type AgentDirectory,
  type PublishCheck,
} from "@pickler/core";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { listTransfers } from "../src/studio/ledger.js";
import { PostgresXStore } from "../src/studio/x-store.js";
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
  const walletAddress = `0x${hex(40)}`;
  await store.pool.query(
    `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
     VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', 'm/44')`,
    [walletId, walletAddress],
  );
  const created = await studio.createDraft(access, userId, {
    name: "Halftime",
    handle: "halftime",
    config,
    profile,
    walletId,
  });
  return {
    pool: store.pool,
    studio,
    directory,
    access,
    userId,
    walletId,
    walletAddress,
    agentId: created.productId,
  };
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

type Fixture = Awaited<ReturnType<typeof setup>>;

/** A second agent in the same workspace; it and its handle reference each other (deferred). */
async function otherAgent(f: Fixture, handle = "other_one"): Promise<string> {
  const id = randomUUID();
  const client = await f.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents (id, workspace_id, name, handle, status)
       SELECT $1, workspace_id, 'Other', $3, 'draft' FROM agents.agents WHERE id=$2`,
      [id, f.agentId, handle],
    );
    await client.query("INSERT INTO identity.handles (handle, agent_id) VALUES ($1, $2)", [
      handle,
      id,
    ]);
    await client.query("INSERT INTO agents.agent_profiles (agent_id) VALUES ($1)", [id]);
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return id;
}

const isCode = (code: string) => (error: unknown) =>
  error instanceof PilotError && error.code === code;

test("an agent keeps one live X challenge, and its checks", async (t) => {
  const f = await setup(t);
  const x = new PostgresXStore(f.pool);
  const expiresAt = new Date(Date.now() + 86_400_000);

  assert.equal(await x.challenge(f.agentId), null);
  await x.saveChallenge(f.agentId, { handle: "OldBot", code: "pk-aaaaaaaa", expiresAt });
  const saved = await x.saveChallenge(f.agentId, {
    handle: "HalftimeBot",
    code: "pk-bbbbbbbb",
    expiresAt,
  });

  const challenge = await x.challenge(f.agentId);
  assert.deepEqual(challenge, saved);
  assert.equal(challenge?.handle, "HalftimeBot");
  assert.equal(challenge?.code, "pk-bbbbbbbb");
  assert.deepEqual(challenge?.expiresAt, expiresAt);
  assert.ok(challenge?.createdAt instanceof Date);
  assert.equal(await x.lastChecked(f.agentId), null);

  const at = new Date("2026-10-02T12:00:00Z");
  await x.markChecked(f.agentId, at);
  assert.deepEqual(await x.lastChecked(f.agentId), at);
  assert.deepEqual((await x.challenge(f.agentId))?.lastCheckedAt, at);

  // A new challenge starts its checks over.
  await x.saveChallenge(f.agentId, { handle: "HalftimeBot", code: "pk-cccccccc", expiresAt });
  assert.equal(await x.lastChecked(f.agentId), null);
});

test("connecting X writes the account and the profile handle, and spends the challenge", async (t) => {
  const f = await setup(t);
  const x = new PostgresXStore(f.pool);
  const at = new Date("2026-10-02T12:00:00Z");
  await x.saveChallenge(f.agentId, {
    handle: "HalftimeBot",
    code: "pk-aaaaaaaa",
    expiresAt: new Date(Date.now() + 86_400_000),
  });

  await x.connect(f.agentId, { xUserId: "42", handle: "HalftimeBot", postId: "1001", at });

  assert.deepEqual(await x.account(f.agentId), {
    xUserId: "42",
    handle: "HalftimeBot",
    verifiedAt: at,
    postId: "1001",
  });
  assert.equal(await x.challenge(f.agentId), null);
  const profile = await f.pool.query(
    "SELECT x_handle FROM agents.agent_profiles WHERE agent_id=$1",
    [f.agentId],
  );
  assert.equal(profile.rows[0].x_handle, "@HalftimeBot");
  assert.equal((await f.studio.list(f.access))[0]?.xHandle, "HalftimeBot");

  await x.disconnect(f.agentId);
  assert.equal(await x.account(f.agentId), null);
  const cleared = await f.pool.query(
    "SELECT x_handle FROM agents.agent_profiles WHERE agent_id=$1",
    [f.agentId],
  );
  assert.equal(cleared.rows[0].x_handle, null);
});

test("one X account and one handle, whatever its case, belong to one agent", async (t) => {
  const f = await setup(t);
  const x = new PostgresXStore(f.pool);
  const other = await otherAgent(f);
  const at = new Date();
  await x.connect(f.agentId, { xUserId: "42", handle: "HalftimeBot", postId: "1001", at });

  await assert.rejects(
    x.connect(other, { xUserId: "42", handle: "RenamedBot", postId: "1002", at }),
    XHandleTakenError,
  );
  await assert.rejects(
    x.connect(other, { xUserId: "43", handle: "halftimebot", postId: "1002", at }),
    XHandleTakenError,
  );
  assert.equal(await x.account(other), null);

  assert.equal(await x.handleTaken("HALFTIMEBOT", other), true);
  assert.equal(await x.handleTaken("halftimebot", f.agentId), false);
  assert.equal(await x.handleTaken("NobodyBot", other), false);

  // A handle on a profile alone (set before verification existed) is taken too.
  await f.pool.query("UPDATE agents.agent_profiles SET x_handle='@LegacyBot' WHERE agent_id=$1", [
    other,
  ]);
  assert.equal(await x.handleTaken("legacybot", f.agentId), true);
  assert.equal(await x.handleTaken("legacybot", other), false);
});

test("a public agent keeps its X handle", async (t) => {
  const f = await setup(t);
  const x = new PostgresXStore(f.pool);
  await x.connect(f.agentId, { xUserId: "42", handle: "HalftimeBot", postId: "1", at: new Date() });
  await f.pool.query(
    "UPDATE agents.agents SET visibility='public', published_at=now() WHERE id=$1",
    [f.agentId],
  );

  await assert.rejects(x.disconnect(f.agentId), isCode("X_ON_PUBLIC_AGENT"));
  assert.equal((await x.account(f.agentId))?.handle, "HalftimeBot");
});

test("publish checks the agent's state, then makes a draft public and active", async (t) => {
  const f = await setup(t);
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

test("publish and identity refuse an agent outside the workspace", async (t) => {
  const f = await setup(t);
  const stranger = randomUUID();

  await assert.rejects(
    f.studio.publish(f.access, stranger, async () => []),
    isCode("NOT_FOUND"),
  );
  await assert.rejects(
    f.studio.updateIdentity(f.access, stranger, { name: "X" }),
    isCode("NOT_FOUND"),
  );
  await assert.rejects(f.studio.activity(f.access, stranger), isCode("NOT_FOUND"));
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

  for (const bad of [{ name: "" }, { name: "x".repeat(41) }, { avatarPattern: 6 }]) {
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
