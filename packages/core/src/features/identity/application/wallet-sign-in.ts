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
/**
 * The signed message was written for something else: a sign-in message presented to join an
 * account, or a join message presented to sign in.
 */
export class WrongPurposeError extends Error {
  constructor() {
    super("That signature was made for something else");
    this.name = "WrongPurposeError";
  }
}
export class AddressTakenError extends Error {
  constructor() {
    super("That wallet is already linked to another Pickler account");
    this.name = "AddressTakenError";
  }
}

/** The wallet that signed opens no Pickler account, so there is none to join. */
export class NoAccountToJoinError extends Error {
  constructor() {
    super("That wallet has no Pickler account yet");
    this.name = "NoAccountToJoinError";
  }
}

/** The wallet that signed already opens the account that asked. */
export class SameAccountError extends Error {
  constructor() {
    super("That wallet already opens this account");
    this.name = "SameAccountError";
  }
}

const NOT_JOINABLE = {
  has_profile: "This account already has a username, so it cannot be folded into another",
  has_custody: "This account already has a Pickler wallet, so it cannot be folded into another",
  not_wallet_account: "Only an account made by connecting a wallet can be folded into another",
  changed: "That account changed while it was being joined. Try again.",
} as const;

/**
 * The account that asked to join another cannot be given up: it has a username or a custody
 * wallet, it is not the bare account a wallet's first sign-in makes, or it stopped being one
 * while the join was under way.
 */
export class AccountNotJoinableError extends Error {
  constructor(readonly reason: keyof typeof NOT_JOINABLE) {
    super(NOT_JOINABLE[reason]);
    this.name = "AccountNotJoinableError";
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

/**
 * Which wallet signed, as the client says: the Mera passkey wallet or a browser wallet. It is
 * outside the signed message and cannot be verified — both are plain accounts, told apart by
 * nothing a signature shows — so it describes a link and decides nothing.
 */
export type PresentedWalletKind = "mera" | "eoa";

export const PRESENTED_WALLET_KINDS: readonly PresentedWalletKind[] = ["mera", "eoa"];

export interface Presented {
  /** The exact string that was signed — the one this service handed out. Nothing else is trusted. */
  raw: string;
  signature: string;
  /** Recorded on the link when the link is made. Absent means a browser wallet. */
  kind?: PresentedWalletKind;
}

/** What `identity.wallet_links.kind` stores for a presented kind. */
const storedKind = (kind: PresentedWalletKind | undefined): "mera" | "external" =>
  kind === "mera" ? "mera" : "external";

export interface WalletSignInDependencies {
  clock: Clock;
  domain: string;
  nonces: NonceStore;
  links: WalletLinkRepository;
  verifier: SignatureVerifier;
  accounts: AccountProvisioner;
  /** Whether the account has a profile, and so a username. `join` gives up only one without. */
  hasProfile: (userId: string) => Promise<boolean>;
  /**
   * Whether the account has a custody account: a Turnkey sub-organization and its master wallet.
   * Nothing ties those rows to the auth user, so removing the account would strand the wallet.
   */
  hasCustodyAccount: (userId: string) => Promise<boolean>;
  randomNonce: () => string;
  /** Builds the string to sign. Lives in infrastructure because it is viem's format. */
  buildMessage: (fields: MessageFields) => string;
  /** Reads back the fields from a string this service built. Throws if it is not one. */
  parseMessage: (raw: string) => SignedMessage;
}

/** What a wallet reads, and signs, to sign in. */
export const SIGN_IN_STATEMENT = "Sign in to Pickler";

/**
 * What the wallet of an account reads, and signs, to let another wallet open that account. It
 * names the wallet being let in, so the signature is good for that wallet and for nothing else:
 * not for signing in, and not for attaching any other address.
 */
export const joinStatement = (joining: string) =>
  `Link wallet ${joining} to this wallet's Pickler account`;

export interface MessageFields {
  domain: string;
  /** The sentence of the message: what the signature is for. */
  statement: string;
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
    // Before the nonce, because the nonce is kept under the address it was issued to. A message
    // whose address is not one stops here with its nonce unspent, which gives nothing away: no
    // signature over that message can ever verify.
    const address = normalizeAddress(parsed.namespace, parsed.address);
    const taken = await deps.nonces.consume(parsed.nonce, {
      namespace: parsed.namespace,
      address,
    });
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
    const ok = await deps.verifier.verify({
      message: presented.raw,
      signature: presented.signature,
      address,
    });
    if (!ok) {
      throw new BadSignatureError();
    }
    return {
      address,
      namespace: parsed.namespace,
      chainReference: parsed.chainReference,
      // Covered by the signature, like the rest of the string: what the wallet agreed to.
      statement: parsed.statement,
    };
  }

  /** A sign-in or a link takes a sign-in message, and no other. The nonce is spent either way. */
  async function provenToSignIn(presented: Presented) {
    const proof = await proven(presented);
    if (proof.statement !== SIGN_IN_STATEMENT) {
      throw new WrongPurposeError();
    }
    return proof;
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
    async issueNonce(input: {
      address: string;
      namespace: Namespace;
      chainReference: number;
      /**
       * Set when the message is for `join`: the wallet that is to be let into this wallet's
       * account. Unverified here, like the address — it goes into the sentence the wallet signs,
       * and `join` holds the signature to the wallet that actually asks.
       */
      joining?: { namespace: Namespace; address: string };
    }) {
      // Everything that can refuse the request runs before the nonce is stored. This route is
      // public, and a nonce stored ahead of a refusal is a row anyone can make for free.
      const address = normalizeAddress(input.namespace, input.address);
      if (!Number.isSafeInteger(input.chainReference) || input.chainReference <= 0) {
        throw new InvalidChainError(String(input.chainReference));
      }
      const statement = input.joining
        ? joinStatement(normalizeAddress(input.joining.namespace, input.joining.address))
        : SIGN_IN_STATEMENT;
      const nonce = deps.randomNonce();
      const message = deps.buildMessage({
        domain: deps.domain,
        statement,
        address,
        chainReference: input.chainReference,
        nonce,
        issuedAt: deps.clock.now(),
      });
      await deps.nonces.issue(nonce, new Date(deps.clock.now().getTime() + NONCE_TTL_MS), {
        namespace: input.namespace,
        address,
      });
      return { nonce, message };
    },

    /** Sign in: an address already linked returns its account; a new one gets an account made. */
    async verify(presented: Presented) {
      const { address, namespace, chainReference } = await provenToSignIn(presented);
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
        kind: storedKind(presented.kind),
      });
      const userId = created ? made.userId : await holderOfLostLink(made, namespace, address);
      await deps.accounts.markWalletAccount(userId, namespace, address);
      return { userId, session: await deps.accounts.session(userId) };
    },

