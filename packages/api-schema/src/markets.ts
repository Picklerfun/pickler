// Perpetual markets on Perpl. Prices are in the market's quote currency, amounts are AUSD, and
// `change24h` and `funding1h` are signed fractions, not percentages already multiplied out.
//
// The options below mirror the business rules in core so the client can draw the surface without a
// round trip per keystroke. What the venue charges and demands is not an option of ours: it travels
// with each market, in `limits`.

import type { AccentDto } from "./landing.js";

export type HorizonDto = "1H" | "4H" | "12H" | "24H";

/** The columns of the surface: how long a position is given before it closes. */
export const HORIZON_OPTIONS = ["1H", "4H", "12H", "24H"] as const;

/** Every read resolves a day out, whichever column picked its level. */
export const READ_HORIZON_DTO: HorizonDto = "24H";

/** The rows of the surface: distance from the mark in per cent, top down. */
export const LEVEL_OPTIONS = [2.5, 2, 1.5, 1, 0.5, -0.5, -1, -1.5, -2] as const;

/** The leverages a ticket offers, before the market's own ceiling cuts the list. */
export const LEVERAGE_OPTIONS = [2, 3, 5, 10] as const;

/** What the venue charges and demands on one market. Fractions, except the account, in AUSD. */
export interface MarketLimitsDto {
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
 * Where a market's figures came from. `observedAt` is when the venue's answer was received, as an
 * ISO timestamp; `stale` says the venue could not be reached since and this is the last answer.
 */
export type MarketSourceDto =
  | { venue: "sample" }
  | { venue: "perpl"; network: "mainnet" | "testnet"; observedAt: string; stale: boolean };

export interface MarketCallDto {
  agent: string;
  when: string;
}

export interface PerpMarketDto {
  symbol: string;
  base: string;
  accent: AccentDto;
  mark: number;
  change24h: number;
  funding1h: number;
  openInterest: number;
  maxLeverage: number;
  /** Null when nobody has counted: unknown, not zero. */
  agentsReading: number | null;
  openCalls: number | null;
  lastCall: MarketCallDto | null;
  note: string;
  /** Largest hourly move this month, in per cent — the scale a square's level is on. Null when unmeasured. */
  hourlyReach: number | null;
  limits: MarketLimitsDto;
  source: MarketSourceDto;
}

/** A square an agent holds a public call on. */
export interface AgentSquareDto {
  level: number;
  horizon: HorizonDto;
  agents: number;
}

export interface MarketDetailDto {
  market: PerpMarketDto;
  /**
   * The question a read on this market answers, with `{level}` where the chosen price goes. Core
   * writes the wording — a page fills in the number and never rewrites the sentence.
   */
  readQuestion: string;
  calls: AgentSquareDto[];
  /** Marks over the last 24 hours, oldest first. */
  trail: number[];
  /**
   * Optional ISO UTC times aligned with trail: closed hourly candles use their closing time;
   * the final mark uses the board's observedAt. Missing times are unknown, never inferred.
   */
  trailTimestamps?: (string | null)[] | undefined;
  /** Up to 720 hourly closes plus the observed mark. Missing history is not reconstructed. */
  priceHistory?: { price: number; at: string }[] | undefined;
}
