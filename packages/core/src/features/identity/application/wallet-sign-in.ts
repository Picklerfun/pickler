import type { Clock } from "../../../ports/clock.js";
import {
  caip2,
  InvalidChainError,
  normalizeAddress,
  type Namespace,
  type NormalizedAddress,
} from "../domain/wallet-auth.js";
import type {
  AccountProvisioner,
  NonceStore,
  SignatureVerifier,
  WalletLink,
  WalletLinkRepository,
} from "../ports/wallet-identity.js";

export class UnknownNonceError extends Error {
  constructor() {
    super("That sign-in request is no longer valid. Ask for a new one.");
    this.name = "UnknownNonceError";
  }
}
export class ExpiredNonceError extends Error {
  constructor() {
    super("That sign-in request has expired. Ask for a new one.");
    this.name = "ExpiredNonceError";
  }
}
export class WrongDomainError extends Error {
  constructor() {
    super("That signature was made for another site");
    this.name = "WrongDomainError";
  }
}
export class BadSignatureError extends Error {
  constructor() {
    super("That signature does not belong to that address");
    this.name = "BadSignatureError";
  }
}
export class AddressTakenError extends Error {
  constructor() {
    super("That wallet is already linked to another Pickler account");
    this.name = "AddressTakenError";
  }
}

/**
 * The auth account at this address's synthetic email was not made by wallet sign-in: it has a
 * password, or an identity wallet sign-in never creates, and no wallet-account marker. Since the
 * synthetic email is computable from a public address, that is what an account pre-registered
 * to take over the wallet's sign-in looks like, so it is refused — never linked, marked or given a
 * session.
 */
export class WalletAccountConflictError extends Error {
  constructor() {
    super(
      "This wallet's sign-in is held by an account that wallet sign-in did not create. Contact support.",
    );
    this.name = "WalletAccountConflictError";
  }
}

/** Five minutes, the same window a WebAuthn challenge gets. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

export interface SignedMessage {
  domain: string;
  nonce: string;
  address: string;
  namespace: Namespace;
  chainReference: number | string;
  statement: string;
  issuedAt: string;
}

export interface Presented {
  /** The exact string that was signed — the one this service handed out. Nothing else is trusted. */
  raw: string;
  signature: string;
}

export interface WalletSignInDependencies {
  clock: Clock;
  domain: string;
  nonces: NonceStore;
  links: WalletLinkRepository;
  verifier: SignatureVerifier;
  accounts: AccountProvisioner;
  randomNonce: () => string;
  /** Builds the string to sign. Lives in infrastructure because it is viem's format. */
  buildMessage: (fields: MessageFields) => string;
  /** Reads back the fields from a string this service built. Throws if it is not one. */
  parseMessage: (raw: string) => SignedMessage;
}

export interface MessageFields {
  domain: string;
  address: string;
  chainReference: number;
  nonce: string;
  issuedAt: Date;
}

