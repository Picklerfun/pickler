import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  DEFAULT_BRIEF,
  DEFAULT_CONFIG,
  STARTER_CAPS,
  createStudioAccess,
  prepareDraft,
  type AgentConfig,
  type Principal,
} from "@pickler/core";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresBudgetLedger } from "../src/studio/budget.js";
import { createTestStore } from "./database.js";

const { config, profile } = prepareDraft({
  name: "Agent",
  handle: "agent_one",
  voice: "analyst",
  avatar: { accent: "amber", pattern: 0 },
  sources: { web: null },
  brief: DEFAULT_BRIEF,
  caps: STARTER_CAPS,
  walletId: "unused",
});
const input = { name: "Agent", handle: "agent_one", config, profile };
const base = { ...DEFAULT_CONFIG };
delete base.categoryIds;
/** A Polymarket config, for the runtime tests below that queue a run on the agent. */
const polymarket: AgentConfig = {
  ...base,
  marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
};
const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

/**
 * A `wallets.wallets` row (with its account) a draft can link. Approved with three policy ids (the
 * fewest any wallet is written with), the way a real `confirmPolicies` would have left it.
 */
async function seedWallet(pool: Pool, userId: string) {
  const walletId = `wallet-${hex(12)}`;
  await pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
     VALUES ($1, $2, $3, 'agent', 'Agent wallet 1', $4)`,
    [userId, walletId, `sub-${hex(12)}`, ["p1", "p2", "p3"]],
  );
  await pool.query(
    `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
     VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', 'm/44')`,
    [walletId, `0x${hex(40)}`],
  );
  return walletId;
}

async function setup(t: Parameters<typeof createTestStore>[0]) {
  const store = await createTestStore(t);
  const directory = new PostgresStudioDirectory(store.pool);
  const userId = randomUUID();
  if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  await store.pool.query("SELECT identity.create_profile($1,'Researcher','researcher')", [userId]);
  await Promise.all([directory.onboard(userId), directory.onboard(userId)]);
  const access = (await directory.access(userId, null))!;
  const walletId = await seedWallet(store.pool, userId);
  const draft = async () =>
    (await directory.createDraft(access, userId, { ...input, walletId })).scope;
  /**
   * The draft made an active Polymarket agent: drafts spend nothing and Perpl configs queue no
   * runs yet, and these tests are about the runtime, not about creating.
   */
  const active = async () => {
    const scope = await draft();
    await store.pool.query("UPDATE agents.agents SET status='active' WHERE id=$1", [scope.agentId]);
    await store.updateConfig(scope, (await store.agent(scope)).version, polymarket);
    return scope;
  };
  return { store, directory, userId, access, walletId, draft, active };
}

test("onboarding is idempotent and account creation does not enable research", async (t) => {
  const { store, access, draft } = await setup(t);
  assert.equal(access.enabled, false);
  assert.equal(access.workspaceId, access.tenantId);
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM identity.workspaces")).rows[0].n,
    1,
  );
  await assert.rejects(draft());
  assert.equal((await store.agents(access.tenantId)).length, 0);
  assert.equal((await store.agents("alpha")).length, 1);
});

test("concurrent creation preserves one handle, config, mapping and disabled schedule", async (t) => {
  const { store, directory, userId, access, walletId, draft } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scopes = await Promise.all(Array.from({ length: 5 }, () => draft()));
  assert.equal(new Set(scopes.map((s) => s.agentId)).size, 1);
  const agent = await store.agent(scopes[0]!);
  assert.equal(agent.scheduleEnabled, false);
  assert.deepEqual(agent.config.voice, config.voice);
  await assert.rejects(
    directory.createDraft(access, userId, { ...input, name: "Changed", walletId }),
    { code: "WALLET_ASSIGNED" },
  );
  await assert.rejects(directory.agentScope({ ...access, tenantId: "beta" }, scopes[0]!.agentId), {
    code: "NOT_FOUND",
  });
  await store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    userId,
  ]);
  await assert.rejects(draft());
});

test("studio authorization checks current ownership and never accepts an API key", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  const service = createStudioAccess(directory);
  const user = { id: userId, kind: "user", tenantId: access.workspaceId } as Principal;
  await assert.rejects(service.authorize(user, true));
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  assert.equal((await service.authorize(user, true)).enabled, true);
  await assert.rejects(service.authorize({ ...user, kind: "apikey", scopes: [] } as Principal));
  await assert.rejects(service.authorize({ ...user, tenantId: randomUUID() }));
});

test("PostgreSQL budget coordinates independent executors and preserves idempotency after restart", async (t) => {
  const { store, userId, active } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const { agentId } = await active();
  const ledger = new PostgresBudgetLedger(store.pool);
  const peer = new PostgresBudgetLedger(store.connectPeer().pool);
  await ledger.configure(agentId, { tokens: "1000" });
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? peer : ledger).reserve(agentId, {
        reservationId: `request-${i}`,
        category: "tokens",
        amount: "70",
        source: "test",
        ttlMs: 60_000,
      }),
    ),
  );
  assert.equal(results.filter((r) => r.success).length, 14);
  const snapshot = await peer.snapshot(agentId);
  assert.equal(snapshot.categories.find((c) => c.category === "tokens")!.reserved, 980n);
  await peer.commit(agentId, "request-0");
  await ledger.commit(agentId, "request-0");
  await peer.release(agentId, "request-0");
  await ledger.release(agentId, "request-0");
  assert.equal(
    (await ledger.snapshot(agentId)).categories.find((c) => c.category === "tokens")!.spent,
    0n,
  );
});

test("revoking operator access blocks claims and writes from an active execution", async (t) => {
  const { store, userId, active } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await active();
  const queued = await store.enqueue(scope, "first", null, Date.now());
  const running = await store.claim(Date.now());
  assert.equal(running!.id, queued.id);
  await store.event(running!, "partial", { preserved: true }, Date.now());

  await store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    userId,
  ]);
  await assert.rejects(store.assertOwnership(running!), { code: "LEASE_LOST" });
  await assert.rejects(store.event(running!, "late", {}, Date.now()));
  await assert.rejects(store.enqueue(scope, "second", null, Date.now()));
  assert.equal(
    (await store.events(scope.tenantId, queued.id)).filter((e) => e.type === "partial").length,
    1,
  );
});

test("global lab connection validation never enables a managed agent's schedule", async (t) => {
  const { store, userId, active } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await active();
  const { version } = await store.agent(scope);
  await store.setConnectionsChecked(true);
  await assert.rejects(store.schedule(scope, true, Date.now()), { code: "NOT_READY" });
  await store.setAgentConnectionsChecked(scope, version, true);
  // A successful manual research is independently required.
  await assert.rejects(store.schedule(scope, true, Date.now()), { code: "NOT_READY" });
});

test("the agent list carries each agent's accent, and lime for an agent without a profile", async (t) => {
  const { store, directory, userId, access, draft } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const { agentId } = await draft();

  const listed = await directory.list(access);

  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.accent, "amber");

  await store.pool.query("DELETE FROM agents.agent_profiles WHERE agent_id = $1", [agentId]);

  assert.equal((await directory.list(access))[0]!.accent, "lime");
});
