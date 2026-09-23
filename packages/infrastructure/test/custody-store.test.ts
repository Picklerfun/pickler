import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { RegistrationInput } from "@pickler/core";
import { PostgresCustodyStore } from "../src/persistence/custody-store.js";
import { createTestStore } from "./database.js";

const hex = (length: number) =>
  `${randomUUID()}${randomUUID()}`.replaceAll("-", "").slice(0, length);

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
  // The wallet row carries the registration's wallet, marked as the master.
  const { rows } = await store.pool.query<{ kind: string; subOrganizationId: string }>(
    `SELECT kind, sub_organization_id AS "subOrganizationId"
       FROM wallets.wallets WHERE wallet_id = $1`,
    [input.walletId],
  );
  assert.deepEqual(rows, [{ kind: "master", subOrganizationId: input.subOrganizationId }]);
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

test("a challenge can be spent once and never again", async (t) => {
  const { custody } = await setup(t);
  const userId = randomUUID();
  const challenge = hex(32);
  const expiresAt = new Date(Date.now() + 300_000);
  await custody.put(challenge, { userId, expiresAt });

  const first = await custody.consume(challenge);

  assert.equal(first?.userId, userId);
  assert.equal(first?.expiresAt.getTime(), expiresAt.getTime());
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
