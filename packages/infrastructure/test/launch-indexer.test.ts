import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";

import type { BlockRef, ChainLog, ChainReader, LogQuery } from "@pickler/core";

import { migrateDatabase } from "../src/persistence/migrate-database.js";
import { PostgresLaunchIndexStore } from "../src/persistence/product/launch-index-store.js";
import { runIndexerPass, type IndexerSource } from "../src/chain/launch-indexer.js";

const CHAIN = "eip155:10143";
const FACTORY = "0x1111111111111111111111111111111111111111" as const;
const ABI_HASH = "a".repeat(64);

const SOURCE: IndexerSource = {
  chain: CHAIN,
  contract: FACTORY,
  stream: "launches",
  deploymentBlock: 10n,
};

function hash(seed: string): string {
  const hex = [...seed].map((character) => character.charCodeAt(0).toString(16)).join("");

  return `0x${hex.padStart(64, "0").slice(-64)}`;
}

/**
 * A chain that can be rewritten between passes, which is the only way to test a reorg
 * without one happening to us.
 */
class ScriptedChain implements ChainReader {
  readonly chainId = 10143;

  private blocks = new Map<bigint, BlockRef>();
  private logs: ChainLog[] = [];

  blockCalls = 0;

  constructor(private tip: bigint) {}

  /** Writes a branch: block `number` with `suffix`, descending from `parentSuffix`. */
  setBlock(number: bigint, suffix: string, parentSuffix: string): void {
    this.blocks.set(number, {
      number,
      hash: hash(suffix) as `0x${string}`,
      parentHash: hash(parentSuffix) as `0x${string}`,
      timestamp: BigInt(1_700_000_000 + Number(number)),
    });
  }

  setTip(tip: bigint): void {
    this.tip = tip;
  }

  addLog(blockNumber: bigint, blockSuffix: string, logIndex: number, removed = false): void {
    this.logs.push({
      chainId: this.chainId,
      blockNumber,
      blockHash: hash(blockSuffix) as `0x${string}`,
      transactionHash: hash(`${blockSuffix}-tx-${logIndex}`) as `0x${string}`,
      logIndex,
      address: FACTORY,
      topics: [hash("dead") as `0x${string}`],
      data: "0x00",
      removed,
    });
  }

  clearLogs(): void {
    this.logs = [];
  }

  async getLatestBlock(): Promise<BlockRef> {
    return this.blocks.get(this.tip)!;
  }

  async getBlock(blockNumber: bigint): Promise<BlockRef> {
    this.blockCalls++;

    const block = this.blocks.get(blockNumber);
    if (!block) {
      throw new Error(`no block ${blockNumber}`);
    }

    return block;
  }

  /** No pass reads contract state, so answering is enough to satisfy the port. */
  async call(): Promise<`0x${string}`> {
    return "0x";
  }

  async getLogs(query: LogQuery): Promise<ChainLog[]> {
    return this.logs.filter(
      (log) => log.blockNumber >= query.fromBlock && log.blockNumber <= query.toBlock,
    );
  }
}

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
    throw new Error("Start PostgreSQL with npm run db:up or set TEST_DATABASE_URL", { cause });
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

const decode = () => ({ eventName: "LaunchCreated", abiHash: ABI_HASH, decoded: { ok: true } });

function chainOf(tip: bigint, suffixes: Record<string, string>): ScriptedChain {
  const chain = new ScriptedChain(tip);

  for (const [number, suffix] of Object.entries(suffixes)) {
    const height = BigInt(number);
    const parent = suffixes[String(height - 1n)] ?? "genesis";
    chain.setBlock(height, suffix, parent);
  }

  return chain;
}

test("a first pass starts at the deployment block, not at the tip", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(13n, { "10": "a", "11": "b", "12": "c", "13": "d" });
  chain.addLog(11n, "b", 0);

  const outcome = await runIndexerPass({ reader: chain, store, source: SOURCE, decode });

  assert.equal(outcome.kind, "applied");
  assert.equal(outcome.kind === "applied" && outcome.fromBlock, 10n);
  assert.equal(outcome.kind === "applied" && outcome.events, 1);

  const cursor = await store.readCursor(CHAIN, FACTORY, "launches");
  assert.equal(cursor?.lastBlock, 13n);
});

test("a second pass with nothing new does nothing", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(12n, { "10": "a", "11": "b", "12": "c" });

  await runIndexerPass({ reader: chain, store, source: SOURCE, decode });
  const second = await runIndexerPass({ reader: chain, store, source: SOURCE, decode });

  assert.deepEqual(second, { kind: "idle", reason: "caught-up" });
});

test("a pass is bounded even when the chain is far ahead", async (t) => {
  const store = await createStore(t);
  const heights: Record<string, string> = {};
  for (let height = 10; height <= 200; height++) {
    heights[String(height)] = `h${height}`;
  }
  const chain = chainOf(200n, heights);

  const outcome = await runIndexerPass({
    reader: chain,
    store,
    source: SOURCE,
    decode,
    maxBlocks: 5n,
  });

  assert.equal(outcome.kind === "applied" && outcome.toBlock, 14n);
});

