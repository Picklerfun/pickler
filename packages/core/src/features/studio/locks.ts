/** The balance an agent must hold before it runs alone, and before another agent is created. */
export const MIN_FUNDED_AUSD = 10;

export const LOCK_REASONS = ["first_run", "unfunded", "unfunded_agent"] as const;
export type LockReason = (typeof LOCK_REASONS)[number];

export type Lock = { ok: true; reason: null } | { ok: false; reason: LockReason };

const OPEN: Lock = { ok: true, reason: null };

/**
 * `ready` is the runtime's NOT_READY cleared (`isReadyToSchedule`): one successful manual run with
 * the current configuration. The first run comes first; funding is the second lock.
 */
export function canSchedule(input: { ready: boolean; balanceAusd: number }): Lock {
  if (!input.ready) {
    return { ok: false, reason: "first_run" };
  }

  if (input.balanceAusd < MIN_FUNDED_AUSD) {
    return { ok: false, reason: "unfunded" };
  }

  return OPEN;
}

/** One unfunded agent at a time: every agent the person owns must hold the minimum. */
export function canCreateAnother(balancesAusd: readonly number[]): Lock {
  const allFunded = balancesAusd.every((balance) => balance >= MIN_FUNDED_AUSD);

  if (!allFunded) {
    return { ok: false, reason: "unfunded_agent" };
  }

  return OPEN;
}
