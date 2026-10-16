import { createHash } from "node:crypto";
import {
  PilotError,
  requireTool,
  type AgentRecord,
  type Scope,
  type PerpCandles,
  type PerpMarketInfo,
  type PerpSymbol,
  type PerpFundingHistory,
} from "@pickler/core";
import {
  PerplRequestSchedule,
  type PerplDataOptions,
  type PerplSocket,
  type PerplStreamEvent,
} from "@pickler/infrastructure/perpl-public";
import {
  COMPONENT_PAPER_POLICY,
  transientPerpsData,
  validateUniverseStream,
  type UniverseStreamBuffer,
} from "@pickler/trading/perps";
import type { PtsHistory } from "@pickler/trading/pts";
import { assertBreakoutMarketIdentity } from "@pickler/trading/evaluation";
import { createUniversePerplReader } from "./universe.js";

const RESOLUTIONS = [3600, 900, 300] as const;
const COUNTS = { 3600: 60, 900: 240, 300: 180 } as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export interface BreakoutCandleVersion {
  format: "breakout-native-candle-version-v1";
  symbol: string;
  marketId: number;
  resolution: number;
  closeTime: number;
  contentHash: string;
  previousHash: string | null;
  firstReceivedAt: number;
  requestId: string;
  responseSha256: string;
  sourceRecordId: string;
  from: number;
  to: number;
  source: PerpCandles["provenance"];
  candle: PerpCandles["candles"][number];
}

export interface BreakoutPreparedData {
  candles: PerpCandles[];
  commonSymbols: string[];
  ptsHistory: PtsHistory[];
  excluded: { symbol: string; code: string; phase: string }[];
  versions: BreakoutCandleVersion[];
}

export interface BreakoutReadOperation {
  operationId: string;
  dueAt: number;
  deadlineAt: number;
  signal: AbortSignal;
}

export interface BreakoutFundingRange {
  key: string;
  symbol: string;
  marketId: number;
  from: number;
  to: number;
}

