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
  PaperFundingEpochs,
  PostgresPerpsRuntimeStore,
  PostgresResearchStore,
  createAusdBalanceReader,
  createPaperFundingAnchor,
  createPerplMarketBoard,
  type DatabaseConnectionOptions,
} from "@pickler/infrastructure";
import type { PerpsPaperMark, PerpsPaperScope } from "@pickler/trading/perps";
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
        /^[A-Z0-9][A-Z0-9._-]{0,31}(?![\s\S])/.test(market.base) &&
        markets.filter((row) => row.base === market.base).length === 1 &&
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
  const runtime: PerpsBackground & PerpsActionsBackground = {
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
    async exitFrame(network, symbol, signal, market) {
      const data = market
        ? new PerplMarketData({
            schedule,
            sessionLimit: PERPL_CHECK_SESSION_LIMIT,
            positionMarkets: [market],
          })
        : exitData;
      const ctx = {
        signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
        guard: async () => {},
      };
      const book = await data.book(network, symbol, 20, ctx);
      const snapshot = await data.snapshot(network, symbol, ctx);
      return perpsFrame(snapshot, book);
    },
    async funding(network, symbol, from, to, signal, market) {
      const data = market
        ? new PerplMarketData({
            schedule,
            sessionLimit: PERPL_CHECK_SESSION_LIMIT,
            positionMarkets: [market],
          })
        : exitData;
      return data.funding(
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
    async auditFunding(signal) {
      const next = await research.pool
        .query(`SELECT a.id,a.tenant_id AS "tenantId",a.agent_id AS "agentId",a.session_id AS "sessionId",a.network
        FROM pickler.perps_paper_accounts a JOIN pickler.paper_storage s ON s.account_id=a.id
        WHERE a.session_id='product' AND s.mode='operational'
          AND a.document->>'fundingDisputed' IS DISTINCT FROM 'true'
          AND NOT EXISTS(SELECT 1 FROM pickler.paper_funding_epochs e WHERE e.account_id=a.id AND e.owner IS NOT NULL AND e.expires_at>floor(extract(epoch FROM clock_timestamp())*1000))
          AND (s.coverage_required>s.coverage_complete
            OR EXISTS(SELECT 1 FROM pickler.paper_funding_epochs e WHERE e.account_id=a.id AND e.status IN ('pending','running'))
            OR NOT EXISTS(SELECT 1 FROM pickler.paper_funding_epochs e WHERE e.account_id=a.id AND e.status='committed' AND e.committed_at>floor(extract(epoch FROM clock_timestamp())*1000)-86400000))
          AND EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=a.id AND p.closed_at IS NOT NULL)
        ORDER BY s.audit_at,a.id LIMIT 1`);
      const scope = next.rows[0] as PerpsPaperScope | undefined;
      if (!scope || !runtime.funding) {
        return;
      }
      await research.pool.query(
        "UPDATE pickler.paper_storage SET audit_at=floor(extract(epoch FROM clock_timestamp())*1000) WHERE account_id=$1",
        [next.rows[0].id],
      );
      let requests = 0;
      const reserve = (count: number) => {
        if (requests + count > PERPL_CHECK_SESSION_LIMIT) {
          throw new PilotError(
            "PERPL_SESSION_LIMIT",
            "Historical audit reached its public request budget",
          );
        }
        requests += count;
      };
      const deadline = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
      const verify = createPaperFundingAnchor({
        chainId: scope.network === "testnet" ? 10143 : 143,
        ...(env.MONAD_RPC_URL ? { rpcUrl: env.MONAD_RPC_URL } : {}),
        signal: deadline,
        beforeRpc: reserve,
      });
      await new PaperFundingEpochs(research.pool).pass(
        scope,
        async (position, from, to) => {
          const data = new PerplMarketData({
            schedule,
            sessionLimit: PERPL_CHECK_SESSION_LIMIT,
            ...(position.market ? { positionMarkets: [position.market] } : {}),
            transport: async (input, init) => {
              reserve(1);
              return fetch(input, init);
            },
          });
          return data.funding(
            scope.network,
            {
              symbol: position.symbol,
              from: Math.max(0, from - (position.market?.fundingIntervalSeconds ?? 0) * 1000),
              to,
            },
            {
              signal: deadline,
              guard: async () => {
                deadline.throwIfAborted();
              },
            },
          );
        },
        verify,
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
  return runtime;
}
