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
//
// This serves a public page, so nobody waits on the venue for long: what is held is served while
// a newer answer is fetched, a read is shared by everyone who wants it, and a read that failed is
// not repeated at once.

/** A board younger than this is served without asking the venue again. */
const FRESH_MS = 10_000;
/** While the venue does not answer, its last figures are served, marked stale, for this long. */
const STALE_LIMIT_MS = 5 * 60_000;
/** After a failed read the venue is not asked again for this long, whoever is asking. */
const RETRY_AFTER_MS = 10_000;
/** Someone already holding a usable board waits this long for a newer one, and no longer. */
const HELD_WAIT_MS = 2_000;

/** A market's trail and reach change by the hour; they are read at most this often. */
const HISTORY_FRESH_MS = 5 * 60_000;
/** After a failed history read that market's history is not asked for again for this long. */
const HISTORY_RETRY_AFTER_MS = 30_000;
/** A market page waits this long for its history, then is served without it. */
const HISTORY_WAIT_MS = 2_500;

/**
 * A read nobody has heard from in this long is given up on. The transport's own timeout is ten
 * seconds; this covers a read whose request died with the invocation that started it.
 */
const ABANDON_MS = 15_000;

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

/** A read in flight, shared by everyone who asks while it lasts. */
interface Reading<T> {
  startedAt: number;
  promise: Promise<T>;
}

/**
 * What a board remembers between requests: the venue's last answer, each market's history, the
 * reads in flight, and the schedules that pace requests to the venue. The API composes its
 * services per request, so this is created once per network by whoever composes them and handed
 * to every board built after. It is a cache: an isolate that is recycled starts empty, and
 * nothing depends on it surviving.
 *
 * The list and the histories are paced apart, one request a second each, so a burst of market
 * pages never delays the board.
 */
export class PerplBoardMemory {
  contextSchedule = new PerplRequestSchedule();
  historySchedule = new PerplRequestSchedule();
  board: HeldBoard | null = null;
  reading: Reading<HeldBoard> | null = null;
  failedAt = -Infinity;
  readonly histories = new Map<number, HeldHistory>();
  readonly historyReading = new Map<number, Reading<HeldHistory>>();
  readonly historyFailedAt = new Map<number, number>();
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

/**
 * The asset a market is named for: its symbol, or what it is sized in when the symbol is empty.
 * Null for a name the board's `BASE-PERP` symbols cannot carry; such a market is not listed.
 */
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
  // The venue publishes a rate per funding interval; the board states it per hour. A rate with
  // no interval cannot be stated per hour, and is treated as not published.
  const fundingRate = market.fundingIntervalSec ? market.fundingRate : null;
  const funding1h =
    fundingRate !== null && market.fundingIntervalSec
      ? (fundingRate / 1e6) * (3600 / market.fundingIntervalSec)
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
    note: noteFor(change24h, fundingRate),
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

const LATE = Symbol("late");

/** The promise's value, or `LATE` when it has not settled in time. The promise itself goes on. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | typeof LATE> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((resolve) => {
    timer = setTimeout(() => resolve(LATE), ms);
  });
  try {
    return await Promise.race([promise, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function createPerplMarketBoard(options: PerplMarketBoardOptions): MarketBoard {
  const { network, memory } = options;
  const now = options.now ?? Date.now;
  const where = `perpl ${network}`;

  // One transport is one bounded session of at most twelve requests, so each read gets its own;
  // the schedule it is given is what paces it against the other reads of its kind.
  const transport = (schedule: PerplRequestSchedule) =>
    new PerplTransport({
      schedule,
      now,
      ...(options.transport ? { transport: options.transport } : {}),
    });
  const reading = () => ({ signal: new AbortController().signal, guard: async () => {} });

  // The venue said to wait (429). The transport would sleep through that wait; a public page does
  // not, so the wait counts as a failed read and nothing is sent until it is over.
  const toldToWait = (schedule: PerplRequestSchedule) => schedule.blockedUntil > Date.now();

  async function readBoard(): Promise<HeldBoard> {
    const response = await transport(memory.contextSchedule).get(
      network,
      "/v1/pub/context",
      reading(),
    );
    const context = parseContext(JSON.parse(response.body));
    if (context.chainId !== PERPL_NETWORKS[network].chainId) {
      throw new Error(`Perpl answered for chain ${context.chainId}, not ${network}`);
    }
    return { at: response.receivedAt, context };
  }

  /** Starts the one read everyone waits on, and records how it ends whoever is still waiting. */
  function startBoardRead(at: number): Reading<HeldBoard> {
    const started: Reading<HeldBoard> = { startedAt: at, promise: readBoard() };
    memory.reading = started;
    void started.promise
      .then(
        (fresh) => {
          memory.board = fresh;
        },
        () => {
          memory.failedAt = now();
        },
      )
      .finally(() => {
        if (memory.reading === started) {
          memory.reading = null;
        }
      });
    return started;
  }

