import type { LeaderboardDto } from "@pickler/api-schema";
import { hasToken } from "./token-profile";

/*
 * The launch-day questions. Each public board draws a designed empty screen instead of a filter
 * with nothing under it, and these are the decisions those screens are made from. They live here,
 * apart from the components, so the root suite can test them the way it tests `hasToken`.
 */

/** The directory has nobody in it: the first agents are still being built. */
export const noAgents = (agents: readonly unknown[]): boolean => agents.length === 0;

/** The token board is the board of tokens, so an agent without one is not a row on it. */
export const agentsWithToken = <T extends { ticker: string | null; slug: string | null }>(
  agents: readonly T[],
): T[] => agents.filter(hasToken);

/** A rank is earned by settlement. With no entry settled there is nothing to rank. */
export const nothingRanked = (board: Pick<LeaderboardDto, "entries">): boolean =>
  board.entries.length === 0;