test("staying behind the tip leaves unconfirmed blocks unread", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(20n, {
    "10": "a",
    "11": "b",
    "12": "c",
    "13": "d",
    "14": "e",
    "15": "f",
    "16": "g",
    "17": "h",
    "18": "i",
    "19": "j",
    "20": "k",
  });

  const outcome = await runIndexerPass({
    reader: chain,
    store,
    source: SOURCE,
    decode,
    confirmations: 5n,
  });

  assert.equal(outcome.kind === "applied" && outcome.toBlock, 15n);
});

/** The node already told us this log is on a branch that lost. Storing it would count a
 * trade that did not happen. */
test("a log the node reports as removed is not stored", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(11n, { "10": "a", "11": "b" });
  chain.addLog(11n, "b", 0, true);

  const outcome = await runIndexerPass({ reader: chain, store, source: SOURCE, decode });

  assert.equal(outcome.kind === "applied" && outcome.events, 0);
  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 0);
});

test("a log we cannot decode is skipped rather than stored half-understood", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(11n, { "10": "a", "11": "b" });
  chain.addLog(11n, "b", 0);

  const outcome = await runIndexerPass({
    reader: chain,
    store,
    source: SOURCE,
    decode: () => null,
  });

  assert.equal(outcome.kind === "applied" && outcome.events, 0);
});

/**
 * The case the pass exists for. Between two passes the chain replaces a block; the indexer
 * must notice on the parent hash, unwind, and then rebuild on the branch that survived.
 */
test("a reorg between passes is detected, unwound and rebuilt", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(12n, { "10": "a", "11": "b", "12": "c" });
  chain.addLog(12n, "c", 0);

  await runIndexerPass({ reader: chain, store, source: SOURCE, decode });
  assert.equal((await store.readCanonicalEvents(CHAIN)).length, 1);

  // The chain rewrites everything above block 11.
  chain.clearLogs();
  chain.setBlock(12n, "cc", "b");
  chain.setBlock(13n, "dd", "cc");
  chain.setTip(13n);
  chain.addLog(13n, "dd", 0);

  const detected = await runIndexerPass({ reader: chain, store, source: SOURCE, decode });

  assert.equal(detected.kind, "reorg");
  assert.equal(detected.kind === "reorg" && detected.rollbackToBlock, 11n);
  assert.equal(
    (await store.readCanonicalEvents(CHAIN)).length,
    0,
    "the losing branch's event is still canonical",
  );

  const rebuilt = await runIndexerPass({ reader: chain, store, source: SOURCE, decode });

  assert.equal(rebuilt.kind, "applied");

  const canonical = await store.readCanonicalEvents(CHAIN);
  assert.equal(canonical.length, 1, "the surviving branch was not rebuilt");
  assert.equal(canonical[0]?.blockNumber, 13n);
});

/**
 * Replay is the property the whole design serves: running everything again from an empty
 * cursor has to reconstruct exactly the same catalogue, or no rebuild can ever be trusted.
 */
test("replaying every pass reconstructs the same events", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(16n, {
    "10": "a",
    "11": "b",
    "12": "c",
    "13": "d",
    "14": "e",
    "15": "f",
    "16": "g",
  });
  chain.addLog(11n, "b", 0);
  chain.addLog(11n, "b", 1);
  chain.addLog(14n, "e", 0);

  for (let pass = 0; pass < 6; pass++) {
    await runIndexerPass({ reader: chain, store, source: SOURCE, decode, maxBlocks: 2n });
  }

  const first = await store.readCanonicalEvents(CHAIN);
  assert.equal(first.length, 3);

  // Run every pass again over the same chain. Ranges overlap, logs repeat, nothing changes.
  for (let pass = 0; pass < 6; pass++) {
    await runIndexerPass({ reader: chain, store, source: SOURCE, decode, maxBlocks: 2n });
  }

  assert.deepEqual(await store.readCanonicalEvents(CHAIN), first);
});

test("announcements are planned per event and enqueued once", async (t) => {
  const store = await createStore(t);
  const chain = chainOf(11n, { "10": "a", "11": "b" });
  chain.addLog(11n, "b", 0);

  const pass = {
    reader: chain,
    store,
    source: SOURCE,
    decode,
    plan: (event: { blockHash: string; txHash: string; logIndex: number }) => [
      {
        topic: "launch.created",
        payload: { block: event.blockHash },
        event: { blockHash: event.blockHash, txHash: event.txHash, logIndex: event.logIndex },
      },
    ],
  };

  await runIndexerPass(pass);
  await runIndexerPass({ ...pass, store });

  assert.equal(await store.countPendingOutbox(CHAIN), 1, "a replay enqueued a second time");
});
