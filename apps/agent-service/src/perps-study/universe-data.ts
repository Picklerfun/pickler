import { createUniversePerplReader } from "@pickler/agent-runtime/plugins/perps-paper";
import { PerplRequestSchedule, type PerplDataOptions } from "@pickler/infrastructure";
import {
  PilotError,
  requireTool,
  type AgentRecord,
  type Scope,
  type PerpCandles,
} from "@pickler/core";
import { type AcquisitionDiagnostic, transientPerpsData } from "@pickler/trading/perps";
import type {
  StudyData,
  PerpsSmaUniverseConfig,
  PerpsStudyRecord,
} from "@pickler/trading/evaluation";
export function createUniverseStudyData(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (e: AcquisitionDiagnostic) => void } = {},
): StudyData & { close(): Promise<void> } {
  const reader = createUniversePerplReader(agents, {
    ...options,
    schedule: options.schedule ?? new PerplRequestSchedule(),
  });
  let cache:
    | {
        hour: number;
        candles: PerpCandles[];
        excluded: { symbol: import("@pickler/core").PerpSymbol; code: string; phase: string }[];
      }
    | undefined;
  let acquisitionExclusions: NonNullable<typeof cache>["excluded"] | undefined;
  const identity = (record: PerpsStudyRecord) => ({
    tenantId: record.config.tenantId,
    agentId: record.agentIds.rules!,
  });
  const config = (record: PerpsStudyRecord) => {
    if (record.config.version !== 5) {
      throw new PilotError("INVALID_INPUT", "Universe configuration required");
    }
    return record.config as PerpsSmaUniverseConfig;
  };
  async function candles(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ) {
    const hour = Math.floor(Date.now() / 3600000) * 3600000;
    await guard?.();
    if (cache?.hour === hour) {
      await reader.session(identity(record), signal, guard);
      requireTool((await agents.agent(identity(record))).config, "getPerpCandles");
      return cache;
    }
    const service = await reader.session(identity(record), signal, guard);
    const series: PerpCandles[] = [],
      excluded: NonNullable<typeof cache>["excluded"] = [];
    for (const { symbol } of config(record).markets) {
      try {
        const s = await service.getPerpCandles({
          symbol,
          resolution: 3600,
          from: hour - 60 * 3600000,
          to: hour,
        });
        if (
          s.candles.length !== 60 ||
          s.missingOpenTimes.length ||
          s.candles.some((c, i) => !c.closed || c.openTime !== hour - (60 - i) * 3600000)
        ) {
          throw new PilotError(
            "DATA_UNAVAILABLE",
            "Sixty closed consecutive hourly candles required",
          );
        }
        series.push(s);
      } catch (e) {
        signal.throwIfAborted();
        if (
          !(e instanceof PilotError) ||
          (!transientPerpsData(e) &&
            !["PERPL_INVALID_RESPONSE", "PERPL_MARKET_IDENTITY"].includes(e.code))
        ) {
          throw e;
        }
        excluded.push({ symbol, code: e.code, phase: "candles" });
      }
    }
    cache = { hour, candles: series, excluded };
    return cache;
  }
  async function frames(
    record: PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ) {
    const result = await reader.read(identity(record), config(record).markets, signal, guard);
    acquisitionExclusions = result.excluded;
    return result.frames;
  }
  return {
    close: () => reader.close(),
    async observe(record, signal, guard) {
      // Prepare slower evidence/funding first, preserving every original provider timestamp.
      await candles(record, signal, guard);
      const service = await reader.session(identity(record), signal, guard);
      const to = Date.now(),
        from = Math.max(0, (record.startedAt ?? to) - 86400000);
      const funding = [];
      for (const { symbol } of config(record).markets) {
        try {
          funding.push(await service.getPerpFundingHistory({ symbol, from, to }));
        } catch (e) {
          signal.throwIfAborted();
          if (!(e instanceof PilotError) || !transientPerpsData(e)) {
            throw e;
          }
        }
      }
      return { frames: await frames(record, signal, guard), funding };
    },
    async evidence(record, observation, signal, guard) {
      const saved = await candles(record, signal, guard);
      await guard?.();
      const excluded = [...saved.excluded, ...(acquisitionExclusions ?? [])];
      const invalid = new Set(excluded.map((e) => e.symbol));
      return {
        observedAt: Date.now(),
        frames: observation.frames.filter((f) => !invalid.has(f.snapshot.market.symbol)),
        candles: saved.candles,
        sourceIds: config(record).markets.flatMap((m) => [
          `${m.symbol}:market`,
          `${m.symbol}:book`,
          `${m.symbol}:candles`,
        ]),
        excluded,
      };
    },
    async execution(record, signal, guard) {
      return frames(record, signal, guard);
    },
  };
}
