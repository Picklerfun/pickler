import type { PasskeyAttestation } from "../domain/passkey.js";
import type { TurnkeyPolicy } from "../domain/agent-wallet-policies.js";

export interface CustodyAccount {
  userId: string;
  subOrganizationId: string;
  masterWalletId: string;
  rootUserId: string;
  address: string;
}

export interface StoredChallenge {
  userId: string;
  expiresAt: Date;
}

/**
 * Offers no read-only lookup on purpose. Every caller that reads a challenge spends it, so one
 * cannot survive a failed claim and be probed again. A `peek` would make check-then-consume
 * expressible and would drop that guarantee for every caller at once, including the add-passkey
 * flows — so the absence is the guarantee, and it belongs here rather than in each caller.
 */
export interface ChallengeStore {
  put(challenge: string, record: StoredChallenge): Promise<void>;
  /** Returns the record and deletes it in one statement, or null if it was not there. */
  consume(challenge: string): Promise<StoredChallenge | null>;
}

export interface RegistrationInput {
  userId: string;
  subOrganizationId: string;
  /**
   * The sub-organization's default wallet, recorded on the turnkey_orgs row. It carries the
   * same value as `walletId` below because registration mints exactly one wallet, but the two
   * are separate fields because they name different things and will part company: this one is
   * "whichever wallet this person's sub-organization treats as its main one", while `walletId`
   * is the wallet this particular registration created. An agent wallet minted later adds a
   * `wallets` row of its own with kind 'agent' and leaves `masterWalletId` where it pointed.
   */
  masterWalletId: string;
  rootUserId: string;
  /** The wallet created by this registration, recorded on the wallets row. */
  walletId: string;
  address: string;
  credentialId: string;
  label: string;
  transports: string[];
  deviceType: string;
}

/**
 * A passkey on an account, whole, as a person is shown it.
 *
 * Both nullable fields mean something and neither has a sensible default. `deviceType` is null for
 * a row whose transports named no device class. `lastUsedAt` is null for a passkey that has never
 * signed anything — which is a fact worth showing, not a blank to fill with the creation date.
 */
export interface Passkey {
  id: string;
  credentialId: string;
  label: string;
  transports: string[];
  deviceType: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface CustodyRepository {
  findByUserId(userId: string): Promise<CustodyAccount | null>;
  /**
   * Feeds `excludeCredentials` on a challenge, and nothing else.
   *
   * **Never read this to count an account's passkeys.** Its one caller degrades a failure to
   * `undefined` on purpose — a lookup failure must not stop somebody registering — so "this
   * account has no credentials" and "the database did not answer" leave here indistinguishable.
   * That is the right contract for an exclusion list and the wrong one for anything that makes a
   * claim about somebody's safety: a security headline read off this would one day say "covered"
   * because Postgres was down. `listPasskeys` below is the read with the opposite contract.
   */
  listCredentials(userId: string): Promise<{ credentialId: string; transports: string[] }[]>;
  /**
   * Every passkey on the account, oldest first.
   *
   * Separate from `listCredentials` because the contracts are opposite and not because the columns
   * differ. **Errors propagate.** A caller of this is answering "can you still reach your funds if
   * you lose this device", and the only honest answer to a failed lookup is that it could not be
   * checked — never an empty list, which reads as "no passkeys" and is the more alarming of the
   * two lies. Anything that wraps this in a catch and returns `[]` has merged the two methods
   * again in the one place it matters.
   */
  listPasskeys(userId: string): Promise<Passkey[]>;
  /**
   * One transaction across turnkey_orgs, wallets, wallet_accounts and passkeys.
   * Returns `created: false` when the unique index on user_id already holds a row,
   * which is how a concurrent double submit is told apart from a failure.
   */
  saveRegistration(input: RegistrationInput): Promise<{ created: boolean }>;
  addPasskey(input: {
    userId: string;
    credentialId: string;
    label: string;
    transports: string[];
    deviceType: string;
  }): Promise<void>;
}

export interface SubOrganizationCreator {
  create(input: {
    /** A human label for the Turnkey dashboard, never an email: it is only a name there. */
    ownerLabel: string;
    discriminator: string;
    label: string;
    challenge: string;
    attestation: PasskeyAttestation;
  }): Promise<{
    subOrganizationId: string;
    walletId: string;
    address: string;
    rootUserId: string;
  }>;
}

export interface UnsignedActivity {
  url: string;
  body: string;
  timestampMs: string;
  organizationId: string;
}

export interface AddPasskeyActivityBuilder {
  build(input: {
    subOrganizationId: string;
    rootUserId: string;
    label: string;
    challenge: string;
    attestation: PasskeyAttestation;
  }): UnsignedActivity;
}

/**
 * The unsigned bodies of an agent's wallet ceremony, each stamped by the person's passkey in the
 * browser and forwarded unchanged. Nothing here is signed by Pickler: the parent key is not a
 * voter inside a sub-organization, and the delegated user is only ever created by the person.
 */
export interface AgentWalletActivityBuilders {
  /** One non-root user, "Pickler", whose only credential is Pickler's delegated API key. */
  createDelegatedUser(input: { subOrganizationId: string; publicKey: string }): UnsignedActivity;
  /** One wallet named after the agent's handle, with the single Monad account. */
  createAgentWallet(input: { subOrganizationId: string; handle: string }): UnsignedActivity;
  createPolicies(input: {
    subOrganizationId: string;
    policies: readonly TurnkeyPolicy[];
  }): UnsignedActivity;
  /** An Ethereum-format transaction signed by a wallet account the passkey controls. */
  signTransaction(input: {
    subOrganizationId: string;
    signWith: string;
    unsignedTransaction: string;
  }): UnsignedActivity;
}

export interface AgentWallet {
  walletId: string;
  address: string;
}

export interface AgentWalletRepository {
  /**
   * Records Pickler's user inside the person's sub-organization. Idempotent for the same id;
   * refuses (`DelegatedUserExistsError`) when a different one is already recorded, because two
   * delegated users would mean one of them is a key nobody is watching.
   */
  saveDelegatedUser(userId: string, delegatedUserId: string): Promise<void>;
  delegatedUserId(userId: string): Promise<string | null>;
  /** The wallets row and its one account, in one transaction. */
  saveWallet(input: {
    userId: string;
    walletId: string;
    subOrganizationId: string;
    kind: "agent";
    name: string;
    address: string;
    path: string;
  }): Promise<void>;
  /**
   * An agent wallet of this person's with this name that no agent is linked to: a creation that
   * failed between the wallet and the link. Retrying finds it instead of minting a second one.
   */
  findOrphanWallet(userId: string, name: string): Promise<AgentWallet | null>;
  /** This person's agent wallet with this id, linked or not; null for anyone else's. */
  findOwnedAgentWallet(userId: string, walletId: string): Promise<AgentWallet | null>;
  /**
   * Whether any wallet of this person's is linked to an agent. False means the ceremony in
   * progress is their first agent's, which is when the delegated user's self-delete policy is
   * written.
   */
  hasLinkedAgentWallet(userId: string): Promise<boolean>;
  /** The wallet linked to an agent through `agent_wallets`. */
  findAgentWallet(agentId: string): Promise<AgentWallet | null>;
  saveDeposit(input: { agentId: string; txHash: string; amountMicroUsd: bigint }): Promise<void>;
}
