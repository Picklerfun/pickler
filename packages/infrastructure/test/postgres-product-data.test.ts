import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createProfileService,
  DataSourceUnavailableError,
  ProfileAlreadyExistsError,
  ProfileHandleTakenError,
} from "@pickler/core";
import { PostgresProfileRepository } from "../src/persistence/profile-repository.js";
import {
  PostgresApiKeyDirectory,
  PostgresWorkspaceDirectory,
} from "../src/persistence/access-directory.js";
import {
  PostgresAgentEventLog,
  PostgresAgentRegistry,
  PostgresBudgetSource,
} from "../src/persistence/agent-registry.js";
import { PostgresApplicants, PostgresWaitlist } from "../src/persistence/growth-store.js";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { createTestStore } from "./database.js";

/** A user id that satisfies the auth.users reference when the database has one. */
async function newUser(pool: Pool) {
  const userId = randomUUID();
  if ((await pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  return userId;
}

/** An agent with its handle, profile and credentials, written together as the deferred keys require. */
async function seedAgent(pool: Pool, workspaceId: string, handle: string) {
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO agents.agents (id, workspace_id, name, handle, status) VALUES ($1,$2,'Halftime',$3,'active')",
      [id, workspaceId, handle],
    );
    await client.query("INSERT INTO identity.handles (handle, agent_id) VALUES ($1,$2)", [
      handle,
      id,
    ]);
    await client.query("INSERT INTO agents.agent_profiles (agent_id, blurb) VALUES ($1,'')", [id]);
    await client.query(
      "INSERT INTO agents.agent_credentials (agent_id, encrypted_hmac_secret) VALUES ($1,'sealed')",
      [id],
    );
    await client.query("COMMIT");
  } finally {
    client.release();
  }
  return id;
}

/** These tests are about the profile rows; the wallet rule is core's and the API's to test. */
const EVERYONE_HAS_A_WALLET = { hasCustodyAccount: async () => true };

test("a profile is created through identity.create_profile and read back", async (t) => {
  const { pool } = await createTestStore(t);
  const repository = new PostgresProfileRepository(pool);
  const userId = await newUser(pool);

  assert.equal(await repository.findByUserId(userId), null);
  assert.equal(await repository.isHandleTaken("anarobles"), false);
  const result = await repository.create({
    userId,
    displayName: "Ana Robles",
    handle: "anarobles",
  });
  assert.equal(result.created, true);
  const profile = result.created ? result.profile : null;
  assert.equal(profile?.userId, userId);
  assert.equal(profile?.displayName, "Ana Robles");
  assert.equal(profile?.handle, "anarobles");
  assert.ok(profile?.createdAt instanceof Date);
  assert.deepEqual(await repository.findByUserId(userId), profile);
  assert.equal(await repository.isHandleTaken("anarobles"), true);
  // Malformed handles are never available.
  assert.equal(await repository.isHandleTaken("No"), true);
});

test("create reports handle_taken and user_has_profile as the function returns them", async (t) => {
  const { pool } = await createTestStore(t);
  const repository = new PostgresProfileRepository(pool);
  const [first, second] = [await newUser(pool), await newUser(pool)];
  await repository.create({ userId: first, displayName: "Ana", handle: "anarobles" });

  assert.deepEqual(
    await repository.create({ userId: second, displayName: "Bo", handle: "anarobles" }),
    { created: false, reason: "handle_taken" },
  );
  assert.deepEqual(
    await repository.create({ userId: first, displayName: "Ana", handle: "another" }),
    { created: false, reason: "user_has_profile" },
  );
});

test("the profile service maps the outcomes to its errors", async (t) => {
  const { pool } = await createTestStore(t);
  const profiles = createProfileService(new PostgresProfileRepository(pool), EVERYONE_HAS_A_WALLET);
  const [first, second] = [await newUser(pool), await newUser(pool)];
  const created = await profiles.createProfile(first, { displayName: "Ana", handle: "anarobles" });

  // The same request again is a safe retry.
  assert.deepEqual(
    await profiles.createProfile(first, { displayName: "Ana", handle: "anarobles" }),
    created,
  );
  await assert.rejects(
    profiles.createProfile(second, { displayName: "Bo", handle: "anarobles" }),
    ProfileHandleTakenError,
  );
  await assert.rejects(
    profiles.createProfile(first, { displayName: "Ana", handle: "another" }),
    ProfileAlreadyExistsError,
  );
});