export function createWalletSignIn(deps: WalletSignInDependencies) {
  /**
   * Everything that must hold before an address is believed, in an order that is load-bearing.
   *
   * The nonce is spent first, before the signature is checked, so that a rejected attempt burns it
   * too. Verify-first would leave the nonce sitting there on every rejection, and a harvested
   * message could be retried against it until a signature landed. Consume-first gives an attacker
   * exactly one attempt per nonce.
   *
   * Note that spending a nonce twice in sequence cannot detect this: both orderings behave
   * identically, because the window the order closes is a concurrent one. What distinguishes them
   * is a *failed* attempt, which is what `a bad signature still spends the nonce` pins.
   */
  async function proven(presented: Presented) {
    const parsed = deps.parseMessage(presented.raw);
    const taken = await deps.nonces.consume(parsed.nonce);
    if (!taken) {
      throw new UnknownNonceError();
    }
    // Written as "not still valid" rather than "expired" so that an unreadable expiry fails closed.
    // An Invalid Date yields NaN, and every comparison against NaN is false — so `expiresAt <= now`
    // would answer "not expired" and make the nonce immortal. A field that is present but invalid
    // passes a presence check; this is the same shape, one operator further on.
    if (!(taken.expiresAt.getTime() > deps.clock.now().getTime())) {
      throw new ExpiredNonceError();
    }
    if (parsed.domain !== deps.domain) {
      throw new WrongDomainError();
    }
    const address = normalizeAddress(parsed.namespace, parsed.address);
    const ok = await deps.verifier.verify({
      message: presented.raw,
      signature: presented.signature,
      address,
    });
    if (!ok) {
      throw new BadSignatureError();
    }
    return { address, namespace: parsed.namespace, chainReference: parsed.chainReference };
  }

  /**
   * The address was linked to nobody when `verify` looked and is linked now: somebody else wrote
   * the link first. Usually that is a second sign-in of the same wallet, which resolves to the
   * same account. It can also be a signed-in account linking this wallet, and then the wallet is
   * theirs — a session for the account made a moment ago would be a session for an account the
   * wallet is not linked to. So the link is read again and its holder is who signs in, after the
   * same `markWalletAccount` check every returning sign-in gets.
   *
   * The account made for nothing is removed, and only when this very call made it: an account
   * that was already there belongs to whoever made it. Removing is tidying, so its failure does
   * not refuse the sign-in — a leftover holds no wallet and no session is ever minted for it.
   */
  async function holderOfLostLink(
    made: { userId: string; created: boolean },
    namespace: Namespace,
    address: NormalizedAddress,
  ): Promise<string> {
    const holder = await deps.links.findByAddress(namespace, address);
    if (!holder) {
      throw new Error("That wallet's link could not be written or read. Try again.");
    }
    if (holder.userId !== made.userId && made.created) {
      await deps.accounts.discardAccount(made.userId, namespace, address).catch(() => {});
    }
    return holder.userId;
  }

  return {
    /**
     * Returns the exact string to sign, not just a nonce. The browser signs what it is given and
     * sends it back verbatim, so there is only ever one builder. Two builders — one here, one in
     * the browser — that disagree by a single byte produce a signature that fails verification
     * with no indication of why, and the failure looks exactly like the wrong wallet.
     *
     * The address is unverified at this point and that is fine: it goes into the message, and the
     * signature is what proves it. It is checked for shape, though, and so is the chain: a
     * malformed one is `InvalidAddressError` or `InvalidChainError` and stores nothing.
     */
    async issueNonce(input: { address: string; namespace: Namespace; chainReference: number }) {
      // Everything that can refuse the request runs before the nonce is stored. This route is
      // public, and a nonce stored ahead of a refusal is a row anyone can make for free.
      const address = normalizeAddress(input.namespace, input.address);
      if (!Number.isSafeInteger(input.chainReference) || input.chainReference <= 0) {
        throw new InvalidChainError(String(input.chainReference));
      }
      const nonce = deps.randomNonce();
      const message = deps.buildMessage({
        domain: deps.domain,
        address,
        chainReference: input.chainReference,
        nonce,
        issuedAt: deps.clock.now(),
      });
      await deps.nonces.issue(nonce, new Date(deps.clock.now().getTime() + NONCE_TTL_MS));
      return { nonce, message };
    },

    /** Sign in: an address already linked returns its account; a new one gets an account made. */
    async verify(presented: Presented) {
      const { address, namespace, chainReference } = await proven(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing) {
        await deps.accounts.markWalletAccount(existing.userId, namespace, address);
        return { userId: existing.userId, session: await deps.accounts.session(existing.userId) };
      }
      const made = await deps.accounts.forAddress(namespace, address);
      const { created } = await deps.links.link({
        userId: made.userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: "external",
      });
      const userId = created ? made.userId : await holderOfLostLink(made, namespace, address);
      await deps.accounts.markWalletAccount(userId, namespace, address);
      return { userId, session: await deps.accounts.session(userId) };
    },

    /** Link to the signed-in account. An address owned elsewhere is refused, never moved. */
    async link(userId: string, presented: Presented) {
      const { address, namespace, chainReference } = await proven(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing && existing.userId !== userId) {
        throw new AddressTakenError();
      }
      const { created } = await deps.links.link({
        userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: "external",
      });
      if (!created && !existing) {
        throw new AddressTakenError();
      }
      return { linked: true as const };
    },

    /** No catch: a failed read must not render as an account with no wallets. */
    listLinks(userId: string): Promise<WalletLink[]> {
      return deps.links.listForUser(userId);
    },
  };
}
