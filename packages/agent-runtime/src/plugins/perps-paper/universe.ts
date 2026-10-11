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
  type PerplSocket,
  type PerplStreamEvent,
} from "@pickler/infrastructure/perpl-public";
import {
  acquireUniverse,
  acquireUniverseV2,
  type AcquisitionDiagnostic,
  type UniverseStreamBuffer,
  UNIVERSE_COMPONENT_STREAM_POLICY,
  COMPONENT_PAPER_POLICY,
} from "@pickler/trading/perps";
import { createUniverseStreamReader } from "./universe-stream.js";
export type UniverseAcquisitionPolicy =
  | "rest-universe-20s-v1"
  | "rest-universe-coherent-20s-v2"
  | "stream-universe-20s-v1"
  | typeof UNIVERSE_COMPONENT_STREAM_POLICY
  | typeof COMPONENT_PAPER_POLICY;
/** Private v2 plugin composition: no Mastra tools, model or signer is constructed. */
export function createUniversePerplReader(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & {
    onAcquisition?: (value: AcquisitionDiagnostic) => void;
    acquisitionPolicy?: UniverseAcquisitionPolicy;
    socket?: (url: string) => PerplSocket;
    onStream?: (event: PerplStreamEvent) => void;
    onBuffer?: (value: UniverseStreamBuffer) => void;
  } = {},
) {
  const acquisitionPolicy = options.acquisitionPolicy ?? "rest-universe-20s-v1";
  if (
    ![
      "rest-universe-20s-v1",
      "rest-universe-coherent-20s-v2",
      "stream-universe-20s-v1",
      UNIVERSE_COMPONENT_STREAM_POLICY,
      COMPONENT_PAPER_POLICY,
    ].includes(acquisitionPolicy)
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown universe acquisition policy");
  }
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
  async function sessionData(scope: Scope, signal: AbortSignal, guard?: () => Promise<void>) {
    await check(scope, signal, guard);
    const data = new PerplMarketData({
      ...options,
      schedule,
      retryTransient: true,
      universe: true,
      sessionLimit: 24,
      guard: () => check(scope, signal, guard).then(() => {}),
    });
    const service = await createPerpReadService({ repository: agents, data })(scope, signal);
    return { data, service };
  }
  async function session(scope: Scope, signal: AbortSignal, guard?: () => Promise<void>) {
    return (await sessionData(scope, signal, guard)).service;
  }
  const stream =
    acquisitionPolicy === "stream-universe-20s-v1" ||
    acquisitionPolicy === UNIVERSE_COMPONENT_STREAM_POLICY ||
    acquisitionPolicy === COMPONENT_PAPER_POLICY
      ? createUniverseStreamReader({
          ...options,
          now,
          signal: lifetime.signal,
          check,
          session,
          policy: acquisitionPolicy,
        })
      : undefined;
  return {
    session,
    async read(
      scope: Scope,
      markets: readonly { symbol: PerpSymbol; marketId: number }[],
      parent: AbortSignal,
      guard?: () => Promise<void>,
    ) {
      if (stream) {
        return stream.read(scope, markets, parent, guard);
      }
      const deadlineAt = now() + 20000;
      const timeout = AbortSignal.timeout(20000);
      const signal = AbortSignal.any([parent, lifetime.signal, timeout]);
      const active = await check(scope, signal, guard);
      const { service, data } = await sessionData(scope, signal, guard);
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
      const input = {
        network: active.config.perpl!.network,
        symbols: markets.map((m) => m.symbol),
        now,
        signal,
        guard: () => check(scope, signal, guard).then(() => {}),
        book: (symbol: PerpSymbol) => service.getPerpOrderBook({ symbol }),
        hash,
        ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
      };
      async function snapshots(symbols: readonly PerpSymbol[]) {
        async function batchGuard() {
          const current = await check(scope, signal, guard);
          for (const symbol of symbols) {
            requireTool(current.config, "getPerpSnapshot");
            if (!(current.config.perpl!.markets as readonly string[]).includes(symbol)) {
              throw new PilotError("MARKET_NOT_ALLOWED", "Batch market is not enabled");
            }
          }
          signal.throwIfAborted();
        }
        await batchGuard();
        const result = await data.snapshotBatch(active.config.perpl!.network, symbols, {
          signal,
          guard: batchGuard,
        });
        await batchGuard();
        return result;
      }
      const result =
        acquisitionPolicy === "rest-universe-coherent-20s-v2"
          ? await acquireUniverseV2({
              ...input,
              guard: () => check(scope, parent, guard).then(() => {}),
              deadlineAt,
              snapshots,
              waitUntil: (at: number, s: AbortSignal) => pausePerplRead(Math.max(0, at - now()), s),
            })
          : await acquireUniverse({
              ...input,
              snapshot: (symbol: PerpSymbol) => service.getPerpSnapshot({ symbol }),
              wait: (s) => pausePerplRead(2000, s),
            });
      await check(scope, parent, guard);
      return result;
    },
    async latest(
      scope: Scope,
      markets: readonly { symbol: PerpSymbol; marketId: number }[],
      parent: AbortSignal,
      guard?: () => Promise<void>,
    ) {
      if (!stream) {
        throw new PilotError(
          "INVALID_INPUT",
          "Only explicit WebSocket acquisition has a live buffer",
        );
      }
      return stream.latest(scope, markets, parent, guard);
    },
    async close() {
      closed = true;
      lifetime.abort(new PilotError("DATA_READER_CLOSED", "Universe reader closed"));
      await stream?.close();
    },
  };
}
