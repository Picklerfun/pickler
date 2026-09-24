import type { AgentProfileDto } from "@pickler/api-schema";

/** What every public agent DTO says about its token: a ticker and a slug, or neither. */
interface TokenNamed {
  ticker: string | null;
  slug: string | null;
}

/** A profile the token pages can draw: the agent has launched a token, so it has a ticker and a slug. */
export type TokenProfileDto = AgentProfileDto & { ticker: string; slug: string };

/** The ticker and the slug arrive together, so one question covers both. */
export const hasToken = <T extends TokenNamed>(
  agent: T,
): agent is T & { ticker: string; slug: string } => agent.ticker !== null && agent.slug !== null;
