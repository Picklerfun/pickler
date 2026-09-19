import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_CONFIG,
  createConsoleAccess,
  type AgentConfig,
  type Principal,
} from "@pickler/core";
import { PostgresConsoleDirectory } from "../src/console/directory.js";
import { PostgresBudgetLedger } from "../src/console/budget.js";
import { createTestStore } from "./database.js";

const base = { ...DEFAULT_CONFIG };
delete base.categoryIds;
const config: AgentConfig = {
  ...base,
  marketScope: { version: 1, category: "sports", subcategories: ["soccer"] },
};

async function setup(t: Parameters<typeof createTestStore>[0]) {
  const store = await createTestStore(t);
  const directory = new PostgresConsoleDirectory(store.pool);
  const userId = randomUUID();
  if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
    await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
  }
  await store.pool.query("SELECT identity.create_profile($1,'Researcher','researcher')", [userId]);
  await Promise.all([directory.onboard(userId), directory.onboard(userId)]);
  const access = (await directory.access(userId, null))!;
  return { store, directory, userId, access };
}

test("onboarding is idempotent and account creation does not enable research", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  assert.equal(access.enabled, false);
  assert.equal(access.workspaceId, access.tenantId);
  assert.equal(
    (await store.pool.query("SELECT count(*)::int AS n FROM identity.workspaces")).rows[0].n,
    1,
  );
  await assert.rejects(
    directory.createAgent(access, userId, {
      name: "Agent",
      handle: "agent_one",
      config,
      key: "create",
    }),
  );
  assert.equal((await store.agents(access.tenantId)).length, 0);
  assert.equal((await store.agents("alpha")).length, 1);
});

test("concurrent creation preserves one handle, config, mapping and disabled schedule", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const input = { name: "Agent", handle: "agent_one", config, key: "create" };
  const scopes = await Promise.all(
    Array.from({ length: 5 }, () => directory.createAgent(access, userId, input)),
  );
  assert.equal(new Set(scopes.map((s) => s.agentId)).size, 1);
  const agent = await store.agent(scopes[0]!);
  assert.equal(agent.scheduleEnabled, false);
  assert.deepEqual(agent.config.marketScope, config.marketScope);
  await assert.rejects(directory.createAgent(access, userId, { ...input, name: "Changed" }), {
    code: "CONFLICT",
  });
  await assert.rejects(directory.agentScope({ ...access, tenantId: "beta" }, scopes[0]!.agentId), {
    code: "NOT_FOUND",
  });
  await store.pool.query("UPDATE pickler.research_access SET enabled=false WHERE user_id=$1", [
    userId,
  ]);
  await assert.rejects(directory.createAgent(access, userId, input));
});

test("console authorization checks current ownership and never accepts an API key", async (t) => {
  const { store, directory, userId, access } = await setup(t);
  const service = createConsoleAccess(directory);
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
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const { agentId } = await directory.createAgent(access, userId, {
    name: "Agent",
    handle: "agent_one",
    config,
    key: "create",
  });
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
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await directory.createAgent(access, userId, {
    name: "Agent",
    handle: "agent_one",
    config,
    key: "create",
  });
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
  const { store, directory, userId, access } = await setup(t);
  await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
    userId,
  ]);
  const scope = await directory.createAgent(access, userId, {
    name: "Agent",
    handle: "agent_one",
    config,
    key: "create",
  });
  await store.setConnectionsChecked(true);
  await assert.rejects(store.schedule(scope, true, Date.now()));
  await store.setAgentConnectionsChecked(scope, 1, true);
  // A successful manual research is independently required.
  await assert.rejects(store.schedule(scope, true, Date.now()));
});
