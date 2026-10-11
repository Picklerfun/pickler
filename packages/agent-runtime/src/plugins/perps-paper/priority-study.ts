import { createUniversePerplReader, type UniverseAcquisitionPolicy } from "./universe.js";
import {
  PerplRequestSchedule,
  type PerplDataOptions,
  type PerplSocket,
  type PerplStreamEvent,
} from "@pickler/infrastructure/perpl-public";
import {
  PilotError,
  requireTool,
  type AgentRecord,
  type Scope,
  type PerpCandles,
  type PerpSymbol,
} from "@pickler/core";
import {
  analyzePts,
  ptsConfigVersion,
  ptsTemporalProfile,
  type PerpsPtsConfig,
  type PtsHistory,
} from "@pickler/trading/pts";
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
    initialHistory?: PtsHistory[];
    preparedPtsSymbols?: readonly PerpSymbol[];
    onHistoryRevision?: (event: {
      symbol: string;
      resolution: number;
      openTime: number;
      previous: unknown;
      current: unknown;
    }) => void;
    onAcquisition?: (e: AcquisitionDiagnostic) => void;
    acquisitionPolicy?: UniverseAcquisitionPolicy;
    socket?: (url: string) => PerplSocket;
    onStream?: (event: PerplStreamEvent) => void;
    onBuffer?: (value: import("@pickler/trading/perps").UniverseStreamBuffer) => void;
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
  const histories = new Map(
    (options.initialHistory ?? [])
      .filter(
        (h) => !options.preparedPtsSymbols || options.preparedPtsSymbols.includes(h.market.symbol),
      )
      .flatMap((h) =>
        h.series.map(
          (s) => [JSON.stringify([h.market.symbol, s.resolution]), structuredClone(s)] as const,
        ),
      ),
  );
  const fundingCache = new Map<PerpSymbol, import("@pickler/core").PerpFundingHistory>();
  let prepared:
    | { candles: PerpCandles[]; excluded: { symbol: PerpSymbol; code: string; phase: string }[] }
    | undefined;
  const identity = (r: PerpsStudyRecord) => ({
    tenantId: r.config.tenantId,
    agentId: r.agentIds["sma-reference"]!,
  });
  const config = (r: PerpsStudyRecord) => {
    if (r.config.version !== 7 && r.config.version !== 8 && r.config.version !== 9) {
      throw new PilotError("INVALID_INPUT", "Profile configuration required");
    }
    if (
      (r.config.acquisitionPolicy ?? "rest-universe-20s-v1") !==
      (options.acquisitionPolicy ?? "rest-universe-20s-v1")
    ) {
      throw new PilotError("CONFIG_CHANGED", "Reader policy differs from the frozen study");
    }
    const markets = r.config.markets;

    if (
      options.preparedPtsSymbols !== undefined &&
      (r.config.version !== 9 ||
        new Set(options.preparedPtsSymbols).size !== options.preparedPtsSymbols.length ||
        options.preparedPtsSymbols.some((symbol) => !markets.some((m) => m.symbol === symbol)))
    ) {
      throw new PilotError(
        "CONFIG_CHANGED",
        "Prepared PTS cohort differs from the frozen universe",
      );
    }
    return r.config;
  };
  async function prepare(r: PerpsStudyRecord, parent: AbortSignal, guard?: () => Promise<void>) {
    const started = (options.monotonic ?? (() => performance.now()))();
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
    const settings = config(r);
    const omitted = new Set(
      options.preparedPtsSymbols === undefined
        ? []
        : settings.markets
            .filter((m) => !options.preparedPtsSymbols!.includes(m.symbol))
            .map((m) => m.symbol),
    );
    const candles: PerpCandles[] = [],
      excluded: NonNullable<typeof prepared>["excluded"] = settings.markets
        .filter((m) => omitted.has(m.symbol))
        .map((m) => ({
          symbol: m.symbol,
          code: "PTS_PREPARATION_NOT_ELIGIBLE",
          phase: "pts-history",
        }));
    try {
      const resolutions =
        r.config.version === 8 || r.config.version === 9
          ? ([3600, 900, 300, 14400, 86400] as const)
          : ([3600, 900, 300] as const);
      const requiredResolutions =
        settings.version === 9
          ? resolutions.filter(
              (resolution) =>
                resolution === 3600 ||
                resolution === 900 ||
                resolution === 300 ||
                ptsTemporalProfile(ptsConfigVersion(settings)).native.includes(resolution),
            )
          : resolutions;
      for (const resolution of requiredResolutions) {
        // At most eleven candle requests in each independently bounded public session.
        const service = await reader.session(identity(r), signal, guard);
        const end = Math.floor(now() / (resolution * 1000)) * resolution * 1000;
        const tailCount =
          settings.version === 9 && resolution === 86400
            ? Math.min(60, ptsTemporalProfile(ptsConfigVersion(settings)).minimum["1d"] ?? 60)
            : 60;
        for (const market of settings.markets) {
          if (omitted.has(market.symbol)) {
            continue;
          }
          await guard?.();
          const agent = await agents.agent(identity(r));
          requireTool(agent.config, "getPerpCandles");
          const key = JSON.stringify([
            agent.version,
            agent.config.perpl,
            market.marketId,
            resolution,
            end,
            ...(settings.version === 9 ? [settings.protocol, tailCount] : []),
          ]);
          try {
            let s = cache.get(key);
            if (!s) {
              const original =
                r.config.version === 8 || r.config.version === 9
                  ? histories.get(JSON.stringify([market.symbol, resolution]))
                  : undefined;
              if (
                original &&
                original.to === end &&
                original.market.marketId === market.marketId &&
                original.candles
                  .slice(-tailCount)
                  .every(
                    (c, i) => c.closed && c.openTime === end - (tailCount - i) * resolution * 1000,
                  )
              ) {
                s = {
                  ...original,
                  from: end - tailCount * resolution * 1000,
                  candles: original.candles.slice(-tailCount),
                  missingOpenTimes: [],
                };
              } else {
                s = await service.getPerpCandles({
                  symbol: market.symbol,
                  resolution,
                  from: end - tailCount * resolution * 1000,
                  to: end,
                });
              }
              if (
                s.market.marketId !== market.marketId ||
                s.market.symbol !== market.symbol ||
                s.resolution !== resolution ||
                s.candles.length !== tailCount ||
                s.missingOpenTimes.length ||
                s.candles.some(
                  (c, i) => !c.closed || c.openTime !== end - (tailCount - i) * resolution * 1000,
                )
              ) {
                throw new PilotError(
                  "DATA_UNAVAILABLE",
                  tailCount === 60
                    ? "Sixty original consecutive closed candles required"
                    : "Frozen intraday daily minimum of consecutive closed candles required",
                );
              }
              cache.set(key, s);
            }
            await guard?.();
            signal.throwIfAborted();
            if (
              (r.config.version === 8 || r.config.version === 9) &&
              ptsTemporalProfile(ptsConfigVersion(r.config as PerpsPtsConfig)).native.includes(
                resolution,
              )
            ) {
              const historyKey = JSON.stringify([market.symbol, resolution]);
              const original = histories.get(historyKey);
              if (!original || original.market.marketId !== s.market.marketId) {
                excluded.push({
                  symbol: market.symbol,
                  code: "INSUFFICIENT_HISTORY",
                  phase: "pts-history",
                });
              } else {
                const bars = new Map(original.candles.map((c) => [c.openTime, c]));
                for (const current of s.candles) {
                  const previous = bars.get(current.openTime);
                  if (previous && JSON.stringify(previous) !== JSON.stringify(current)) {
                    options.onHistoryRevision?.({
                      symbol: market.symbol,
                      resolution,
                      openTime: current.openTime,
                      previous,
                      current,
                    });
                  }
                  bars.set(current.openTime, current);
                }
                const combined = {
                  ...s,
                  from: original.from,
                  candles: [...bars.values()].sort((a, b) => a.openTime - b.openTime),
                };
                combined.missingOpenTimes = [];
                const times = new Set(combined.candles.map((c) => c.openTime));
                for (let t = combined.from; t < combined.to; t += resolution * 1000) {
                  if (!times.has(t)) {
                    combined.missingOpenTimes.push(t);
                  }
                }
                histories.set(historyKey, combined);
                s = combined;
              }
            }
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
        (r.config.version === 8 || r.config.version === 9
          ? [3600, 900, 300, 14400, 86400]
          : [3600, 900, 300]
        ).map((resolution) => Math.floor(now() / (resolution * 1000)) * resolution * 1000),
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
      if (r.config.version === 9 && excluded.some((e) => e.symbol === m.symbol)) {
        continue;
      }
      if (
        (r.config.version === 8 || r.config.version === 9
          ? [3600, 900, 300, 14400, 86400]
          : [3600, 900, 300]
        ).some(
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
    if (r.config.version === 8 || r.config.version === 9) {
      for (const market of config(r).markets) {
        if (r.config.version === 9 && excluded.some((e) => e.symbol === market.symbol)) {
          continue;
        }
        const own = saved.candles.filter((c) => c.market.symbol === market.symbol);
        const info = own[0]?.market;
        if (
          !info ||
          analyzePts(
            { market: info, series: own, capturedAt: now() },
            now(),
            ptsConfigVersion(r.config as PerpsPtsConfig),
          ).coverage.some((c) => !c.eligible)
        ) {
          excluded.push({
            symbol: market.symbol,
            code: "INSUFFICIENT_HISTORY",
            phase: "pts-coverage",
          });
        }
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
      const candles = [
        ...(r.config.version === 8 || r.config.version === 9 ? histories.values() : cache.values()),
      ].filter(
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
