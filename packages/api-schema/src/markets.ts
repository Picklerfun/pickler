// Perpetual markets on Perpl. Prices are in the market's quote currency, amounts are AUSD, and
// `change24h` and `funding1h` are signed fractions, not percentages already multiplied out.
//
// The options and limits below mirror the business rules in core so the client can draw the
// surface and quote a ticket without a round trip per keystroke. Core stays authoritative for
// anything that is sent.

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

/** What the venue charges and demands. Fractions, except the deposit, which is AUSD. */
export const PERP_LIMITS_DTO = {
  /** Below this share of the notional the position is liquidated. */
  maintenanceMargin: 0.05,
  /** Taker fee, charged on open only; closing is free. */
  takerFee: 0.0005,
  /** How far the open may slip before the immediate-or-cancel order expires unfilled. */
  slippageCap: 0.005,
  /** Smallest deposit that opens a Perpl account. */
  minimumDeposit: 10,
} as const;

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
  agentsReading: number;
  openCalls: number;
  lastCall: MarketCallDto | null;
  note: string;
  /** Largest hourly move this month, in per cent — the scale a square's level is on. */
  hourlyReach: number;
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
}
