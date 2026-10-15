import {
  nextRange,
  planAdvance,
  type ChainLog,
  type ChainReader,
  type IndexedBlock,
} from "@pickler/core";

import type {
  IndexEventInput,
  OutboxInput,
  PostgresLaunchIndexStore,
} from "../persistence/product/launch-index-store.js";

/**
 * One pass of the launch indexer: read a bounded range, decide what it means, write it.
 *
 * Deliberately a function rather than a loop or a service. A pass either advances the cursor
 * or does not, and a worker that calls it on a schedule needs no state of its own — which is
 * what lets the whole thing be tested against a real database with a scripted chain.
 *
 * Every block in the range is fetched, not only the ones carrying logs. That costs a request
 * per block and is why `maxBlocks` is small: it is what makes each block's parent verifiable,
 * so a reorg cannot pass unnoticed between two sparse samples. Long histories are covered by
 * running many small passes, not by widening one.
 */
export interface IndexerSource {
  /** CAIP-2, e.g. `eip155:10143`. */
  chain: string;
  /** The log source, lower-case hex. */
  contract: `0x${string}`;
  /** A name for what is read from it. */
  stream: string;
  /** Where this contract's history starts. Never the current height. */
  deploymentBlock: bigint;
}

/** Turns a raw log into something storable. Returning null skips a log we do not understand. */
export type LogDecoder = (
  log: ChainLog,
) => { eventName: string; abiHash: string; decoded: unknown } | null;

/** What, if anything, a decoded event should announce. */
export type OutboxPlanner = (event: IndexEventInput) => OutboxInput[];

export interface IndexerPassOptions {
  reader: ChainReader;
  store: PostgresLaunchIndexStore;
  source: IndexerSource;
  decode: LogDecoder;
  plan?: OutboxPlanner;
  /** Blocks per pass. Small on purpose; see the note above. */
  maxBlocks?: bigint;
  /** Blocks to stay behind the tip, under the finality policy measured for this chain. */
  confirmations?: bigint;
  confirmed?: boolean;
}

export type PassOutcome =
  | { kind: "idle"; reason: "caught-up" }
  | { kind: "applied"; fromBlock: bigint; toBlock: bigint; blocks: number; events: number }
  | { kind: "reorg"; rollbackToBlock: bigint; orphanedBlocks: number; orphanedEvents: number }
  | { kind: "gap"; expectedBlock: bigint; receivedBlock: bigint };

const DEFAULT_MAX_BLOCKS = 100n;

export async function runIndexerPass(options: IndexerPassOptions): Promise<PassOutcome> {
  const { reader, store, source } = options;

  const cursor = await store.readCursor(source.chain, source.contract, source.stream);
  const latest = await reader.getLatestBlock();

  const range = nextRange({
    cursor,
    deploymentBlock: source.deploymentBlock,
    latestBlock: latest.number,
    maxBlocks: options.maxBlocks ?? DEFAULT_MAX_BLOCKS,
    confirmations: options.confirmations ?? 0n,
  });

  if (range === null) {
    return { kind: "idle", reason: "caught-up" };
  }

  const blocks = await fetchRange(reader, range.fromBlock, range.toBlock);
  const advance = planAdvance(cursor, blocks.map(toIndexedBlock));

  if (advance.kind === "idle") {
    return { kind: "idle", reason: "caught-up" };
  }

  if (advance.kind === "gap") {
    // Refusing is the point: applying it would leave a hole no later pass looks for.
    return {
      kind: "gap",
      expectedBlock: advance.expectedBlock,
      receivedBlock: advance.receivedBlock,
    };
  }

  if (advance.kind === "reorg") {
    const undone = await store.rollbackFrom(
      source.chain,
      source.contract,
      source.stream,
      advance.rollbackToBlock,
    );

    // The next pass re-reads from the surviving block and rebuilds on whichever branch won.
    return {
      kind: "reorg",
      rollbackToBlock: advance.rollbackToBlock,
      orphanedBlocks: undone.orphanedBlocks,
      orphanedEvents: undone.orphanedEvents,
    };
  }

  const applying = new Set(advance.blocks.map((block) => block.hash));
  const logs = await reader.getLogs({
    fromBlock: advance.blocks[0]!.number,
    toBlock: advance.blocks[advance.blocks.length - 1]!.number,
    addresses: [source.contract],
  });

  const events: IndexEventInput[] = [];
  const outbox: OutboxInput[] = [];

  for (const log of logs) {
    // A log the node already marked removed belongs to a branch that lost; storing it as
    // canonical would count a trade that did not happen.
    if (log.removed) {
      continue;
    }
    if (!applying.has(log.blockHash)) {
      throw new Error("INDEX_LOG_BRANCH_MISMATCH");
    }

    const decoded = options.decode(log);
    if (decoded === null) {
      continue;
    }

    const event: IndexEventInput = {
      blockHash: log.blockHash,
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      emitter: log.address,
      eventName: decoded.eventName,
      abiHash: decoded.abiHash,
      topics: log.topics,
      data: log.data,
      decoded: decoded.decoded,
    };

    events.push(event);
    outbox.push(...(options.plan?.(event) ?? []));
  }

  await store.applyBatch({
    ...(options.confirmed === undefined ? {} : { confirmed: options.confirmed }),
    chain: source.chain,
    contract: source.contract,
    stream: source.stream,
    blocks: advance.blocks.map((block) => {
      const full = blocks.find((candidate) => candidate.hash === block.hash)!;

      return {
        number: full.number,
        hash: full.hash,
        parentHash: full.parentHash,
        blockTime: new Date(Number(full.timestamp) * 1000),
      };
    }),
    events,
    outbox,
  });

  return {
    kind: "applied",
    fromBlock: advance.blocks[0]!.number,
    toBlock: advance.blocks[advance.blocks.length - 1]!.number,
    blocks: advance.blocks.length,
    events: events.length,
  };
}

async function fetchRange(reader: ChainReader, fromBlock: bigint, toBlock: bigint) {
  const numbers: bigint[] = [];
  for (let number = fromBlock; number <= toBlock; number++) {
    numbers.push(number);
  }

  return Promise.all(numbers.map((number) => reader.getBlock(number)));
}

function toIndexedBlock(block: { number: bigint; hash: string; parentHash: string }): IndexedBlock {
  return { number: block.number, hash: block.hash, parentHash: block.parentHash };
}
