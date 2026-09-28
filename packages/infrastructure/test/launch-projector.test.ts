import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import { migrateDatabase } from "../src/persistence/migrate-database.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import {
  PostgresLaunchProjector,
  type LaunchMetadata,
} from "../src/persistence/product/launch-projector.js";

const CHAIN = "eip155:10143";
const FACTORY = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const CURVE = "0x3333333333333333333333333333333333333333";
const QUOTE = "0x4444444444444444444444444444444444444444";
const ALICE = "0x5555555555555555555555555555555555555555";
const ABI_HASH = "a".repeat(64);

function hash(seed: string): string {
  const hex = [...seed].map((character) => character.charCodeAt(0).toString(16)).join("");

  return `0x${hex.padStart(64, "0").slice(-64)}`;
}

const metadata: LaunchMetadata = {
  name: "Pickler Agent",
  symbol: "AGENT",
  decimals: 18,
  totalSupply: 1_000_000_000_000_000_000_000n,
};

const readMetadata = async () => metadata;

async function createPair(t: TestContext) {
  const connectionString =
    process.env.TEST_DATABASE_URL ??
    "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler";
  const admin = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 });
  const database = `pickler_test_${randomUUID().replaceAll("-", "")}`;

  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } catch (cause) {
    await admin.end();
    throw new Error("Start PostgreSQL with npm run db:up or set TEST_DATABASE_URL", { cause });
  }

  const url = new URL(connectionString);
  url.pathname = `/${database}`;

  const store = new PostgresLaunchIndexStore(url.toString());
  const projector = new PostgresLaunchProjector(url.toString());

  t.after(async () => {
    await projector.close();
    await store.close();
    try {
      await admin.query(`DROP DATABASE "${database}"`);
    } finally {
      await admin.end();
    }
  });

  await migrateDatabase(store.pool);

  return { store, projector };
}

function block(number: bigint, suffix: string, parentSuffix: string) {
  return {
    number,
    hash: hash(suffix),
    parentHash: hash(parentSuffix),
    blockTime: new Date(1_700_000_000_000 + Number(number) * 1000),
  };
}

function event(
  blockNumber: bigint,
  blockSuffix: string,
  logIndex: number,
  eventName: string,
  emitter: string,
  decoded: Record<string, unknown>,
) {
  return {
    blockHash: hash(blockSuffix),
    blockNumber,
    txHash: hash(`${blockSuffix}-tx-${logIndex}`),
    logIndex,
    emitter,
    eventName,
    abiHash: ABI_HASH,
    topics: [hash("dead")],
    data: "0x00",
    decoded,
  };
}

const launchEvent = (blockNumber: bigint, suffix: string, logIndex = 0) =>
  event(blockNumber, suffix, logIndex, "LaunchCreated", FACTORY, {
    token: TOKEN,
    curve: CURVE,
    agentKey: hash("agent"),
    creator: ALICE,
    quoteToken: QUOTE,
    presetHash: hash("preset"),
    metadataHash: hash("meta"),
  });

const buyEvent = (blockNumber: bigint, suffix: string, logIndex = 0, tokensOut = "5000") =>
  event(blockNumber, suffix, logIndex, "CurveBought", CURVE, {
    payer: ALICE,
    recipient: ALICE,
    grossQuoteIn: "1000000",
    netQuoteIn: "990000",
    tokensOut,
    totalFee: "10000",
    reserveAfter: "990000",
    netSoldAfter: tokensOut,
  });

async function indexed(
  store: PostgresLaunchIndexStore,
  blocks: ReturnType<typeof block>[],
  events: ReturnType<typeof event>[],
) {
  await store.applyBatch({ chain: CHAIN, contract: FACTORY, stream: "launches", blocks, events });
}

test("a launch becomes a token and its curve", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(store, [block(10n, "a", "9")], [launchEvent(10n, "a")]);

  const result = await projector.project(CHAIN, readMetadata);

  assert.equal(result.launches, 1);

  const rows = await projector.pool.query(
    `select "ticker", "name", "address", "status", "agent_id" from "market"."tokens"`,
  );

  assert.equal(rows.rowCount, 1);
  assert.equal(rows.rows[0].ticker, "$AGENT");
  assert.equal(rows.rows[0].address, TOKEN);
  assert.equal(rows.rows[0].status, "pre_graduation");
  assert.equal(rows.rows[0].agent_id, null, "the projector invented an agent link");

  const curve = await projector.pool.query(
    `select "venue", "address", "phase" from "market"."pools"`,
  );

  assert.equal(curve.rows[0].venue, "pickler_curve");
  assert.equal(curve.rows[0].address, CURVE);
});

