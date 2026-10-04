import { createHash } from "node:crypto";
import type {
  AgentConfig,
  PerpCandles,
  PerpNetwork,
  PerpSymbol,
  Scope,
  Source,
} from "@pickler/core";
import {
  PERPS_CHECK_DECISION_VERSION,
  type AdviceSource,
  type PerpsCheckLease,
  type PerpsPaperFrame,
  type PerpsPaperMark,
  type PerpsPaperPosition,
} from "@pickler/trading/perps";

/** The least a wallet must hold for the first check to open its paper account (R9). */
export const PERPS_WALLET_MINIMUM_AUSD = 10;
/** Historical v1 captured context only; new Studio execution requires sixty candles. */
export const PERPS_CHECK_CANDLES = 48;
/** Web results the model sees at most (R5). */
export const PERPS_CHECK_WEB_RESULTS = 3;
/** Characters of each web result the model sees. */
const WEB_CONTENT_LIMIT = 1500;

/** One instrument's evidence, read through `readPerplInstrument`. */
export interface PerpsInstrumentRead {
  frame: PerpsPaperFrame;
  candles: PerpCandles;
  sources: AdviceSource[];
}

/** One bounded Perpl session for one check (24 requests, R5 and §6). */
export interface PerpsCheckSession {
  read(symbol: PerpSymbol): Promise<PerpsInstrumentRead>;
  /** A fresh book and snapshot to fill a paper order at. */
  frame(symbol: PerpSymbol): Promise<PerpsPaperFrame>;
}

export interface PerpsCheckMarket {
  open(scope: Scope, signal: AbortSignal): Promise<PerpsCheckSession>;
}

/** Marks from the shared market board; empty when the board cannot answer freshly. */
export type PerpsMarks = (network: PerpNetwork, signal: AbortSignal) => Promise<PerpsPaperMark[]>;

export interface PerpsCheckWeb {
  /** Site-scoped search under the agent's rules; cost in micro-USD, null when unknown. */
  search(
    web: NonNullable<NonNullable<AgentConfig["sources"]>["web"]>,
    query: string,
    signal: AbortSignal,
  ): Promise<{ sources: Source[]; costMicros: string | null }>;
}

/** The running check's lease; the heartbeat and the paper fence both replace it when renewed. */
export interface PerpsLeaseHolder {
  lease: PerpsCheckLease;
}

/** The model's input (R5): the brief as numbered lines, the markets, its positions, the web. */
export function perpsCheckState(input: {
  now: number;
  network: PerpNetwork;
  brief: NonNullable<AgentConfig["brief"]>;
  reads: PerpsInstrumentRead[];
  positions: PerpsPaperPosition[];
  web: Source[];
}) {
  const numbered = (lines: string[]) => lines.map((text, i) => ({ index: i + 1, text }));
  const iso = (at: number | null | undefined) =>
    at === null || at === undefined ? null : new Date(at).toISOString();
  return {
    protocol: PERPS_CHECK_DECISION_VERSION,
    now: iso(input.now),
    network: input.network,
    brief: {
      thesis: input.brief.thesis,
      entersWhen: numbered(input.brief.entersWhen),
      exitsWhen: numbered(input.brief.exitsWhen),
      never: numbered(input.brief.never),
    },
    markets: input.reads.map(({ frame, candles }) => ({
      instrument: frame.snapshot.market.symbol,
      mark: frame.snapshot.ticker.mark,
      index: frame.snapshot.ticker.index,
      openInterestBase: frame.snapshot.ticker.openInterestBase,
      funding: frame.snapshot.funding?.rate ?? null,
      dataAsOf: iso(frame.snapshot.ticker.provenance.providerTimestamp),
      book: {
        bids: frame.book.bids.map((level) => [level.price, level.size]),
        asks: frame.book.asks.map((level) => [level.price, level.size]),
      },
      hourlyCandles: candles.candles.map((c) => [
        iso(c.openTime),
        c.open,
        c.high,
        c.low,
        c.close,
        c.volumeCollateral,
      ]),
    })),
    positions: input.positions.map((p) => ({
      instrument: p.symbol,
      side: p.side,
      entryPrice: p.entryPrice,
      leverage: p.leverage ?? 1,
      openedAt: iso(p.openedAt),
      stopPrice: p.stopPrice ?? null,
      takeProfitPrice: p.takeProfitPrice ?? null,
      exitDueAt: iso(p.exitDueAt),
    })),
    web: input.web.map((source) => ({
      id: source.id,
      title: source.title,
      url: source.url,
      retrievedAt: source.retrievedAt,
      content: source.content.slice(0, WEB_CONTENT_LIMIT),
    })),
    sources: [
      ...input.reads.flatMap((read) => read.sources.map((s) => ({ id: s.id, name: s.name }))),
      ...input.web.map((s) => ({ id: s.id, name: (s.title || "Web source").slice(0, 300) })),
    ],
  };
}

export function perpsFrame(snapshot: PerpsPaperFrame["snapshot"], book: PerpsPaperFrame["book"]) {
  return {
    snapshot,
    book,
    hash: createHash("sha256").update(JSON.stringify({ snapshot, book })).digest("hex"),
  };
}
