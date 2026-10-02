// apps/web/src/features/studio/new-agent/ceremony.ts
/**
 * The create screen's two signature moments, as sequences and nothing else (spec §3.1):
 *
 * - `createWallet`: "Create its wallet". Step 1 is the wallet under the person's passkey; step 2,
 *   the first time only, is Pickler's delegated user ("Let Pickler trade from it"). A wallet an
 *   earlier attempt left unlinked comes back from `prepareWallet` as `existing` and is reused
 *   without a stamp or a step 1, so a press after a cancelled step 2 starts at step 2.
 * - `createAgent`: "Create {name}". The wallet's policies (one stamp), then the draft. Skipped when
 *   the policies were already approved (a retry), so they are never written twice.
 *
 * No React, no transport and no `@pickler/api-schema` value import, so the order is pinned from
 * node:test with fakes (`apps/web/test/studio-new-agent-ceremony.test.ts`).
 */
export interface UnsignedActivity {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}
export interface SignedActivity {
  url: string;
  body: string;
  stamp: { stampHeaderName: string; stampHeaderValue: string };
}

export interface WalletDeps {
  state(): Promise<{ hasSubOrganization: boolean; hasDelegatedUser: boolean }>;
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  prepareWallet(): Promise<
    | UnsignedActivity
    | { existing: { walletId: string; address: string; policiesApproved: boolean } }
  >;
  confirmWallet(signed: SignedActivity): Promise<{ walletId: string; address: string }>;
  prepareDelegated(): Promise<UnsignedActivity>;
  confirmDelegated(signed: SignedActivity): Promise<void>;
  /** 1 while the wallet is made, 2 while the delegated user is. */
  onStep(step: 1 | 2): void;
  /**
   * Waits for the person to press Continue again before step 2, when step 1 just prompted. A
   * browser may refuse a second passkey prompt that no press started; a rejection stops here and
   * keeps the wallet, so the next press starts at step 2.
   */
  beforeStep2?(): Promise<void>;
}

/** The person has no sub-organization: send them to signup's passkey step. Thrown before any prompt. */
export class NoSubOrganization extends Error {
  constructor() {
    super("Your wallet has not been created yet. Create it with your passkey first.");
    this.name = "NoSubOrganization";
  }
}

export async function createWallet(
  deps: WalletDeps,
): Promise<{ walletId: string; address: string; policiesApproved: boolean }> {
  const state = await deps.state();
  if (!state.hasSubOrganization) {
    throw new NoSubOrganization();
  }
  const prepared = await deps.prepareWallet();
  let wallet: { walletId: string; address: string; policiesApproved: boolean };
  const stamped = !("existing" in prepared);
  if ("existing" in prepared) {
    wallet = prepared.existing;
  } else {
    deps.onStep(1);
    wallet = { ...(await deps.confirmWallet(await deps.stamp(prepared))), policiesApproved: false };
  }
  if (!state.hasDelegatedUser) {
    deps.onStep(2);
    if (stamped && deps.beforeStep2) {
      await deps.beforeStep2();
    }
    await deps.confirmDelegated(await deps.stamp(await deps.prepareDelegated()));
  }
  return wallet;
}

export interface CreateDeps {
  stamp(unsigned: UnsignedActivity): Promise<SignedActivity>;
  preparePolicies(walletId: string): Promise<UnsignedActivity>;
  confirmPolicies(walletId: string, signed: SignedActivity): Promise<{ policyIds: string[] }>;
  createDraft(): Promise<{ productId: string }>;
}

export async function createAgent(
  deps: CreateDeps,
  wallet: { walletId: string; policiesApproved: boolean },
): Promise<{ productId: string }> {
  if (!wallet.policiesApproved) {
    await deps.confirmPolicies(
      wallet.walletId,
      await deps.stamp(await deps.preparePolicies(wallet.walletId)),
    );
  }
  return deps.createDraft();
}
