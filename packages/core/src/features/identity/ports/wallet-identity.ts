import type { Namespace, NormalizedAddress } from "../domain/wallet-auth.js";

export interface WalletLink {
  userId: string;
  namespace: Namespace;
  address: NormalizedAddress;
  verifiedChain: string;
  kind: "external" | "mera";
  verifiedAt: Date;
}

/**
 * Who a nonce was issued to: the address the message names. Unverified when the nonce is issued —
 * the signature is what proves it — but it is what the message will say, so it is what the nonce
 * is kept under and what a cap on open nonces counts.
 */
export interface NonceHolder {
  namespace: Namespace;
  address: NormalizedAddress;
}

/**
 * How many nonces one address may hold at once. The route that issues them is public, so without
 * a bound one address's rows grow for as long as anybody keeps asking. Five is more than a person
 * retrying in several tabs needs inside the five minutes a nonce lives.
 */
export const MAX_OPEN_NONCES_PER_ADDRESS = 5;

export interface NonceStore {
  /**
   * Never refuses. A holder already at `MAX_OPEN_NONCES_PER_ADDRESS` loses its oldest nonces to
   * make room: the address is unverified and anybody can ask in its name, so refusing would let
   * a stranger keep a wallet from signing in, where evicting costs its holder a retry. Every call
   * also deletes nonces that have expired, a bounded number at a time, because nothing else does.
   */
  issue(nonce: string, expiresAt: Date, holder: NonceHolder): Promise<void>;
  /**
   * Single-use. Returns the row and deletes it in one statement, so two concurrent verifications
   * of the same nonce cannot both succeed. Returns null when it never existed, was already taken
   * or was issued to another holder — indistinguishable on purpose: all mean "ask for a new one".
   */
  consume(nonce: string, holder: NonceHolder): Promise<{ expiresAt: Date } | null>;
}

export interface WalletLinkRepository {
  findByAddress(namespace: Namespace, address: NormalizedAddress): Promise<WalletLink | null>;
  /** `created: false` means the unique index already held this address for another account. */
  link(link: Omit<WalletLink, "verifiedAt">): Promise<{ created: boolean }>;
  /** Errors propagate: "no wallets" and "could not read" are different facts. */
  listForUser(userId: string): Promise<WalletLink[]>;
  /**
   * The one wallet of `fromUserId` becomes a wallet of `toUserId`; answers whether it moved. The
   * only way an address changes account, and core calls it only from `join`.
   *
   * The adapter checks again, in the statement that moves it, what `join` checked a moment
   * before: `fromUserId` holds exactly one wallet and has no profile, and `toUserId` still holds
   * a wallet. If any of that stopped being true in between, nothing moves and the answer is false.
   */
  reassignSole(fromUserId: string, toUserId: string): Promise<boolean>;
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
  /**
   * The Supabase user for this address, created on first sight. An account already at its
   * synthetic email that wallet sign-in did not create is refused with
   * `WalletAccountConflictError`, never returned.
   */
  forAddress(
    namespace: Namespace,
    address: NormalizedAddress,
  ): Promise<{
    userId: string;
    /** True only when this very call made the account; false when it was already there. */
    created: boolean;
  }>;
  /** A session for an existing user, minted server-side. */
  session(userId: string): Promise<{ accessToken: string; refreshToken: string }>;
  /**
   * Puts the server-only wallet-account marker (`app_metadata.pickler_account = "wallet"`) on the
   * account a wallet sign-in is about to open, if it is missing and the account is the one this
   * address's sign-in created (its auth email is this address's synthetic one, with no password).
   * An email account that merely linked this wallet is left alone. An account at the synthetic
   * email that wallet sign-in did not create is refused with `WalletAccountConflictError`. Called
   * before `session`, so the token it mints carries the marker — accounts made before the marker
   * existed heal on their next sign-in — and a refused account gets no session.
   */
  markWalletAccount(
    userId: string,
    namespace: Namespace,
    address: NormalizedAddress,
  ): Promise<void>;
  /**
   * Removes an account `forAddress` made in the same call (`created: true`) whose link then went
   * to another account, so it holds no wallet. Never called for any other account, and an adapter
   * refuses anything that is not this address's own marked wallet account.
   */
  discardAccount(userId: string, namespace: Namespace, address: NormalizedAddress): Promise<void>;
  /**
   * Whether this account is the one wallet sign-in made for this address and marked: not an email
   * or Google account that linked the wallet, and not one registered by hand at its synthetic
   * email. The same test `discardAccount` applies before it deletes.
   */
  isOwnWalletAccount(
    userId: string,
    namespace: Namespace,
    address: NormalizedAddress,
  ): Promise<boolean>;
}
