/**
 * "Create and run it once", as a sequence and nothing else: which passkey prompt follows which,
 * what is skipped when it already exists, and where a failure stops.
 *
 * No React, no transport and no `@pickler/api-schema` value import, so the order can be pinned from
 * `node:test` with fakes (`apps/web/test/studio-ceremony.test.ts`). The screen hands in the real
 * routes and the passkey stamper; see `create.tsx`.
 *
 * Four steps, drawn as the first run's four-line rail (spec §4):
 *
 * - `wallet` — the delegated user when there is none, then the agent's wallet named for its handle.
 *   The sub-organization is not made here: it is born at signup (spec §4.1), and a person without
 *   one gets `NoSubOrganization` before any prompt, which the screen turns into a trip to
 *   the signup's passkey step. A wallet left behind by an earlier attempt that failed before its link comes back
 *   from `prepareWallet` as `existing` and is reused without another prompt.
 * - `rules` — the wallet's policies, approved by the passkey. No policies, no link. Skipped when
 *   the `existing` wallet's policies were already approved (a retry after a reload, which has lost
 *   the in-memory progress), so the rules are never written twice.
 * - `agent` — the agent, created with the wallet whose policies were just approved.
 * - `run` — its first run.
 *
 * A first agent is three prompts (delegated user, wallet, policies); every later one is two
 * (wallet, policies). Any failure propagates, and nothing after the failed step runs.
 */

export type CeremonyStep = "wallet" | "rules" | "agent" | "run";

export const CEREMONY_STEPS: readonly CeremonyStep[] = ["wallet", "rules", "agent", "run"];

/** The Turnkey request the browser must stamp, as the signing routes answer it. */
export interface UnsignedActivity {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

/** The same request, stamped by the passkey. */
export interface SignedActivity {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
}

interface AgentWallet {
  walletId: string;
  address: string;
}

/** A wallet an earlier attempt left unlinked, and whether its rules were already approved. */
interface ExistingWallet extends AgentWallet {
  policiesApproved: boolean;
}

/**
 * The person has no sub-organization, so there is nothing to put an agent's wallet in. Thrown
 * before any prompt; the screen sends them to the signup's passkey step, which creates it — this sequence never
 * does.
 */
export class NoSubOrganization extends Error {
  constructor() {
    super("Your wallet has not been created yet. Create it with your passkey first.");
    this.name = "NoSubOrganization";
  }
}

export interface CeremonyDeps {
  state(): Promise<{ hasSubOrganization: boolean; hasDelegatedUser: boolean }>;
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  prepareDelegated(): Promise<UnsignedActivity>;
  confirmDelegated(signed: SignedActivity): Promise<void>;
  prepareWallet(handle: string): Promise<UnsignedActivity | { existing: ExistingWallet }>;
  confirmWallet(handle: string, signed: SignedActivity): Promise<AgentWallet>;
  preparePolicies(walletId: string): Promise<UnsignedActivity>;
  confirmPolicies(walletId: string, signed: SignedActivity): Promise<{ policyIds: string[] }>;
  /** Builds the create body from the draft inside the caller; only the wallet comes from here. */
  createAgent(walletId: string): Promise<{ id: string }>;
  startRun(agentId: string): Promise<{ runId: string }>;
  onStep(step: CeremonyStep, state: "start" | "done"): void;
  /** Called once the wallet exists, so the screen can name its address before the run does. */
  onWallet?(wallet: AgentWallet): void;
  /**
   * Called once the custody state is read, before any prompt: whether this is the first agent,
   * whose Wallet line covers two prompts (Pickler's delegated key, then the wallet).
   */
  onFirstAgent?(first: boolean): void;
}

interface CeremonyResult {
  agentId: string;
  runId: string;
  address: string;
}

/**
 * What an attempt has already done, carried across retries of the same draft. `runCeremony`
 * writes each field the moment its step finishes, so a failure leaves behind exactly what exists,
 * and a retry resumes after it: a created agent is never re-approved, an approved wallet never
 * re-prompted.
 */
export interface CeremonyProgress {
  walletId?: string;
  address?: string;
  policiesApproved?: boolean;
  agentId?: string;
  runId?: string;
}

const isExisting = (
  prepared: UnsignedActivity | { existing: ExistingWallet },
): prepared is { existing: ExistingWallet } => "existing" in prepared;

async function wallet(
  deps: CeremonyDeps,
  handle: string,
  signal?: AbortSignal,
): Promise<AgentWallet & { policiesApproved?: boolean }> {
  const state = await deps.state();
  signal?.throwIfAborted();

  if (!state.hasSubOrganization) {
    throw new NoSubOrganization();
  }
  deps.onFirstAgent?.(!state.hasDelegatedUser);

  if (!state.hasDelegatedUser) {
    const unsigned = await deps.prepareDelegated();
    signal?.throwIfAborted();
    await deps.confirmDelegated(await deps.stamp(unsigned));
    signal?.throwIfAborted();
  }

  const prepared = await deps.prepareWallet(handle);
  if (isExisting(prepared)) {
    return prepared.existing;
  }
  signal?.throwIfAborted();
  return deps.confirmWallet(handle, await deps.stamp(prepared));
}

/**
 * Runs the ceremony from wherever `progress` says the last attempt stopped. A step already done is
 * reported as done without calling anything. `signal` is checked between calls, so a screen that
 * has gone away never raises another passkey prompt.
 */
export async function runCeremony(
  deps: CeremonyDeps,
  handle: string,
  progress: CeremonyProgress = {},
  signal?: AbortSignal,
): Promise<CeremonyResult> {
  signal?.throwIfAborted();

  deps.onStep("wallet", "start");
  if (!progress.walletId || !progress.address) {
    const created = await wallet(deps, handle, signal);
    progress.walletId = created.walletId;
    progress.address = created.address;
    if (created.policiesApproved) {
      progress.policiesApproved = true;
    }
  }
  const walletId = progress.walletId;
  const address = progress.address;
  deps.onWallet?.({ walletId, address });
  deps.onStep("wallet", "done");
  signal?.throwIfAborted();

  deps.onStep("rules", "start");
  if (!progress.policiesApproved) {
    const policies = await deps.preparePolicies(walletId);
    signal?.throwIfAborted();
    await deps.confirmPolicies(walletId, await deps.stamp(policies));
    progress.policiesApproved = true;
  }
  deps.onStep("rules", "done");
  signal?.throwIfAborted();

  deps.onStep("agent", "start");
  if (!progress.agentId) {
    progress.agentId = (await deps.createAgent(walletId)).id;
  }
  const agentId = progress.agentId;
  deps.onStep("agent", "done");
  signal?.throwIfAborted();

  deps.onStep("run", "start");
  if (!progress.runId) {
    progress.runId = (await deps.startRun(agentId)).runId;
  }
  deps.onStep("run", "done");

  return { agentId, runId: progress.runId, address };
}
