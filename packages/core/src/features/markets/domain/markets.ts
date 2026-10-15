// Perpetuals on Perpl, as the "Pickler Market Web" design canvas draws them: a market is a grid of
// squares, one axis a price level away from the mark and the other how long you give it. Picking a
// square is the whole interaction. Above the mark it is a long, below it a short, and the column is
// the time after which the position closes whatever the price is.
//
// The same square means two things depending on which side of the market you are on. Under Trade it
// is a position of your own money. Under Ask it is a question put to an agent, and asking never
// opens anything. What a read asks is fixed by `READ_HORIZON` rather than by the column, so two
// answers on the same market stay comparable — see `readQuestionAtLevel` in the agents feature.
//
// The arithmetic a ticket shows while it is being filled in lives in the web feature that draws it,
// against the venue's own limits carried by each market (`limits`). It belongs here the day an
// order is actually sent, because then it decides money rather than describing it.

import type { Accent } from "../../landing/domain/landing.js";

/** How long a position is given before Pickler closes it. */
export const HORIZONS = ["1H", "4H", "12H", "24H"] as const;
export type Horizon = (typeof HORIZONS)[number];

/**
 * A read resolves a day out, whichever column wrote it. The grid moves the level of the question,
 * never its clock, because an agent's record is only readable when every read it holds was asked
 * over the same distance in time.
 */
export const READ_HORIZON: Horizon = "24H";

/** Distance from the mark in per cent, top of the surface downward. */
export const LEVEL_STEPS = [2.5, 2, 1.5, 1, 0.5, -0.5, -1, -1.5, -2] as const;

export type Side = "long" | "short";

/** Who last published a call on the market, in the board's own words. */
export interface MarketCall {
  agent: string;
  /** Relative, as the row shows it ("2h ago"). */
  when: string;
}

/** What the venue charges and demands on one market. Fractions, except the account, in AUSD. */
export interface MarketLimits {
  /** Taker fee on an order's notional. */
  takerFee: number;
  /** Below this share of the notional the position is liquidated. */
  maintenanceMargin: number;
  /** How far a market order may slip before it expires unfilled. */
  slippageCap: number;
  /** The smallest deposit that opens an account on the venue. */
  minimumAccountOpen: number;
}

/**
 * Where a market's figures came from. A sample says so and nothing else; a venue names its network,
 * when the venue's answer was received, and whether that answer is older than the board would like
 * because the venue could not be reached since.
 */
export type MarketSource =
  | { venue: "sample" }
  | { venue: "perpl"; network: "mainnet" | "testnet"; observedAt: string; stale: boolean };

/** The venue could not be read and nothing recent enough is held. Never answered with an empty board. */
export class MarketDataUnavailableError extends Error {
  readonly code = "MARKET_DATA_UNAVAILABLE";

  constructor(source: string, options?: { cause?: unknown }) {
    super(`Market data unavailable: ${source}`, options);
    this.name = "MarketDataUnavailableError";
  }
}

export interface PerpMarket {
  /** "BTC-PERP", normalized. */
  symbol: string;
  /** The base asset alone ("BTC"), for the square mark on the row. */
  base: string;
  accent: Accent;
  /** Mark price on Perpl, which is what PnL, the take profit and liquidation all follow. */
  mark: number;
  /** Fraction over the last 24 hours, signed. */
  change24h: number;
  /** Fraction of the notional paid or received each hour, signed. */
  funding1h: number;
  /** Open interest in AUSD. */
  openInterest: number;
  maxLeverage: number;
  /** Agents that read this market at all. Null when nobody has counted: unknown is not zero. */
  agentsReading: number | null;
  /** Public calls of theirs still open on it. Null when nobody has counted. */
  openCalls: number | null;
  lastCall: MarketCall | null;
  /** One line on what is worth knowing about the market right now. */
  note: string;
  /**
   * The largest hourly move the market has made this month, in per cent — the same scale a square's
   * level is on. A square further than this inside an hour is refused rather than sold as a
   * plausible position. Null when it has not been measured, which refuses nothing.
   */
  hourlyReach: number | null;
  limits: MarketLimits;
  source: MarketSource;
}

/** A square an agent has a public call on. The surface marks it with a dot. */
export interface AgentSquare {
  level: number;
  horizon: Horizon;
  /** How many agents hold a call on that square. */
  agents: number;
}

export interface MarketDetail {
  market: PerpMarket;
  calls: AgentSquare[];
  /** Marks over the last 24 hours, oldest first, for the trail drawn beside the surface. */
  trail: number[];
  /**
   * Optional ISO UTC times aligned with trail: closed hourly candles use their closing time;
   * the final mark uses the board's observedAt. Missing times are unknown, never inferred.
   */
  trailTimestamps?: (string | null)[];
  /** Up to thirty days of timestamped hourly closes plus the observed mark, oldest first. */
  priceHistory?: { price: number; at: string }[];
}

/** The price a level away from the mark. */
export function levelPrice(mark: number, level: number): number {
  return mark * (1 + level / 100);
}

/** Above the mark is a long, below it a short. A square is never both. */
export function levelSide(level: number): Side {
  return level >= 0 ? "long" : "short";
}

/**
 * Why a square cannot be taken, or null when it can. The only limit today is reach: a level the
 * market has never covered in an hour is not a position, it is a lottery ticket.
 */
export function squareProblem(
  market: Pick<PerpMarket, "hourlyReach">,
  level: number,
  horizon: Horizon,
): "out-of-reach" | null {
  if (horizon === "1H" && market.hourlyReach !== null && Math.abs(level) > market.hourlyReach) {
    return "out-of-reach";
  }
  return null;
}
