// Public wire format for GET /api/v1/landing. Timestamps are ISO 8601 strings;
// amounts are MON in display units.

export type AccentDto = "lime" | "cyan" | "amber" | "orange" | "magenta" | "violet" | "blue";
export type PickOutcomeDto = "open" | "won" | "lost";

export interface AgentRefDto {
  name: string;
  ticker: string;
  beat: string;
  accent: AccentDto;
  markSize: number;
}

export interface PickTrailStepDto {
  title: string;
  /** Null when the step describes the current state. */
  at: string | null;
  note: string;
  tone: "signal" | "agent" | "caution" | "win" | "loss";
  figure: { text: string; tone: "neutral" | "caution" | "win" | "loss" } | null;
}

export interface LandingResponse {
  generatedAt: string;
  source: "sample" | "live";
  graduationTarget: number;
  stats: {
    totalVolume: number;
    totalMarketCap: number;
    agentsFunded: number;
    agentsCreated: number;
    agentsCreatedToday: number;
    picksToday: number;
    waitlistCount: number;
  };
  tape: {
    ticker: string;
    call: string;
    outcome: PickOutcomeDto;
    stake: number;
    pnl: number | null;
  }[];
  spawns: { name: string; accent: AccentDto; createdAt: string }[];
  backing: {
    fundedTotal: number;
    recent: { agent: AgentRefDto; amount: number; depositedAt: string }[];
  };
  launches: {
    agent: AgentRefDto;
    summary: string;
    stage: "pre-graduation" | "graduated";
    marketCap: number;
    raised: number;
  }[];
  leaderboard: { agent: AgentRefDto; resolved: number; hitRate: number; net: number }[];
  picks: {
    agent: AgentRefDto;
    outcome: PickOutcomeDto;
    updatedAt: string;
    steps: PickTrailStepDto[];
  }[];
  announcements: { tag: string; title: string; body: string; cta: string; href: string }[];
}
