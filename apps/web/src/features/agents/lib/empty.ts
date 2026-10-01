import type { LeaderboardDto } from "@pickler/api-schema";

/*
 * The launch-day questions. Each public board draws a designed empty screen instead of a filter
 * with nothing under it, and these are the decisions those screens are made from. They live here,
 * apart from the components, so the root suite can test them.
 */

/** The directory has nobody in it: the first agents are still being built. */
export const noAgents = (agents: readonly unknown[]): boolean => agents.length === 0;

/** A rank is earned by settlement. With no entry settled there is nothing to rank. */
export const nothingRanked = (board: Pick<LeaderboardDto, "entries">): boolean =>
  board.entries.length === 0;
