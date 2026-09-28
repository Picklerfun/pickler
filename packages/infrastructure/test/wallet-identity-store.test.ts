import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { InvalidAddressError, normalizeAddress, type WalletLink } from "@pickler/core";
import { PostgresWalletIdentityStore } from "../src/persistence/wallet-identity-store.js";
import { createTestStore } from "./database.js";

/**
 * Checksummed, because that is what every wallet emits and what `wallet_links_address_format`
 * refuses. `normalizeAddress` is the only way to obtain the spelling the column accepts.
 */
const CHECKSUMMED = "0xC0fFEe254729296a45a3885639AC7E10F9d54979";
const ADDR = normalizeAddress("eip155", CHECKSUMMED);
const OTHER_ADDR = normalizeAddress("eip155", "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc");
const SOL_ADDR = normalizeAddress("solana", "So11111111111111111111111111111111111111112");

/**
 * The hex shape the container actually issues. viem's SIWE builder enforces
 * `/^[a-zA-Z0-9]{8,}$/` and its parser reads `Nonce: (?<nonce>[a-zA-Z0-9]+)`, so a hyphenated
 * nonce does not fail on the way back — it truncates at the hyphen, silently. The store never
 * sees a SIWE message and so cannot be bitten by that, but a fixture is the thing people copy.
 */
const nonce = () => randomUUID().replaceAll("-", "");

const EVM_CHAIN = "eip155:10143";
const SOLANA_CHAIN = "solana:mainnet";

async function setup(t: TestContext) {
  const store = await createTestStore(t);
  return { store, wallets: new PostgresWalletIdentityStore(store.pool) };
}

function external(userId: string, address = ADDR): Omit<WalletLink, "verifiedAt"> {
  return { userId, namespace: "eip155", address, verifiedChain: EVM_CHAIN, kind: "external" };
}

test("a nonce can be consumed once", async (t) => {
  const { wallets } = await setup(t);
  const expiresAt = new Date(Date.now() + 60_000);
  const issued = nonce();
  await wallets.issue(issued, expiresAt);

  // The whole record, so a misspelled alias cannot pass as an unchecked field.
  assert.deepEqual(await wallets.consume(issued), { expiresAt });
  assert.equal(await wallets.consume(issued), null);
});

test("a nonce that was never issued cannot be consumed", async (t) => {
  const { wallets } = await setup(t);
  assert.equal(await wallets.consume(nonce()), null);
});

test("two concurrent consumers, one winner", async (t) => {
  const { store, wallets } = await setup(t);
  const contested = nonce();
  await wallets.issue(contested, new Date(Date.now() + 60_000));

  // Warm the pool first: otherwise the connections open one by one and nothing races.
  const warm = await Promise.all(Array.from({ length: 4 }, () => store.pool.connect()));
  for (const client of warm) {
    client.release();
  }

  const results = await Promise.all(Array.from({ length: 4 }, () => wallets.consume(contested)));

  assert.equal(results.filter((row) => row !== null).length, 1);
});

test("an address belongs to one account", async (t) => {
  const { wallets } = await setup(t);
  const userA = randomUUID();
  const userB = randomUUID();
  assert.deepEqual(await wallets.link(external(userA)), { created: true });

  const second = await wallets.link(external(userB));

  assert.equal(second.created, false);
  const found = await wallets.findByAddress("eip155", ADDR);
  assert.ok(found);
  // Every column the store reads, so a misspelled alias fails here rather than yielding undefined.
  const { verifiedAt, ...columns } = found;
  assert.deepEqual(columns, {
    userId: userA,
    namespace: "eip155",
    address: ADDR,
    verifiedChain: EVM_CHAIN,
    kind: "external",
  });
  assert.ok(verifiedAt instanceof Date);
});

test("an address nobody has linked is absent, not an error", async (t) => {
  const { wallets } = await setup(t);
  assert.equal(await wallets.findByAddress("eip155", OTHER_ADDR), null);
});

