import {
  PostgresLaunchIndexStore,
  ViemChainReader,
  decodeLaunchLog,
  runIndexerPass,
  type DatabaseConnectionOptions,
} from "@pickler/infrastructure";

import { IndexerNotConfiguredError, readIndexerConfig } from "./config.js";

export interface Env {
  APP_ENV: string;
  DATABASE?: Hyperdrive;
  DATABASE_URL: string;
  CHAIN_ID?: string;
  RPC_URLS?: string;
  LAUNCH_FACTORY_ADDRESS?: string;
  LAUNCH_FACTORY_DEPLOYMENT_BLOCK?: string;
  CONFIRMATIONS?: string;
  MAX_BLOCKS_PER_PASS?: string;
}

/** The same trusted binding for every trigger; never fall back to a hosted secret. */
function indexerDatabase(env: Env): { url: string; options: DatabaseConnectionOptions } {
  if (env.DATABASE) {
    return {
      url: env.DATABASE.connectionString,
      options: { environment: env.APP_ENV, transport: "hyperdrive" },
    };
  }

  if (env.APP_ENV !== "local") {
    throw new Error("Indexer database binding unavailable");
  }

  return { url: env.DATABASE_URL, options: { environment: "local" } };
}

/**
 * The launch indexer.
 *
 * All the logic it runs is in `@pickler/infrastructure`, tested against a real database with
 * a scripted chain. What lives here is the schedule, the bindings and the decision to refuse
 * rather than guess: with no factory address configured, the pass does not run and says so,
 * because an index that looks populated and is not costs more than one that plainly never
 * started.
 */
const worker = {
  async scheduled(_controller: ScheduledController, env: Env) {
    let config;
    try {
      config = readIndexerConfig(env);
    } catch (error) {
      if (error instanceof IndexerNotConfiguredError) {
        console.warn(error.message);
        return;
      }

      throw error;
    }

    const database = indexerDatabase(env);
    const store = new PostgresLaunchIndexStore(database.url, database.options);

    try {
      const reader = new ViemChainReader({ chainId: config.chainId, rpcUrls: config.rpcUrls });

      const outcome = await runIndexerPass({
        reader,
        store,
        source: {
          chain: config.chain,
          contract: config.factory,
          stream: "launches",
          deploymentBlock: config.deploymentBlock,
        },
        decode: decodeLaunchLog,
        maxBlocks: config.maxBlocks,
        confirmations: config.confirmations,
      });

      // A gap and a reorg are both worth seeing in logs: one means a range was refused, the
      // other that a branch was unwound. Neither is a failure of this worker.
      console.log(JSON.stringify({ indexer: outcome }, replaceBigints));
    } finally {
      await store.close();
    }
  },
};

export default worker;

function replaceBigints(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
