// Read model for the public landing page. Amounts are MON in display units;
// this snapshot is for presentation and must not be used for accounting.

export const ACCENTS = ["lime", "cyan", "amber", "orange", "magenta", "violet", "blue"] as const;
export type Accent = (typeof ACCENTS)[number];

export interface AgentRef {
  name: string;
  ticker: string;
  /** Market category the agent covers, e.g. "sports". */
  beat: string;
  accent: Accent;
  /** Number of blocks in the agent's pixel mark, 1 to 4. */
  markSize: number;
}

export type PickOutcome = "open" | "won" | "lost";

export interface TapeEntry {
  ticker: string;
  call: string;
  outcome: PickOutcome;
  stake: number;
  /** Settled profit or loss; null while the pick is open. */
  pnl: number | null;
}

export interface PlatformStats {
  totalVolume: number;
  totalMarketCap: number;
  agentsFunded: number;
  agentsCreated: number;
  agentsCreatedToday: number;
  picksToday: number;
  waitlistCount: number;
}

export interface AgentSpawn {
  name: string;
  accent: Accent;
  createdAt: Date;
}

export interface BackingDeposit {
  agent: AgentRef;
  amount: number;
  depositedAt: Date;
}

export interface Backing {
  fundedTotal: number;
  recent: BackingDeposit[];
}

export type LaunchStage = "pre-graduation" | "graduated";

export interface TokenLaunch {
  agent: AgentRef;
  summary: string;
  stage: LaunchStage;
  marketCap: number;
  raised: number;
}

export interface AgentScore {
  agent: AgentRef;
  resolved: number;
  /** Share of resolved picks that won, from 0 to 1. */
  hitRate: number;
  net: number;
}

export type TrailTone = "signal" | "agent" | "caution" | "win" | "loss";

export interface PickTrailStep {
  title: string;
  /** Null when the step describes the current state. */
  at: Date | null;
  note: string;
  tone: TrailTone;
  figure: { text: string; tone: "neutral" | "caution" | "win" | "loss" } | null;
}

export interface PickTrail {
  agent: AgentRef;
  outcome: PickOutcome;
  updatedAt: Date;
  steps: PickTrailStep[];
}

export interface Announcement {
  tag: string;
  title: string;
  body: string;
  cta: string;
  href: string;
}

export interface LandingSnapshot {
  generatedAt: Date;
  /** Where the data came from, so presentation can label sample data. */
  source: "sample" | "live";
  graduationTarget: number;
  stats: PlatformStats;
  tape: TapeEntry[];
  spawns: AgentSpawn[];
  backing: Backing;
  launches: TokenLaunch[];
  leaderboard: AgentScore[];
  picks: PickTrail[];
  announcements: Announcement[];
}
