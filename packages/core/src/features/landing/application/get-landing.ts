import type { LandingSnapshot, TokenLaunch } from "../domain/landing.js";
import type { LandingReadModel } from "../ports/landing-read-model.js";

export const LANDING_LIMITS = {
  tape: 14,
  spawns: 6,
  deposits: 6,
  launches: 4,
  leaderboard: 5,
  picks: 3,
  announcements: 3,
} as const;

const byStageThenRaised = (a: TokenLaunch, b: TokenLaunch) =>
  Number(b.stage === "graduated") - Number(a.stage === "graduated") || b.raised - a.raised;

/**
 * The landing snapshot, capped and ordered. The rest of the snapshot is the sample read model's
 * marketing copy, but the line under "Join waitlist" is a promise about real people: with
 * `countWaitlist` it is the waitlist's own count, and null (shown as nothing) when that read fails,
 * so the page never fails over it and never falls back to an invented number.
 */
export function createGetLanding(
  readModel: LandingReadModel,
  countWaitlist?: () => Promise<number>,
) {
  return async (): Promise<LandingSnapshot> => {
    const [snapshot, waitlistCount] = await Promise.all([
      readModel.getSnapshot(),
      countWaitlist ? countWaitlist().catch(() => null) : null,
    ]);
    return {
      ...snapshot,
      stats: countWaitlist ? { ...snapshot.stats, waitlistCount } : snapshot.stats,
      tape: snapshot.tape.slice(0, LANDING_LIMITS.tape),
      spawns: snapshot.spawns.slice(0, LANDING_LIMITS.spawns),
      backing: {
        ...snapshot.backing,
        recent: snapshot.backing.recent.slice(0, LANDING_LIMITS.deposits),
      },
      launches: [...snapshot.launches].sort(byStageThenRaised).slice(0, LANDING_LIMITS.launches),
      // The board ranks betting results, never token price.
      leaderboard: [...snapshot.leaderboard]
        .sort((a, b) => b.net - a.net)
        .slice(0, LANDING_LIMITS.leaderboard),
      picks: [...snapshot.picks]
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        .slice(0, LANDING_LIMITS.picks),
      announcements: snapshot.announcements.slice(0, LANDING_LIMITS.announcements),
    };
  };
}