test("onboarding succeeds on the same database right after the profile is created", async (t) => {
  const { pool } = await createTestStore(t);
  const profiles = createProfileService(new PostgresProfileRepository(pool), EVERYONE_HAS_A_WALLET);
  const directory = new PostgresStudioDirectory(pool);
  const workspaces = new PostgresWorkspaceDirectory(pool);
  const userId = await newUser(pool);

  await profiles.createProfile(userId, { displayName: "Ana Robles", handle: "anarobles" });
  await directory.onboard(userId);

  const owned = await workspaces.findOwnedBy(userId);
  assert.equal(owned?.userId, userId);
  assert.equal(owned?.name, "Ana Robles");
  assert.equal(owned?.isActive, true);
  assert.ok(Array.isArray(owned?.activeModules));
  assert.deepEqual(await workspaces.findById(owned!.id), owned);
  assert.equal(await workspaces.roleOf(userId, owned!.id), "admin");
  assert.ok(await directory.access(userId, null));
});

test("workspace members resolve by their oldest membership and role", async (t) => {
  const { pool } = await createTestStore(t);
  const profiles = new PostgresProfileRepository(pool);
  const directory = new PostgresStudioDirectory(pool);
  const workspaces = new PostgresWorkspaceDirectory(pool);
  const [owner, member, stranger] = [await newUser(pool), await newUser(pool), await newUser(pool)];
  await profiles.create({ userId: owner, displayName: "Owner", handle: "owner" });
  await directory.onboard(owner);
  const workspace = (await workspaces.findOwnedBy(owner))!;
  await pool.query(
    "INSERT INTO identity.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'developer')",
    [workspace.id, member],
  );

  assert.deepEqual(await workspaces.findOldestMembership(member), {
    workspaceId: workspace.id,
    role: "developer",
  });
  assert.equal(await workspaces.findOldestMembership(stranger), null);
  assert.equal(await workspaces.roleOf(member, workspace.id), "developer");
  assert.equal(await workspaces.roleOf(stranger, workspace.id), null);
  assert.equal(await workspaces.findOwnedBy(stranger), null);
});

test("api keys are found by hash, with revocation and cidrs as text", async (t) => {
  const { pool } = await createTestStore(t);
  const userId = await newUser(pool);
  await new PostgresProfileRepository(pool).create({ userId, displayName: "Ana", handle: "keys" });
  await new PostgresStudioDirectory(pool).onboard(userId);
  const workspace = (await new PostgresWorkspaceDirectory(pool).findOwnedBy(userId))!;
  const hash = "a".repeat(64);
  await pool.query(
    `INSERT INTO identity.api_keys (workspace_id, name, hash, scopes, allowed_cidrs, revoked_at)
     VALUES ($1, 'ci', $2, ARRAY['agents:read'], ARRAY['10.0.0.0/8']::cidr[], now())`,
    [workspace.id, hash],
  );
  const keys = new PostgresApiKeyDirectory(pool);

  const key = await keys.findByHash(hash);
  assert.equal(key?.workspaceId, workspace.id);
  assert.deepEqual(key?.scopes, ["agents:read"]);
  assert.deepEqual(key?.allowedCidrs, ["10.0.0.0/8"]);
  assert.equal(key?.active, false);
  assert.equal(key?.expiresAt, null);
  assert.equal(key?.linkExpiresAt, null);
  assert.equal(await keys.findByHash("b".repeat(64)), null);
});

