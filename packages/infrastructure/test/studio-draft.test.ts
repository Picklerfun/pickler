import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_BRIEF,
  MAX_DRAFTS_PER_WORKSPACE,
  PilotError,
  STARTER_CAPS,
  prepareDraft,
} from "@pickler/core";
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

async function setup(t: TestContext) {
  const store = await createTestStore(t);
  const directory = new PostgresStudioDirectory(store.pool);
  const person = async (handle: string) => {
    const userId = randomUUID();
    if ((await store.pool.query("SELECT to_regclass('auth.users') AS name")).rows[0].name) {
      await store.pool.query("INSERT INTO auth.users (id) VALUES ($1)", [userId]);
    }
    await store.pool.query("SELECT identity.create_profile($1,'Maker',$2)", [userId, handle]);
    await directory.onboard(userId);
    await store.pool.query("UPDATE pickler.research_access SET enabled=true WHERE user_id=$1", [
      userId,
    ]);
    return { userId, access: (await directory.access(userId, null))! };
  };
  /**
   * An unlinked agent wallet of this person's, with its account. Approved with three policy ids
   * (the fewest any wallet is written with) unless `approvedPolicyIds` says otherwise.
   */
  const wallet = async (
    userId: string,
    approvedPolicyIds: string[] | null = ["p1", "p2", "p3"],
  ) => {
    const walletId = `wallet-${hex(12)}`;
    await store.pool.query(
      `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name, approved_policy_ids)
       VALUES ($1, $2, $3, 'agent', 'Agent wallet 1', $4)`,
      [userId, walletId, `sub-${hex(12)}`, approvedPolicyIds],
    );
    await store.pool.query(
      `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
       VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', 'm/44')`,
      [walletId, `0x${hex(40)}`],
    );
    return walletId;
  };
  const terms = (walletId: string, handle = "halftime", name = "Halftime") => ({
    name,
    handle,
    config,
    profile,
    walletId,
  });
  return { store, directory, person, wallet, terms };
}

const agentCount = async (f: Awaited<ReturnType<typeof setup>>, handle: string) =>
  (await f.store.pool.query("SELECT 1 FROM agents.agents WHERE handle=$1", [handle])).rows.length;

test("a draft links the wallet, with its approved policy ids, its profile and its config", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId);

  const created = await f.directory.createDraft(owner.access, owner.userId, f.terms(walletId));

  const agent = await f.store.pool.query("SELECT status, name FROM agents.agents WHERE id=$1", [
    created.productId,
  ]);
  assert.deepEqual(agent.rows[0], { status: "draft", name: "Halftime" });
  const link = await f.store.pool.query(
    "SELECT wallet_id, policy_ids FROM wallets.agent_wallets WHERE agent_id=$1",
    [created.productId],
  );
  assert.deepEqual(link.rows[0], { wallet_id: walletId, policy_ids: ["p1", "p2", "p3"] });
  const face = await f.store.pool.query(
    "SELECT accent, avatar_pattern, voice, venue FROM agents.agent_profiles WHERE agent_id=$1",
    [created.productId],
  );
  assert.deepEqual(face.rows[0], {
    accent: "cyan",
    avatar_pattern: 3,
    voice: "Analyst",
    venue: "perps",
  });
  assert.deepEqual((await f.store.agent(created.scope)).config, config);
  const listed = await f.directory.list(owner.access);
  assert.deepEqual(
    listed.map((item) => [item.handle, item.draft, item.accent]),
    [["halftime", true, "cyan"]],
  );
});

test("a wallet already linked to an agent is WALLET_ASSIGNED", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId);
  await f.directory.createDraft(owner.access, owner.userId, f.terms(walletId));

  await assert.rejects(
    f.directory.createDraft(owner.access, owner.userId, f.terms(walletId, "fulltime", "Fulltime")),
    { code: "WALLET_ASSIGNED" },
  );
  assert.equal(await agentCount(f, "fulltime"), 0);
});

test("a wallet without approved policies is POLICIES_MISSING and writes nothing", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const unapproved = await f.wallet(owner.userId, null);
  const partial = await f.wallet(owner.userId, ["p1", "p2"]);

  for (const walletId of [unapproved, partial]) {
    await assert.rejects(f.directory.createDraft(owner.access, owner.userId, f.terms(walletId)), {
      code: "POLICIES_MISSING",
    });
  }
  assert.equal(await agentCount(f, "halftime"), 0);
});

