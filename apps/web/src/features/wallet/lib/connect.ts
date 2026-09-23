/** Anything that can sign a string for an address — MetaMask, Mera, WalletConnect. */
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
 * The server hands back the exact string to sign and this signs it unchanged. Nothing here
 * constructs a SIWE message: one builder means a signature can never fail verification because two
 * builders disagreed by a byte, which is a failure that looks exactly like the wrong wallet.
 */
export async function signIn(
  signer: Signer,
  fetchImpl: typeof fetch = fetch,
): Promise<ConnectResult> {
  const issued = await envelope(
    await fetchImpl("/api/v1/auth/wallet/nonce", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: signer.address, chain_id: signer.chainId }),
    }),
    "Could not start a sign-in",
  );
  const signature = await signer.signMessage(issued.message);
  return envelope(
    await fetchImpl("/api/v1/auth/wallet/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw: issued.message, signature }),
    }),
    "That sign-in did not go through",
  );
}
