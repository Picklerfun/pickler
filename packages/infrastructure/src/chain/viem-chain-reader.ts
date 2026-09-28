import { createPublicClient, fallback, http, type PublicClient, type Transport } from "viem";

import {
  ChainMismatchError,
  ChainUnavailableError,
  type BlockRef,
  type ChainLog,
  type ChainReader,
  type LogQuery,
} from "@pickler/core";

/**
 * Reads a chain through viem, behind the domain's own `ChainReader`.
 *
 * Two behaviours matter more than the plumbing:
 *
 * - The chain id is verified against the node, not assumed from configuration. A node that
 *   answers for another chain is refused rather than read, because silently indexing the
 *   wrong chain produces data that looks correct and is not.
 * - A read that no endpoint can answer raises `ChainUnavailableError` rather than returning
 *   an empty result. An empty block range and an unreachable node are indistinguishable to a
 *   caller that only sees `[]`, and treating the second as the first is how an indexer
 *   silently skips history.
 */
export interface ViemChainReaderOptions {
  chainId: number;
  /** Tried in order; later entries are failover, not load balancing. */
  rpcUrls: readonly string[];
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Attempts per endpoint before moving to the next. */
  retryCount?: number;
  /** Injected in tests to avoid a network. */
  transport?: Transport;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_COUNT = 2;

export class ViemChainReader implements ChainReader {
  readonly chainId: number;

  private readonly client: PublicClient;
  private verified = false;

  constructor(options: ViemChainReaderOptions) {
    if (options.rpcUrls.length === 0 && !options.transport) {
      throw new ChainUnavailableError("A chain reader needs at least one RPC endpoint");
    }

    this.chainId = options.chainId;

    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retryCount = options.retryCount ?? DEFAULT_RETRY_COUNT;

    const transport =
      options.transport ??
      fallback(
        options.rpcUrls.map((url) => http(url, { timeout, retryCount })),
        { rank: false },
      );

    this.client = createPublicClient({ transport });
  }

  async getLatestBlock(): Promise<BlockRef> {
    await this.verifyChain();

    return this.call_("getLatestBlock", async () => {
      const block = await this.client.getBlock({ blockTag: "latest" });

      return toBlockRef(block);
    });
  }

  async getBlock(blockNumber: bigint): Promise<BlockRef> {
    await this.verifyChain();

    return this.call_("getBlock", async () => {
      const block = await this.client.getBlock({ blockNumber });

      return toBlockRef(block);
    });
  }

  async getLogs(query: LogQuery): Promise<ChainLog[]> {
    await this.verifyChain();

    if (query.toBlock < query.fromBlock) {
      throw new ChainUnavailableError(
        `Refusing a backwards range: ${query.fromBlock} to ${query.toBlock}`,
      );
    }

    return this.call_("getLogs", async () => {
      const logs = await this.client.request({
        method: "eth_getLogs",
        params: [
          {
            fromBlock: toHex(query.fromBlock),
            toBlock: toHex(query.toBlock),
            ...(query.addresses ? { address: [...query.addresses] } : {}),
            ...(query.topics ? { topics: query.topics as never } : {}),
          },
        ],
      } as never);

      return (logs as RawLog[]).map((log) => this.toChainLog(log));
    });
  }

  async call(request: { to: `0x${string}`; data: `0x${string}`; blockNumber?: bigint }) {
    await this.verifyChain();

    return this.call_("call", async () => {
      const result = await this.client.call({
        to: request.to,
        data: request.data,
        ...(request.blockNumber === undefined ? {} : { blockNumber: request.blockNumber }),
      });

      return (result.data ?? "0x") as `0x${string}`;
    });
  }

  /**
   * Asks the node which chain it is, once. Every read goes through this, so a misconfigured
   * or swapped endpoint is caught on first use rather than after a day of indexing.
   */
  private async verifyChain(): Promise<void> {
    if (this.verified) {
      return;
    }

    const reported = await this.call_("getChainId", () => this.client.getChainId());

    if (reported !== this.chainId) {
      throw new ChainMismatchError(this.chainId, reported);
    }

    this.verified = true;
  }

  private async call_<T>(operation: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (cause) {
      if (cause instanceof ChainMismatchError) {
        throw cause;
      }

      throw new ChainUnavailableError(`${operation} failed on chain ${this.chainId}`, cause);
    }
  }

  private toChainLog(log: RawLog): ChainLog {
    if (log.blockHash === null || log.blockNumber === null || log.logIndex === null) {
      // A pending log has no place in a projection: it has no identity yet, so it cannot be
      // deduplicated and cannot be rolled back.
      throw new ChainUnavailableError("The node returned a pending log with no block identity");
    }

    return {
      chainId: this.chainId,
      blockNumber: BigInt(log.blockNumber),
      blockHash: log.blockHash,
      transactionHash: log.transactionHash,
      logIndex: Number(BigInt(log.logIndex)),
      address: log.address,
      topics: log.topics,
      data: log.data,
      removed: log.removed ?? false,
    };
  }
}

interface RawLog {
  address: `0x${string}`;
  topics: readonly `0x${string}`[];
  data: `0x${string}`;
  blockNumber: `0x${string}` | null;
  blockHash: `0x${string}` | null;
  transactionHash: `0x${string}`;
  logIndex: `0x${string}` | null;
  removed?: boolean;
}

function toBlockRef(block: {
  number: bigint | null;
  hash: `0x${string}` | null;
  parentHash: `0x${string}`;
  timestamp: bigint;
}): BlockRef {
  if (block.number === null || block.hash === null) {
    throw new ChainUnavailableError("The node returned a pending block with no identity");
  }

  return {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp,
  };
}

function toHex(value: bigint): `0x${string}` {
  return `0x${value.toString(16)}`;
}
