"use client";

import {
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
} from "@category-labs/mera";
import { readBalanceOverRpc } from "./rpc";
import type { SignerAccount, SignerAdapter } from "./signer";

/** Experimental PRF account derivation. App address parity requires real-device validation.
 * Connecting is not server authentication and does not enable trading.
 */

/** The host the app's passkeys are registered against. */
const PASSKEY_HOST = "pickler.fun";

/**
 * Loopback is allowed while developing, because otherwise this path cannot be worked on at all.
 * The account it derives there is a different one — a passkey is scoped to its host — and the
 * chooser says so rather than letting it pass for the app's.
 */
const isDevelopmentHost = (hostname: string) =>
  process.env.NODE_ENV !== "production" && (hostname === "localhost" || hostname === "127.0.0.1");

const passkeyHost = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const { hostname } = window.location;
  return hostname === PASSKEY_HOST || isDevelopmentHost(hostname) ? hostname : null;
};

const supportsPasskeys = () =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

async function derive(): Promise<SignerAccount | null> {
  // No credential and no salt: WebAuthn offers whichever passkey this person has for the host —
  // including one on their phone, over the platform's own cross-device prompt — and Mera's fixed
  // default salt keeps the output the same every time.
  const rpId = passkeyHost();
  if (!rpId) {
    return null;
  }

  const { prfOutput } = await getPasskeyPrfOutput({ rpId });

  const address = addressFromPrf(prfOutput);
  return { address, chainId: null, balance: await readBalanceOverRpc(address) };
}

/** Clear caller-owned key material even when the SDK rejects it. No RPC or signing is performed. */
export function addressFromPrf(prfOutput: Uint8Array): string {
  let session: ReturnType<typeof createSecp256k1SigningSession> | undefined;
  try {
    session = createSecp256k1SigningSession({ privateKey: prfOutput });
    return getEvmAddress(session.publicKey);
  } finally {
    session?.end();
    prfOutput.fill(0);
  }
}

export const meraSigner: SignerAdapter = {
  kind: "mera",

  unavailableReason: () => {
    if (!supportsPasskeys()) {
      return "This browser does not support passkeys.";
    }
    return passkeyHost() === null ? `The app account only opens on ${PASSKEY_HOST}.` : null;
  },

  note: () => {
    const host = passkeyHost();
    return host && host !== PASSKEY_HOST
      ? "Development host — this derives a different account from the app's."
      : "Experimental: verify this address matches your app before using it.";
  },

  resume: async () =>
    // Opening the account needs the passkey, and a passkey needs the person. Resuming silently is
    // not possible and pretending otherwise would show an address nothing can sign for.
    null,

  // Provider/PRF failures must remain visible; a generic operation failure is not proof of cancellation.
  connect: derive,

  disconnect: async () => {
    // Nothing is held between connections: the session ended when the address was derived, and
    // the key can only come back from the authenticator.
  },
};
