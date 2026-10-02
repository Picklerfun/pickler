/** The two wallets the marketplace offers: the Mera passkey wallet and a browser wallet. */
export type WalletKind = "mera" | "eoa";

/** Anything that can sign a string for an address: a browser wallet, or a Mera key just opened. */
export interface Signer {
  address: string;
  chainId: number;
  signMessage(message: string): Promise<string>;
}

export interface ConnectResult {
  userId: string;
  session: { accessToken: string; refreshToken: string };
}

export class ConnectError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

async function envelope(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ConnectError(body?.message ?? fallback, body?.error ?? String(response.status));
  }
  return body.data;
}

/**
 * How long either request may take. A sign-in that hangs is a prompt the person answered for
 * nothing, and for the passkey wallet it is also a key held open while it waits.
 */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * The first half of a sign-in: the exact string to sign, built by the server. Nothing here
 * constructs a SIWE message: one builder means a signature can never fail verification because two
 * builders disagreed by a byte, which is a failure that looks exactly like the wrong wallet.
 */
export async function challenge(
  address: string,
  chainId: number,
  fetchImpl: typeof fetch = fetch,
  /**
   * Asks for the message that lets this other wallet into `address`'s account, instead of a
   * sign-in message. The server writes it into the sentence that is signed, and `join` accepts the
   * signature for that wallet only.
   */
  joining?: string,
): Promise<string> {
  const issued = await envelope(
    await fetchImpl("/api/v1/auth/wallet/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chain_id: chainId, ...(joining ? { joining } : {}) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "Could not start a sign-in",
  );
  if (typeof issued?.message !== "string") {
    throw new ConnectError("Could not start a sign-in", "invalid_challenge");
  }
  return issued.message;
}

/** The second half: the server's string, unchanged, with its signature. No key is needed here. */
export async function present(
  message: string,
  signature: string,
  /** Which wallet signed, for the link the server keeps. It describes; it decides nothing. */
  kind: WalletKind,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectResult> {
  return envelope(
    await fetchImpl("/api/v1/auth/wallet/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: message, signature, kind }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "That sign-in did not go through",
  );
}

/**
 * Folds the signed-in account into the account of the wallet that signed `message`.
 *
 * For somebody who connected a wallet Pickler had not seen — which made it an account — and who
 * already has one under another wallet. That other wallet signs the server's string — not the
 * sign-in message, but one that names the wallet it lets in (`challenge` with `joining`) — and it
 * is presented with the session of the account being given up. The
 * answer is the session of the account that is kept: the caller's own stops existing.
 *
 * The API refuses when the wallet that signed has no account (`no_account`), when it is the
 * caller's own (`same_account`), and when the caller's account has a username or is more than the
 * bare account a first sign-in makes (`join_has_profile`, `join_not_wallet_account`).
 */
export async function join(
  message: string,
  signature: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectResult> {
  return envelope(
    await fetchImpl("/api/v1/auth/wallet/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ raw: message, signature }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }),
    "That account could not be joined",
  );
}

/** Both halves, for a signer that can be asked to sign at any time: a browser wallet. */
export async function signIn(
  signer: Signer,
  fetchImpl: typeof fetch = fetch,
  kind: WalletKind = "eoa",
): Promise<ConnectResult> {
  const message = await challenge(signer.address, signer.chainId, fetchImpl);
  const signature = await signer.signMessage(message);
  return present(message, signature, kind, fetchImpl);
}
