import { createPerplSession } from "@pickler/agent-runtime/plugins/perpl";
import { createPerpsPaperRuntime } from "@pickler/agent-runtime/plugins/perps-paper";
import { PilotError, type AgentRecord, type Scope, type PerpCandles } from "@pickler/core";
import { type PerpsPaperRepository } from "@pickler/trading/perps";
import type { StudyData } from "@pickler/trading/evaluation";
export function createStudyData(
  paper: PerpsPaperRepository,
  agents: { agent(scope: Scope): Promise<AgentRecord> },
): StudyData {
  const runtime = createPerpsPaperRuntime(paper, agents);
  let cache: { hour: number; candles: PerpCandles[] } | undefined;
  return {
    observe: (record, signal) =>
      runtime.data.observation(
        { ...record.config, agentId: record.agentIds.rules },
        record.startedAt ?? Date.now(),
        signal,
      ),
    async evidence(record, observation, signal) {
      const hour = Math.floor(Date.now() / 3600000) * 3600000;
      if (cache?.hour !== hour) {
        const { service } = await createPerplSession(
          agents,
          { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
          signal,
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
    async execution(record, signal) {
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
