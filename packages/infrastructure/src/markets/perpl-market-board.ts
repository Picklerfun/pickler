import {
  ACCENTS,
  MarketDataUnavailableError,
  type Accent,
  type MarketBoard,
  type MarketDetail,
  type PerpMarket,
  type PerpNetwork,
} from "@pickler/core";
import { parseContext, type Context, type Market } from "@pickler/perpl-context";
import { PERPL_NETWORKS, PerplRequestSchedule, PerplTransport } from "../perpl/transport.js";
import { candlesSchema } from "../perpl/wire.js";

// The market board of the marketplace, read from Perpl. The list is one request to the venue's
// public context, parsed by the same package the mobile app trades on, so the two surfaces list
// the same markets with the same figures. docs/specs/perps-board-live-v1.md has the decisions.

/** A board younger than this is served without asking the venue again. */
const FRESH_MS = 10_000;
/** While the venue does not answer, its last figures are served, marked stale, for this long. */
const STALE_LIMIT_MS = 5 * 60_000;
/** After a failed read the venue is not asked again for this long, whoever is asking. */
const RETRY_AFTER_MS = 10_000;
/** A market's trail and reach change by the hour; they are read at most this often. */
const HISTORY_FRESH_MS = 5 * 60_000;

const HOUR_MS = 3_600_000;
/** The reach is the furthest hourly move of the last thirty days. */
const REACH_HOURS = 30 * 24;
const TRAIL_HOURS = 24;

/** AUSD, the venue's collateral, has six decimals. */
const COLLATERAL_UNIT = 1_000_000;

interface HeldBoard {
  at: number;
  context: Context;
}

interface HeldHistory {
  at: number;
  /** Closes of the closed hourly candles, oldest first, scaled like the mark. */
  closes: number[];
  hourlyReach: number | null;
}

/**
 * What a board remembers between requests: the venue's last answer, each market's history, and the
 * schedule that paces requests to one a second. The API composes its services per request, so this
 * is created once per network by whoever composes them and handed to every board built after.
 * It is a cache: an isolate that is recycled starts empty, and nothing depends on it surviving.
 */
export class PerplBoardMemory {
  readonly schedule = new PerplRequestSchedule();
  board: HeldBoard | null = null;
  reading: Promise<HeldBoard> | null = null;
  failedAt = -Infinity;
  readonly histories = new Map<number, HeldHistory>();
}

export interface PerplMarketBoardOptions {
  network: PerpNetwork;
  memory: PerplBoardMemory;
  transport?: typeof fetch;
  now?: () => number;
}

const KNOWN_ACCENTS: Record<string, Accent> = {
  BTC: "amber",
  ETH: "cyan",
  SOL: "violet",
  MON: "lime",
};

/** A market keeps its colour: the known four are fixed and the rest follow from their letters. */
function accentFor(base: string): Accent {
  const known = KNOWN_ACCENTS[base];
  if (known) {
    return known;
  }
  let sum = 0;
  for (const character of base) {
    sum += character.charCodeAt(0);
  }
  return ACCENTS[sum % ACCENTS.length]!;
}

/** What the last day and the funding say, in a sentence. No model writes it. */
function noteFor(change24h: number, fundingRate: number | null): string {
  const moved = `${(Math.abs(change24h) * 100).toFixed(1)}%`;
  let move = "Flat over 24 hours.";
  if (change24h >= 0.001) {
    move = `Up ${moved} in 24 hours.`;
  } else if (change24h <= -0.001) {
    move = `Down ${moved} in 24 hours.`;
  }

  let funding = "Funding is flat.";
  if (fundingRate === null) {
    funding = "No funding is published.";
  } else if (fundingRate > 0) {
    funding = "Funding is positive.";
  } else if (fundingRate < 0) {
    funding = "Funding is negative.";
  }
  return `${move} ${funding}`;
}

/** The asset a market is named for: its symbol, or what it is sized in when the symbol is empty. */
function baseOf(market: Market): string | null {
  const base = (market.symbol !== "" ? market.symbol : (market.sizeUnits ?? "")).toUpperCase();
  return /^[A-Z0-9]{2,10}$/.test(base) ? base : null;
}

function toPerpMarket(
  market: Market,
  base: string,
  held: HeldBoard,
  network: PerpNetwork,
  stale: boolean,
): PerpMarket {
  const mark = market.mark / 10 ** market.priceDecimals;
  const change24h = market.prev > 0 ? (market.mark - market.prev) / market.prev : 0;
  // The venue publishes a rate per funding interval; the board states it per hour.
  const funding1h =
    market.fundingRate !== null && market.fundingIntervalSec
      ? (market.fundingRate / 1e6) * (3600 / market.fundingIntervalSec)
      : 0;
  const openInterest =
    market.openInterest !== null ? (market.openInterest / 10 ** market.sizeDecimals) * mark : 0;

  return {
    symbol: `${base}-PERP`,
    base,
    accent: accentFor(base),
    mark,
    change24h,
    funding1h,
    openInterest,
    maxLeverage: market.maxLeverage,
    agentsReading: null,
    openCalls: null,
    lastCall: null,
    note: noteFor(change24h, market.fundingRate),
    hourlyReach: null,
    limits: {
      takerFee: market.takerFeeMicros / 1e6,
      maintenanceMargin:
        market.maxLeverage > 0 ? market.maintenanceBps / 1e4 / market.maxLeverage : 0,
      slippageCap: market.maxSlippageBps / 1e4,
      minimumAccountOpen: Number(held.context.instance.minAccountOpen) / COLLATERAL_UNIT,
    },
    source: {
      venue: "perpl",
      network,
      observedAt: new Date(held.at).toISOString(),
      stale,
    },
  };
}

