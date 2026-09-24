import type { AgentProfileDto } from "@pickler/api-schema";

/** A profile the token pages can draw: the agent has launched a token, so it has a ticker and a slug. */
export type TokenProfileDto = AgentProfileDto & { ticker: string; slug: string };

export const hasToken = (profile: AgentProfileDto): profile is TokenProfileDto =>
  profile.ticker !== null && profile.slug !== null;
