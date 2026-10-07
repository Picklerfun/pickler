import { createHash } from "node:crypto";
import {
  createPerpReadService,
  PilotError,
  requireTool,
  type AgentRecord,
  type Scope,
  type PerpSymbol,
} from "@pickler/core";
import {
  PerplMarketData,
  PerplRequestSchedule,
  pausePerplRead,
  type PerplDataOptions,
} from "@pickler/infrastructure";
import { acquireUniverse, type AcquisitionDiagnostic } from "@pickler/trading/perps";
/** Private v2 plugin composition: no Mastra tools, model or signer is constructed. */
export function createUniversePerplReader(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (value: AcquisitionDiagnostic) => void } = {},
) {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  let frozen: AgentRecord | undefined;
  let closed = false;
  const lifetime = new AbortController();
  const now = options.now ?? Date.now;
  const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  async function check(scope: Scope, signal: AbortSignal, guard?: () => Promise<void>) {
    signal.throwIfAborted();
    lifetime.signal.throwIfAborted();
    if (closed) {
      throw new PilotError("DATA_READER_CLOSED", "Universe reader closed");
    }
    await guard?.();
    const agent = await agents.agent(scope);
    if (
      agent.id !== scope.agentId ||
      agent.tenantId !== scope.tenantId ||
      agent.paused ||
      agent.config.perpl?.version !== 2 ||
      (frozen &&
        (frozen.id !== agent.id ||
          frozen.tenantId !== agent.tenantId ||
          frozen.version !== agent.version ||
          JSON.stringify(frozen.config.perpl) !== JSON.stringify(agent.config.perpl)))
    ) {
      throw new PilotError("CONFIG_CHANGED", "Universe scope or permissions changed");
    }
    requireTool(agent.config, "getPerpSnapshot");
    requireTool(agent.config, "getPerpOrderBook");
    frozen ??= structuredClone(agent);
    return agent;
  }
  async function session(scope: Scope, signal: AbortSignal, guard?: () => Promise<void>) {
    await check(scope, signal, guard);
    return createPerpReadService({
      repository: agents,
      data: new PerplMarketData({
        ...options,
        schedule,
        retryTransient: true,
        universe: true,
        sessionLimit: 24,
        guard: () => check(scope, signal, guard).then(() => {}),
      }),
    })(scope, signal);
  }
  return {
    session,
    async read(
      scope: Scope,
      markets: readonly { symbol: PerpSymbol; marketId: number }[],
      parent: AbortSignal,
      guard?: () => Promise<void>,
    ) {
      const timeout = AbortSignal.timeout(20000);
      const signal = AbortSignal.any([parent, lifetime.signal, timeout]);
      const active = await check(scope, signal, guard);
      const service = await session(scope, signal, guard);
      const listed = await service.listPerpMarkets();
      if (
        markets.some(
          (m) =>
            !listed.markets.some(
              (v) =>
                v.symbol === m.symbol &&
                v.marketId === m.marketId &&
                v.collateral.symbol === "AUSD",
            ),
        )
      ) {
        throw new PilotError("PERPL_MARKET_IDENTITY", "Frozen universe catalog changed");
      }
      const result = await acquireUniverse({
        network: active.config.perpl!.network,
        symbols: markets.map((m) => m.symbol),
        now,
        signal,
        guard: () => check(scope, signal, guard).then(() => {}),
        snapshot: (symbol) => service.getPerpSnapshot({ symbol }),
        book: (symbol) => service.getPerpOrderBook({ symbol }),
        hash,
        wait: (s) => pausePerplRead(2000, s),
        ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
      });
      await check(scope, parent, guard);
      return result;
    },
    async close() {
      closed = true;
      lifetime.abort(new PilotError("DATA_READER_CLOSED", "Universe reader closed"));
    },
  };
}
