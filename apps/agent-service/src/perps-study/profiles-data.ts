import { createUniversePerplReader } from "@pickler/agent-runtime/plugins/perps-paper";
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
export function createProfileStudyData(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (e: AcquisitionDiagnostic) => void } = {},
): ProfileStudyData & { close(): Promise<void> } {
  const reader = createUniversePerplReader(agents, {
    ...options,
    schedule: options.schedule ?? new PerplRequestSchedule(),
  });
  const cache = new Map<string, PerpCandles>();
  let prepared:
    | { candles: PerpCandles[]; excluded: { symbol: PerpSymbol; code: string; phase: string }[] }
    | undefined;
  const identity = (r: PerpsStudyRecord) => ({
    tenantId: r.config.tenantId,
    agentId: r.agentIds["hourly-legacy"]!,
  });
  const config = (r: PerpsStudyRecord) => {
    if (r.config.version !== 6) {
      throw new PilotError("INVALID_INPUT", "Profile configuration required");
    }
    return r.config;
  };
  async function prepare(r: PerpsStudyRecord, parent: AbortSignal, guard?: () => Promise<void>) {
    const signal = AbortSignal.any([parent, AbortSignal.timeout(60000)]);
    const candles: PerpCandles[] = [],
      excluded: NonNullable<typeof prepared>["excluded"] = [];
    try {
      for (const resolution of [3600, 900, 300] as const) {
        // At most eleven candle requests in each independently bounded public session.
        const service = await reader.session(identity(r), signal, guard);
        const end = Math.floor(Date.now() / (resolution * 1000)) * resolution * 1000;
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
          (resolution) => Math.floor(Date.now() / (resolution * 1000)) * resolution * 1000,
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
    }
  }
  async function capture(
    r: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ): Promise<PerpsEvidence> {
    const saved = await prepare(r, signal, guard);
    const price = await reader.read(identity(r), config(r).markets, signal, guard);
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
                  Math.floor(Date.now() / (res * 1000)) * res * 1000,
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
      observedAt: Date.now(),
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
  let latest: PerpsEvidence | undefined;
  return {
    close: () => reader.close(),
    async observe(r, signal, guard) {
      // Funding comes before the bounded fresh price capture, never after it.
      const service = await reader.session(identity(r), signal, guard),
        funding = [];
      const to = Date.now(),
        from = Math.max(0, (r.startedAt ?? to) - 86400000);
      for (const { symbol } of config(r).markets) {
        try {
          funding.push(await service.getPerpFundingHistory({ symbol, from, to }));
        } catch (e) {
          signal.throwIfAborted();
          if (!(e instanceof PilotError) || !transientPerpsData(e)) {
            throw e;
          }
        }
      }
      latest = await capture(r, signal, guard);
      return { frames: latest.frames, funding };
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
