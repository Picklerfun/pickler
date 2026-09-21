/**
 * What the site needs from whatever holds the person's keys.
 *
 * Two unlike things sit behind this one shape. A wallet the person brought is injected by the
 * browser, can be pointed at the wrong chain, and changes under the page when they switch account.
 * A passkey account is derived by the page itself: it has no chain of its own, nothing to switch,
 * and nobody else can change it while you look at it.
 *
 * The rest of the site should not have to know which one it is talking to, so everything a page
 * needs is required here and everything peculiar to one of them is optional. A page that wants to
 * offer "switch network" asks whether the verb exists rather than asking which wallet this is.
 */

export type SignerKind = "injected" | "mera";

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