test("the unique key is (namespace, address), so one account can hold a link in each family", async (t) => {
  const { store, wallets } = await setup(t);
  const userA = randomUUID();
  await wallets.link(external(userA));

  const other = await wallets.link({
    userId: userA,
    namespace: "solana",
    address: SOL_ADDR,
    verifiedChain: SOLANA_CHAIN,
    kind: "mera",
  });

  assert.equal(other.created, true);
  assert.equal(await wallets.findByAddress("solana", SOL_ADDR).then((row) => row?.kind), "mera");
  // Two rows with one address string would be the case that distinguishes a key on (namespace,
  // address) from a key on address alone, and it cannot be constructed: base58 excludes `0`, so
  // no string is both a well-formed EVM address and a well-formed Solana one. The claim is
  // therefore asserted where it actually lives — the index definition.
  const { rows } = await store.pool.query<{ columns: string[] }>(
    `SELECT array_agg(a.attname::text ORDER BY k.ord) AS columns
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE c.relname = 'wallet_links_address_key' AND i.indisunique`,
  );
  assert.deepEqual(rows, [{ columns: ["namespace", "address"] }]);
});

test("listForUser returns only that user's links", async (t) => {
  const { wallets } = await setup(t);
  const userA = randomUUID();
  const userB = randomUUID();
  await wallets.link(external(userA));
  // A stranger, so a query that forgot its WHERE would be caught rather than measured.
  await wallets.link(external(userB, OTHER_ADDR));

  const mine = await wallets.listForUser(userA);

  assert.equal(mine.length, 1);
  assert.equal(mine[0]?.address, ADDR);
});

test("listForUser returns one account's links oldest first", async (t) => {
  const { store, wallets } = await setup(t);
  const userA = randomUUID();
  await wallets.link(external(userA));
  await wallets.link(external(userA, OTHER_ADDR));
  // Age the second link past the first, so insertion order and verified_at order disagree: a
  // query that returned rows in whatever order Postgres chose would pass without this.
  await store.pool.query(
    `UPDATE identity.wallet_links SET verified_at = now() - interval '1 day' WHERE address = $1`,
    [OTHER_ADDR],
  );

  const mine = await wallets.listForUser(userA);

  assert.deepEqual(
    mine.map((link) => link.address),
    [OTHER_ADDR, ADDR],
  );
});

test("a failed read is a failure, never an account with no wallets", async (t) => {
  const { store, wallets } = await setup(t);
  await store.pool.query("DROP TABLE identity.wallet_links");

  await assert.rejects(wallets.listForUser(randomUUID()));
});

/**
 * `wallet_links_address_format` is what normally keeps a checksummed or malformed address out of
 * the column, which is also why a cast at the read boundary looks harmless. Dropping it is the
 * only way to ask what the store does with a row that is already wrong — and the answer has to be
 * "re-normalise it, or raise", never "brand it and pass it on".
 */
async function unguard(pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) {
  await pool.query("ALTER TABLE identity.wallet_links DROP CONSTRAINT wallet_links_address_format");
}

async function insertRaw(
  pool: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
  userId: string,
  address: string,
) {
  await pool.query(
    `INSERT INTO identity.wallet_links
       (user_id, namespace, verified_chain, address, method, kind, verified_at)
     VALUES ($1, 'eip155', $2, $3, 'siwe', 'external', now())`,
    [userId, EVM_CHAIN, address],
  );
}

test("a checksummed row is normalised on the way out, not branded as it stands", async (t) => {
  const { store, wallets } = await setup(t);
  const userA = randomUUID();
  await unguard(store.pool);
  await insertRaw(store.pool, userA, CHECKSUMMED);

  const mine = await wallets.listForUser(userA);

  // A cast would hand back the checksummed spelling wearing the brand; the call re-establishes it.
  assert.deepEqual(
    mine.map((link) => link.address),
    [ADDR],
  );
});

test("a row that is not an address at all raises rather than becoming one", async (t) => {
  const { store, wallets } = await setup(t);
  const userA = randomUUID();
  await unguard(store.pool);
  await insertRaw(store.pool, userA, "0xNOTANADDRESS");

  await assert.rejects(wallets.listForUser(userA), InvalidAddressError);
});
