import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DEFAULT_BRIEF, STARTER_CAPS, PilotError, prepareDraft } from "@pickler/core";
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

/** A draft made the way the studio makes one: with its own agent wallet. */
async function setup(t: TestContext) {
  const store = await createTestStore(t);
  const studio = new PostgresStudioDirectory(store.pool);
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
  const created = await studio.createDraft(access, userId, {
    name: "Halftime",
    handle: "halftime",
    config,
    profile,
    walletId,
  });
  return { pool: store.pool, studio, userId, agentId: created.productId };
}

const stored = async (pool: Pool, agentId: string) =>
  (
    await pool.query("SELECT advice_price_micro_ausd::text AS p FROM agents.agents WHERE id=$1", [
      agentId,
    ])
  ).rows[0].p as string | null;

test("the owner sets and clears the advice price of an agent with a wallet", async (t) => {
  const f = await setup(t);
  assert.equal(await f.studio.setAdvicePrice(f.userId, f.agentId, 1500000n), 1500000n);
  assert.equal(await stored(f.pool, f.agentId), "1500000");
  assert.equal(await f.studio.setAdvicePrice(f.userId, f.agentId, null), null);
  assert.equal(await stored(f.pool, f.agentId), null);
});

test("a price needs the agent wallet, but clearing does not", async (t) => {
  const f = await setup(t);
  await f.studio.setAdvicePrice(f.userId, f.agentId, 1500000n);
  await f.pool.query("DELETE FROM wallets.agent_wallets WHERE agent_id=$1", [f.agentId]);
  await assert.rejects(
    () => f.studio.setAdvicePrice(f.userId, f.agentId, 2000000n),
    (error) =>
      error instanceof PilotError &&
      error.code === "CONFLICT" &&
      error.message === "AGENT_WALLET_REQUIRED",
  );
  assert.equal(await stored(f.pool, f.agentId), "1500000");
  await f.studio.setAdvicePrice(f.userId, f.agentId, null);
  assert.equal(await stored(f.pool, f.agentId), null);
});

test("someone else's agent is not found", async (t) => {
  const f = await setup(t);
  await assert.rejects(
    () => f.studio.setAdvicePrice(randomUUID(), f.agentId, 1500000n),
    (error) => error instanceof PilotError && error.code === "NOT_FOUND",
  );
  assert.equal(await stored(f.pool, f.agentId), null);
});
