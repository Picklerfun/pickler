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
 * - `wallet` — the sub-organization when there is none (the existing enrolment ceremony, which is
 *   its own passkey prompt), the delegated user when there is none, then the agent's wallet named
 *   for its handle. A wallet left behind by an earlier attempt that failed before its link comes
 *   back from `prepareWallet` as `existing` and is reused without another prompt.
 * - `rules` — the wallet's policies, approved by the passkey. No policies, no link.
 * - `agent` — the agent, created with the wallet whose policies were just approved.
 * - `run` — its first run.
 *
 * A first agent is four prompts (register, delegated user, wallet, policies); every later one is
 * two (wallet, policies). Any failure propagates, and nothing after the failed step runs.
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

export interface AgentWallet {
  walletId: string;
  address: string;
}

export interface CeremonyDeps {
  state(): Promise<{ hasSubOrganization: boolean; hasDelegatedUser: boolean }>;
  /** The sub-organization and its master wallet: the existing enrolment ceremony. */
  register(): Promise<void>;
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  prepareDelegated(): Promise<UnsignedActivity>;
  confirmDelegated(signed: SignedActivity): Promise<void>;
  prepareWallet(handle: string): Promise<UnsignedActivity | { existing: AgentWallet }>;
  confirmWallet(handle: string, signed: SignedActivity): Promise<AgentWallet>;
  preparePolicies(walletId: string): Promise<UnsignedActivity>;
  confirmPolicies(walletId: string, signed: SignedActivity): Promise<{ policyIds: string[] }>;
  /** Builds the create body from the draft inside the caller; only the wallet comes from here. */
  createAgent(walletId: string): Promise<{ id: string }>;
  startRun(agentId: string): Promise<{ runId: string }>;
  onStep(step: CeremonyStep, state: "start" | "done"): void;
  /** Called once the wallet exists, so the screen can name its address before the run does. */
  onWallet?(wallet: AgentWallet): void;
}

export interface CeremonyResult {
  agentId: string;
  runId: string;
  address: string;
}

const isExisting = (
  prepared: UnsignedActivity | { existing: AgentWallet },
): prepared is { existing: AgentWallet } => "existing" in prepared;

async function wallet(deps: CeremonyDeps, handle: string): Promise<AgentWallet> {
  const state = await deps.state();

  if (!state.hasSubOrganization) {
    await deps.register();
  }

  if (!state.hasDelegatedUser) {
    const unsigned = await deps.prepareDelegated();
    await deps.confirmDelegated(await deps.stamp(unsigned));
  }

  const prepared = await deps.prepareWallet(handle);
  if (isExisting(prepared)) {
    return prepared.existing;
  }
  return deps.confirmWallet(handle, await deps.stamp(prepared));
}

export async function runCeremony(deps: CeremonyDeps, handle: string): Promise<CeremonyResult> {
  deps.onStep("wallet", "start");
  const created = await wallet(deps, handle);
  deps.onWallet?.(created);
  deps.onStep("wallet", "done");

  deps.onStep("rules", "start");
  const policies = await deps.preparePolicies(created.walletId);
  await deps.confirmPolicies(created.walletId, await deps.stamp(policies));
  deps.onStep("rules", "done");

  deps.onStep("agent", "start");
  const agent = await deps.createAgent(created.walletId);
  deps.onStep("agent", "done");

  deps.onStep("run", "start");
  const run = await deps.startRun(agent.id);
  deps.onStep("run", "done");

  return { agentId: agent.id, runId: run.runId, address: created.address };
}
