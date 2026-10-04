import { createStudioPerpsCheckDependencies } from "./studio-perps-runtime.js";
import { runStudioPerpsCheck } from "@pickler/trading/perps";
import type { StudioPerpsModels } from "@pickler/trading/strategies";
import { PilotError, type PerpNetwork } from "@pickler/core";
import {
  PERPL_CHECK_SESSION_LIMIT,
  PerplBoardMemory,
  PerplMarketData,
  PerplRequestSchedule,
  PostgresCustodyStore,
  PostgresPerpsOwnerStore,
  PostgresPerpsPaperStore,
  PostgresPerpsRuntimeStore,
  PostgresResearchStore,
  createAusdBalanceReader,
  createPerplMarketBoard,
  type DatabaseConnectionOptions,
} from "@pickler/infrastructure";
import type { PerpsPaperMark } from "@pickler/trading/perps";
import type { PerpsBackground } from "../workers/perps.js";
import type { PerpsActionsBackground } from "../workers/perps-actions.js";
import { perpsFrame, type PerpsMarks } from "./perps-check.js";

/** The chain the agent wallets' AUSD is read on when `CHAIN_ID` is absent: Monad testnet. */
export const PERPS_DEFAULT_CHAIN_ID = 10143;

export interface PerpsRuntimeEnvironment {
  DATABASE_URL: string;
  PERPS_RUNTIME_POLICY_JSON?: string;
  PERPS_JEV_API_KEY?: string;
  MODEL_BASE_URL?: string;
  MODEL_ID?: string;
  MODEL_API_KEY?: string;
  EXA_API_KEY?: string;
  CHAIN_ID?: string;
  MONAD_RPC_URL?: string;
}

// Per isolate, like the API's: the board's memory and the Perpl schedule outlive one invocation,
// so a minute's Cron and the checks share one paced, cached view of the venue.
const boards = new Map<PerpNetwork, PerplBoardMemory>();
const schedule = new PerplRequestSchedule();

/** Board marks as paper decimals; a stale board, a sample or a bad number gives none. */
export function boardMarks(): PerpsMarks {
  return async (network) => {
    let memory = boards.get(network);
    if (!memory) {
      memory = new PerplBoardMemory();
      boards.set(network, memory);
    }
    const markets = await createPerplMarketBoard({ network, memory }).listMarkets();
    const marks: PerpsPaperMark[] = [];
    for (const market of markets) {
      const fresh = market.source.venue === "perpl" && !market.source.stale;
      if (
        fresh &&
        (market.base === "BTC" || market.base === "ETH") &&
        Number.isFinite(market.mark) &&
        market.mark > 0
      ) {
        marks.push({ network, symbol: market.base, mark: market.mark.toFixed(8) });
      }
    }
    return marks;
  };
}

/**
 * The deployed composition of the Perpl paper runtime for one research-worker invocation: one
 * pool (closed by `close`), the runtime and paper stores, the agent wallets' AUSD reader, bounded
 * Perpl sessions of 24 requests, the board's marks, site-scoped Exa and the configured model, plus
 * the owner store the owner's approvals and closes (`workers/perps-actions.ts`) run under.
 */
export function createPerpsRuntime(
  env: PerpsRuntimeEnvironment,
  options: DatabaseConnectionOptions,
  overrides: { models?: StudioPerpsModels } = {},
): PerpsBackground & PerpsActionsBackground {
  const research = new PostgresResearchStore(env.DATABASE_URL, undefined, options);
  const store = new PostgresPerpsRuntimeStore(research.pool);
  const paper = new PostgresPerpsPaperStore(research.pool);
  const custody = new PostgresCustodyStore(research.pool);
  const chainId = Number(env.CHAIN_ID ?? PERPS_DEFAULT_CHAIN_ID);
  let reader: ReturnType<typeof createAusdBalanceReader> | null = null;
  const balances = {
    read(address: string) {
      reader ??= createAusdBalanceReader({
        chainId,
        ...(env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {}),
      });
      return reader.read(address);
    },
  };
  const marks = boardMarks();
  const exitData = new PerplMarketData({ schedule, sessionLimit: PERPL_CHECK_SESSION_LIMIT });
  return {
    store,
    paper,
    bindPaper(scope, version, holder, signal) {
      return new PostgresPerpsPaperStore(research.pool, undefined, undefined, () => ({
        scope,
        configVersion: version,
        lease: holder.lease,
        requireReservation: false,
        signal,
      }));
    },
    agents: research,
    marks,
    async exitFrame(network, symbol, signal) {
      const ctx = {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        guard: async () => {},
      };
      const book = await exitData.book(network, symbol, 20, ctx);
      const snapshot = await exitData.snapshot(network, symbol, ctx);
      return perpsFrame(snapshot, book);
    },
    async funding(network, symbol, from, to, signal) {
      return exitData.funding(
        network,
        { symbol, from, to },
        {
          signal,
          guard: async () => {
            signal.throwIfAborted();
          },
        },
      );
    },
    async check(check, holder, signal) {
      if (check.trigger !== "hourly" && check.trigger !== "manual") {
        throw new PilotError("INVALID_INPUT", "Only hourly and manual checks run");
      }
      const studio = createStudioPerpsCheckDependencies({
        env,
        research,
        custody,
        store,
        balances,
        schedule,
        ...(overrides.models ? { models: overrides.models } : {}),
      });
      return runStudioPerpsCheck(studio, check, holder, signal);
    },
    // The owner's actions (workers/perps-actions.ts) and the Cron's re-drive share this pool.
    owner: new PostgresPerpsOwnerStore(research.pool),
    close: () => research.close(),
  };
}