/** Each asset once: where the venue lists one twice, the market with the lower id stands. */
function listed(context: Context): { market: Market; base: string }[] {
  const seen = new Set<string>();
  const result: { market: Market; base: string }[] = [];
  for (const market of context.markets) {
    const base = baseOf(market);
    if (base === null || seen.has(base)) {
      continue;
    }
    seen.add(base);
    result.push({ market, base });
  }
  return result;
}

export function createPerplMarketBoard(options: PerplMarketBoardOptions): MarketBoard {
  const { network, memory } = options;
  const now = options.now ?? Date.now;
  const where = `perpl ${network}`;

  // One transport is one bounded session of at most twelve requests, so each read gets its own;
  // the schedule they share is what paces them.
  const transport = () =>
    new PerplTransport({
      schedule: memory.schedule,
      now,
      ...(options.transport ? { transport: options.transport } : {}),
    });
  const reading = () => ({ signal: new AbortController().signal, guard: async () => {} });

  async function readBoard(): Promise<HeldBoard> {
    const response = await transport().get(network, "/v1/pub/context", reading());
    const context = parseContext(JSON.parse(response.body));
    if (context.chainId !== PERPL_NETWORKS[network].chainId) {
      throw new Error(`Perpl answered for chain ${context.chainId}, not ${network}`);
    }
    return { at: response.receivedAt, context };
  }

  /** The venue's answer and whether it is older than the venue would give now. */
  async function board(): Promise<{ held: HeldBoard; stale: boolean }> {
    const held = memory.board;
    if (held && now() - held.at < FRESH_MS) {
      return { held, stale: false };
    }

    if (now() - memory.failedAt >= RETRY_AFTER_MS) {
      // Requests that arrive together share one read.
      memory.reading ??= readBoard().finally(() => {
        memory.reading = null;
      });
      try {
        const fresh = await memory.reading;
        memory.board = fresh;
        return { held: fresh, stale: false };
      } catch (cause) {
        memory.failedAt = now();
        if (!held || now() - held.at >= STALE_LIMIT_MS) {
          throw new MarketDataUnavailableError(where, { cause });
        }
      }
    }

    if (held && now() - held.at < STALE_LIMIT_MS) {
      return { held, stale: true };
    }
    throw new MarketDataUnavailableError(where);
  }

  /** Thirty days of closed hourly candles. Null when the venue does not give them. */
  async function history(market: Market): Promise<HeldHistory | null> {
    const cached = memory.histories.get(market.id);
    if (cached && now() - cached.at < HISTORY_FRESH_MS) {
      return cached;
    }

    const to = Math.floor(now() / HOUR_MS) * HOUR_MS;
    const from = to - REACH_HOURS * HOUR_MS;
    try {
      // The venue's range is inclusive at both ends: ask up to the last hour that has closed.
      const response = await transport().get(
        network,
        `/v1/market-data/${market.id}/candles/3600/${from}-${to - HOUR_MS}`,
        reading(),
      );
      const series = candlesSchema.parse(JSON.parse(response.body));
      const closed = series.d
        .filter((candle) => candle.t >= from && candle.t + HOUR_MS <= now() && candle.o > 0)
        .sort((a, b) => a.t - b.t);

      let reach = 0;
      for (const candle of closed) {
        const furthest = Math.max(candle.h - candle.o, candle.o - candle.l);
        reach = Math.max(reach, (furthest / candle.o) * 100);
      }
      const scale = 10 ** market.priceDecimals;
      const fresh: HeldHistory = {
        at: now(),
        closes: closed.map((candle) => candle.c / scale),
        hourlyReach: closed.length > 0 ? Math.round(reach * 100) / 100 : null,
      };
      memory.histories.set(market.id, fresh);
      return fresh;
    } catch {
      // The market is still worth showing without its history; the next request asks again.
      return null;
    }
  }

  return {
    async listMarkets(): Promise<PerpMarket[]> {
      const { held, stale } = await board();
      return listed(held.context).map(({ market, base }) =>
        toPerpMarket(market, base, held, network, stale),
      );
    },

    async getMarket(symbol: string): Promise<MarketDetail | null> {
      const { held, stale } = await board();
      const found = listed(held.context).find(({ base }) => `${base}-PERP` === symbol);
      if (!found) {
        return null;
      }

      const market = toPerpMarket(found.market, found.base, held, network, stale);
      const past = await history(found.market);
      if (!past) {
        return { market, calls: [], trail: [] };
      }

      return {
        market: { ...market, hourlyReach: past.hourlyReach },
        calls: [],
        trail: [...past.closes.slice(-TRAIL_HOURS), market.mark],
      };
    },
  };
}
