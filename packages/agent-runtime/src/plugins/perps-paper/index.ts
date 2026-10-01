import { createHash } from "node:crypto";
import {
  createPerpsPaperService,
  type PerpsPaperData,
  type PerpsPaperRepository,
  assertPerpsPaperAgent,
  acquirePerpsFrames,
  type AcquisitionDiagnostic,
} from "@pickler/trading/perps";
import {
  requireTool,
  PilotError,
  type AgentRecord,
  type Scope,
  type PerpSymbol,
} from "@pickler/core";
import { createPerplSession } from "../perpl/index.js";
import {
  abortablePerplRead,
  PerplRequestSchedule,
  type PerplDataOptions,
} from "@pickler/infrastructure";
/** Operator-only simulator. No Mastra trading tool or signer is exposed. */
export function createPerpsPaperRuntime(
  repository: PerpsPaperRepository,
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & {
    coherent?: boolean;
    onAcquisition?: (event: AcquisitionDiagnostic) => void;
  } = {},
) {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  const coherent = createCoherentPerplReader(agents, { ...options, schedule });
  const data: PerpsPaperData = {
    async frame(scope, symbol, signal) {
      if (options.coherent) {
        return (await coherent(scope, [symbol], signal))[0]!;
      }
      const view = await repository.view(scope);
      assertPerpsPaperAgent(await agents.agent(scope), scope, view.account.agentVersion);
      const { service } = await createPerplSession(agents, scope, signal, { ...options, schedule });
      const book = await service.getPerpOrderBook({ symbol });
      const snapshot = await service.getPerpSnapshot({ symbol });
      return {
        snapshot,
        book,
        hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
      };
    },
    async observation(scope, from, signal) {
      const view = await repository.view(scope);
      const agent = await agents.agent(scope);
      assertPerpsPaperAgent(agent, scope, view.account.agentVersion);
      const { service } = await createPerplSession(agents, scope, signal, { ...options, schedule });
      const frames = options.coherent
        ? await coherent(scope, agent.config.perpl!.markets, signal)
        : [];
      const funding = [];
      for (const symbol of agent.config.perpl!.markets) {
        if (!options.coherent) {
          const book = await service.getPerpOrderBook({ symbol });
          const snapshot = await service.getPerpSnapshot({ symbol });
          frames.push({
            snapshot,
            book,
            hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
          });
        }
        const snapshot = frames.find((frame) => frame.snapshot.market.symbol === symbol)!.snapshot;
        {
          funding.push(
            await service.getPerpFundingHistory({
              symbol,
              from: Math.max(0, from - snapshot.market.fundingIntervalSeconds * 1000),
              to: options.now?.() ?? Date.now(),
            }),
          );
        }
      }
      return { frames, funding };
    },
  };
  return { service: createPerpsPaperService(repository, data, options.now), data };
}

/** Shared acquisition without accounts, models, or execution capabilities. */
export function createCoherentPerplReader(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (event: AcquisitionDiagnostic) => void } = {},
) {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  return async (scope: Scope, symbols: readonly PerpSymbol[], parent: AbortSignal) => {
    const timeout = AbortSignal.timeout(20000);
    const signal = AbortSignal.any([parent, timeout]);
    const operation = async () => {
      const initial = await agents.agent(scope);
      const guard = async () => {
        signal.throwIfAborted();
        await options.guard?.();
        const current = await agents.agent(scope);
        requireTool(current.config, "getPerpOrderBook");
        requireTool(current.config, "getPerpSnapshot");
        if (
          current.tenantId !== scope.tenantId ||
          current.id !== scope.agentId ||
          current.paused ||
          current.version !== initial.version
        ) {
          throw new PilotError("CONFIG_CHANGED", "Perpl permissions changed");
        }
        signal.throwIfAborted();
      };
      const { service } = await createPerplSession(agents, scope, signal, {
        ...options,
        schedule,
        guard,
        retryTransient: true,
      });
      return await acquirePerpsFrames({
        network: initial.config.perpl!.network,
        symbols,
        signal,
        now: options.now ?? Date.now,
        guard,
        book: (symbol) => service.getPerpOrderBook({ symbol }),
        snapshot: (symbol) => service.getPerpSnapshot({ symbol }),
        hash: (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex"),
        ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
      });
    };
    try {
      return await abortablePerplRead(operation(), signal);
    } catch (error) {
      parent.throwIfAborted();
      if (
        timeout.aborted ||
        (error instanceof PilotError && error.code === "PERPL_SESSION_LIMIT")
      ) {
        throw new PilotError(
          "DATA_UNAVAILABLE",
          "Public acquisition deadline or request allowance exhausted",
        );
      }
      throw error;
    }
  };
}
