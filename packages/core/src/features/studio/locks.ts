/** The balance an agent must hold before it runs alone, and before another agent is created. */
export const MIN_FUNDED_AUSD = 10;

/**
 * How many private drafts a workspace may hold at once. A draft has no wallet, so the funding lock
 * cannot count it; this keeps drafts from piling up until Go Public gives them one.
 */
export const MAX_DRAFTS_PER_WORKSPACE = 3;

export const LOCK_REASONS = ["first_run", "unfunded", "unfunded_agent", "draft_limit"] as const;
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

/**
 * One unfunded agent at a time: every agent with a wallet must hold the minimum. A private draft
 * has no wallet and is not among the balances; drafts close the lock only at their own limit.
 */
export function canCreateAnother(balancesAusd: readonly number[], drafts = 0): Lock {
  const allFunded = balancesAusd.every((balance) => balance >= MIN_FUNDED_AUSD);

  if (!allFunded) {
    return { ok: false, reason: "unfunded_agent" };
  }

  if (drafts >= MAX_DRAFTS_PER_WORKSPACE) {
    return { ok: false, reason: "draft_limit" };
  }

  return OPEN;
}
