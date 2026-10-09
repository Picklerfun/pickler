import { createUniversePerplReader, type UniverseAcquisitionPolicy } from "./universe.js";
import { PerplRequestSchedule, type PerplDataOptions } from "@pickler/infrastructure";
import {
  PilotError,
  requireTool,
  type AgentRecord,
  type Scope,
  type PerpCandles,
  type PerpSymbol,
} from "@pickler/core";
import { transientPerpsData, type AcquisitionDiagnostic } from "@pickler/trading/perps";
import type {
  ProfileStudyData,
  PerpsStudyRecord,
  PerpsEvidence,
} from "@pickler/trading/evaluation";
/** Public-only composition. Sessions share the provider scheduler, not request counters. */
export function createPriorityPerplStudyData(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & {
    onAcquisition?: (e: AcquisitionDiagnostic) => void;
    acquisitionPolicy?: UniverseAcquisitionPolicy;
    onTiming?: (e: {
      version: 1;
      cycle: string;
      operation: string;
      at: number;
      durationMs: number;
    }) => void;
  } = {},
): ProfileStudyData & { close(): Promise<void> } {
  const reader = createUniversePerplReader(agents, {
    ...options,
    schedule: options.schedule ?? new PerplRequestSchedule(),
  });
  const now = options.now ?? Date.now;
  const cache = new Map<string, PerpCandles>();
  const fundingCache = new Map<PerpSymbol, import("@pickler/core").PerpFundingHistory>();
  let prepared:
    | { candles: PerpCandles[]; excluded: { symbol: PerpSymbol; code: string; phase: string }[] }
    | undefined;
  const identity = (r: PerpsStudyRecord) => ({
    tenantId: r.config.tenantId,
    agentId: r.agentIds["sma-reference"]!,
  });
  const config = (r: PerpsStudyRecord) => {
    if (r.config.version !== 7) {
      throw new PilotError("INVALID_INPUT", "Profile configuration required");
    }
    if (
      (r.config.acquisitionPolicy ?? "rest-universe-20s-v1") !==
      (options.acquisitionPolicy ?? "rest-universe-20s-v1")
    ) {
      throw new PilotError("CONFIG_CHANGED", "Reader policy differs from the frozen study");
    }
    return r.config;
  };
  async function prepare(r: PerpsStudyRecord, parent: AbortSignal, guard?: () => Promise<void>) {
    const started = (options.monotonic ?? (() => performance.now()))();
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
    const candles: PerpCandles[] = [],
      excluded: NonNullable<typeof prepared>["excluded"] = [];
    try {
      for (const resolution of [3600, 900, 300] as const) {
        // At most eleven candle requests in each independently bounded public session.
        const service = await reader.session(identity(r), signal, guard);
        const end = Math.floor(now() / (resolution * 1000)) * resolution * 1000;
        for (const market of config(r).markets) {
          await guard?.();
          const agent = await agents.agent(identity(r));
          requireTool(agent.config, "getPerpCandles");
          const key = JSON.stringify([
            agent.version,
            agent.config.perpl,
            market.marketId,
            resolution,
            end,
          ]);
          try {
            let s = cache.get(key);
            if (!s) {
              s = await service.getPerpCandles({
                symbol: market.symbol,
                resolution,
                from: end - 60 * resolution * 1000,
                to: end,
              });
              if (
                s.market.marketId !== market.marketId ||
                s.market.symbol !== market.symbol ||
                s.resolution !== resolution ||
                s.candles.length !== 60 ||
                s.missingOpenTimes.length ||
                s.candles.some(
                  (c, i) => !c.closed || c.openTime !== end - (60 - i) * resolution * 1000,
                )
              ) {
                throw new PilotError(
                  "DATA_UNAVAILABLE",
                  "Sixty original consecutive closed candles required",
                );
              }
              cache.set(key, s);
            }
            await guard?.();
            signal.throwIfAborted();
            candles.push(s);
          } catch (e) {
            parent.throwIfAborted();
            if (signal.aborted) {
              throw new PilotError("DATA_UNAVAILABLE", "Candle preparation deadline exhausted");
            }
            if (!(e instanceof PilotError) || !transientPerpsData(e)) {
              throw e;
            }
            excluded.push({ symbol: market.symbol, code: e.code, phase: `candles-${resolution}` });
          }
        }
      }
      // Bound the cache to the current three windows; no stale-window reuse.
      const ends = new Set(
        [3600, 900, 300].map(
          (resolution) => Math.floor(now() / (resolution * 1000)) * resolution * 1000,
        ),
      );
      for (const key of cache.keys()) {
        if (!ends.has((JSON.parse(key) as unknown[])[4] as number)) {
          cache.delete(key);
        }
      }
      prepared = { candles, excluded };
      return prepared;
    } catch (e) {
      parent.throwIfAborted();
      if (signal.aborted) {
        throw new PilotError("DATA_UNAVAILABLE", "Candle preparation deadline exhausted");
      }
      throw e;
    } finally {
      options.onTiming?.({
        version: 1,
        cycle: `prepare-${r.config.sessionId}-${Math.floor(now() / 60000)}`,
        operation: "candle-preparation",
        at: now(),
        durationMs: (options.monotonic ?? (() => performance.now()))() - started,
      });
    }
  }
  async function capture(
    r: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<PerpsEvidence> {
    const saved = await prepare(r, signal, guard);
    const price = await prices(r, signal, guard);
    const excluded = [...saved.excluded, ...price.excluded];
    // If a boundary crossed during acquisition, do not silently use the previous closed window.
    for (const m of config(r).markets) {
      if (
        [3600, 900, 300].some(
          (res) =>
            !saved.candles.some(
              (s) =>
                s.market.symbol === m.symbol &&
                s.resolution === res &&
                s.candles.at(-1)!.openTime + res * 1000 ===
                  Math.floor(now() / (res * 1000)) * res * 1000,
            ),
        )
      ) {
        excluded.push({
          symbol: m.symbol,
          code: "CANDLE_WINDOW_CHANGED",
          phase: "boundary-validation",
        });
      }
    }
    const bad = new Set(excluded.map((e) => e.symbol));
    return {
      observedAt: now(),
      frames: price.frames.filter((f) => !bad.has(f.snapshot.market.symbol)),
      candles: saved.candles,
      excluded,
      sourceIds: config(r).markets.flatMap((m) => [
        `${m.symbol}:market`,
        `${m.symbol}:book`,
        `${m.symbol}:candles-3600`,
        `${m.symbol}:candles-900`,
        `${m.symbol}:candles-300`,
      ]),
    };
  }
  let closed = false;
  async function prices(r: PerpsStudyRecord, parent: AbortSignal, guard?: () => Promise<void>) {
    try {
      return await reader.read(identity(r), config(r).markets, parent, guard);
    } catch (error) {
      parent.throwIfAborted();
      if (closed) {
        throw new PilotError("DATA_READER_CLOSED", "Priority reader closed");
      }
      if (
        (error instanceof PilotError && error.code === "PERPL_CANCELLED") ||
        (error instanceof DOMException && error.name === "TimeoutError")
      ) {
        throw new PilotError("DATA_UNAVAILABLE", "Price acquisition deadline exhausted");
      }
      throw error;
    }
  }
  let latest: PerpsEvidence | undefined;
  return {
    close: async () => {
      closed = true;
      await reader.close();
    },
    async observe(r, signal, guard) {
      const price = await prices(r, signal, guard);
      // Hourly invalidation can use a still-current cached window. Missing candles never
      // prevent stop/expiry exits; preparation happens only after price maintenance.
      const candles = [...cache.values()].filter(
        (s) =>
          s.candles.at(-1)!.openTime + s.resolution * 1000 ===
          Math.floor(now() / (s.resolution * 1000)) * s.resolution * 1000,
      );
      latest = {
        observedAt: now(),
        frames: price.frames,
        candles,
        excluded: price.excluded,
        sourceIds: [],
      };
      return { frames: price.frames, funding: [], marksOnly: true };
    },
    async prepareEvidence(r, signal, guard) {
      return capture(r, signal, guard);
    },
    async reconcile(r, views, parent, guard) {
      const signal = AbortSignal.any([parent, AbortSignal.timeout(20000)]);
      const funding = [];
      const positions = Object.values(views).flatMap((v) => v!.account.positions);
      const service = await reader.session(identity(r), signal, guard);
      for (const { symbol } of config(r).markets) {
        const held = positions.filter((p) => p.symbol === symbol);
        if (!held.length) {
          continue;
        }
        const from = Math.min(...held.map((p) => p.openedAt));
        const to = held.some((p) => p.closedAt === null)
          ? now()
          : Math.max(...held.map((p) => p.closedAt!));
        try {
          await guard?.();
          let history = fundingCache.get(symbol);
          if (!history || !history.complete || history.from > from || history.to < to - 30000) {
            history = await service.getPerpFundingHistory({
              symbol,
              from: Math.max(0, from - 86400000),
              to: now(),
            });
            fundingCache.set(symbol, history);
          }
          await guard?.();
          signal.throwIfAborted();
          funding.push(history);
        } catch (e) {
          parent.throwIfAborted();
          if (signal.aborted) {
            break;
          }
          if (!(e instanceof PilotError) || !transientPerpsData(e)) {
            throw e;
          }
        }
      }
      return { frames: [], funding };
    },
    async evidence(r, observation, signal, guard) {
      await guard?.();
      signal.throwIfAborted();
      if (!latest) {
        throw new PilotError("DATA_UNAVAILABLE", "Initial capture absent");
      }
      return { ...latest, frames: observation.frames };
    },
    async finalEvidence(r, signal, guard) {
      return capture(r, signal, guard);
    },
    async execution(r, signal, guard) {
      return (await capture(r, signal, guard)).frames;
    },
  };
}
