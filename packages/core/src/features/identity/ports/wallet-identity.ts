import type { Namespace, NormalizedAddress } from "../domain/wallet-auth.js";

export interface WalletLink {
  userId: string;
  namespace: Namespace;
  address: NormalizedAddress;
  verifiedChain: string;
  kind: "external" | "mera";
  verifiedAt: Date;
}

export interface NonceStore {
  issue(nonce: string, expiresAt: Date): Promise<void>;
  /**
   * Single-use. Returns the row and deletes it in one statement, so two concurrent verifications
   * of the same nonce cannot both succeed. Returns null when it never existed or was already
   * taken — indistinguishable on purpose: both mean "ask for a new one".
   */
  consume(nonce: string): Promise<{ expiresAt: Date } | null>;
}

export interface WalletLinkRepository {
  findByAddress(namespace: Namespace, address: NormalizedAddress): Promise<WalletLink | null>;
  /** `created: false` means the unique index already held this address for another account. */
  link(link: Omit<WalletLink, "verifiedAt">): Promise<{ created: boolean }>;
  /** Errors propagate: "no wallets" and "could not read" are different facts. */
  listForUser(userId: string): Promise<WalletLink[]>;
}

export interface SignatureVerifier {
  /** True only when `signature` was produced by `address` over exactly `message`. */
  verify(input: {
    message: string;
    signature: string;
    address: NormalizedAddress;
  }): Promise<boolean>;
}

export interface AccountProvisioner {
  /** The Supabase user for this address, created on first sight. */
  forAddress(namespace: Namespace, address: NormalizedAddress): Promise<{ userId: string }>;
  /** A session for an existing user, minted server-side. */
  session(userId: string): Promise<{ accessToken: string; refreshToken: string }>;
}
