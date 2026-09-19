import "server-only";
import type { LandingSnapshot } from "@pickler/core";
import type { LandingResponse } from "@pickler/api-schema";

export function toLandingResponse(snapshot: LandingSnapshot): LandingResponse {
  return {
    generatedAt: snapshot.generatedAt.toISOString(),
    source: snapshot.source,
    graduationTarget: snapshot.graduationTarget,
    stats: { ...snapshot.stats },
    tape: snapshot.tape.map((entry) => ({ ...entry })),
    spawns: snapshot.spawns.map((spawn) => ({
      ...spawn,
      createdAt: spawn.createdAt.toISOString(),
    })),
    backing: {
      fundedTotal: snapshot.backing.fundedTotal,
      recent: snapshot.backing.recent.map((deposit) => ({
        ...deposit,
        depositedAt: deposit.depositedAt.toISOString(),
      })),
    },
    launches: snapshot.launches.map((launch) => ({ ...launch })),
    leaderboard: snapshot.leaderboard.map((score) => ({ ...score })),
    picks: snapshot.picks.map((pick) => ({
      ...pick,
      updatedAt: pick.updatedAt.toISOString(),
      steps: pick.steps.map((step) => ({ ...step, at: step.at?.toISOString() ?? null })),
    })),
    announcements: snapshot.announcements.map((announcement) => ({ ...announcement })),
  };
}
