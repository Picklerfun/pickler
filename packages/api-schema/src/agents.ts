import type { AgentTokenDto } from "./token-launch.js";
// Public agent board, profile and pick detail. Timestamps are ISO strings,
// amounts are MON, token prices are MON per token, probability prices are 0–1.

import type { AccentDto, PickOutcomeDto, PickTrailStepDto } from "./landing.js";

export type ChartRangeDto = "5m" | "1h" | "4h" | "1d";

// Mirrors `VENUES` in core, which this package may not import; a drift test in workers/api pins it.
export const VENUES = ["predictions", "perps", "both"] as const;
export type VenueDto = (typeof VENUES)[number];
export type ActivityKindDto = "call" | "position" | "settlement" | "pass" | "answer" | "perp";

export interface AdvicePriceDto {
  amount: string;
  asset: "AUSD";
  decimals: 6;
}

export interface AgentSummaryDto {
  id: string;
  advicePrice: AdvicePriceDto | null;
  /** Null until the agent launches a token; the slug names the token's page. */
  slug: string | null;
  name: string;
  handle: string;
  /** Null until the agent launches a token. */
  ticker: string | null;
  beat: string;
  accent: AccentDto;
  venue: VenueDto;
  createdAt: string;
  resolved: number;
  hitRate: number | null;
  net: number;
  token: {
    stage: "pre-graduation" | "graduated";
    marketCap: number;
    raised: number;
    graduationTarget: number;
    volume24h: number;
    price: number;
    change24h: number;
    address: string | null;
    chain: string;
  } | null;
}

export interface ActivityAgentDto {
  name: string;
  handle: string;
  ticker: string | null;
  slug: string | null;
  accent: AccentDto;
}

export interface ActivityEventDto {
  id: string;
  agent: ActivityAgentDto;
  kind: ActivityKindDto;
  at: string;
  text: string;
  meta: string;
  amount: string;
  tone: "win" | "loss" | "neutral";
}

export interface AgentPersonaDto {
  id: string;
  advicePrice: AdvicePriceDto | null;
  /** Confirmed token on the configured network. Missing on historical clients. */
  launchedToken?: AgentTokenDto | null | undefined;
  tokenConfirmation?: "absent" | "pending" | "confirmed" | undefined;
  name: string;
  handle: string;
  ticker: string | null;
  slug: string | null;
  accent: AccentDto;
  beat: string;
  venue: VenueDto;
  vibe: string;
  voice: string;
  blurb: string;
  xHandle: string | null;
  creatorHandle: string | null;
  /** Null until settlement exists. */
  calibrationGap: number | null;
  resolved: number;
  hitRate: number | null;
  net: number;
  openPicks: number;
  aliveDays: number;
  /** Null until a token is launched. */
  marketCap: number | null;
  stage: "pre-graduation" | "graduated" | null;
  meters: { label: string; value: number }[];
  decides: string;
  wrong: string;
  askPrice: string | null;
  answers: { question: string; answer: string; meta: string }[];
  decisions: ActivityEventDto[];
  /** 0–100, the same score the leaderboard ranks by. Null until settlement exists. */
  score: number | null;
  /** Null until paid reads exist. */
  service: ReadServiceDto | null;
  reads: AgentReadDto[];
}

export type DeliveryStateDto = "preparing" | "delivered" | "failed";
export type ReadEvaluationDto = "pending" | "happened" | "missed" | "not_evaluable" | "none";

export interface ReadServiceDto {
  open: boolean;
  closedNote: string | null;
  /** In AUSD. */
  price: number;
  /** Each market with the question a read on it would answer. */
  markets: { name: string; question: string }[];
  typical: string;
  sla: string;
  slots: string;
  evaluated: number;
  gap: number;
}

export interface AgentReadDto {
  id: string;
  agent: ActivityAgentDto;
  beat: string;
  venue: VenueDto;
  market: string;
  question: string;
  paid: number;
  when: string;
  delivery: DeliveryStateDto;
  evaluation: ReadEvaluationDto;
  evaluatesIn: string | null;
  isPublic: boolean;
  answer: {
    probability: number;
    summary: string;
    reasons: string[];
    sources: { name: string; at: string }[];
    limits: string;
    reference: string;
    issuedAt: string;
    evaluatesAt: string;
  } | null;
  outcome: { final: string; observedAt: string } | null;
}

export interface DirectoryAgentRefDto extends ActivityAgentDto {
  id: string;
  advicePrice: AdvicePriceDto | null;
}

export interface DirectoryAgentDto {
  agent: DirectoryAgentRefDto;
  beat: string;
  venue: VenueDto;
  decides: string;
  /** Null until settlement exists. */
  score: number | null;
  hitRate: number | null;
  resolved: number;
  net: number;
  /** Null until paid reads exist. */
  service: ReadServiceDto | null;
}

export type AnalyticsRangeDto = "7d" | "30d" | "90d";

export interface PlatformAnalyticsDto {
  range: AnalyticsRangeDto;
  settledVolumeAllTime: number;
  groups: {
    label: string;
    cards: {
      label: string;
      value: string;
      note: string;
      tone: "plain" | "win" | "caution" | "open" | "quiet";
    }[];
  }[];
  predictionsShare: number;
  splitNote: string;
  series: {
    key: "settled" | "at-risk";
    label: string;
    total: string;
    note: string;
    from: string;
    to: string;
    points: { value: number; positive: boolean }[];
  }[];
  log: ActivityEventDto[];
  table: {
    agent: ActivityAgentDto;
    beat: string;
    venue: VenueDto;
    form: ("won" | "lost" | null)[];
    hitRate: number | null;
    net: number;
    moving: number;
  }[];
}

export interface LeaderboardDto {
  entries: {
    agent: ActivityAgentDto;
    beat: string;
    venue: VenueDto;
    score: number;
    calibrationGap: number;
    resolved: number;
    net: number;
  }[];
  weights: { label: string; weight: number; note: string }[];
  calibration: {
    agent: ActivityAgentDto;
    points: { said: number; happened: number; sample: number }[];
    gap: number;
    settled: number;
  }[];
}

export interface AgentCallDto {
  id: string;
  call: string;
  outcome: PickOutcomeDto;
  stake: number;
  entryPrice: number | null;
  calledAt: string;
  pnl: number | null;
}

export interface AgentProfileDto extends AgentSummaryDto {
  blurb: string;
  xHandle: string | null;
  creatorHandle: string | null;
  openPicks: number;
  market: {
    price: number;
    change24h: number;
    holders: number;
    liquidity: number | null;
    buybacks: number;
    candles: Record<
      ChartRangeDto,
      { at: string; open: number; high: number; low: number; close: number }[]
    >;
    topHolders: { label: string; share: number }[];
  } | null;
  calls: AgentCallDto[];
}

export interface PickDetailDto extends AgentCallDto {
  agent: {
    slug: string | null;
    name: string;
    ticker: string | null;
    beat: string;
    accent: AccentDto;
    xHandle: string | null;
  };
  thesis: string;
  maxPrice: number | null;
  settledAt: string | null;
  post: { text: string; url: string | null; views: number | null } | null;
  steps: PickTrailStepDto[];
  chain: { positionTx: string | null; settlementTx: string | null; agentWallet: string | null };
}
