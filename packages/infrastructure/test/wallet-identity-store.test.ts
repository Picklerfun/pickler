import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  InvalidAddressError,
  MAX_OPEN_NONCES_PER_ADDRESS,
  normalizeAddress,
  type NonceHolder,
  type WalletLink,
} from "@pickler/core";
import {
  EXPIRED_NONCE_PURGE_BATCH,
  PostgresWalletIdentityStore,
} from "../src/persistence/wallet-identity-store.js";
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

/** Who asked for the nonce: the address the message will name, unverified until it is signed. */
const HOLDER: NonceHolder = { namespace: "eip155", address: ADDR };
const OTHER_HOLDER: NonceHolder = { namespace: "eip155", address: OTHER_ADDR };
const inAMinute = () => new Date(Date.now() + 60_000);

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
  await wallets.issue(issued, expiresAt, HOLDER);

  // The whole record, so a misspelled alias cannot pass as an unchecked field.
  assert.deepEqual(await wallets.consume(issued, HOLDER), { expiresAt });
  assert.equal(await wallets.consume(issued, HOLDER), null);
});

test("a nonce issued for one address cannot be spent in a message naming another", async (t) => {
  const { wallets } = await setup(t);
  const issued = nonce();
  await wallets.issue(issued, inAMinute(), HOLDER);

  assert.equal(await wallets.consume(issued, OTHER_HOLDER), null);
  assert.equal(await wallets.consume(issued, { namespace: "solana", address: SOL_ADDR }), null);
  // And the refusals did not spend it: it is still there for the address it was issued to.
  assert.ok(await wallets.consume(issued, HOLDER));
});

const count = async (
  pool: { query: (text: string) => Promise<{ rows: unknown[] }> },
  where: string,
) =>
  Number(
    (
      (await pool.query(`SELECT count(*) AS n FROM identity.siwe_nonces WHERE ${where}`))
        .rows[0] as { n: string }
    ).n,
  );

test("issuing a nonce deletes the ones that have expired", async (t) => {
  const { store, wallets } = await setup(t);
  await store.pool.query(
    `INSERT INTO identity.siwe_nonces (nonce, expires_at)
     SELECT 'abandoned' || n, now() - interval '1 minute' FROM generate_series(1, 3) AS n`,
  );
  const kept = nonce();
  await wallets.issue(kept, inAMinute(), OTHER_HOLDER);

  await wallets.issue(nonce(), inAMinute(), HOLDER);

  assert.equal(await count(store.pool, "expires_at < now()"), 0);
  assert.ok(await wallets.consume(kept, OTHER_HOLDER), "an unexpired nonce was deleted");
});

test("one issue deletes at most a batch, so no call pays for a backlog", async (t) => {
  const { store, wallets } = await setup(t);
  await store.pool.query(
    `INSERT INTO identity.siwe_nonces (nonce, expires_at)
     SELECT 'abandoned' || n, now() - interval '1 minute'
       FROM generate_series(1, $1::int) AS n`,
    [EXPIRED_NONCE_PURGE_BATCH + 10],
  );

  await wallets.issue(nonce(), inAMinute(), HOLDER);
  assert.equal(await count(store.pool, "expires_at < now()"), 10);

  await wallets.issue(nonce(), inAMinute(), HOLDER);
  assert.equal(await count(store.pool, "expires_at < now()"), 0);
});

/** Issued one after another with expiries a second apart, so which is oldest is not in doubt. */
async function issueInOrder(
  wallets: PostgresWalletIdentityStore,
  howMany: number,
  holder = HOLDER,
) {
  const issued: string[] = [];
  for (let index = 0; index < howMany; index += 1) {
    const one = nonce();
    await wallets.issue(one, new Date(Date.now() + 60_000 + index * 1_000), holder);
    issued.push(one);
  }
  return issued;
}

test("a sixth nonce for an address is issued, and the oldest makes room for it", async (t) => {
  const { store, wallets } = await setup(t);
  assert.equal(MAX_OPEN_NONCES_PER_ADDRESS, 5);
  const [oldest, ...rest] = await issueInOrder(wallets, MAX_OPEN_NONCES_PER_ADDRESS);

  const sixth = nonce();
  await wallets.issue(sixth, new Date(Date.now() + 120_000), HOLDER);

  assert.equal(await count(store.pool, "true"), MAX_OPEN_NONCES_PER_ADDRESS);
  assert.equal(await wallets.consume(oldest!, HOLDER), null, "the evicted nonce was still there");
  for (const kept of [...rest, sixth]) {
    assert.ok(await wallets.consume(kept, HOLDER), "a nonce that was not the oldest was evicted");
  }
});

/**
 * The route is public and the address unverified, so anybody can ask for nonces in somebody
 * else's name. A cap that refused would let them keep that wallet from signing in at all; one that
 * evicts costs its holder a retry at most.
 */
test("an address flooded by somebody else can still get a nonce and spend it", async (t) => {
  const { store, wallets } = await setup(t);
  await issueInOrder(wallets, MAX_OPEN_NONCES_PER_ADDRESS * 3);

  const own = nonce();
  await wallets.issue(own, new Date(Date.now() + 300_000), HOLDER);

  assert.ok(await wallets.consume(own, HOLDER));
  assert.equal(await count(store.pool, "true"), MAX_OPEN_NONCES_PER_ADDRESS - 1);
});

test("making room for one address never takes another's nonces", async (t) => {
  const { wallets } = await setup(t);
  const others = await issueInOrder(wallets, MAX_OPEN_NONCES_PER_ADDRESS, OTHER_HOLDER);
  const solana: NonceHolder = { namespace: "solana", address: SOL_ADDR };
  const [inSolana] = await issueInOrder(wallets, 1, solana);

  await issueInOrder(wallets, MAX_OPEN_NONCES_PER_ADDRESS * 2);

  for (const kept of others) {
    assert.ok(await wallets.consume(kept, OTHER_HOLDER));
  }
  assert.ok(await wallets.consume(inSolana!, solana));
});

test("issues racing for one address leave it with five at most", async (t) => {
  const { store, wallets } = await setup(t);
  await issueInOrder(wallets, MAX_OPEN_NONCES_PER_ADDRESS);
  const warm = await Promise.all(Array.from({ length: 4 }, () => store.pool.connect()));
  for (const client of warm) {
    client.release();
  }

  await Promise.all(Array.from({ length: 8 }, () => wallets.issue(nonce(), inAMinute(), HOLDER)));

  assert.equal(await count(store.pool, "true"), MAX_OPEN_NONCES_PER_ADDRESS);
});

test("a nonce that was never issued cannot be consumed", async (t) => {
  const { wallets } = await setup(t);
  assert.equal(await wallets.consume(nonce(), HOLDER), null);
});

test("two concurrent consumers, one winner", async (t) => {
  const { store, wallets } = await setup(t);
  const contested = nonce();
  await wallets.issue(contested, new Date(Date.now() + 60_000), HOLDER);

  // Warm the pool first: otherwise the connections open one by one and nothing races.
  const warm = await Promise.all(Array.from({ length: 4 }, () => store.pool.connect()));
  for (const client of warm) {
    client.release();
  }

  const results = await Promise.all(
    Array.from({ length: 4 }, () => wallets.consume(contested, HOLDER)),
  );

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
