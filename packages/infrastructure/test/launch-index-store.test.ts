import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { migrateDatabase } from "../src/persistence/migrate-database.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";

const CHAIN = "eip155:10143";
const FACTORY = "0x1111111111111111111111111111111111111111";
const STREAM = "launches";
const ABI_HASH = "a".repeat(64);

/** Real PostgreSQL, isolated database per test, exactly as the research suite does it. */
async function createStore(t: TestContext) {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const database = `pickler_test_${randomUUID().replaceAll("-", "")}`;

  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (cause) {
    await admin.end();
    throw new Error(
      "Start PostgreSQL with npm run db:up or set TEST_DATABASE_URL with CREATEDB permission",
      { cause },
    );
  }

  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  const store = new PostgresLaunchIndexStore(url.toString());

  t.after(async () => {
    await store.close();
    try {
      await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  });

  await migrateDatabase(store.pool);

  return store;
}

/** Deterministic, and valid hex: the schema rejects anything else, as it should. */
function hash(seed: string): string {
  const hex = [...seed].map((character) => character.charCodeAt(0).toString(16)).join("");

  return `0x${hex.padStart(64, "0").slice(-64)}`;
}

function block(number: bigint, suffix: string, parentSuffix: string) {
  return {
    number,
    hash: hash(suffix),
    parentHash: hash(parentSuffix),
    blockTime: new Date(Number(number) * 1000),
  };
}

function event(blockNumber: bigint, blockSuffix: string, logIndex: number, name: string) {
  return {
    blockHash: hash(blockSuffix),
    blockNumber,
    txHash: hash(`${blockSuffix}-tx-${logIndex}`),
    logIndex,
    emitter: FACTORY,
    eventName: name,
    abiHash: ABI_HASH,
    topics: [hash("dead")],
    data: "0x00",
    decoded: { name },
  };
}

test("a batch lands with its cursor and its outbox", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9")],
    events: [event(10n, "a", 0, "LaunchCreated")],
    outbox: [
      {
        topic: "launch.created",
        payload: { token: "0xabc" },
        event: { blockHash: hash("a"), txHash: hash("a-tx-0"), logIndex: 0 },
      },
    ],
  });

  const cursor = await store.readCursor(CHAIN, FACTORY, STREAM);

  assert.equal(cursor?.lastBlock, 10n);
  assert.equal(cursor?.lastBlockHash, hash("a"));
  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 1);
  assert.equal(await store.countPendingOutbox(CHAIN), 1);
});

/**
 * Ranges overlap after every restart. Re-reading what was already applied has to cost
 * nothing, or an indexer double counts every time it is redeployed.
 */
test("replaying the same batch changes nothing", async (t) => {
  const store = await createStore(t);

  const batch = {
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9"), block(11n, "b", "a")],
    events: [event(10n, "a", 0, "LaunchCreated"), event(11n, "b", 0, "CurveBought")],
    outbox: [
      {
        topic: "launch.created",
        payload: { token: "0xabc" },
        event: { blockHash: hash("a"), txHash: hash("a-tx-0"), logIndex: 0 },
      },
    ],
  };

  await store.applyBatch(batch);
  await store.applyBatch(batch);
  await store.applyBatch(batch);

  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 2);
  assert.equal(await store.countPendingOutbox(CHAIN), 1, "an outbox row was enqueued twice");
  assert.equal((await store.readCursor(CHAIN, FACTORY, STREAM))?.lastBlock, 11n);
});

test("overlapping streams do not rewrite unchanged header rows or their original evidence", async (t) => {
  const store = await createStore(t);
  const original = block(10n, "shared-header", "parent");
  const batch = {
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [original],
    events: [],
  };
  const readHeader = async () =>
    (
      await store.pool.query(
        `SELECT xmin::text,ctid::text,number::text,parent_hash,block_time,orphaned,finality
         FROM market.chain_blocks WHERE chain=$1 AND hash=$2`,
        [CHAIN, original.hash],
      )
    ).rows[0];

  await store.applyBatch(batch);
  const observed = await readHeader();

  await store.applyBatch({
    ...batch,
    contract: "0x" + "7".repeat(40),
    blocks: [{ ...original, number: 99n, parentHash: hash("changed"), blockTime: new Date(0) }],
  });

  assert.deepEqual(await readHeader(), observed);
  assert.equal(observed.finality, "observed");

  await store.applyBatch({ ...batch, confirmed: true });
  const confirmed = await readHeader();

  assert.notEqual(confirmed.xmin, observed.xmin);
  assert.equal(confirmed.finality, "confirmed");
  assert.equal(confirmed.number, observed.number);
  assert.equal(confirmed.parent_hash, observed.parent_hash);
  assert.deepEqual(confirmed.block_time, observed.block_time);

  await store.applyBatch({ ...batch, confirmed: true });
  await store.applyBatch(batch);

  assert.deepEqual(await readHeader(), confirmed);
});

