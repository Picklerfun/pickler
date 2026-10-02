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
): Promise<string> {
  const issued = await envelope(
    await fetchImpl("/api/v1/auth/wallet/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, chain_id: chainId }),
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