  /** The venue's answer and whether it is older than the venue would give now. */
  async function board(): Promise<{ held: HeldBoard; stale: boolean }> {
    const held = memory.board;
    const at = now();
    if (held && at - held.at < FRESH_MS) {
      return { held, stale: false };
    }
    const usable = held && at - held.at < STALE_LIMIT_MS ? held : null;
    const lastFigures = (cause?: unknown) => {
      if (usable) {
        return { held: usable, stale: true };
      }
      throw new MarketDataUnavailableError(where, cause === undefined ? undefined : { cause });
    };

    let current = memory.reading;
    if (current && at - current.startedAt >= ABANDON_MS) {
      // Its request is gone, and the schedule it holds would keep every later read waiting.
      memory.contextSchedule = new PerplRequestSchedule();
      memory.reading = null;
      current = null;
    }
    if (!current) {
      const resting = at - memory.failedAt < RETRY_AFTER_MS || toldToWait(memory.contextSchedule);
      if (resting) {
        return lastFigures();
      }
      current = startBoardRead(at);
    }

    let outcome: HeldBoard | typeof LATE;
    try {
      outcome = await within(current.promise, usable ? HELD_WAIT_MS : ABANDON_MS);
    } catch (cause) {
      return lastFigures(cause);
    }
    if (outcome === LATE) {
      // The venue is slow, not silent: what is held is still its latest answer.
      if (usable) {
        return { held: usable, stale: false };
      }
      throw new MarketDataUnavailableError(where);
    }
    return { held: outcome, stale: false };
  }

  /** Thirty days of closed hourly candles for one market. */
  async function readHistory(market: Market): Promise<HeldHistory> {
    const at = now();
    const to = Math.floor(at / HOUR_MS) * HOUR_MS;
    const from = to - REACH_HOURS * HOUR_MS;
    // The venue's range is inclusive at both ends: ask up to the last hour that has closed.
    const response = await transport(memory.historySchedule).get(
      network,
      `/v1/market-data/${market.id}/candles/3600/${from}-${to - HOUR_MS}`,
      reading(),
    );
    const series = candlesSchema.parse(JSON.parse(response.body));
    if (series.r !== 3600) {
      throw new Error("Perpl answered with another candle resolution");
    }

    // Only what was asked for, what has closed, and what is a candle at all.
    const closed = series.d
      .filter(
        (candle) =>
          candle.t >= from &&
          candle.t + HOUR_MS <= at &&
          candle.o > 0 &&
          candle.l <= Math.min(candle.o, candle.c) &&
          candle.h >= Math.max(candle.o, candle.c),
      )
      .sort((a, b) => a.t - b.t);

    let reach = 0;
    for (const candle of closed) {
      const furthest = Math.max(candle.h - candle.o, candle.o - candle.l);
      reach = Math.max(reach, (furthest / candle.o) * 100);
    }
    const rounded = Math.round(reach * 100) / 100;
    const scale = 10 ** market.priceDecimals;
    return {
      at,
      closes: closed.map((candle) => candle.c / scale),
      // A market that has not moved has no measured reach; zero would refuse every square.
      hourlyReach: rounded > 0 ? rounded : null,
    };
  }

  function startHistoryRead(market: Market, at: number): Reading<HeldHistory> {
    const started: Reading<HeldHistory> = { startedAt: at, promise: readHistory(market) };
    memory.historyReading.set(market.id, started);
    void started.promise
      .then(
        (fresh) => {
          memory.histories.set(market.id, fresh);
          memory.historyFailedAt.delete(market.id);
        },
        () => {
          memory.historyFailedAt.set(market.id, now());
        },
      )
      .finally(() => {
        if (memory.historyReading.get(market.id) === started) {
          memory.historyReading.delete(market.id);
        }
      });
    return started;
  }

  /**
   * A market's history, or the last one held when a newer one is not to be had now, or null. The
   * market is worth showing without it, so nothing here throws and nothing here waits for long.
   */
  async function history(market: Market): Promise<HeldHistory | null> {
    const cached = memory.histories.get(market.id) ?? null;
    const at = now();
    if (cached && at - cached.at < HISTORY_FRESH_MS) {
      return cached;
    }

    let current = memory.historyReading.get(market.id) ?? null;
    if (current && at - current.startedAt >= ABANDON_MS) {
      memory.historySchedule = new PerplRequestSchedule();
      memory.historyReading.delete(market.id);
      current = null;
    }
    if (!current) {
      const failedAt = memory.historyFailedAt.get(market.id) ?? -Infinity;
      if (at - failedAt < HISTORY_RETRY_AFTER_MS || toldToWait(memory.historySchedule)) {
        return cached;
      }
      current = startHistoryRead(market, at);
    }

    try {
      const outcome = await within(current.promise, HISTORY_WAIT_MS);
      return outcome === LATE ? cached : outcome;
    } catch {
      return cached;
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