test("header conflicts revive orphaned branches and preserve existing finality for unconfirmed input", async (t) => {
  const store = await createStore(t);
  const header = block(10n, "returning-header", "parent");
  const batch = {
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [header],
    events: [],
  };
  const readHeader = async () =>
    (
      await store.pool.query(
        `SELECT xmin::text,ctid::text,orphaned,finality FROM market.chain_blocks
         WHERE chain=$1 AND hash=$2`,
        [CHAIN, header.hash],
      )
    ).rows[0];

  await store.applyBatch({ ...batch, confirmed: true });
  await store.pool.query(
    "UPDATE market.chain_blocks SET orphaned=true,finality='finalized' WHERE chain=$1 AND hash=$2",
    [CHAIN, header.hash],
  );
  const orphaned = await readHeader();

  await store.applyBatch(batch);
  const revived = await readHeader();

  assert.notEqual(revived.xmin, orphaned.xmin);
  assert.equal(revived.orphaned, false);
  assert.equal(revived.finality, "finalized");

  await store.applyBatch(batch);

  assert.deepEqual(await readHeader(), revived);

  // Confirmed input retains the existing writer's semantics, including finalized headers.
  await store.applyBatch({ ...batch, confirmed: true });
  const confirmed = await readHeader();

  assert.equal(confirmed.finality, "confirmed");
  assert.notEqual(confirmed.xmin, revived.xmin);

  await store.pool.query(
    "UPDATE market.chain_blocks SET orphaned=true WHERE chain=$1 AND hash=$2",
    [CHAIN, header.hash],
  );
  await store.applyBatch({ ...batch, confirmed: true });

  assert.equal((await readHeader()).orphaned, false);
  assert.equal((await readHeader()).finality, "confirmed");
});

test("events come back in chain order regardless of how they were written", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9"), block(11n, "b", "a")],
    events: [
      event(11n, "b", 1, "second-in-block"),
      event(10n, "a", 3, "earlier-block"),
      event(11n, "b", 0, "first-in-block"),
    ],
  });

  const ordered = await store.readCanonicalEvents(CHAIN);

  assert.deepEqual(
    ordered.map((row) => row.eventName),
    ["earlier-block", "first-in-block", "second-in-block"],
  );
});

/**
 * The case the whole store exists for. After a reorg the losing branch must stop counting,
 * its announcements must not go out, and the cursor must fall back to where the two branches
 * still agree.
 */
test("a reorg orphans the losing branch, drops its announcements and rewinds the cursor", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9"), block(11n, "b", "a"), block(12n, "c", "b")],
    events: [event(10n, "a", 0, "kept"), event(11n, "b", 0, "lost"), event(12n, "c", 0, "lost")],
    outbox: [
      {
        topic: "trade.finalized",
        payload: { block: 11 },
        event: { blockHash: hash("b"), txHash: hash("b-tx-0"), logIndex: 0 },
      },
      {
        topic: "trade.finalized",
        payload: { block: 10 },
        event: { blockHash: hash("a"), txHash: hash("a-tx-0"), logIndex: 0 },
      },
    ],
  });

  assert.equal(await store.countPendingOutbox(CHAIN), 2);

  const result = await store.rollbackFrom(CHAIN, FACTORY, STREAM, 10n);

  assert.equal(result.orphanedBlocks, 2);
  assert.equal(result.orphanedEvents, 2);

  const surviving = await store.readCanonicalEvents(CHAIN);
  assert.deepEqual(
    surviving.map((row) => row.eventName),
    ["kept"],
    "an orphaned event is still counted as canonical",
  );

  assert.equal(
    await store.countPendingOutbox(CHAIN),
    1,
    "an announcement for a block that no longer exists is still queued",
  );

  const cursor = await store.readCursor(CHAIN, FACTORY, STREAM);
  assert.equal(cursor?.lastBlock, 10n, "the cursor did not rewind to the surviving block");
  assert.equal(cursor?.lastBlockHash, hash("a"));
});

/** A replacement branch rebuilds on top of what survived, and the old one stays orphaned. */
test("the replacement branch is applied after a rollback", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9"), block(11n, "b", "a")],
    events: [event(11n, "b", 0, "lost")],
  });

  await store.rollbackFrom(CHAIN, FACTORY, STREAM, 10n);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(11n, "bb", "a"), block(12n, "cc", "bb")],
    events: [event(11n, "bb", 0, "won")],
  });

  const canonical = await store.readCanonicalEvents(CHAIN);

  assert.deepEqual(
    canonical.map((row) => row.eventName),
    ["won"],
  );
  assert.equal((await store.readCursor(CHAIN, FACTORY, STREAM))?.lastBlockHash, hash("cc"));
});

