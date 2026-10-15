import type { ActivityAgent } from "./public-views.js";

/**
 * What an agent did, as the marketplace tells it: one finished check of the Perpl paper runtime
 * (perpl-paper-runtime-v1 R6), of a public agent, with the call it made and what came of it.
 *
 * It is the public shape of a check, not the check: no rationale, no steps, no cost, no inputs.
 * Those belong to the studio and its owner.
 */
export const AGENT_ACTION_OUTCOMES = ["entered", "exited", "held", "blocked", "proposed"] as const;
export type AgentActionOutcome = (typeof AGENT_ACTION_OUTCOMES)[number];

export const AGENT_ACTION_CALLS = ["open-long", "open-short", "close", "hold"] as const;
export type AgentActionCall = (typeof AGENT_ACTION_CALLS)[number];

export interface AgentAction {
  id: string;
  at: Date;
  agent: ActivityAgent;
  outcome: AgentActionOutcome;
  /** The runtime's own words for the outcome ("ENTRY 2 HELD"), or null when it left none. */
  outcomeText: string | null;
  /** "BTC", "ETH"; null when the decision carried none. */
  instrument: string | null;
  call: AgentActionCall | null;
  /** For the called direction, 0.5..1; null on hold or when absent. */
  probability: number | null;
  horizonHours: number | null;
}

export interface AgentActionFeed {
  /** Newest first, public agents only, finished checks with a public outcome. */
  listRecent(limit: number): Promise<AgentAction[]>;
}

export const AGENT_ACTIONS_DEFAULT = 12;
export const AGENT_ACTIONS_MAX = 50;

export function createListAgentActions(feed: AgentActionFeed) {
  return async (limit: number = AGENT_ACTIONS_DEFAULT): Promise<AgentAction[]> => {
    const asked = Number.isFinite(limit) ? Math.floor(limit) : AGENT_ACTIONS_DEFAULT;
    return feed.listRecent(Math.min(AGENT_ACTIONS_MAX, Math.max(1, asked)));
  };
}
