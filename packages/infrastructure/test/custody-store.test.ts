import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  DelegatedUserExistsError,
  DepositAlreadyRecordedError,
  TransferAlreadyRecordedError,
  type RegistrationInput,
} from "@pickler/core";
import { PostgresCustodyStore } from "../src/persistence/custody-store.js";
import { createTestStore } from "./database.js";

const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

/**
 * A minimal agent, the way the studio writes one: the agent and its handle reference each other
 * through deferrable foreign keys, so both inserts share one transaction. With `runtimeConfig` it
 * also writes the runtime agent and the product link that carry the caps. Returns the agent id.
 */
async function seedAgent(pool: Pool, runtimeConfig?: Record<string, unknown>) {
  const id = randomUUID();
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const handle = `h${id.slice(0, 8)}`;

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
      `INSERT INTO agents.agents (id, workspace_id, name, handle, status, created_by)
       VALUES ($1, $2, 'Halftime', $3, 'active', $4)`,
      [id, workspaceId, handle, userId],
    );
    await client.query(`INSERT INTO identity.handles (handle, agent_id) VALUES ($1, $2)`, [
      handle,
      id,
    ]);
    if (runtimeConfig) {
      await client.query(
        `INSERT INTO pickler.workspace_tenants (workspace_id, tenant_id) VALUES ($1, $2)`,
        [workspaceId, workspaceId],
      );
      await client.query(
        `INSERT INTO pickler.agents (tenant_id, id, config) VALUES ($1, $2, $3::jsonb)`,
        [workspaceId, id, JSON.stringify(runtimeConfig)],
      );
      await client.query(
        `INSERT INTO pickler.product_agents (product_agent_id, workspace_id, tenant_id, runtime_agent_id, request_key, request)
         VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
        [id, workspaceId, workspaceId, id, hex(16)],
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

/** A `wallets.wallets` row an `agent_wallets` row can reference. Returns its wallet id. */
async function seedWalletRecord(pool: Pool) {
  const walletId = `wallet-${hex(12)}`;
  await pool.query(
    `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
     VALUES ($1, $2, $3, 'agent', 'Agent Wallet')`,
    [randomUUID(), walletId, `sub-${hex(12)}`],
  );
  return walletId;
}

/** masterWalletId equals walletId because registration mints exactly one wallet. */
function registration(overrides: Partial<RegistrationInput> = {}): RegistrationInput {
  const walletId = `wallet-${hex(12)}`;
  return {
    userId: randomUUID(),
    subOrganizationId: `sub-${hex(12)}`,
    masterWalletId: walletId,
    rootUserId: `root-${hex(12)}`,
    walletId,
    address: `0x${hex(40)}`,
    credentialId: `credential-${hex(16)}`,
    label: "MacBook",
    transports: ["internal", "hybrid"],
    deviceType: "multiDevice",
    ...overrides,
  };
}

/** Every one of the four tables a registration writes, counted for one person. */
async function rowCounts(pool: Pool, userId: string, walletId: string) {
  const { rows } = await pool.query<Record<"orgs" | "wallets" | "accounts" | "passkeys", string>>(
    `SELECT (SELECT count(*) FROM wallets.turnkey_orgs WHERE user_id = $1) AS orgs,
            (SELECT count(*) FROM wallets.wallets WHERE wallet_id = $2) AS wallets,
            (SELECT count(*) FROM wallets.wallet_accounts WHERE wallet_id = $2) AS accounts,
            (SELECT count(*) FROM wallets.passkeys WHERE user_id = $1) AS passkeys`,
    [userId, walletId],
  );
  const [row] = rows;
  assert.ok(row);
  return {
    orgs: Number(row.orgs),
    wallets: Number(row.wallets),
    accounts: Number(row.accounts),
    passkeys: Number(row.passkeys),
  };
}

async function setup(t: TestContext) {
  const store = await createTestStore(t);
  return { store, custody: new PostgresCustodyStore(store.pool) };
}

test("a registration lands in every table, credential included", async (t) => {
  const { store, custody } = await setup(t);
  const input = registration();

  assert.deepEqual(await custody.saveRegistration(input), { created: true });

  assert.deepEqual(await custody.findByUserId(input.userId), {
    userId: input.userId,
    subOrganizationId: input.subOrganizationId,
    masterWalletId: input.masterWalletId,
    rootUserId: input.rootUserId,
    address: input.address,
  });
  // The credential is what excludeCredentials reads on a second device.
  assert.deepEqual(await custody.listCredentials(input.userId), [
    { credentialId: input.credentialId, transports: input.transports },
  ]);
  assert.deepEqual(await rowCounts(store.pool, input.userId, input.walletId), {
    orgs: 1,
    wallets: 1,
    accounts: 1,
    passkeys: 1,
  });
  // Every column the store writes, read back under its real name rather than the store's
  // alias: a misspelled alias must fail here rather than quietly yield undefined.
  const wallet = await store.pool.query(
    `SELECT user_id, wallet_id, sub_organization_id, kind, name
       FROM wallets.wallets WHERE wallet_id = $1`,
    [input.walletId],
  );
  assert.deepEqual(wallet.rows, [
    {
      user_id: input.userId,
      wallet_id: input.walletId,
      sub_organization_id: input.subOrganizationId,
      kind: "master",
      name: "Master Wallet",
    },
  ]);
  const account = await store.pool.query(
    `SELECT wallet_id, chain, address, address_format, path
       FROM wallets.wallet_accounts WHERE wallet_id = $1`,
    [input.walletId],
  );
  assert.deepEqual(account.rows, [
    {
      wallet_id: input.walletId,
      chain: "monad",
      address: input.address,
      address_format: "ADDRESS_FORMAT_ETHEREUM",
      path: "m/44'/60'/0'/0/0",
    },
  ]);
  const passkey = await store.pool.query(
    `SELECT user_id, credential_id, label, transports, device_type
       FROM wallets.passkeys WHERE user_id = $1`,
    [input.userId],
  );
  assert.deepEqual(passkey.rows, [
    {
      user_id: input.userId,
      credential_id: input.credentialId,
      label: input.label,
      transports: input.transports,
      device_type: input.deviceType,
    },
  ]);
});

test("a second registration for the same person is refused, not applied", async (t) => {
  const { store, custody } = await setup(t);
  const first = registration();
  const second = registration({ userId: first.userId });
  await custody.saveRegistration(first);

  assert.deepEqual(await custody.saveRegistration(second), { created: false });

  const account = await custody.findByUserId(first.userId);
  assert.equal(account?.subOrganizationId, first.subOrganizationId);
  assert.equal(account?.address, first.address);
  assert.deepEqual(
    (await custody.listCredentials(first.userId)).map((row) => row.credentialId),
    [first.credentialId],
  );
  assert.deepEqual(await rowCounts(store.pool, first.userId, second.walletId), {
    orgs: 1,
    wallets: 0,
    accounts: 0,
    passkeys: 1,
  });
});

test("a rejected address leaves nothing behind in any of the four tables", async (t) => {
  const { store, custody } = await setup(t);
  const input = registration({ address: "0xnot-an-address" });

  await assert.rejects(custody.saveRegistration(input));

  assert.equal(await custody.findByUserId(input.userId), null);
  assert.deepEqual(await custody.listCredentials(input.userId), []);
  assert.deepEqual(await rowCounts(store.pool, input.userId, input.walletId), {
    orgs: 0,
    wallets: 0,
    accounts: 0,
    passkeys: 0,
  });
});

test("a credential already claimed elsewhere rolls back the three rows before it", async (t) => {
  const { store, custody } = await setup(t);
  const stranger = registration();
  await custody.saveRegistration(stranger);
  // The passkeys insert is the last of the four; this makes only that one fail.
  const input = registration({ credentialId: stranger.credentialId });

  await assert.rejects(custody.saveRegistration(input));

  assert.equal(await custody.findByUserId(input.userId), null);
  assert.deepEqual(await custody.listCredentials(input.userId), []);
  assert.deepEqual(await rowCounts(store.pool, input.userId, input.walletId), {
    orgs: 0,
    wallets: 0,
    accounts: 0,
    passkeys: 0,
  });
});

test("adding the same device twice stores it once", async (t) => {
  const { store, custody } = await setup(t);
  const input = registration();
  await custody.saveRegistration(input);
  const device = {
    userId: input.userId,
    credentialId: `credential-${hex(16)}`,
    label: "iPhone",
    transports: ["hybrid"],
    deviceType: "multiDevice",
  };

  await custody.addPasskey(device);
  await custody.addPasskey({ ...device, label: "iPhone renamed" });

  const { rows } = await store.pool.query<{ label: string }>(
    "SELECT label FROM wallets.passkeys WHERE credential_id = $1",
    [device.credentialId],
  );
  assert.deepEqual(rows, [{ label: "iPhone" }]);
  assert.equal((await custody.listCredentials(input.userId)).length, 2);
});

test("the passkey list is ordered, scoped to one person, and keeps its nulls", async (t) => {
  const { store, custody } = await setup(t);
  const mine = registration({ label: "MacBook", transports: ["internal"] });
  await custody.saveRegistration(mine);
  await custody.addPasskey({
    userId: mine.userId,
    credentialId: `credential-${hex(16)}`,
    label: "iPhone",
    transports: ["hybrid"],
    deviceType: "multiDevice",
  });
  // A stranger, so a query that forgot its WHERE would be caught rather than measured. Without a
  // second person in the table, `SELECT ... FROM passkeys` with no predicate passes every
  // assertion below.
  await custody.saveRegistration(registration({ label: "Someone else's laptop" }));

  const listed = await custody.listPasskeys(mine.userId);

  assert.deepEqual(
    listed.map((passkey) => passkey.label),
    ["MacBook", "iPhone"],
  );
  assert.deepEqual(listed[1]?.transports, ["hybrid"]);
  assert.ok(listed[0]?.createdAt instanceof Date);
  // Neither row has ever signed anything, and the column says so rather than defaulting to the
  // creation date — which is the one substitution that would look entirely reasonable on screen.
  assert.equal(listed[0]?.lastUsedAt, null);
  assert.equal(listed[1]?.lastUsedAt, null);
  // A device type the transports named nothing for stays null through the query.
  await store.pool.query(
    `UPDATE wallets.passkeys SET device_type = NULL WHERE user_id = $1 AND label = 'iPhone'`,
    [mine.userId],
  );
  assert.equal((await custody.listPasskeys(mine.userId))[1]?.deviceType, null);
});

test("an account with no passkeys lists nothing rather than throwing", async (t) => {
  const { custody } = await setup(t);
  assert.deepEqual(await custody.listPasskeys(randomUUID()), []);
});

test("a challenge can be spent once and never again", async (t) => {
  const { custody } = await setup(t);
  const userId = randomUUID();
  const challenge = hex(32);
  const expiresAt = new Date(Date.now() + 300_000);
  await custody.put(challenge, { userId, expiresAt });

  const first = await custody.consume(challenge);

  // The whole record, so a misspelled alias cannot pass as an unchecked field.
  assert.deepEqual(first, { userId, expiresAt });
  assert.equal(await custody.consume(challenge), null);
});

test("a challenge that was never stored cannot be spent", async (t) => {
  const { custody } = await setup(t);
  assert.equal(await custody.consume(hex(32)), null);
});

test("two connections racing for one challenge: exactly one wins", async (t) => {
  const { store, custody } = await setup(t);
  const userId = randomUUID();
  const challenge = hex(32);
  await custody.put(challenge, { userId, expiresAt: new Date(Date.now() + 300_000) });

  // Warm the pool first: otherwise the connections open one by one and nothing races.
  const warm = await Promise.all(Array.from({ length: 4 }, () => store.pool.connect()));
  for (const client of warm) {
    client.release();
  }

  const results = await Promise.all(Array.from({ length: 4 }, () => custody.consume(challenge)));

  assert.equal(results.filter((record) => record !== null).length, 1);
});

test("a consumer blocked behind an uncommitted delete gets nothing", async (t) => {
  const { store, custody } = await setup(t);
  const peer = store.connectPeer();
  const userId = randomUUID();
  const challenge = hex(32);
  await custody.put(challenge, { userId, expiresAt: new Date(Date.now() + 300_000) });

  const holder = await peer.pool.connect();
  try {
    await holder.query("BEGIN");
    const held = await holder.query(
      "DELETE FROM wallets.webauthn_challenges WHERE challenge = $1 RETURNING user_id",
      [challenge],
    );
    assert.equal(held.rowCount, 1);
    const blocked = custody.consume(challenge);
    await waitForLockWait(store.pool);
    await holder.query("COMMIT");
    assert.equal(await blocked, null);
  } finally {
    holder.release();
  }
});

/** The second deleter must really be queued on the row lock, or the race proves nothing. */
async function waitForLockWait(pool: Pool) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { rows } = await pool.query<{ waiting: string }>(
      `SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE datname = current_database()
          AND wait_event_type = 'Lock'
          AND query LIKE '%webauthn_challenges%'`,
    );
    const [row] = rows;
    if (row && Number(row.waiting) > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("the second delete never queued on the row lock");
}

test("an agent_wallets row with one policy id is refused", async (t) => {
  const { store } = await setup(t);
  const agentId = await seedAgent(store.pool);
  const walletId = await seedWalletRecord(store.pool);

  await assert.rejects(
    store.pool.query(
      `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids)
       VALUES ($1, $2, $3)`,
      [agentId, walletId, ["policy-one"]],
    ),
    /agent_wallets_policies/,
  );
});

test("two agent_wallets rows pointing at the same wallet_id are refused", async (t) => {
  const { store } = await setup(t);
  const firstAgentId = await seedAgent(store.pool);
  const secondAgentId = await seedAgent(store.pool);
  const walletId = await seedWalletRecord(store.pool);
  const policyIds = ["policy-one", "policy-two"];

  await store.pool.query(
    `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1, $2, $3)`,
    [firstAgentId, walletId, policyIds],
  );

  await assert.rejects(
    store.pool.query(
      `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1, $2, $3)`,
      [secondAgentId, walletId, policyIds],
    ),
    /agent_wallets_wallet_key/,
  );
});

test("a deposit with a malformed hash is refused", async (t) => {
  const { store } = await setup(t);
  const agentId = await seedAgent(store.pool);

  await assert.rejects(
    store.pool.query(
      `INSERT INTO wallets.deposits (agent_id, tx_hash, amount_micro_usd) VALUES ($1, $2, $3)`,
      [agentId, "not-a-hash", 1_000_000],
    ),
    /deposits_tx_format/,
  );
});

/** A registered person, so turnkey_orgs has a row the delegated user can be written on. */
async function registered(custody: PostgresCustodyStore) {
  const input = registration();
  await custody.saveRegistration(input);
  return input;
}

function agentWallet(userId: string, subOrganizationId: string, name = "halftime") {
  return {
    userId,
    walletId: `wallet-${hex(12)}`,
    subOrganizationId,
    kind: "agent" as const,
    name,
    address: `0x${hex(40)}`,
    path: "m/44'/60'/0'/0/0",
  };
}

test("the delegated user is written once; the same id again is fine, another is refused", async (t) => {
  const { custody } = await setup(t);
  const person = await registered(custody);
  assert.equal(await custody.delegatedUserId(person.userId), null);

  await custody.saveDelegatedUser(person.userId, "da-1");
  await custody.saveDelegatedUser(person.userId, "da-1");

  assert.equal(await custody.delegatedUserId(person.userId), "da-1");
  await assert.rejects(custody.saveDelegatedUser(person.userId, "da-2"), DelegatedUserExistsError);
  assert.equal(await custody.delegatedUserId(person.userId), "da-1");
  // Nobody's row to write on: refused rather than silently ignored.
  await assert.rejects(custody.saveDelegatedUser(randomUUID(), "da-1"), DelegatedUserExistsError);
});

test("an agent wallet lands with its account; the master lookup is unaffected", async (t) => {
  const { store, custody } = await setup(t);
  const person = await registered(custody);
  const wallet = agentWallet(person.userId, person.subOrganizationId);

  await custody.saveWallet(wallet);

  const { rows } = await store.pool.query(
    `SELECT w.kind, w.name, a.address, a.path
       FROM wallets.wallets w JOIN wallets.wallet_accounts a USING (wallet_id)
      WHERE w.wallet_id = $1`,
    [wallet.walletId],
  );
  assert.deepEqual(rows, [
    { kind: "agent", name: "halftime", address: wallet.address, path: wallet.path },
  ]);
  assert.equal((await custody.findByUserId(person.userId))?.address, person.address);
  assert.deepEqual(await custody.findOwnedAgentWallet(person.userId, wallet.walletId), {
    walletId: wallet.walletId,
    address: wallet.address,
    linked: false,
  });
  assert.equal(await custody.findOwnedAgentWallet(randomUUID(), wallet.walletId), null);
  assert.equal(await custody.findOwnedAgentWallet(person.userId, person.walletId), null);
});

test("saving the same wallet twice for its owner is a no-op; for someone else it is refused", async (t) => {
  const { store, custody } = await setup(t);
  const person = await registered(custody);
  const wallet = agentWallet(person.userId, person.subOrganizationId);

  await custody.saveWallet(wallet);
  await custody.saveWallet(wallet);

  const { rows } = await store.pool.query(
    `SELECT (SELECT count(*) FROM wallets.wallets WHERE wallet_id = $1) AS wallets,
            (SELECT count(*) FROM wallets.wallet_accounts WHERE wallet_id = $1) AS accounts`,
    [wallet.walletId],
  );
  assert.deepEqual(rows, [{ wallets: "1", accounts: "1" }]);

  const stranger = await registered(custody);
  await assert.rejects(
    custody.saveWallet({ ...wallet, userId: stranger.userId }),
    /another person/,
  );
  assert.equal(await custody.findOwnedAgentWallet(stranger.userId, wallet.walletId), null);
});

test("a wallet whose account is refused leaves no wallets row behind", async (t) => {
  const { store, custody } = await setup(t);
  const person = await registered(custody);
  const wallet = { ...agentWallet(person.userId, person.subOrganizationId), address: "0xnope" };

  await assert.rejects(custody.saveWallet(wallet));

  const { rowCount } = await store.pool.query(
    "SELECT 1 FROM wallets.wallets WHERE wallet_id = $1",
    [wallet.walletId],
  );
  assert.equal(rowCount, 0);
});

test("an unlinked wallet is found before its link and not after; the link decides first agent and findAgentWallet", async (t) => {
  const { store, custody } = await setup(t);
  const person = await registered(custody);
  const wallet = agentWallet(person.userId, person.subOrganizationId);
  await custody.saveWallet(wallet);
  // Someone else's unlinked wallet must never be offered.
  const stranger = await registered(custody);
  await custody.saveWallet(agentWallet(stranger.userId, stranger.subOrganizationId));

  assert.deepEqual(await custody.findUnlinkedWallet(person.userId), {
    walletId: wallet.walletId,
    address: wallet.address,
    approvedPolicyIds: null,
  });
  // Rules approved before the attempt stopped travel with the wallet, so a retry can skip them.
  await custody.saveApprovedPolicies(person.userId, wallet.walletId, ["p1", "p2", "p3"]);
  assert.deepEqual((await custody.findUnlinkedWallet(person.userId))?.approvedPolicyIds, [
    "p1",
    "p2",
    "p3",
  ]);

  const agentId = await seedAgent(store.pool);
  assert.equal(await custody.findAgentWallet(agentId), null);
  // Not linked yet: the ceremony in progress is this person's first agent's.
  assert.equal(await custody.hasLinkedAgentWallet(person.userId), false);
  await store.pool.query(
    `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1, $2, $3)`,
    [agentId, wallet.walletId, ["p1", "p2"]],
  );

  assert.equal(await custody.findUnlinkedWallet(person.userId), null);
  assert.equal((await custody.findOwnedAgentWallet(person.userId, wallet.walletId))?.linked, true);
  assert.equal(await custody.hasLinkedAgentWallet(person.userId), true);
  assert.equal(await custody.hasLinkedAgentWallet(stranger.userId), false);
  assert.deepEqual(await custody.findAgentWallet(agentId), {
    walletId: wallet.walletId,
    address: wallet.address,
  });
});

test("a deposit hash is lowercased before it is stored", async (t) => {
  const { store, custody } = await setup(t);
  const agentId = await seedAgent(store.pool);
  const hash = `0x${"AB".repeat(32)}`;

  await custody.saveDeposit({ agentId, txHash: hash, amountMicroUsd: 2_500_000n });

  const { rows } = await store.pool.query(
    "SELECT tx_hash, amount_micro_usd FROM wallets.deposits WHERE agent_id = $1",
    [agentId],
  );
  assert.deepEqual(rows, [{ tx_hash: hash.toLowerCase(), amount_micro_usd: "2500000" }]);
});

test("recording the same deposit hash twice is DepositAlreadyRecordedError", async (t) => {
  const { store, custody } = await setup(t);
  const agentId = await seedAgent(store.pool);
  const hash = `0x${"cd".repeat(32)}`;
  await custody.saveDeposit({ agentId, txHash: hash, amountMicroUsd: 10_000_000n });

  await assert.rejects(
    custody.saveDeposit({
      agentId,
      txHash: hash.toUpperCase().replace("0X", "0x"),
      amountMicroUsd: 10_000_000n,
    }),
    DepositAlreadyRecordedError,
  );
});

test("a recorded deposit is found by its hash in any case, and only that one", async (t) => {
  const { store, custody } = await setup(t);
  const agentId = await seedAgent(store.pool);
  const hash = `0x${"ef".repeat(32)}`;
  assert.equal(await custody.depositRecorded(hash), false);

  await custody.saveDeposit({ agentId, txHash: hash, amountMicroUsd: 10_000_000n });

  assert.equal(await custody.depositRecorded(hash), true);
  assert.equal(await custody.depositRecorded(`0x${"EF".repeat(32)}`), true);
  assert.equal(await custody.depositRecorded(`0x${"ee".repeat(32)}`), false);
});

async function linkWallet(pool: Pool, agentId: string, walletId: string) {
  await pool.query(
    `INSERT INTO wallets.agent_wallets (agent_id, wallet_id, policy_ids) VALUES ($1, $2, $3)`,
    [agentId, walletId, ["p1", "p2"]],
  );
}

test("agent wallets are listed oldest first with their agent and caps; unlinked ones have none", async (t) => {
  const { store, custody } = await setup(t);
  const u = await registered(custody);
  const v = await registered(custody);

  const linked = agentWallet(u.userId, u.subOrganizationId);
  const noSpend = agentWallet(u.userId, u.subOrganizationId);
  const noLeverage = agentWallet(u.userId, u.subOrganizationId);
  for (const wallet of [linked, noSpend, noLeverage]) {
    await custody.saveWallet(wallet);
    await custody.saveApprovedPolicies(u.userId, wallet.walletId, ["p1", "p2", "p3"]);
  }
  await linkWallet(
    store.pool,
    await seedAgent(store.pool, { spend: { perCallAusd: 7, perDayAusd: 30 }, maxLeverage: 3 }),
    linked.walletId,
  );
  await linkWallet(store.pool, await seedAgent(store.pool, { maxLeverage: 3 }), noSpend.walletId);
  await linkWallet(
    store.pool,
    await seedAgent(store.pool, { spend: { perCallAusd: 2, perDayAusd: 9 } }),
    noLeverage.walletId,
  );
  const unlinked = agentWallet(u.userId, u.subOrganizationId);
  await custody.saveWallet(unlinked);
  await custody.saveApprovedPolicies(u.userId, unlinked.walletId, ["p1", "p2"]);
  // Someone else's linked wallet never shows up for U.
  const stranger = agentWallet(v.userId, v.subOrganizationId);
  await custody.saveWallet(stranger);
  await linkWallet(store.pool, await seedAgent(store.pool, {}), stranger.walletId);

  const list = await custody.listAgentWallets(u.userId);
  assert.deepEqual(
    list.map((wallet) => wallet.walletId),
    [linked.walletId, noSpend.walletId, noLeverage.walletId, unlinked.walletId],
  );
  const [a, b, c, d] = list;
  assert.ok(a && b && c && d);
  assert.equal(a.address, linked.address);
  assert.equal(a.agentName, "Halftime");
  assert.ok(a.agentId);
  assert.equal(a.policiesApproved, true);
  assert.deepEqual(a.caps, { perTradeAusd: 7, perDayAusd: 30, maxLeverage: 3 });
  assert.equal(b.caps, null);
  assert.deepEqual(c.caps, { perTradeAusd: 2, perDayAusd: 9, maxLeverage: 1 });
  assert.equal(d.agentId, null);
  assert.equal(d.agentName, null);
  assert.equal(d.policiesApproved, false);
  assert.equal(d.caps, null);

  assert.equal((await custody.findUnlinkedWallet(u.userId))?.walletId, unlinked.walletId);
  assert.equal(await custody.countAgentWallets(u.userId), 4);
  assert.equal(await custody.findUnlinkedWallet(v.userId), null);
  assert.equal(await custody.countAgentWallets(v.userId), 1);
});

test("an unlinked agent wallet is found whatever its name", async (t) => {
  const { custody } = await setup(t);
  const person = await registered(custody);
  const wallet = agentWallet(person.userId, person.subOrganizationId, "Agent wallet 1");
  await custody.saveWallet(wallet);

  assert.equal((await custody.findUnlinkedWallet(person.userId))?.walletId, wallet.walletId);
});

test("a transfer is recorded once; the same hash again is TransferAlreadyRecordedError", async (t) => {
  const { custody } = await setup(t);
  const hash = `0x${hex(64)}`;
  const transfer = {
    userId: randomUUID(),
    fromWalletId: `wallet-${hex(12)}`,
    toWalletId: `wallet-${hex(12)}`,
    token: "mon" as const,
    amount: 5n,
    txHash: hash,
  };
  assert.equal(await custody.transferRecorded(hash), false);
  await custody.saveTransfer(transfer);
  assert.equal(await custody.transferRecorded(hash.toUpperCase().replace("0X", "0x")), true);
  await assert.rejects(custody.saveTransfer(transfer), TransferAlreadyRecordedError);
});