/** A block the chain returns to is canonical again, not permanently discarded. */
test("a block that comes back stops being orphaned", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9"), block(11n, "b", "a")],
    events: [event(11n, "b", 0, "flapping")],
  });

  await store.rollbackFrom(CHAIN, FACTORY, STREAM, 10n);
  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 0);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(11n, "b", "a")],
    events: [event(11n, "b", 0, "flapping")],
  });

  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 1);
});

/**
 * A cursor past data that was never stored is unrecoverable: the next pass starts after the
 * missing range and nothing ever looks back.
 */
test("a batch that cannot be written moves no cursor", async (t) => {
  const store = await createStore(t);

  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "a", "9")],
    events: [],
  });

  await assert.rejects(() =>
    store.applyBatch({
      chain: CHAIN,
      contract: FACTORY,
      stream: STREAM,
      blocks: [block(11n, "b", "a")],
      events: [
        // A log index below zero violates a check constraint, so the batch must fail whole.
        { ...event(11n, "b", 0, "doomed"), logIndex: -1 },
      ],
    }),
  );

  const cursor = await store.readCursor(CHAIN, FACTORY, STREAM);

  assert.equal(cursor?.lastBlock, 10n, "the cursor advanced past a batch that failed");
  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 0);
});

test("a chain reorg rewinds every advanced stream and preserves streams behind the fork", async (t) => {
  const store = await createStore(t);
  const adapter = "0x" + "7".repeat(40),
    escrow = "0x" + "8".repeat(40);
  for (const [contract, height] of [
    [FACTORY, 12n],
    [adapter, 13n],
    [escrow, 9n],
  ] as const) {
    await store.applyBatch({
      chain: CHAIN,
      contract,
      stream: "token-launch-v1",
      blocks: [block(height, "h" + height, "h" + (height - 1n))],
      events: [],
    });
  }
  await store.applyBatch({
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    blocks: [block(10n, "common", "9")],
    events: [],
  });
  await store.rollbackFrom(CHAIN, FACTORY, "token-launch-v1", 10n);
  assert.equal((await store.readCursor(CHAIN, FACTORY, "token-launch-v1"))?.lastBlock, 10n);
  assert.equal((await store.readCursor(CHAIN, adapter, "token-launch-v1"))?.lastBlock, 10n);
  assert.equal((await store.readCursor(CHAIN, escrow, "token-launch-v1"))?.lastBlock, 9n);
  await store.applyBatch({
    chain: CHAIN,
    contract: adapter,
    stream: "token-launch-v1",
    blocks: [block(11n, "replacement", "common")],
    events: [{ ...event(11n, "replacement", 0, "replacement-adapter"), emitter: adapter }],
  });
  assert.equal((await store.readCanonicalEvents(CHAIN))[0]?.eventName, "replacement-adapter");
});
test("expired index admission fences writes and rollback", async (t) => {
  const store = await createStore(t),
    owner = randomUUID();
  await store.pool.query(
    "INSERT INTO launch.indexer_admission(chain,owner,expires_at,day,requests) VALUES($1,$2,now()-interval '1 second','2026-10-09',0)",
    [CHAIN, owner],
  );
  store.admissionFence = { chain: CHAIN, owner };
  await assert.rejects(
    store.applyBatch({
      chain: CHAIN,
      contract: FACTORY,
      stream: STREAM,
      blocks: [block(10n, "a", "9")],
      events: [],
    }),
    /INDEX_LEASE_LOST/,
  );
  await assert.rejects(store.rollbackFrom(CHAIN, FACTORY, STREAM, 0n), /INDEX_LEASE_LOST/);
  assert.equal(await store.readCursor(CHAIN, FACTORY, STREAM), null);
});

test("a sparse block replaced during catch-up keeps orphaned notification history and restores returning branches", async (t) => {
  const store = await createStore(t);
  const original = {
    chain: CHAIN,
    contract: FACTORY,
    stream: STREAM,
    confirmed: true,
    blocks: [block(10n, "a", "9")],
    events: [event(10n, "a", 0, "LaunchCreated")],
    outbox: [
      {
        topic: "launch.created",
        payload: { retained: true },
        event: { blockHash: hash("a"), txHash: hash("a-tx-0"), logIndex: 0 },
      },
    ],
  };
  await store.applyBatch(original);
  await store.applyBatch({ ...original, blocks: [block(10n, "b", "9")], events: [], outbox: [] });
  assert.equal(await store.countPendingOutbox(CHAIN), 0);
  const retained = (await store.pool.query("SELECT status,last_error,payload FROM launch.outbox"))
    .rows[0];
  assert.equal(retained.status, "failed");
  assert.equal(retained.last_error, "CHAIN_EVENT_ORPHANED");
  assert.deepEqual(retained.payload, { retained: true });
  await store.applyBatch(original);
  assert.equal(await store.countPendingOutbox(CHAIN), 1);
  assert.equal((await store.pool.query("SELECT count(*) FROM launch.outbox")).rows[0].count, "1");
});