test("another person's wallet, or none, is WALLET_NOT_FOUND", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const other = await f.person("owner_two");
  const theirs = await f.wallet(other.userId);

  for (const walletId of [theirs, "wallet-missing"]) {
    await assert.rejects(f.directory.createDraft(owner.access, owner.userId, f.terms(walletId)), {
      code: "WALLET_NOT_FOUND",
    });
  }
  assert.equal(await agentCount(f, "halftime"), 0);
});

test("a taken handle is HANDLE_TAKEN and leaves the wallet unlinked", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  await f.person("halftime");
  const walletId = await f.wallet(owner.userId);

  await assert.rejects(f.directory.createDraft(owner.access, owner.userId, f.terms(walletId)), {
    code: "HANDLE_TAKEN",
  });
  const link = await f.store.pool.query("SELECT 1 FROM wallets.agent_wallets WHERE wallet_id=$1", [
    walletId,
  ]);
  assert.equal(link.rows.length, 0);
});

test("the wallet is checked before admit: a refused wallet never reaches the lock", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId, null);
  let admitted = false;

  await assert.rejects(
    f.directory.createDraft(owner.access, owner.userId, f.terms(walletId), async () => {
      admitted = true;
    }),
    { code: "POLICIES_MISSING" },
  );
  assert.equal(admitted, false);
});

test("a retry returns the same productId without calling admit", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId);
  const created = await f.directory.createDraft(owner.access, owner.userId, f.terms(walletId));
  let admitted = false;

  const replayed = await f.directory.createDraft(
    owner.access,
    owner.userId,
    f.terms(walletId),
    async () => {
      admitted = true;
    },
  );

  assert.deepEqual(replayed, created);
  assert.equal(admitted, false);
  assert.equal(await agentCount(f, "halftime"), 1);
});

test("a retry under another name is WALLET_ASSIGNED, and the draft keeps its name", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId);
  const created = await f.directory.createDraft(owner.access, owner.userId, f.terms(walletId));

  await assert.rejects(
    f.directory.createDraft(owner.access, owner.userId, f.terms(walletId, "halftime", "Fulltime")),
    { code: "WALLET_ASSIGNED" },
  );
  const agent = await f.store.pool.query("SELECT name FROM agents.agents WHERE id=$1", [
    created.productId,
  ]);
  assert.equal(agent.rows[0].name, "Halftime");
});

test("an admit that refuses writes nothing and leaves the wallet unlinked", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  const walletId = await f.wallet(owner.userId);

  await assert.rejects(
    f.directory.createDraft(owner.access, owner.userId, f.terms(walletId), async () => {
      throw new PilotError("WALLET_UNDERFUNDED", "Fund its wallet first");
    }),
    { code: "WALLET_UNDERFUNDED" },
  );
  assert.equal(await agentCount(f, "halftime"), 0);
  const link = await f.store.pool.query("SELECT 1 FROM wallets.agent_wallets WHERE wallet_id=$1", [
    walletId,
  ]);
  assert.equal(link.rows.length, 0);
});

test("two concurrent drafts serialize on the create lock: the draft limit admits only one", async (t) => {
  const f = await setup(t);
  const owner = await f.person("owner_one");
  // The route's lock over this directory: drafts are refused at their limit.
  const admit = async () => {
    const drafts = (await f.directory.list(owner.access)).filter((agent) => agent.draft);
    if (drafts.length >= MAX_DRAFTS_PER_WORKSPACE) {
      throw new PilotError("DRAFT_LIMIT", "At most 3 drafts at a time");
    }
  };
  const draft = async (handle: string) =>
    f.directory.createDraft(
      owner.access,
      owner.userId,
      f.terms(await f.wallet(owner.userId), handle, "Agent"),
      admit,
    );
  await draft("agent_one");
  await draft("agent_two");

  const results = await Promise.allSettled([draft("agent_three"), draft("agent_four")]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const refused = results.find((result) => result.status === "rejected");
  assert.equal((refused as PromiseRejectedResult).reason.code, "DRAFT_LIMIT");
  assert.equal((await f.directory.list(owner.access)).length, MAX_DRAFTS_PER_WORKSPACE);
});
