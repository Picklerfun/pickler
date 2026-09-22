/**
 * What the launch domain needs from a chain, described without naming one.
 *
 * The indexer and the quoting path both read through this. Keeping it here rather than in
 * infrastructure is what stops viem's types leaking into business code, and what lets a
 * reader be faked in tests without a node.
 *
 * Every amount and block number is a `bigint`. Nothing here returns a floating point number,
 * and nothing here is serialised: conversion to strings belongs at the HTTP boundary.
 */

/** A block, identified well enough to detect a reorg. */
export interface BlockRef {
  number: bigint;
  hash: `0x${string}`;
  parentHash: `0x${string}`;
  /** Seconds since the epoch, as the chain reports it. */
  timestamp: bigint;
}

/**
 * A log's identity, which is what makes indexing idempotent.
 *
 * `chainId + blockHash + transactionHash + logIndex` is unique across reorged branches too,
 * where `blockNumber + logIndex` alone is not: two competing blocks at the same height can
 * each carry a log at the same index.
 */
export interface ChainLog {
  chainId: number;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logIndex: number;
  address: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  /** True when the node reported the log as belonging to a reorganised block. */
  removed: boolean;
}

export interface LogQuery {
  /** Inclusive. */
  fromBlock: bigint;
  /** Inclusive. */
  toBlock: bigint;
  /** When omitted, every address is matched. */
  addresses?: readonly `0x${string}`[];
  /** Topic filter in `eth_getLogs` form; a nested array means "any of these". */
  topics?: readonly (`0x${string}` | readonly `0x${string}`[] | null)[];
}

/** An `eth_call`, pinned to a block so a multi-read view stays internally consistent. */
export interface CallRequest {
  to: `0x${string}`;
  data: `0x${string}`;
  blockNumber?: bigint;
}

export interface ChainReader {
  /** The chain this reader is bound to. Verified against the node, never assumed. */
  readonly chainId: number;

  getLatestBlock(): Promise<BlockRef>;

  getBlock(blockNumber: bigint): Promise<BlockRef>;

  getLogs(query: LogQuery): Promise<ChainLog[]>;

  /**
   * Reads contract state. Returns raw bytes: decoding belongs to whoever knows the ABI, and
   * keeping it out of the port is what keeps the domain free of a chain SDK.
   */
  call(request: CallRequest): Promise<`0x${string}`>;
}

/** Raised when a node answers for a chain other than the one the reader was configured for. */
export class ChainMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`RPC reported chain ${actual} where ${expected} was expected`);
    this.name = "ChainMismatchError";
  }
}

/** Raised when no configured endpoint could answer. */
export class ChainUnavailableError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChainUnavailableError";
  }
}
