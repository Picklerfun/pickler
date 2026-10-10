import { PilotError, type PerpSymbol, type PerpSnapshot, type PerpOrderBook } from "@pickler/core";
import {
  validatePaperFrame,
  validatePaperFrameComponents,
  type PerpsPaperFrame,
} from "./simulation.js";
import type { AcquisitionDiagnostic } from "./acquisition.js";
import { COMPONENT_PAPER_POLICY } from "./types.js";

export const UNIVERSE_STREAM_POLICY = "stream-universe-20s-v1" as const;
/** Capture-only experiment: independently fresh components plus a continuous live stream. */
export const UNIVERSE_COMPONENT_STREAM_POLICY = "stream-universe-component-20s-v2" as const;
export type UniverseStreamPolicy =
  | typeof UNIVERSE_STREAM_POLICY
  | typeof UNIVERSE_COMPONENT_STREAM_POLICY
  | typeof COMPONENT_PAPER_POLICY;
export function universeStreamValidation(policy: UniverseStreamPolicy) {
  if (
    ![UNIVERSE_STREAM_POLICY, UNIVERSE_COMPONENT_STREAM_POLICY, COMPONENT_PAPER_POLICY].includes(
      policy,
    )
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown stream validation policy");
  }
  return {
    policy,
    componentMaximumAgeMs: 30000,
    maximumFutureMs: 5000,
    tickerBookSkewGateMs: policy === UNIVERSE_STREAM_POLICY ? 5000 : null,
    streamHeartbeatMaximumAgeMs: policy !== UNIVERSE_STREAM_POLICY ? 5000 : null,
    financialAdmission: policy === COMPONENT_PAPER_POLICY,
  } as const;
}
export interface UniverseStreamBuffer {
  generation: number;
  observedAt: number;
  continuity?: { heartbeatSequence: number; headBlock: number; heartbeatReceivedAt: number };
  components: {
    symbol: PerpSymbol;
    snapshot?: PerpSnapshot;
    book?: PerpOrderBook;
  }[];
}
export interface UniverseStreamResult {
  frames: PerpsPaperFrame[];
  excluded: { symbol: PerpSymbol; code: string; phase: string }[];
}

