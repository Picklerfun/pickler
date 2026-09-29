import type { Env } from "./index.js";

export interface IndexerConfig {
  chainId: number;
  chain: string;
  rpcUrls: string[];
  factory: `0x${string}`;
  deploymentBlock: bigint;
  confirmations: bigint;
  maxBlocks: bigint;
}

export class IndexerNotConfiguredError extends Error {
  constructor(missing: string) {
    super(`The indexer has no ${missing}; it will not run until one is configured`);
    this.name = "IndexerNotConfiguredError";
  }
}

/**
 * Reads the indexer's configuration, or refuses to run.
 *
 * Nothing is defaulted. A factory address or a deployment block guessed wrong produces an
 * index that looks populated and is not, which is harder to notice than an indexer that
 * plainly did not start. No Pickler contract is deployed yet, so in practice this refuses.
 */
export function readIndexerConfig(env: Env): IndexerConfig {
  const factory = env.LAUNCH_FACTORY_ADDRESS?.toLowerCase();
  if (!factory || !/^0x[0-9a-f]{40}$/.test(factory)) {
    throw new IndexerNotConfiguredError("launch factory address");
  }

  if (!env.LAUNCH_FACTORY_DEPLOYMENT_BLOCK) {
    throw new IndexerNotConfiguredError("factory deployment block");
  }

  const chainId = Number(env.CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new IndexerNotConfiguredError("chain id");
  }

  const rpcUrls = (env.RPC_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (rpcUrls.length === 0) {
    throw new IndexerNotConfiguredError("RPC endpoint");
  }

  return {
    chainId,
    chain: `eip155:${chainId}`,
    rpcUrls,
    factory: factory as `0x${string}`,
    deploymentBlock: BigInt(env.LAUNCH_FACTORY_DEPLOYMENT_BLOCK),
    confirmations: BigInt(env.CONFIRMATIONS ?? "0"),
    maxBlocks: BigInt(env.MAX_BLOCKS_PER_PASS ?? "100"),
  };
}
