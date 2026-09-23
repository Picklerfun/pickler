import type { Clock } from "../../../ports/clock.js";
import { normalizeAddress, caip2, type Namespace } from "../domain/wallet-auth.js";
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
   * Everything that must hold before an address is believed, in the order that spends the least:
   * the nonce is taken first because taking it is what makes a replay impossible, and the
   * signature is checked last because it is the expensive one.
   */
  async function proven(presented: Presented) {
    const parsed = deps.parseMessage(presented.raw);
    const taken = await deps.nonces.consume(parsed.nonce);
    if (!taken) {
      throw new UnknownNonceError();
    }
    if (taken.expiresAt.getTime() <= deps.clock.now().getTime()) {
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

  return {
    /**
     * Returns the exact string to sign, not just a nonce. The browser signs what it is given and
     * sends it back verbatim, so there is only ever one builder. Two builders — one here, one in
     * the browser — that disagree by a single byte produce a signature that fails verification
     * with no indication of why, and the failure looks exactly like the wrong wallet.
     *
     * The address is unverified at this point and that is fine: it goes into the message, and the
     * signature is what proves it.
     */
    async issueNonce(input: { address: string; namespace: Namespace; chainReference: number }) {
      const nonce = deps.randomNonce();
      await deps.nonces.issue(nonce, new Date(deps.clock.now().getTime() + NONCE_TTL_MS));
      const message = deps.buildMessage({
        domain: deps.domain,
        address: normalizeAddress(input.namespace, input.address),
        chainReference: input.chainReference,
        nonce,
        issuedAt: deps.clock.now(),
      });
      return { nonce, message };
    },

    /** Sign in: an address already linked returns its account; a new one gets an account made. */
    async verify(presented: Presented) {
      const { address, namespace, chainReference } = await proven(presented);
      const existing = await deps.links.findByAddress(namespace, address);
      if (existing) {
        return { userId: existing.userId, session: await deps.accounts.session(existing.userId) };
      }
      const { userId } = await deps.accounts.forAddress(namespace, address);
      await deps.links.link({
        userId,
        namespace,
        address,
        verifiedChain: caip2(namespace, chainReference),
        kind: "external",
      });
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
