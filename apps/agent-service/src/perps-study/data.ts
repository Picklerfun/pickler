import { createPerplSession } from "@pickler/agent-runtime/plugins/perpl";
import { PerplRequestSchedule, type PerplDataOptions } from "@pickler/infrastructure";
import {
  createPerpsPaperRuntime,
  createPerplAcquisitionReader,
} from "@pickler/agent-runtime/plugins/perps-paper";
import { PilotError, type AgentRecord, type Scope, type PerpCandles } from "@pickler/core";
import { type AcquisitionDiagnostic, type PerpsPaperRepository } from "@pickler/trading/perps";
import type { StudyData } from "@pickler/trading/evaluation";
export function createStudyData(
  paper: PerpsPaperRepository,
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  options: PerplDataOptions & { onAcquisition?: (event: AcquisitionDiagnostic) => void } = {},
): StudyData & { close(): Promise<void> } {
  const schedule = options.schedule ?? new PerplRequestSchedule();
  const runtime = createPerpsPaperRuntime(paper, agents, { ...options, schedule });
  let reader: ReturnType<typeof createPerplAcquisitionReader> | undefined;
  let readerPolicy: string | undefined;
  const read = (
    record: import("@pickler/trading/evaluation").PerpsStudyRecord,
    signal: AbortSignal,
    guard?: () => Promise<void>,
  ) => {
    const policy = record.dataPolicy ?? "coherent-20s-v1";
    if (readerPolicy && policy !== readerPolicy) {
      throw new PilotError("CONFIG_CHANGED", "Transport is frozen for this session");
    }
    readerPolicy = policy;
    reader ??= createPerplAcquisitionReader(agents, { ...options, schedule, policy });
    return reader.read(
      { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
      ["BTC", "ETH"],
      signal,
      guard,
    );
  };
  const cache = new Map<string, PerpCandles>();
  return {
    close: async () => {
      await reader?.close();
    },
    observe: async (record, signal, guard) => {
      if (!record.dataPolicy) {
        return runtime.data.observation(
          { ...record.config, agentId: record.agentIds.rules },
          record.startedAt ?? Date.now(),
          signal,
        );
      }
      const frames = await read(record, signal, guard);
      const { service } = await createPerplSession(
        agents,
        { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
        signal,
        { ...options, schedule, ...(guard ? { guard } : {}) },
      );
      const funding = [];
      for (const frame of frames) {
        funding.push(
          await service.getPerpFundingHistory({
            symbol: frame.snapshot.market.symbol,
            from: Math.max(
              0,
              (record.startedAt ?? Date.now()) -
                frame.snapshot.market.fundingIntervalSeconds * 1000,
            ),
            to: Date.now(),
          }),
        );
      }
      return { frames, funding };
    },
    async evidence(record, observation, signal, guard) {
      await guard?.();
      const resolutions = record.config.strategyVersion === "1.1.0" ? [3600, 900, 300] : [3600];
      const candles: PerpCandles[] = [];
      const { service } = await createPerplSession(
        agents,
        { tenantId: record.config.tenantId, agentId: record.agentIds.rules },
        signal,
        { ...options, schedule, ...(guard ? { guard } : {}) },
      );
      for (const symbol of ["BTC", "ETH"] as const) {
        for (const resolution of resolutions) {
          await guard?.();
          const end = Math.floor(Date.now() / (resolution * 1000)) * resolution * 1000;
          const key = `${record.config.tenantId}:${record.agentIds.rules}:${symbol}:${resolution}`;
          let series = cache.get(key);
          if (record.config.strategyVersion === "1.1.0" || series?.to !== end) {
            series = await service.getPerpCandles({
              symbol,
              resolution,
              from: end - 60 * resolution * 1000,
              to: end,
            });
            if (
              series.candles.filter((c) => c.closed).length !== 60 ||
              series.missingOpenTimes.length
            ) {
              throw new PilotError("DATA_UNAVAILABLE", "Sixty consecutive closed candles required");
            }
            cache.set(key, series);
          }
          candles.push(structuredClone(series));
        }
      }
      await guard?.();
      const frames =
        record.config.strategyVersion === "1.1.0"
          ? await read(record, signal, guard)
          : structuredClone(observation.frames);
      await guard?.();
      return {
        observedAt: Date.now(),
        frames,
        candles,
        sourceIds: [
          "BTC:market",
          "BTC:book",
          "BTC:candles",
          "ETH:market",
          "ETH:book",
          "ETH:candles",
          ...(record.config.strategyVersion === "1.1.0"
            ? ["BTC:candles:300", "BTC:candles:900", "ETH:candles:300", "ETH:candles:900"]
            : []),
        ],
      };
    },
    async execution(record, signal, guard) {
      if (record.dataPolicy) {
        return read(record, signal, guard);
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
