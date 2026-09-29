import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AgentDirectory } from "@pickler/core";
import { PostgresAgentDirectory } from "../src/persistence/agent-directory.js";
import { createTestStore } from "./database.js";

const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

/**
 * An agent row plus its profile, the way the studio writes them. Returns the id.
 *
 * The agent and its handle reference each other through deferrable foreign keys, so the two
 * inserts share one transaction, as `src/studio/directory.ts` does. Handles must match
 * `^[a-z0-9_]{3,15}$`.
 */
async function seedAgent(
  pool: Pool,
  over: {
    name?: string;
    handle?: string;
    killed?: boolean;
    status?: "draft";
    profile?: boolean;
    createdAt?: Date;
  } = {},
) {
  const id = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const handle = over.handle ?? `h${id.slice(0, 8)}`;

  // identity.create_profile writes identity.profiles and claims the handle, as signup does.
  await pool.query(`SELECT identity.create_profile($1, 'Maker', $2)`, [
    userId,
    `maker_${id.slice(0, 6)}`,
  ]);
  await pool.query(
    `INSERT INTO identity.workspaces (id, owner_user_id, name) VALUES ($1, $2, 'w')`,
    [workspaceId, userId],
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO agents.agents
         (id, workspace_id, name, handle, status, created_by, killed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, now()))`,
      [
        id,
        workspaceId,
        over.name ?? "Halftime",
        handle,
        over.killed ? "killed" : (over.status ?? "active"),
        userId,
        over.killed ? new Date() : null,
        over.createdAt ?? null,
      ],
    );
    await client.query(`INSERT INTO identity.handles (handle, agent_id) VALUES ($1, $2)`, [
      handle,
      id,
    ]);
    if (over.profile !== false) {
      await client.query(
        `INSERT INTO agents.agent_profiles (agent_id, beat, accent, blurb, venue)
         VALUES ($1, 'sports', 'amber', 'Bets on injury news.', 'predictions')`,
        [id],
      );
    }
    await client.query("COMMIT");
  } catch (cause) {
    await client.query("ROLLBACK");
    throw cause;
  } finally {
    client.release();
  }
  return id;
}

/**
 * A token in the given status. The ticker is stored with its `$`, as `tokens_ticker_format`
 * requires, and is unique across every token that has not failed (`tokens_ticker_key`). A
 * launched status (`pre_graduation`, `graduated`) must carry an address, a launch time, a supply
 * and quote decimals (`tokens_launched_consistent`); a graduated one also a graduation time.
 */
async function seedToken(
  pool: Pool,
  agentId: string,
  status: string,
  ticker = "$HALF",
  target: { graduationTarget: string; quoteDecimals: number } | null = null,
) {
  const launched = status === "pre_graduation" || status === "graduated";
  await pool.query(
    `INSERT INTO market.tokens
       (agent_id, ticker, name, chain, status, address, launched_at, total_supply, quote_decimals,
        graduated_at, graduation_target)
     VALUES ($1, $2, 'Halftime', 'eip155:10143', $3, $4, $5, $6, $7, $8, $9)`,
    [
      agentId,
      ticker,
      status,
      launched ? `0x${hex(40)}` : null,
      launched ? new Date() : null,
      launched ? "1000000000000000000000000" : null,
      launched ? (target?.quoteDecimals ?? 18) : null,
      status === "graduated" ? new Date() : null,
      target?.graduationTarget ?? null,
    ],
  );
}

/** Typed as the port: the tests call what the marketplace calls, and nothing narrower. */
async function setup(t: TestContext) {
  const store = await createTestStore(t);
  const directory: AgentDirectory = new PostgresAgentDirectory(store.pool);
  return { pool: store.pool, directory };
}

test("an agent with no runs and no token lists with an absent record and a null token", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "halftime" });

  const [agent] = await directory.listAgents();

  assert.equal(agent?.handle, "halftime");
  assert.equal(agent?.beat, "sports");
  assert.equal(agent?.accent, "amber");
  assert.equal(agent?.ticker, null);
  assert.equal(agent?.token, null);
  assert.equal(agent?.resolved, 0);
  assert.equal(agent?.hitRate, null, "no rate to state, so null, never 0");
  assert.equal(agent?.net, 0);
});

test("an agent with no profile row still lists, with the profile's defaults", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { profile: false });

  const [agent] = await directory.listAgents();

  assert.ok(agent, "a missing profile must not drop the agent");
  assert.equal(agent.accent, "lime");
  assert.equal(agent.beat, "");
});

test("a killed agent is absent from the listing", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "alive" });
  await seedAgent(pool, { handle: "dead", killed: true });

  const handles = (await directory.listAgents()).map((a) => a.handle);

  assert.deepEqual(handles, ["alive"]);
});

test("only a launched token is a token", async (t) => {
  const { pool, directory } = await setup(t);
  const reserved = await seedAgent(pool, { handle: "reserved" });
  const live = await seedAgent(pool, { handle: "live" });
  await seedToken(pool, reserved, "reserved", "$RSVD");
  // A failed launch frees the agent and the ticker for another attempt, so the live agent has
  // two token rows. Only the launched one may join, or the agent would list twice.
  await seedToken(pool, live, "failed");
  await seedToken(pool, live, "pre_graduation");

  const agents = await directory.listAgents();
  const byHandle = Object.fromEntries(agents.map((a) => [a.handle, a]));

  assert.equal(agents.length, 2, "each agent lists once, whatever its token history");
  assert.equal(byHandle.reserved?.ticker, null, "a reserved ticker is not a launched token");
  assert.equal(byHandle.live?.ticker, "$HALF");
  assert.equal(byHandle.live?.token?.stage, "pre-graduation");
});

test("a graduation target is shown in display units, scaled by the quote's decimals", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool, { handle: "halftime" });
  await seedToken(pool, id, "pre_graduation", "$HALF", {
    graduationTarget: "5000000000",
    quoteDecimals: 6,
  });

  const [agent] = await directory.listAgents();

  assert.equal(agent?.token?.graduationTarget, 5000);
});

test("the listing is newest first", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "older", createdAt: new Date("2026-01-01T00:00:00Z") });
  await seedAgent(pool, { handle: "newer", createdAt: new Date("2026-06-01T00:00:00Z") });
  await seedAgent(pool, { handle: "middle", createdAt: new Date("2026-03-01T00:00:00Z") });

  const handles = (await directory.listAgents()).map((a) => a.handle);

  assert.deepEqual(handles, ["newer", "middle", "older"]);
});

test("a failed read is a failure, never an empty marketplace", async (t) => {
  const { pool, directory } = await setup(t);
  await pool.query(`DROP TABLE agents.agent_profiles CASCADE`);

  await assert.rejects(() => directory.listAgents());
  await assert.rejects(() => directory.listDirectory());
  await assert.rejects(() => directory.getPersona("x"));
  await assert.rejects(() => directory.getProfile("$X"));
});

test("a persona is one agent by handle, with its profile prose and no record", async (t) => {
  const { pool, directory } = await setup(t);
  // Ten and a half days, so a small drift between this clock and the database's cannot make it 9.
  const createdAt = new Date(Date.now() - 10.5 * 86_400_000);
  const id = await seedAgent(pool, { handle: "halftime", createdAt });
  await pool.query(
    `UPDATE agents.agent_profiles SET vibe = 'Patient', voice = 'Dry' WHERE agent_id = $1`,
    [id],
  );
  await seedToken(pool, id, "pre_graduation");

  const persona = await directory.getPersona("halftime");

  assert.equal(persona?.name, "Halftime");
  assert.equal(persona?.vibe, "Patient");
  assert.equal(persona?.calibrationGap, null);
  assert.equal(persona?.service, null, "no read service exists yet");
  assert.deepEqual(persona?.reads, []);
  assert.deepEqual(persona?.decisions, []);
  assert.equal(persona?.aliveDays, 10);
  assert.equal(persona?.stage, "pre-graduation", "the token exists");
  assert.equal(persona?.marketCap, null, "its cap is unread, which is not zero");
});

test("a killed agent still has a persona, so links to a record that existed survive", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "gone", killed: true });

  assert.ok(await directory.getPersona("gone"));
});

test("an unknown handle is null", async (t) => {
  const { directory } = await setup(t);

  assert.equal(await directory.getPersona("nobody"), null);
});

test("the directory lists every live agent with a null service", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool, { handle: "alpha" });
  await seedAgent(pool, { handle: "beta", killed: true });

  const entries = await directory.listDirectory();

  assert.deepEqual(
    entries.map((e) => e.agent.handle),
    ["alpha"],
  );
  assert.equal(entries[0]?.service, null);
  assert.equal(entries[0]?.score, null);
});

test("a profile by ticker resolves through the token, or is null", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool, { handle: "halftime" });
  await seedToken(pool, id, "pre_graduation");

  const profile = await directory.getProfile("$HALF");

  assert.equal(profile?.handle, "halftime");
  assert.equal(profile?.market, null, "no candles indexed yet, so no market");
  assert.deepEqual(profile?.calls, []);
  assert.equal(await directory.getProfile("$NOPE"), null);
});

test("a reserved ticker has no profile page, because it is not a launched token", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool);
  await seedToken(pool, id, "reserved");

  assert.equal(await directory.getProfile("$HALF"), null);
});

test("the leaderboard is empty until settlement exists", async (t) => {
  const { pool, directory } = await setup(t);
  await seedAgent(pool);

  const board = await directory.getLeaderboard();

  assert.deepEqual(board.entries, []);
  assert.deepEqual(board.calibration, []);
});

test("a pick is null until settlement exists, and reads are empty until they exist", async (t) => {
  const { pool, directory } = await setup(t);
  const id = await seedAgent(pool);
  await seedToken(pool, id, "graduated");

  assert.equal(await directory.getPick("$HALF", "anything"), null);
  assert.deepEqual(await directory.listReads(), []);
  assert.equal(await directory.getRead("anything"), null);
});

test("a private draft is not on the board, in the directory, at its handle or its ticker", async (t) => {
  const { pool, directory } = await setup(t);
  const listed = await seedAgent(pool, { handle: "public_one" });
  const draft = await seedAgent(pool, { handle: "draft_one", status: "draft" });
  await seedToken(pool, listed, "pre_graduation", "$PUB");
  await seedToken(pool, draft, "pre_graduation", "$DRAFT");

  const agents = await directory.listAgents();
  assert.deepEqual(
    agents.map((agent) => agent.handle),
    ["public_one"],
  );
  const rows = await directory.listDirectory();
  assert.deepEqual(
    rows.map((row) => row.agent.handle),
    ["public_one"],
  );
  assert.equal(await directory.getPersona("draft_one"), null);
  assert.ok(await directory.getPersona("public_one"));
  assert.equal(await directory.getProfile("$DRAFT"), null);
  assert.ok(await directory.getProfile("$PUB"));
});
