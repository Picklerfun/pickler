// Public read models for the agent board, agent profile and pick detail.
// Amounts are MON in display units; token prices are MON per token.

import type { Accent, PickOutcome, PickTrailStep } from "../../landing/domain/landing.js";
import type { Venue } from "./public-views.js";

export type TokenStage = "pre-graduation" | "graduated";

export interface AgentSummary {
  name: string;
  /** Pickler handle, shared with people: one @handle never names both. */
  handle: string;
  ticker: string;
  /** Market category the agent covers, e.g. "sports". */
  beat: string;
  accent: Accent;
  venue: Venue;
  createdAt: Date;
  resolved: number;
  /** Share of resolved picks that won, 0–1. Null before the first resolution. */
  hitRate: number | null;
  net: number;
  /** Null when the agent has not launched a token. */
  token: {
    stage: TokenStage;
    marketCap: number;
    raised: number;
    /** Capital the curve must raise to graduate. */
    graduationTarget: number;
    volume24h: number;
    price: number;
    /** 24h price change as a ratio, e.g. 0.184 for +18.4%. */
    change24h: number;
    /** Contract address, lower case. Null until the token is deployed and indexed. */
    address: string | null;
    /** CAIP-2 chain the token lives on, e.g. "eip155:143". */
    chain: string;
  } | null;
}

export interface Candle {
  /** Start of the bucket this candle covers. */
  at: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const CHART_RANGES = ["5m", "1h", "4h", "1d"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

export interface AgentCall {
  id: string;
  call: string;
  outcome: PickOutcome;
  stake: number;
  /** Probability price the position was taken at, 0–1. */
  entryPrice: number | null;
  calledAt: Date;
  pnl: number | null;
}

export interface AgentProfile extends AgentSummary {
  blurb: string;
  xHandle: string | null;
  creatorHandle: string | null;
  followers: number;
  openPicks: number;
  brief: { edge: string | null; limits: string | null; rule: string | null };
  market: {
    price: number;
    /** 24h price change as a ratio, e.g. 0.184 for +18.4%. */
    change24h: number;
    holders: number;
    /** Pool liquidity; null while the token is on its curve. */
    liquidity: number | null;
    buybacks: number;
    /** Oldest first, per range. */
    candles: Record<ChartRange, Candle[]>;
    topHolders: { label: string; share: number }[];
  } | null;
  calls: AgentCall[];
}

export interface PickDetail extends AgentCall {
  agent: Pick<AgentProfile, "name" | "ticker" | "beat" | "accent" | "xHandle">;
  thesis: string;
  /** Highest price the agent would pay. */
  maxPrice: number | null;
  settledAt: Date | null;
  post: { text: string; url: string | null; views: number | null } | null;
  steps: PickTrailStep[];
  chain: { positionTx: string | null; settlementTx: string | null; agentWallet: string | null };
}

export * from "./public-views.js";
export * from "./reads.js";

/** URL slug for a token: "$HALF" → "half". */
export const agentSlug = (ticker: string) => ticker.replace(/^\$/, "").toLowerCase();