test("agents, credentials, events and budgets read back through the registry", async (t) => {
  const { pool } = await createTestStore(t);
  const userId = await newUser(pool);
  await new PostgresProfileRepository(pool).create({ userId, displayName: "Ana", handle: "maker" });
  await new PostgresStudioDirectory(pool).onboard(userId);
  const workspace = (await new PostgresWorkspaceDirectory(pool).findOwnedBy(userId))!;
  const agentId = await seedAgent(pool, workspace.id, "halftime");
  const registry = new PostgresAgentRegistry(pool);
  const events = new PostgresAgentEventLog(pool);

  const agent = await registry.findById(agentId);
  assert.equal(agent?.workspaceId, workspace.id);
  assert.equal(agent?.status, "active");
  assert.equal(agent?.description, null);
  assert.ok(agent?.createdAt instanceof Date);
  assert.equal(await registry.findById("not-a-uuid"), null);
  assert.equal(await registry.findById(randomUUID()), null);
  assert.deepEqual(
    (await registry.listByWorkspace(workspace.id)).map((row) => row.id),
    [agentId],
  );
  assert.deepEqual(await registry.findCredentials(agentId), {
    id: agentId,
    workspaceId: workspace.id,
    walletId: null,
    status: "active",
    encryptedAgentSecret: "sealed",
  });

  for (const [type, status] of [
    ["trade", "filled"],
    ["trade", "rejected"],
    ["heartbeat", null],
  ] as const) {
    await pool.query(
      "INSERT INTO agents.agent_events (agent_id, workspace_id, event_type, payload) VALUES ($1,$2,$3,$4)",
      [agentId, workspace.id, type, status ? { status } : null],
    );
  }
  assert.equal((await events.listSince(agentId, new Date(0))).length, 3);
  const page = await events.audit(agentId, {
    page: 1,
    limit: 1,
    eventTypes: ["trade"],
    since: null,
    status: null,
  });
  assert.equal(page.total, 2);
  assert.equal(page.events.length, 1);
  assert.equal(page.events[0]?.skillId, null);
  const filled = await events.audit(agentId, {
    page: 1,
    limit: 20,
    eventTypes: null,
    since: new Date(0),
    status: "filled",
  });
  assert.equal(filled.total, 1);
  assert.deepEqual(filled.events[0]?.payload, { status: "filled" });
  // Past the last page: no rows, and the total still counts every match.
  const beyond = await events.audit(agentId, {
    page: 9,
    limit: 20,
    eventTypes: null,
    since: null,
    status: null,
  });
  assert.deepEqual([beyond.events.length, beyond.total], [0, 3]);

  await pool.query(
    `INSERT INTO budget.budgets (agent_id, category, limit_micro_usd, spent_micro_usd, period_key)
     VALUES ($1, 'payments', 9007199254740993, 5, '2026-09')`,
    [agentId],
  );
  assert.deepEqual(await new PostgresBudgetSource(pool).loadBudgets(agentId), [
    { category: "payments", limit: "9007199254740993", spent: "5" },
  ]);
});

test("waitlist and applications go through the growth functions", async (t) => {
  const { pool } = await createTestStore(t);
  const waitlist = new PostgresWaitlist(pool);
  const applicants = new PostgresApplicants(pool);

  const seat = await waitlist.join("ana@example.com", null);
  assert.equal(seat.position, 1);
  assert.equal(seat.alreadyJoined, false);
  assert.ok(seat.applyToken);
  assert.deepEqual(await waitlist.join("ana@example.com", null), {
    position: 1,
    alreadyJoined: true,
    applyToken: null,
  });

  assert.equal(await applicants.findByToken("nope"), null);
  assert.equal(await applicants.findByToken(randomUUID()), null);
  const before = await applicants.findByToken(seat.applyToken!);
  assert.equal(before?.email, "ana@example.com");
  assert.equal(before?.application, null);

  assert.equal(await applicants.isTickerAvailable("$HALF"), true);
  const application = {
    agentName: "Halftime",
    ticker: "$HALF",
    xHandle: "@halftime",
    category: "Sports" as const,
    personality: "Analyst" as const,
    edge: "Injury news",
    whyYou: "I watch every game",
  };
  assert.equal(await applicants.submit(seat.applyToken!, application), "submitted");
  assert.equal(await applicants.submit(seat.applyToken!, application), "already_submitted");
  assert.equal(await applicants.submit("nope", application), "not_found");
  assert.equal(await applicants.isTickerAvailable("$HALF"), false);
  const after = await applicants.findByToken(seat.applyToken!);
  assert.equal(after?.application?.ticker, "$HALF");
  assert.ok(after?.application?.submittedAt instanceof Date);
});

test("a failed query surfaces as DataSourceUnavailableError", async (t) => {
  const { pool } = await createTestStore(t);
  // A workspace id that is not a uuid fails the cast, as it did through PostgREST.
  await assert.rejects(
    new PostgresWorkspaceDirectory(pool).findById("not-a-uuid"),
    DataSourceUnavailableError,
  );
});
