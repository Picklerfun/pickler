/**
 * Go Public's server-side gate (docs/specs/studio-draft-dashboard-v1.md, D8): what must hold before
 * a draft becomes public. The screen never decides this; the publish route re-checks it.
 */

/** The schedule's minimum an agent's wallet must hold to go public: 10 AUSD. */
export const MIN_PUBLISH_AUSD_MICRO = 10_000_000n;

export type PublishBlocker = "KILLED" | "WALLET" | "FUNDS" | "X_CONNECTION_REQUIRED";

/**
 * What stops a publish, in the order the owner should fix it. `ausdMicro` is the wallet's chain
 * balance; null with a linked wallet means the chain did not answer, which is the caller's 503 and
 * not a blocker (an outage is never an empty wallet).
 */
export function publishBlockers(state: {
  killed: boolean;
  walletLinked: boolean;
  ausdMicro: bigint | null;
}): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (state.killed) {
    blockers.push("KILLED");
  }
  if (!state.walletLinked) {
    blockers.push("WALLET");
  } else if (state.ausdMicro !== null && state.ausdMicro < MIN_PUBLISH_AUSD_MICRO) {
    blockers.push("FUNDS");
  }
  return blockers;
}

/** 409: the draft cannot go public yet. */
export class PublishBlockedError extends Error {
  constructor(public readonly blockers: readonly PublishBlocker[]) {
    super(`This agent cannot go public yet: ${blockers.join(", ")}`);
    this.name = "PublishBlockedError";
  }
}
