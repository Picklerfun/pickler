/**
 * What the site needs from whatever holds the person's keys.
 *
 * One thing sits behind this shape: the wallet the person brought, injected by their browser. It
 * can be pointed at the wrong chain and it changes under the page when they switch account, so the
 * verbs for following it and for moving it stay optional on the contract — a page that wants to
 * offer "switch network" asks whether the verb exists rather than asking which wallet this is.
 *
 * The person's own Pickler wallet is not one of these and is never derived in the page. It is
 * custodied in Turnkey — the key lives in the enclave, the passkey is the only root user of their
 * sub-organization — and the site reaches it through the signing API, never by holding a key here.
 */

export type SignerKind = "injected";

export interface SignerAccount {
  address: string;
  /** The chain the signer is pointed at, or null when it is not pointed at one. */
  chainId: number | null;
  /** Native balance in wei. Null when unknown or the chain is unreachable. */
  balance: bigint | null;
}

export interface SignerAdapter {
  kind: SignerKind;
  /**
   * Why this cannot be offered here, or null when it can. Read during render, so it answers from
   * what the browser already knows — it never prompts and never waits.
   */
  unavailableReason: () => string | null;
  /**
   * Something true about this choice that does not stop it being picked — a caveat rather than a
   * refusal. Null when there is nothing to say.
   */
  note?: () => string | null;
  /**
   * Pick up a connection that already exists, without prompting. Null when there is nothing to
   * pick up, which includes a signer that cannot resume silently at all.
   */
  resume: () => Promise<SignerAccount | null>;
  /** The one call allowed to prompt. Null when the person closed the prompt. */
  connect: () => Promise<SignerAccount | null>;
  disconnect: () => Promise<void>;
  /** Follow changes made outside the page. Only an injected wallet has them. */
  subscribe?: (onChange: (account: SignerAccount | null) => void) => () => void;
  /** Only where the signer can be pointed at the wrong chain. */
  switchChain?: () => Promise<SignerAccount | null>;
}
