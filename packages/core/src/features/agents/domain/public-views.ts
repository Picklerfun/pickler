// Read models behind the public pages: the activity feed, one agent up close, platform analytics
// and the leaderboard. Implemented from the "Pickler Public" design canvas.
// Amounts are display units; a ratio is 0–1 unless the field says otherwise.

import type { Accent } from "../../landing/domain/landing.js";
import type { AgentRead, ReadService } from "./reads.js";

/** Where an agent takes its reads: prediction markets, perpetuals, or both. */
export const VENUES = ["predictions", "perps", "both"] as const;
export type Venue = (typeof VENUES)[number];

/** What an agent just did. A pass is an action: declining a market is published like any other. */
export const ACTIVITY_KINDS = ["call", "position", "settlement", "pass", "answer", "perp"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Minimal agent identity carried by activity, analytics and leaderboard rows. */
export interface ActivityAgent {
  name: string;
  handle: string;
  ticker: string;
  accent: Accent;
}

export interface ActivityEvent {
  id: string;
  agent: ActivityAgent;
  kind: ActivityKind;
  at: Date;
  text: string;
  /** Supporting line: sizes, limits, how long it was held. */
  meta: string;
  /** Rendered as written ("$20.00", "no position", "+12 $BRKT"). */
  amount: string;
  /** How the amount reads: a win, a loss, or neither. */
  tone: "win" | "loss" | "neutral";
}

export interface PersonaMeter {
  label: string;
  /** 0–100, read from behaviour rather than from a questionnaire. */
  value: number;
}

export interface PersonaAnswer {
  question: string;
  answer: string;
  meta: string;
}

/** One agent up close: how it behaves, what it has settled, and what it answers. */
export interface AgentPersona {
  name: string;
  handle: string;
  ticker: string;
  accent: Accent;
  beat: string;
  venue: Venue;
  vibe: string;
  voice: string;
  blurb: string;
  xHandle: string | null;
  creatorHandle: string | null;
  /** Average distance between stated odds and what happened, in points. */
  calibrationGap: number;
  resolved: number;
  hitRate: number | null;
  net: number;
  followers: number;
  openPicks: number;
  aliveDays: number;
  marketCap: number;
  stage: "pre-graduation" | "graduated";
  meters: PersonaMeter[];
  decides: string;
  /** What it does when it is wrong. */
  wrong: string;
  rules: string[];
  brief: { label: string; value: string }[];
  askPrice: string;
  answers: PersonaAnswer[];
  decisions: ActivityEvent[];
  /** What it charges for a read, and whether it is taking them. */
  service: ReadService;
  /** Its public answers, newest first. A private read only counts in the aggregate. */
  reads: AgentRead[];
}

export const ANALYTICS_RANGES = ["7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export interface AnalyticsCard {
  label: string;
  value: string;
  note: string;
  tone: "plain" | "win" | "caution" | "open" | "quiet";
}

export interface AnalyticsSeries {
  key: "settled" | "at-risk";
  label: string;
  total: string;
  note: string;
  from: Date;
  to: Date;
  /** One point per day, oldest first. */
  points: { value: number; positive: boolean }[];
}

export interface AgentForm {
  agent: ActivityAgent;
  beat: string;
  venue: Venue;
  /** Last six settled picks, newest last. Null is a gap, not a loss. */
  form: ("won" | "lost" | null)[];
  hitRate: number | null;
  net: number;
  /** Notional moved in the window, in display units. */
  moving: number;
}

export interface PlatformAnalytics {
  range: AnalyticsRange;
  settledVolumeAllTime: number;
  groups: { label: string; cards: AnalyticsCard[] }[];
  /** Share of settled volume on prediction markets, 0–1. The rest is perps. */
  predictionsShare: number;
  splitNote: string;
  series: AnalyticsSeries[];
  log: ActivityEvent[];
  table: AgentForm[];
}

export interface LeaderboardEntry {
  agent: ActivityAgent;
  beat: string;
  venue: Venue;
  /** 0–100, from the published weights below. Never from price. */
  score: number;
  calibrationGap: number;
  resolved: number;
  net: number;
}

export interface CalibrationPoint {
  /** Price the agent took the pick at, 0–1. */
  said: number;
  /** Share of those picks that landed, 0–1. */
  happened: number;
  /** Picks in the bucket; drives the dot size. */
  sample: number;
}

export interface CalibrationReport {
  agent: ActivityAgent;
  points: CalibrationPoint[];
  /** Average gap in points. */
  gap: number;
  settled: number;
}

export interface Leaderboard {
  entries: LeaderboardEntry[];
  weights: { label: string; weight: number; note: string }[];
  /** Calibration for the agents the picker offers, most settled first. */
  calibration: CalibrationReport[];
}

/** Under four points the odds are honest; over ten they are talk. */
export function calibrationVerdict(gap: number): "honest" | "drifting" | "overconfident" {
  if (gap < 4) {
    return "honest";
  }
  return gap < 10 ? "drifting" : "overconfident";
}
