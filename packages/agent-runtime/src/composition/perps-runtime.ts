import { PilotError, type PerpNetwork, type PerpSymbol } from "@pickler/core";
import {
  ExaResearch,
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
import { createPerplSession } from "../plugins/perpl/index.js";
import { siteScopedWeb } from "../plugins/exa.js";
import type { PerpsBackground } from "../workers/perps.js";
import type { PerpsActionsBackground } from "../workers/perps-actions.js";
import { readPerplInstrument } from "./advice.js";
import { createPerpsCheckModel, type PerpsCheckModel } from "./perps-check-model.js";
import {
  PERPS_CHECK_CANDLES,
  perpsFrame,
  runPerpsCheck,
  type PerpsCheckDependencies,
  type PerpsCheckWeb,
  type PerpsMarks,
} from "./perps-check.js";

/** The chain the agent wallets' AUSD is read on when `CHAIN_ID` is absent: Monad testnet. */
export const PERPS_DEFAULT_CHAIN_ID = 10143;

export interface PerpsRuntimeEnvironment {
  DATABASE_URL: string;
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
 * Exa under the agent's site rules; the cost is Exa's reported total, when it reports one. Without
 * an `EXA_API_KEY` it answers `WEB_UNAVAILABLE` before any request, and the check goes on with
 * Perpl alone (a step says so).
 */
function exaWeb(apiKey: string): PerpsCheckWeb {
  const exa = new ExaResearch(apiKey);
  return {
    async search(web, query, signal) {
      if (!apiKey) {
        throw new PilotError("WEB_UNAVAILABLE", "Web search is not configured");
      }
      let micros: bigint | null = 0n;
      const search = siteScopedWeb(
        {
          read: (url, s) => exa.read(url, s),
          async search(q, s, domains) {
            const result = await exa.search(q, s, domains);
            const usage = result.usage as { total?: unknown } | number | null;
            const amount =
              typeof usage === "number"
                ? usage
                : typeof usage?.total === "number"
                  ? usage.total
                  : null;
            micros =
              micros === null || amount === null || !Number.isFinite(amount) || amount < 0
                ? null
                : micros + BigInt(Math.ceil(amount * 1_000_000));
            return result;
          },
        },
        web,
        async () => {},
      );
      const result = await search.search(query, signal);
      return { sources: result.sources, costMicros: micros === null ? null : String(micros) };
    },
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
  overrides: { model?: PerpsCheckModel } = {},
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
  const deps: PerpsCheckDependencies = {
    store,
    paper,
    agents: research,
    wallets: custody,
    balances,
    marks,
    market: {
      // No session-wide timer: each Perpl request has the transport's own 10 s timeout, and the
      // session lives within the check's three-minute deadline (`signal`), so a slow read or the
      // model's 20 s never leaves the open's or the close's frame without time.
      async open(scope, signal) {
        const perplSignal = signal;
        const { service } = await createPerplSession(research, scope, perplSignal, {
          schedule,
          sessionLimit: PERPL_CHECK_SESSION_LIMIT,
        });
        const guard = async () => perplSignal.throwIfAborted();
        return {
          read: (symbol: PerpSymbol) =>
            readPerplInstrument(service, symbol, {
              candles: PERPS_CHECK_CANDLES,
              guard,
              prefix: `perpl-${symbol.toLowerCase()}`,
            }),
          async frame(symbol: PerpSymbol) {
            const book = await service.getPerpOrderBook({ symbol, levels: 20 });
            const snapshot = await service.getPerpSnapshot({ symbol });
            return perpsFrame(snapshot, book);
          },
        };
      },
    },
    web: exaWeb(env.EXA_API_KEY ?? ""),
    model:
      overrides.model ??
      createPerpsCheckModel({
        baseUrl: env.MODEL_BASE_URL ?? "",
        model: env.MODEL_ID ?? "",
        apiKey: env.MODEL_API_KEY ?? "",
      }),
  };
  const exitData = new PerplMarketData({ schedule, sessionLimit: PERPL_CHECK_SESSION_LIMIT });
  return {
    store,
    paper,
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
    async check(check, holder, signal) {
      if (check.trigger !== "hourly" && check.trigger !== "manual") {
        throw new PilotError("INVALID_INPUT", "Only hourly and manual checks run");
      }
      return runPerpsCheck(deps, check, holder, signal);
    },
    // The owner's actions (workers/perps-actions.ts) and the Cron's re-drive share this pool.
    owner: new PostgresPerpsOwnerStore(research.pool),
    close: () => research.close(),
  };
}