/** One native reader and schedule, with a bounded candle cache independent of price acquisition. */
export function createHourlyBreakoutPublicReader(
  agents: { agent(scope: Scope): Promise<AgentRecord> },
  scope: Scope,
  markets: readonly { symbol: PerpSymbol; marketId: number }[],
  options: PerplDataOptions & {
    guard(): Promise<void>;
    socket?: (url: string) => PerplSocket;
    onStream?: (event: PerplStreamEvent) => void;
    onCandleVersion?: (version: BreakoutCandleVersion) => void | Promise<void>;
    onBuffer?: (value: UniverseStreamBuffer) => void;
  },
) {
  const now = options.now ?? Date.now;
  const lifetime = new AbortController();
  let closed = false;
  let preparing = false;
  let frozenAgent: string | undefined;
  let latestBuffer: UniverseStreamBuffer | null = null;
  const cache = new Map<string, PerpCandles>();
  const versionCache = new Map<string, BreakoutCandleVersion>();
  const staticIdentity = (m: PerpMarketInfo) =>
    JSON.stringify([
      m.symbol,
      m.marketId,
      m.perpetualId,
      m.instanceId,
      m.exchangeAddress,
      m.collateral,
      m.provenance.network,
      m.provenance.chainId,
    ]);
  const identities = new Map<number, string>();
  const fundingIntervals = new Map<number, number>();
  const candleResponses = new Map<
    string,
    { responseSha256: string; sourceRecordId: string; requestId: string }
  >();
  const reader = createUniversePerplReader(agents, {
    ...options,
    schedule: options.schedule ?? new PerplRequestSchedule(),
    acquisitionPolicy: COMPONENT_PAPER_POLICY,
    onStream(event) {
      if (event.kind === "catalog") {
        const catalog = event.publicMessage as { markets: PerpMarketInfo[] };
        for (const market of catalog.markets) {
          assertBreakoutMarketIdentity(market);
        }
      }
      options.onStream?.(event);
    },
    async onResponse(response) {
      const match = /\/market-data\/(\d+)\/candles\/(\d+)\//.exec(response.url);
      if (match) {
        const responseSha256 = createHash("sha256").update(response.body).digest("hex");
        const requestId = hash([response.url, response.receivedAt]);
        candleResponses.set(JSON.stringify([Number(match[1]), Number(match[2])]), {
          responseSha256,
          requestId,
          sourceRecordId: hash([requestId, responseSha256]),
        });
      }
      await options.onResponse?.(response);
    },
    onBuffer(value) {
      latestBuffer = structuredClone(value);
      options.onBuffer?.(structuredClone(value));
    },
  });

  async function guard(signal: AbortSignal) {
    try {
      signal.throwIfAborted();
      lifetime.signal.throwIfAborted();
      if (closed) {
        throw new PilotError("DATA_READER_CLOSED", "Breakout reader closed");
      }
      await options.guard();
      const agent = await agents.agent(scope);
      const current = JSON.stringify([
        agent.id,
        agent.tenantId,
        agent.version,
        agent.config.perpl,
        agent.config.tools,
        agent.config.plugins,
      ]);
      if (
        agent.paused ||
        agent.id !== scope.agentId ||
        agent.tenantId !== scope.tenantId ||
        agent.config.perpl?.version !== 2 ||
        agent.config.perpl.network !== "mainnet" ||
        markets.some(
          (m) => !(agent.config.perpl!.markets as readonly string[]).includes(m.symbol),
        ) ||
        (frozenAgent !== undefined && frozenAgent !== current)
      ) {
        await close();
        throw new PilotError("CONFIG_CHANGED", "Breakout public permissions changed");
      }
      requireTool(agent.config, "getPerpSnapshot");
      requireTool(agent.config, "getPerpOrderBook");
      requireTool(agent.config, "getPerpCandles");
      frozenAgent ??= current;
      signal.throwIfAborted();
      return agent;
    } catch (error) {
      if (
        error instanceof PilotError &&
        !transientPerpsData(error) &&
        error.code !== "PERPL_CANCELLED"
      ) {
        await close().catch(() => {});
      }
      throw error;
    }
  }

  function preparedAt(at: number): BreakoutPreparedData {
    const candles: PerpCandles[] = [];
    const ptsHistory: PtsHistory[] = [];
    const commonSymbols: string[] = [];
    const excluded: BreakoutPreparedData["excluded"] = [];
    for (const market of markets) {
      const own = RESOLUTIONS.flatMap((resolution) => {
        const end = Math.floor(at / (resolution * 1000)) * resolution * 1000;
        const value = cache.get(JSON.stringify([market.marketId, resolution, end]));
        return value ? [structuredClone(value)] : [];
      });
      const common = own.map((s) => ({
        ...s,
        from: s.to - 60 * s.resolution * 1000,
        candles: s.candles.slice(-60),
        missingOpenTimes: [],
      }));
      candles.push(...common);
      if (common.length === RESOLUTIONS.length && common.every((s) => s.candles.length === 60)) {
        commonSymbols.push(market.symbol);
      } else {
        excluded.push({ symbol: market.symbol, code: "DATA_UNAVAILABLE", phase: "common-candles" });
      }
      if (
        own.length === RESOLUTIONS.length &&
        own.every(
          (s) =>
            !s.missingOpenTimes.length &&
            s.candles.length >= COUNTS[s.resolution as keyof typeof COUNTS],
        )
      ) {
        ptsHistory.push({
          market: structuredClone(own[0]!.market),
          series: own,
          capturedAt: Math.max(...own.map((s) => s.provenance.receivedAt)),
        });
      }
    }
    return {
      candles,
      commonSymbols,
      ptsHistory,
      excluded,
      versions: [...versionCache.values()].map((v) => structuredClone(v)),
    };
  }

  async function prepare(input: BreakoutReadOperation): Promise<BreakoutPreparedData> {
    if (preparing) {
      throw new PilotError("CONFLICT", "Candle preparations cannot overlap");
    }
    preparing = true;
    const deadlineAt = Math.min(input.deadlineAt, now() + 60000);
    const signal = AbortSignal.any([
      input.signal,
      lifetime.signal,
      AbortSignal.timeout(Math.max(0, Math.floor(deadlineAt - now()))),
    ]);
    try {
      await guard(signal);
      if (now() >= deadlineAt) {
        throw new PilotError("DATA_UNAVAILABLE", "Original candle preparation expired");
      }
      for (const resolution of RESOLUTIONS) {
        const service = await reader.session(scope, signal, () => guard(signal).then(() => {}));
        const end = Math.floor(now() / (resolution * 1000)) * resolution * 1000;
        for (const market of markets) {
          await guard(signal);
          const key = JSON.stringify([market.marketId, resolution, end]);
          if (cache.has(key)) {
            continue;
          }
          try {
            const series = await service.getPerpCandles({
              symbol: market.symbol,
              resolution,
              from: end - COUNTS[resolution] * resolution * 1000,
              to: end,
            });
            await guard(signal);
            assertBreakoutMarketIdentity(series.market);
            const identity = staticIdentity(series.market);
            if (
              series.market.marketId !== market.marketId ||
              series.market.symbol !== market.symbol ||
              (identities.has(market.marketId) && identities.get(market.marketId) !== identity)
            ) {
              throw new PilotError("PERPL_MARKET_IDENTITY", "Native candle identity changed");
            }
            identities.set(market.marketId, identity);
            const tail = series.candles.slice(-60);
            if (
              series.resolution !== resolution ||
              series.to !== end ||
              tail.length !== 60 ||
              tail.some((c, i) => !c.closed || c.openTime !== end - (60 - i) * resolution * 1000) ||
              series.candles.some((c) => !c.closed || c.openTime + resolution * 1000 > end)
            ) {
              throw new PilotError(
                "DATA_UNAVAILABLE",
                "Consecutive original closed candles required",
              );
            }
            for (const candle of series.candles) {
              const versionKey = JSON.stringify([market.marketId, resolution, candle.openTime]);
              const contentHash = hash([identity, candle]);
              const previous = versionCache.get(versionKey);
              if (!previous || previous.contentHash !== contentHash) {
                const original = candleResponses.get(JSON.stringify([market.marketId, resolution]));
                if (!original) {
                  throw new PilotError(
                    "DATA_UNAVAILABLE",
                    "Original native response receipt missing",
                  );
                }
                const version: BreakoutCandleVersion = {
                  format: "breakout-native-candle-version-v1",
                  symbol: market.symbol,
                  marketId: market.marketId,
                  resolution,
                  closeTime: candle.openTime + resolution * 1000,
                  contentHash,
                  previousHash: previous?.contentHash ?? null,
                  firstReceivedAt: series.provenance.receivedAt,
                  ...original,
                  from: series.from,
                  to: series.to,
                  source: structuredClone(series.provenance),
                  candle: structuredClone(candle),
                };
                await options.onCandleVersion?.(structuredClone(version));
                versionCache.set(versionKey, version);
              }
            }
            cache.set(key, structuredClone(series));
          } catch (error) {
            input.signal.throwIfAborted();
            lifetime.signal.throwIfAborted();
            requireAvailabilityFailure(error, signal);
            if (signal.aborted) {
              break;
            }
            if (!(error instanceof PilotError) || !transientPerpsData(error)) {
              throw error;
            }
          }
        }
        if (signal.aborted) {
          break;
        }
      }
      await guard(input.signal);
      const at = now();
      for (const [key, value] of cache) {
        if (value.to !== Math.floor(at / (value.resolution * 1000)) * value.resolution * 1000) {
          cache.delete(key);
        }
      }
      for (const [key, version] of versionCache) {
        if (
          version.candle.openTime <
          Math.floor(at / (version.resolution * 1000)) * version.resolution * 1000 -
            COUNTS[version.resolution as keyof typeof COUNTS] * version.resolution * 1000
        ) {
          versionCache.delete(key);
        }
      }
      return preparedAt(at);
    } finally {
      preparing = false;
    }
  }

  async function capture(input: BreakoutReadOperation) {
    await guard(input.signal);
    if (now() >= input.deadlineAt) {
      throw new PilotError("DATA_UNAVAILABLE", "Original source operation expired");
    }
    // Only the reader's internal operation timeout expires; the parent lifetime stays continuous.
    latestBuffer = null;
    const result = await reader.read(
      scope,
      markets,
      input.signal,
      () => guard(input.signal).then(() => {}),
      input.deadlineAt,
    );
    await guard(input.signal);
    for (const frame of result.frames) {
      assertBreakoutMarketIdentity(frame.snapshot.market);
      const identity = staticIdentity(frame.snapshot.market);
      const id = frame.snapshot.market.marketId;
      if (identities.has(id) && identities.get(id) !== identity) {
        await close();
        throw new PilotError("PERPL_MARKET_IDENTITY", "Financial and candle identity differ");
      }
      identities.set(id, identity);
      fundingIntervals.set(id, frame.snapshot.market.fundingIntervalSeconds);
    }
    const at = now();
    if (at >= input.deadlineAt) {
      return {
        operationId: input.operationId,
        dueAt: input.dueAt,
        at,
        frames: [],
        excluded: markets.map((m) => ({
          symbol: m.symbol,
          code: "DATA_UNAVAILABLE",
          phase: "deadline",
        })),
        prepared: preparedAt(at),
        raw: latestBuffer,
      };
    }
    const verified = latestBuffer
      ? validateUniverseStream({
          network: "mainnet",
          markets,
          buffer: latestBuffer,
          now: at,
          hash,
          policy: COMPONENT_PAPER_POLICY,
        })
      : result;
    return {
      operationId: input.operationId,
      dueAt: input.dueAt,
      at,
      ...verified,
      prepared: preparedAt(at),
      raw: latestBuffer,
    };
  }

  async function close() {
    closed = true;
    lifetime.abort(new PilotError("DATA_READER_CLOSED", "Breakout reader closed"));
    cache.clear();
    versionCache.clear();
    candleResponses.clear();
    latestBuffer = null;
    await reader.close();
  }
  async function reconcileRanges(
    input: BreakoutReadOperation,
    ranges: readonly BreakoutFundingRange[],
  ) {
    const signal = AbortSignal.any([
      input.signal,
      lifetime.signal,
      AbortSignal.timeout(
        Math.max(0, Math.floor(Math.min(input.deadlineAt, now() + 20000) - now())),
      ),
    ]);
    const funding: PerpFundingHistory[] = [];
    const completedKeys: string[] = [];
    await guard(signal);
    if (!ranges.length) {
      return { funding, completedKeys };
    }
    if (now() >= input.deadlineAt) {
      throw new PilotError("DATA_UNAVAILABLE", "Original funding operation expired");
    }
    const service = await reader.session(scope, signal, () => guard(signal).then(() => {}));
    const shortest = Math.min(...fundingIntervals.values());
    if (!Number.isFinite(shortest) || shortest <= 0) {
      throw new PilotError("DATA_UNAVAILABLE", "Original funding interval metadata unavailable");
    }
    for (const range of ranges) {
      if (
        !markets.some((m) => m.symbol === range.symbol && m.marketId === range.marketId) ||
        !Number.isSafeInteger(range.from) ||
        !Number.isSafeInteger(range.to) ||
        range.from < 0 ||
        range.to < range.from ||
        range.to > now()
      ) {
        throw new PilotError("INVALID_INPUT", "Original held funding range required");
      }
      const from = Math.max(0, range.from - 86400000);
      const parts: PerpFundingHistory[] = [];
      try {
        for (let cursor = from; cursor <= range.to;) {
          await guard(signal);
          const end = Math.min(range.to, cursor + shortest * 127000);
          const part = await service.getPerpFundingHistory({
            symbol: range.symbol,
            from: cursor,
            to: end,
          });
          await guard(signal);
          parts.push(part);
          if (end === range.to) {
            break;
          }
          cursor = end;
        }
        const events = new Map<number, PerpFundingHistory["events"][number]>();
        for (const part of parts) {
          for (const event of part.events) {
            const old = events.get(event.eventBlock);
            if (
              old &&
              (old.rate !== event.rate ||
                old.index !== event.index ||
                old.appliesAt !== event.appliesAt ||
                old.estimated !== event.estimated)
            ) {
              throw new PilotError(
                "FUNDING_DISPUTED",
                "Overlapping original funding pages disagree",
              );
            }
            events.set(event.eventBlock, structuredClone(event));
          }
        }
        if (parts.length) {
          funding.push({
            market: parts[0]!.market,
            from,
            to: range.to,
            complete: parts.every((p) => p.complete),
            events: [...events.values()].sort((a, b) => a.eventBlock - b.eventBlock),
            pages: parts.flatMap((p) => p.pages),
          });
          completedKeys.push(range.key);
        }
      } catch (error) {
        input.signal.throwIfAborted();
        lifetime.signal.throwIfAborted();
        requireAvailabilityFailure(error, signal);
        if (signal.aborted) {
          break;
        }
        if (!(error instanceof PilotError) || !transientPerpsData(error)) {
          throw error;
        }
        break;
      }
    }
    await guard(input.signal);
    return { funding, completedKeys };
  }
  return { capture, prepare, reconcileRanges, close };
}

/** A simultaneous deadline must not conceal an identity, permission or persistence failure. */
function requireAvailabilityFailure(error: unknown, signal: AbortSignal): void {
  if (error instanceof PilotError && transientPerpsData(error)) {
    return;
  }
  if (
    signal.aborted &&
    ((error instanceof PilotError && error.code === "PERPL_CANCELLED") ||
      (error instanceof DOMException &&
        (error.name === "AbortError" || error.name === "TimeoutError")))
  ) {
    return;
  }
  throw error;
}