/** A single copied generation, with original component dates and one validation clock. */
export function validateUniverseStream(input: {
  network: string;
  markets: readonly { symbol: PerpSymbol; marketId: number }[];
  buffer: UniverseStreamBuffer;
  now: number;
  hash(value: unknown): string;
  attempt?: number;
  diagnostic?(value: AcquisitionDiagnostic): void;
  policy?: UniverseStreamPolicy;
}): UniverseStreamResult {
  const frames: PerpsPaperFrame[] = [];
  const excluded: UniverseStreamResult["excluded"] = [];
  if (
    !Number.isSafeInteger(input.buffer.generation) ||
    input.buffer.generation < 0 ||
    new Set(input.buffer.components.map((c) => c.symbol)).size !== input.buffer.components.length ||
    input.buffer.components.some((c) => !input.markets.some((m) => m.symbol === c.symbol))
  ) {
    throw new PilotError("INVALID_MARKET_DATA", "Stream buffer identity is invalid");
  }
  const policy = input.policy ?? UNIVERSE_STREAM_POLICY;
  universeStreamValidation(policy);
  let continuityCode: string | null = null;
  if (policy !== UNIVERSE_STREAM_POLICY) {
    const continuity = input.buffer.continuity;
    if (!continuity) {
      continuityCode = "DATA_UNAVAILABLE";
    } else if (
      ![continuity.heartbeatSequence, continuity.headBlock, continuity.heartbeatReceivedAt].every(
        (value) => Number.isSafeInteger(value) && value >= 0,
      ) ||
      !Number.isSafeInteger(input.buffer.observedAt) ||
      !Number.isSafeInteger(input.now) ||
      continuity.heartbeatReceivedAt > input.buffer.observedAt ||
      input.buffer.observedAt > input.now
    ) {
      throw new PilotError("INVALID_MARKET_DATA", "Stream continuity evidence is invalid");
    } else if (input.now - continuity.heartbeatReceivedAt > 5000) {
      continuityCode = "DATA_UNAVAILABLE";
    }
  }
  for (const market of input.markets) {
    const pair = input.buffer.components.find((c) => c.symbol === market.symbol);
    const tickerAt = pair?.snapshot?.ticker.provenance.providerTimestamp ?? null;
    const bookAt = pair?.book?.provenance.providerTimestamp ?? null;
    let code: string | null = continuityCode;
    if (!pair?.snapshot || !pair.book) {
      code = "DATA_UNAVAILABLE";
    } else {
      if (
        pair.snapshot.market.marketId !== market.marketId ||
        pair.book.market.marketId !== market.marketId
      ) {
        throw new PilotError("INVALID_MARKET_DATA", "Frozen stream market identity changed");
      }
      const streamEvidence =
        policy === COMPONENT_PAPER_POLICY && input.buffer.continuity
          ? {
              policy,
              generation: input.buffer.generation,
              copiedAt: input.buffer.observedAt,
              ...input.buffer.continuity,
            }
          : undefined;
      const payload = {
        snapshot: pair.snapshot,
        book: pair.book,
        ...(streamEvidence ? { streamEvidence } : {}),
      };
      const frame = { ...payload, hash: input.hash(payload) };
      try {
        if (policy === UNIVERSE_COMPONENT_STREAM_POLICY) {
          validatePaperFrameComponents(frame, input.network, market.symbol, input.now);
        } else if (policy === COMPONENT_PAPER_POLICY && !continuityCode) {
          validatePaperFrame(frame, input.network, market.symbol, input.now, policy);
        } else if (policy === COMPONENT_PAPER_POLICY) {
          validatePaperFrameComponents(frame, input.network, market.symbol, input.now);
        } else {
          validatePaperFrame(frame, input.network, market.symbol, input.now);
        }
        if (!code) {
          frames.push(frame);
        }
      } catch (error) {
        if (
          !(error instanceof PilotError) ||
          !["STALE_MARKET_DATA", "INCONSISTENT_MARKET_DATA"].includes(error.code)
        ) {
          throw error;
        }
        code = error.code;
      }
    }
    if (code) {
      excluded.push({ symbol: market.symbol, code, phase: "stream-acquisition" });
    }
    input.diagnostic?.({
      symbol: market.symbol,
      attempt: input.attempt ?? 0,
      at: input.now,
      tickerAt,
      bookAt,
      skewMs: tickerAt === null || bookAt === null ? null : Math.abs(tickerAt - bookAt),
      code,
    });
  }
  return { frames, excluded };
}

/** Transport-neutral acquisition. Reconnection belongs to the injected guarded reader. */
export async function acquireUniverseStream(input: {
  network: string;
  markets: readonly { symbol: PerpSymbol; marketId: number }[];
  deadlineAt: number;
  signal: AbortSignal;
  now(): number;
  guard(): Promise<void>;
  read(): Promise<UniverseStreamBuffer>;
  refresh?(): Promise<void>;
  hash(value: unknown): string;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  diagnostic?(value: AcquisitionDiagnostic): void;
  policy?: UniverseStreamPolicy;
}): Promise<UniverseStreamResult> {
  let attempt = 0;
  while (input.now() < input.deadlineAt) {
    input.signal.throwIfAborted();
    await input.guard();
    try {
      const buffer = await input.read();
      await input.guard();
      input.signal.throwIfAborted();
      const result = validateUniverseStream({
        ...input,
        buffer,
        now: input.now(),
        attempt: ++attempt,
      });
      if (result.excluded.length === 0 && input.now() < input.deadlineAt) {
        return result;
      }
      if (input.now() < input.deadlineAt) {
        await input.refresh?.();
      }
    } catch (error) {
      input.signal.throwIfAborted();
      if (
        !(error instanceof PilotError) ||
        !["DATA_UNAVAILABLE", "PERPL_TRANSPORT_FAILURE"].includes(error.code)
      ) {
        throw error;
      }
    }
    await input.wait(Math.min(250, Math.max(0, input.deadlineAt - input.now())), input.signal);
  }
  throw new PilotError("DATA_UNAVAILABLE", "Stream universe acquisition deadline exhausted");
}
