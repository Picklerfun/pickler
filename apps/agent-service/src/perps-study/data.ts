import { createPerplSession } from "@pickler/agent-runtime/plugins/perpl";
import { PerplRequestSchedule, type PerplDataOptions } from "@pickler/infrastructure";
import {
  createPerpsPaperRuntime,
  createCoherentPerplReader,
} from "@pickler/agent-runtime/plugins/perps-paper";
import { PilotError, type AgentRecord, type Scope, type PerpCandles } from "@pickler/core";
import { type AcquisitionDiagnostic, type PerpsPaperRepository } from "@pickler/trading/perps";
import type { StudyData } from "@pickler/trading/evaluation";
export function createStudyData(
  paper: PerpsPaperRepository,
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (event: AcquisitionDiagnostic) => void } = {},
): StudyData {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  const runtime = createPerpsPaperRuntime(paper, agents, { ...options, schedule });
  let cache: { hour: number; candles: PerpCandles[] } | undefined;
  return {
    observe: async (record, signal, guard) => {
      const active = record.dataPolicy
        ? createPerpsPaperRuntime(paper, agents, {
            ...options,
            schedule,
            coherent: true,
            ...(guard ? { guard } : {}),
          })
        : runtime;
      return active.data.observation(
        { ...record.config, agentId: record.agentIds.rules },
        record.startedAt ?? Date.now(),
        signal,
      );
    },
    async evidence(record, observation, signal, guard) {
      await guard?.();
      const hour = Math.floor(Date.now() / 3600000) * 3600000;
      if (cache?.hour !== hour) {
        const { service } = await createPerplSession(
          agents,
          { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
          signal,
          { ...options, schedule, ...(guard ? { guard } : {}) },
        );
        const candles = [];
        for (const symbol of ["BTC", "ETH"] as const) {
          const series = await service.getPerpCandles({
            symbol,
            resolution: 3600,
            from: hour - 60 * 3600000,
            to: hour,
          });
          if (
            series.candles.filter((c) => c.closed).length !== 60 ||
            series.missingOpenTimes.length
          ) {
            throw new PilotError("INCOMPLETE_CANDLES", "Sixty closed hourly candles required");
          }
          candles.push(series);
        }
        cache = { hour, candles };
      }
      await guard?.();
      return {
        observedAt: Date.now(),
        frames: structuredClone(observation.frames),
        candles: structuredClone(cache.candles),
        sourceIds: [
          "BTC:market",
          "BTC:book",
          "BTC:candles",
          "ETH:market",
          "ETH:book",
          "ETH:candles",
        ],
      };
    },
    async execution(record, signal, guard) {
      if (record.dataPolicy) {
        return createCoherentPerplReader(agents, {
          ...options,
          schedule,
          ...(guard ? { guard } : {}),
        })(
          { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
          ["BTC", "ETH"],
          signal,
        );
      }
      const frames = [];
      for (const symbol of ["BTC", "ETH"] as const) {
        frames.push(
          await runtime.data.frame(
            { ...record.config, agentId: record.agentIds.rules },
            symbol,
            signal,
          ),
        );
      }
      return frames;
    },
  };
}
