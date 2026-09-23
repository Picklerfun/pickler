import type { PasskeyAttestation } from "../domain/passkey.js";

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
  masterWalletId: string;
  rootUserId: string;
  walletId: string;
  address: string;
  credentialId: string;
  label: string;
  transports: string[];
  deviceType: string;
}

export interface CustodyRepository {
  findByUserId(userId: string): Promise<CustodyAccount | null>;
  listCredentials(userId: string): Promise<{ credentialId: string; transports: string[] }[]>;
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
    ownerEmail: string;
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
