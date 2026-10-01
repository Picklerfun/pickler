import { createHash } from "node:crypto";
import {
  createPerpsPaperService,
  type PerpsPaperData,
  type PerpsPaperRepository,
  assertPerpsPaperAgent,
  acquirePerpsFrames,
  type AcquisitionDiagnostic,
  type PerpsDataPolicy,
  validatePaperFrame,
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
  pausePerplRead,
  PerplRequestSchedule,
  PerplPublicStream,
  type PerplStreamEvent,
  type PerplSocket,
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
  options: PerplDataOptions & {
    onAcquisition?: (event: AcquisitionDiagnostic) => void;
    policy?: PerpsDataPolicy;
  } = {},
) {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  return async (scope: Scope, symbols: readonly PerpSymbol[], parent: AbortSignal) => {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 20000);
    const signal = AbortSignal.any([parent, timeout.signal]);
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
        ...(options.policy === "rest-paced-20s-v1"
          ? {
              repeatedTimestampWait: async (
                _symbol: PerpSymbol,
                _component: "book" | "ticker",
                active: AbortSignal,
              ) => {
                await pausePerplRead(2000, active);
                await guard();
              },
            }
          : {}),
        ...(options.onAcquisition ? { diagnostic: options.onAcquisition } : {}),
      });
    };
    try {
      return await abortablePerplRead(operation(), signal);
    } catch (error) {
      parent.throwIfAborted();
      if (
        timeout.signal.aborted ||
        (error instanceof PilotError && error.code === "PERPL_SESSION_LIMIT")
      ) {
        throw new PilotError(
          "DATA_UNAVAILABLE",
          "Public acquisition deadline or request allowance exhausted",
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export interface PerplAcquisitionOptions extends PerplDataOptions {
  policy: PerpsDataPolicy;
  onAcquisition?: (event: AcquisitionDiagnostic) => void;
  onStream?: (event: PerplStreamEvent) => void;
  socket?: (url: string) => PerplSocket;
}
/** One explicitly selected transport for the entire local session; no fallback. */
export function createPerplAcquisitionReader(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplAcquisitionOptions,
) {
  if (!["coherent-20s-v1", "rest-paced-20s-v1", "stream-20s-v1"].includes(options.policy)) {
    throw new PilotError("INVALID_INPUT", "Unknown explicit Perpl acquisition policy");
  }
  options = { ...options, schedule: options.schedule ?? new PerplRequestSchedule() };
  let stream: PerplPublicStream | undefined;
  let frozen: AgentRecord | undefined;
  let owner: Scope | undefined;
  let activeGuard: (() => Promise<void>) | undefined;
  let closed = false;
  const lifetime = new AbortController();
  const now = options.now ?? Date.now;
  async function check(scope: Scope, guard?: () => Promise<void>) {
    lifetime.signal.throwIfAborted();
    if (closed) {
      throw new PilotError("PERPL_STREAM_CLOSED", "Reader closed");
    }
    await options.guard?.();
    await guard?.();
    const current = await agents.agent(scope);
    requireTool(current.config, "getPerpOrderBook");
    requireTool(current.config, "getPerpSnapshot");
    if (
      !current.config.perpl ||
      current.paused ||
      current.id !== scope.agentId ||
      current.tenantId !== scope.tenantId ||
      (frozen &&
        (current.version !== frozen.version ||
          JSON.stringify(current.config.perpl) !== JSON.stringify(frozen.config.perpl))) ||
      (owner && (owner.agentId !== scope.agentId || owner.tenantId !== scope.tenantId))
    ) {
      throw new PilotError("CONFIG_CHANGED", "Acquisition scope changed");
    }
    frozen ??= structuredClone(current);
    owner ??= scope;
    return current;
  }
  return {
    policy: options.policy,
    async read(
      scope: Scope,
      symbols: readonly PerpSymbol[],
      parent: AbortSignal,
      guard?: () => Promise<void>,
      deadlineAt?: number,
    ) {
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(),
        Math.max(1, Math.min(20000, (deadlineAt ?? now() + 20000) - now())),
      );
      const signal = AbortSignal.any([parent, lifetime.signal, timeout.signal]);
      const interrupt = () => {
        lifetime.abort(parent.reason);
        void stream?.close();
      };
      parent.addEventListener("abort", interrupt, { once: true });
      activeGuard = guard;
      const operation = async () => {
        try {
          const initial = await check(scope, guard);
          signal.throwIfAborted();
          if (symbols.some((symbol) => !initial.config.perpl!.markets.includes(symbol))) {
            throw new PilotError("MARKET_NOT_ALLOWED", "Perpl market disabled");
          }
          if (options.policy !== "stream-20s-v1") {
            return await createCoherentPerplReader(agents, {
              ...options,
              guard: async () => {
                await check(scope, guard);
              },
            })(scope, symbols, signal);
          }
          if (!stream) {
            const { service } = await createPerplSession(agents, scope, signal, options);
            const { markets } = await service.listPerpMarkets();
            stream = new PerplPublicStream({
              markets,
              guard: async () => {
                await check(scope, activeGuard);
              },
              signal: lifetime.signal,
              ...(options.socket ? { socket: options.socket } : {}),
              ...(options.onStream ? { event: options.onStream } : {}),
              now,
            });
          }
          let attempt = 0;
          while (!signal.aborted) {
            const frames = [];
            for (const symbol of symbols) {
              await check(scope, guard);
              try {
                const pair = await stream.frame(symbol, signal);
                const frame = {
                  ...pair,
                  hash: createHash("sha256").update(JSON.stringify(pair)).digest("hex"),
                };
                const tickerAt = frame.snapshot.ticker.provenance.providerTimestamp,
                  bookAt = frame.book.provenance.providerTimestamp;
                let code: string | null = null;
                try {
                  validatePaperFrame(frame, initial.config.perpl!.network, symbol, now());
                } catch (e) {
                  if (
                    !(e instanceof PilotError) ||
                    !["STALE_MARKET_DATA", "INCONSISTENT_MARKET_DATA"].includes(e.code)
                  ) {
                    throw e;
                  }
                  code = e.code;
                }
                options.onAcquisition?.({
                  symbol,
                  attempt: ++attempt,
                  at: now(),
                  tickerAt,
                  bookAt,
                  skewMs: tickerAt === null || bookAt === null ? null : Math.abs(tickerAt - bookAt),
                  code,
                });
                if (!code) {
                  frames.push(frame);
                }
              } catch (e) {
                if (
                  !(e instanceof PilotError) ||
                  !["DATA_UNAVAILABLE", "PERPL_TRANSPORT_FAILURE"].includes(e.code)
                ) {
                  throw e;
                }
              }
            }
            await check(scope, guard);
            signal.throwIfAborted();
            if (frames.length === symbols.length) {
              const reference = now();
              for (const frame of frames) {
                validatePaperFrame(
                  frame,
                  initial.config.perpl!.network,
                  frame.snapshot.market.symbol,
                  reference,
                );
              }
              return frames;
            }
            await pausePerplRead(250, signal);
          }
          signal.throwIfAborted();
          throw new PilotError("DATA_UNAVAILABLE", "Public acquisition expired");
        } catch (e) {
          parent.throwIfAborted();
          if (timeout.signal.aborted) {
            throw new PilotError("DATA_UNAVAILABLE", "Joint acquisition deadline exhausted");
          }
          if (
            !(e instanceof PilotError) ||
            !["DATA_UNAVAILABLE", "PERPL_TRANSPORT_FAILURE"].includes(e.code)
          ) {
            lifetime.abort(e);
            await stream?.close();
          }
          throw e;
        }
      };
      try {
        return await abortablePerplRead(operation(), signal);
      } catch (error) {
        parent.throwIfAborted();
        if (timeout.signal.aborted) {
          throw new PilotError("DATA_UNAVAILABLE", "Joint acquisition deadline exhausted");
        }
        throw error;
      } finally {
        clearTimeout(timer);
        parent.removeEventListener("abort", interrupt);
      }
    },
    async latest(
      scope: Scope,
      symbols: readonly PerpSymbol[],
      signal: AbortSignal,
      guard?: () => Promise<void>,
    ) {
      await check(scope, guard);
      signal.throwIfAborted();
      if (options.policy !== "stream-20s-v1" || !stream) {
        throw new PilotError(
          "INVALID_INPUT",
          "Latest buffer only exists for explicit WebSocket transport",
        );
      }
      const frames = [];
      for (const symbol of symbols) {
        const pair = await stream.frame(symbol, signal);
        frames.push({
          ...pair,
          hash: createHash("sha256").update(JSON.stringify(pair)).digest("hex"),
        });
      }
      await check(scope, guard);
      return frames;
    },
    async close() {
      closed = true;
      lifetime.abort();
      await stream?.close();
    },
  };
}
