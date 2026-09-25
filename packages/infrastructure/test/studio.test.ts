import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  DEFAULT_CONFIG,
  createStudioAccess,
  type AgentConfig,
  type Principal,
} from "@pickler/core";
import { PostgresStudioDirectory } from "../src/studio/directory.js";
import { PostgresBudgetLedger } from "../src/studio/budget.js";
import { createTestStore } from "./database.js";

const base = { ...DEFAULT_CONFIG };
delete base.categoryIds;
const config: AgentConfig = {
  ...base,
  marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
};
const profile = {
  accent: "amber" as const,
  blurb: "Bets on NBA injury news before the lines move.",
  venue: "predictions" as const,
  vibe: "",
  voice: "",
  decides: "",
  wrong: "",
  xHandle: null,
};
const input = { name: "Agent", handle: "agent_one", config, key: "create", profile };
const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

/** A `wallets.wallets` row (with its account) an `agent_wallets` link can reference. */
async function seedWallet(
  pool: Pool,
  userId: string,
  overrides: { walletId?: string; name?: string } = {},
) {
  const walletId = overrides.walletId ?? `wallet-${hex(12)}`;
  await pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
     VALUES ($1, $2, $3, 'agent', $4)`,
    [userId, walletId, `sub-${hex(12)}`, overrides.name ?? "halftime"],
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
  const wallet = { walletId, policyIds: ["p1", "p2"] };
  return { store, directory, userId, access, wallet };
}

test("onboarding is idempotent and account creation does not enable research", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  assert.equal(access.enabled, false);
  assert.equal(access.workspaceId, access.tenantId);
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM identity.workspaces")).rows[0].n,
    1,
  );
  await assert.rejects(directory.createAgent(access, userId, { ...input, wallet }));
  assert.equal((await store.agents(access.tenantId)).length, 0);
  assert.equal((await store.agents("alpha")).length, 1);
});

test("concurrent creation preserves one handle, config, mapping and disabled schedule", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scopes = await Promise.all(
    Array.from({ length: 5 }, () => directory.createAgent(access, userId, { ...input, wallet })),
  );
  assert.equal(new Set(scopes.map((s) => s.agentId)).size, 1);
  const agent = await store.agent(scopes[0]!);
  assert.equal(agent.scheduleEnabled, false);
  assert.deepEqual(agent.config.marketScope, config.marketScope);
  await assert.rejects(
    directory.createAgent(access, userId, { ...input, name: "Changed", wallet }),
    { code: "CONFLICT" },
  );
  await assert.rejects(directory.agentScope({ ...access, tenantId: "beta" }, scopes[0]!.agentId), {
    code: "NOT_FOUND",
  });
  await store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    userId,
  ]);
  await assert.rejects(directory.createAgent(access, userId, { ...input, wallet }));
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
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const { agentId } = await directory.createAgent(access, userId, { ...input, wallet });
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
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await directory.createAgent(access, userId, { ...input, wallet });
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
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await directory.createAgent(access, userId, { ...input, wallet });
  await store.setConnectionsChecked(true);
  await assert.rejects(store.schedule(scope, true, Date.now()));
  await store.setAgentConnectionsChecked(scope, 1, true);
  // A successful manual research is independently required.
  await assert.rejects(store.schedule(scope, true, Date.now()));
});

test("creating an agent writes its profile in the same transaction", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);

  const { agentId } = await directory.createAgent(access, userId, {
    name: "Halftime",
    handle: "halftime",
    config,
    key: "profile",
    profile: { ...profile, vibe: "Reads the injury report before the tape.", xHandle: "@halftime" },
    wallet,
  });

  const { rows } = await store.pool.query(
    `SELECT beat, accent, blurb, venue, vibe, x_handle
     FROM agents.agent_profiles WHERE agent_id = $1`,
    [agentId],
  );
  assert.deepEqual(rows[0], {
    beat: "sports",
    accent: "amber",
    blurb: "Bets on NBA injury news before the lines move.",
    venue: "predictions",
    vibe: "Reads the injury report before the tape.",
    x_handle: "@halftime",
  });
});

test("a retry under the same key with a different profile is refused", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  await directory.createAgent(access, userId, { ...input, wallet });

  await assert.rejects(
    directory.createAgent(access, userId, {
      ...input,
      wallet,
      profile: { ...profile, accent: "blue" },
    }),
    { code: "CONFLICT" },
  );
});

test("a profile the database refuses rolls the agent back too", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);

  await assert.rejects(() =>
    directory.createAgent(access, userId, {
      name: "Halftime",
      handle: "halftime",
      config,
      key: "toolong",
      // 281 characters: violates agent_profiles_blurb_length inside the transaction
      profile: { ...profile, blurb: "x".repeat(281) },
      wallet,
    }),
  );

  const { rows } = await store.pool.query(`SELECT count(*)::int AS n FROM agents.agents`);
  assert.equal(rows[0].n, 0, "the agent row must not survive a failed profile insert");
});

test("a second agent with the same X handle is refused by name", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  await directory.createAgent(access, userId, {
    ...input,
    wallet,
    profile: { ...profile, xHandle: "@Halftime" },
  });

  await assert.rejects(
    directory.createAgent(access, userId, {
      ...input,
      wallet,
      handle: "agent_two",
      key: "second",
      profile: { ...profile, xHandle: "@halftime" },
    }),
    { code: "CONFLICT", message: "X handle already used" },
  );
});

test("creating an agent links the wallet whose policies were approved", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const walletId = await seedWallet(store.pool, userId, { walletId: "w1", name: "halftime" });

  const { agentId } = await directory.createAgent(access, userId, {
    ...input,
    wallet: { walletId, policyIds: ["p1", "p2", "p3"] },
  });

  const { rows } = await store.pool.query(
    `SELECT wallet_id, policy_ids FROM wallets.agent_wallets WHERE agent_id = $1`,
    [agentId],
  );
  assert.deepEqual(rows, [{ wallet_id: "w1", policy_ids: ["p1", "p2", "p3"] }]);
});

test("a wallet already linked to another agent is refused, and no second agent row survives", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);

  await directory.createAgent(access, userId, { ...input, wallet, key: "first" });

  await assert.rejects(
    directory.createAgent(access, userId, {
      ...input,
      wallet,
      handle: "agent_two",
      key: "second",
    }),
    { code: "CONFLICT", message: "That wallet already belongs to an agent" },
  );

  const { rows } = await store.pool.query(
    `SELECT count(*)::int AS n FROM agents.agents WHERE workspace_id = $1`,
    [access.workspaceId],
  );
  assert.equal(rows[0].n, 1, "the second agent must not survive a wallet already linked");
});

test("a wallet that is not the creator's is refused", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const strangerId = randomUUID();
  const walletId = await seedWallet(store.pool, strangerId);

  await assert.rejects(
    directory.createAgent(access, userId, {
      ...input,
      wallet: { walletId, policyIds: ["p1", "p2"] },
    }),
  );

  const { rows } = await store.pool.query(`SELECT count(*)::int AS n FROM agents.agents`);
  assert.equal(rows[0].n, 0, "no agent may be created against a wallet that is not the creator's");
});

test("the idempotent retry with the same wallet returns the same agent; a retry with a different wallet is a different request", async (t) => {
  const { store, directory, userId, access, wallet } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);

  const first = await directory.createAgent(access, userId, { ...input, wallet, key: "idem" });
  const second = await directory.createAgent(access, userId, { ...input, wallet, key: "idem" });
  assert.equal(second.agentId, first.agentId);

  const otherWalletId = await seedWallet(store.pool, userId);
  await assert.rejects(
    directory.createAgent(access, userId, {
      ...input,
      key: "idem",
      wallet: { walletId: otherWalletId, policyIds: ["p1", "p2"] },
    }),
    { code: "CONFLICT" },
  );
});
