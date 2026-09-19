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

export function createGetLanding(readModel: LandingReadModel) {
  return async (): Promise<LandingSnapshot> => {
    const snapshot = await readModel.getSnapshot();
    return {
      ...snapshot,
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
