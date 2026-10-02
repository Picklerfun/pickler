import type { ConnectResult } from "./connect";

/**
 * What the site needs from whatever holds the person's keys.
 *
 * Two things sit behind this shape, and only two (docs/specs/mera-web-v1.md). A browser wallet the
 * person brought: it can be pointed at the wrong chain and it changes under the page when they
 * switch account, so the verbs for following it and for moving it stay optional on the contract —
 * a page that wants to offer "switch network" asks whether the verb exists rather than asking
 * which wallet this is. And the Mera passkey wallet: the same account as in the mobile app, whose
 * key exists only for the length of one passkey ceremony and is never kept.
 *
 * The studio's Turnkey wallet is not one of these and never will be. It is custodied — the key
 * lives in an enclave, and a passkey authorises activities there — and it belongs to another
 * product on another host.
 */

export type SignerKind = "injected" | "mera";

/** How a signer with more than one way in is asked to connect. Only the passkey wallet has two. */
export type ConnectMode = "create" | "existing";

export interface SignerAccount {
  address: string;
  /** The chain the signer is pointed at, or null when it is not pointed at one. */
  chainId: number | null;
  /** Native balance in wei. Null when unknown or the chain is unreachable. */
  balance: bigint | null;
  /**
   * The session, when connecting already signed in. The passkey wallet does both in one ceremony,
   * so that a person is asked for their passkey once; a browser wallet signs in as its own step.
   */
  session?: ConnectResult;
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
  connect: (mode?: ConnectMode) => Promise<SignerAccount | null>;
  /**
   * Signs in again as the connected account, for a signer that needs its own ceremony to sign.
   * Absent on a signer whose provider signs a string on request. Throws `{ code: 4001 }` when the
   * person closes the prompt, as a browser wallet does.
   */
  signIn?: (expectedAddress: string) => Promise<ConnectResult>;
  disconnect: () => Promise<void>;
  /** Follow changes made outside the page. Only an injected wallet has them. */
  subscribe?: (onChange: (account: SignerAccount | null) => void) => () => void;
  /** Only where the signer can be pointed at the wrong chain. */
  switchChain?: () => Promise<SignerAccount | null>;
}