    /** Link to the signed-in account. An address owned elsewhere is refused, never moved. */
    async link(userId: string, presented: Presented) {
      const { address, namespace, chainReference } = await provenToSignIn(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing && existing.userId !== userId) {
        throw new AddressTakenError();
      }
      const { created } = await deps.links.link({
        userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: storedKind(presented.kind),
      });
      if (!created && !existing) {
        throw new AddressTakenError();
      }
      return { linked: true as const };
    },

    /**
     * The signed-in account joins the account of the wallet that signed, and is given up.
     *
     * This is for somebody who connected a wallet Pickler had not seen — which made it an account,
     * as every first sign-in does — and who already has an account under another wallet. They are
     * asked for a username, say "I already have one", and sign with the other wallet. The first
     * wallet then opens the account they already had, and the one made a moment ago is removed.
     *
     * It is the only place an address changes account, so both sides have to agree and the side
     * given up has to be worth nothing:
     *
     * - the account that is kept agrees with a signature of its wallet over a fresh nonce, in a
     *   message that says what it is for and names the wallet being let in (`joinStatement`), so
     *   a signature given to sign in cannot be presented here, nor one given for another wallet;
     * - the account given up agrees with its session, which is the caller's;
     * - it has no username and no custody wallet, and it is the bare account wallet sign-in made
     *   for its one wallet — never an email or Google account that linked a wallet, never one
     *   with more than the wallet it was made for.
     *
     * Those are read here, to say why a join is refused, and held again by the statement that
     * moves the wallet (`reassignSole`), so that nothing moves if they stopped being true.
     *
     * `link` still refuses an address owned elsewhere: adding a wallet to an account never takes
     * it from another.
     */
    async join(userId: string, presented: Presented) {
      const { address, namespace, statement } = await proven(presented);
      const kept = await deps.links.findByAddress(namespace, address);
      if (!kept) {
        throw new NoAccountToJoinError();
      }
      if (kept.userId === userId) {
        throw new SameAccountError();
      }

      const [own, ...others] = await deps.links.listForUser(userId);
      const bare =
        own !== undefined &&
        others.length === 0 &&
        (await deps.accounts.isOwnWalletAccount(userId, own.namespace, own.address));
      if (!bare) {
        throw new AccountNotJoinableError("not_wallet_account");
      }
      // The kept wallet agreed to let this wallet in, and no other.
      if (statement !== joinStatement(own.address)) {
        throw new WrongPurposeError();
      }
      if (await deps.hasProfile(userId)) {
        throw new AccountNotJoinableError("has_profile");
      }
      if (await deps.hasCustodyAccount(userId)) {
        throw new AccountNotJoinableError("has_custody");
      }

      // The check every sign-in into the kept account gets, before anything moves.
      await deps.accounts.markWalletAccount(kept.userId, namespace, address);
      if (!(await deps.links.reassignSole(userId, kept.userId))) {
        // Another request got there first: a second join, a username claimed, the kept account
        // itself given up. Nothing moved, and no session is handed out for a join that did not
        // happen.
        throw new AccountNotJoinableError("changed");
      }
      // The account holds no wallet now. Removing it is tidying and its failure does not undo the
      // join — but unlike an account lost to a race at sign-in, this one has a live session, and
      // a username claimed with it in this instant would be deleted with it. So it is removed
      // only while it still has none; a leftover can do nothing a wallet opens.
      if (!(await deps.hasProfile(userId))) {
        await deps.accounts.discardAccount(userId, own.namespace, own.address).catch(() => {});
      }
      return { userId: kept.userId, session: await deps.accounts.session(kept.userId) };
    },

    /** No catch: a failed read must not render as an account with no wallets. */
    listLinks(userId: string): Promise<WalletLink[]> {
      return deps.links.listForUser(userId);
    },
  };
}