test("a trade lands against the curve that emitted it", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(
    store,
    [block(10n, "a", "9"), block(11n, "b", "a")],
    [launchEvent(10n, "a"), buyEvent(11n, "b")],
  );

  const result = await projector.project(CHAIN, readMetadata);

  assert.equal(result.trades, 1);

  const rows = await projector.pool.query(
    `select "side", "trader", "token_amount", "quote_amount", "fee_amount" from "market"."trades"`,
  );

  assert.equal(rows.rows[0].side, "buy");
  assert.equal(rows.rows[0].trader, ALICE);
  assert.equal(rows.rows[0].token_amount, "5000");
  assert.equal(rows.rows[0].quote_amount, "1000000");
  assert.equal(rows.rows[0].fee_amount, "10000");
});

/** A trade for a curve we never saw would have to invent the launch it belongs to. */
test("a trade with no known curve is skipped, not attached to something else", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(store, [block(11n, "b", "a")], [buyEvent(11n, "b")]);

  const result = await projector.project(CHAIN, readMetadata);

  assert.equal(result.trades, 0);
  assert.equal(result.skipped, 1);
  assert.equal((await projector.pool.query(`select 1 from "market"."trades"`)).rowCount, 0);
});

/**
 * The property that makes a projection disposable: rebuilding it must produce the same
 * catalogue, or no rebuild can be trusted after an incident.
 */
test("projecting twice produces the same catalogue", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(
    store,
    [block(10n, "a", "9"), block(11n, "b", "a")],
    [launchEvent(10n, "a"), buyEvent(11n, "b", 0), buyEvent(11n, "b", 1, "7000")],
  );

  await projector.project(CHAIN, readMetadata);
  const first = await projector.pool.query(
    `select "side", "token_amount", "log_index" from "market"."trades" order by "log_index"`,
  );

  await projector.project(CHAIN, readMetadata);
  const second = await projector.pool.query(
    `select "side", "token_amount", "log_index" from "market"."trades" order by "log_index"`,
  );

  assert.equal(first.rowCount, 2);
  assert.deepEqual(second.rows, first.rows);
  assert.equal((await projector.pool.query(`select 1 from "market"."tokens"`)).rowCount, 1);
});

/**
 * The one that matters most after a reorg: a trade on a branch that lost did not happen, and
 * counting it would inflate the token's volume with a branch the chain discarded.
 */
test("an orphaned trade stops counting", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(
    store,
    [block(10n, "a", "9"), block(11n, "b", "a")],
    [launchEvent(10n, "a"), buyEvent(11n, "b")],
  );

  await projector.project(CHAIN, readMetadata);
  assert.equal((await projector.pool.query(`select 1 from "market"."trades"`)).rowCount, 1);

  await store.rollbackFrom(CHAIN, FACTORY, "launches", 10n);

  // Rebuild from scratch, which is what an operator does after an incident.
  await projector.pool.query(`delete from "market"."trades"`);
  const rebuilt = await projector.project(CHAIN, readMetadata);

  assert.equal(rebuilt.trades, 0, "a trade from a discarded branch was projected again");
  assert.equal((await projector.pool.query(`select 1 from "market"."trades"`)).rowCount, 0);
});

test("graduation closes the curve and opens the pool", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(
    store,
    [block(10n, "a", "9"), block(12n, "c", "b")],
    [
      launchEvent(10n, "a"),
      event(12n, "c", 0, "LaunchGraduated", "0x6666666666666666666666666666666666666666", {
        token: TOKEN,
        curve: CURVE,
        poolId: hash("pool"),
        tokenId: "1",
        quoteUsed: "1000000",
        tokensUsed: "2000",
        quoteDust: "0",
        tokenDust: "0",
      }),
    ],
  );

  const result = await projector.project(CHAIN, readMetadata);

  assert.equal(result.graduations, 1);

  const token = await projector.pool.query(
    `select "status", "graduated_at" from "market"."tokens"`,
  );
  assert.equal(token.rows[0].status, "graduated");
  assert.notEqual(token.rows[0].graduated_at, null);

  const poolRows = await projector.pool.query(
    `select "phase", "venue", "pool_key", "closed_at" from "market"."pools" order by "phase"`,
  );

  assert.equal(poolRows.rowCount, 2);
  const post = poolRows.rows.find((row) => row.phase === "post_graduation");
  const pre = poolRows.rows.find((row) => row.phase === "pre_graduation");

  assert.equal(post.venue, "uniswap_v4");
  assert.equal(post.pool_key, hash("pool"));
  assert.notEqual(pre.closed_at, null, "the curve was left open after graduation");
});

test("an event we do not recognise is counted as skipped, never as projected", async (t) => {
  const { store, projector } = await createPair(t);

  await indexed(
    store,
    [block(10n, "a", "9")],
    [event(10n, "a", 0, "SomethingElse", FACTORY, { whatever: true })],
  );

  const result = await projector.project(CHAIN, readMetadata);

  assert.equal(result.skipped, 1);
  assert.equal(result.launches + result.trades + result.graduations, 0);
});
