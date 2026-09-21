"use client";

import {
  createSecp256k1SigningSession,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
} from "@category-labs/mera";
import { readBalanceOverRpc } from "./rpc";
import type { SignerAccount, SignerAdapter } from "./signer";

/**
 * The account from the Pickler app: one passkey, no extension, nothing to install.
 *
 * The key is the passkey's PRF output, not a random secret kept somewhere. Mera documents that
 * output as a deterministic function of the credential, the host and a fixed salt, so the same
 * passkey yields the same private key — and therefore the same address — on a phone, a laptop, or
 * a borrowed browser, with nothing to sync between them. That is the whole reason this can exist
 * on the web at all.
 *
 * Two consequences the rest of the code depends on:
 *
 * - **The host is part of the key.** A passkey is scoped to its relying party, so the account only
 *   exists on the canonical domain. Anywhere else the same passkey derives a different key holding
 *   different money, which is why the host is checked before anything is asked of the person.
 * - **The session dies immediately.** Connecting only needs the address, so the private key is
 *   used to derive it and then zeroed. Nothing can be signed without asking the person again,
 *   which is what keeps a key out of memory for a whole tab.
 *
 * Mera also offers a vault — a random key encrypted under the passkey — and that model is not this
 * one: it would need the app's vault shipped here before the web could open anything. If an
 * address derived below does not match the app's, that is the difference, and it will show on the
 * first connection rather than hiding.
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

  const session = createSecp256k1SigningSession({ privateKey: prfOutput });
  try {
    const address = getEvmAddress(session.publicKey);
    return {
      address,
      // A passkey account is not pointed at a chain: the same key signs on any of them, and the
      // page decides which one a transaction goes to.
      chainId: null,
      balance: await readBalanceOverRpc(address),
    };
  } finally {
    session.end();
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
      : null;
  },

  resume: async () =>
    // Opening the account needs the passkey, and a passkey needs the person. Resuming silently is
    // not possible and pretending otherwise would show an address nothing can sign for.
    null,

  connect: async () => {
    try {
      return await derive();
    } catch (caught) {
      // Cancelling the platform's prompt is an answer, not a failure.
      if (isMeraError(caught) && caught.code === "PASSKEY_OPERATION_FAILED") {
        return null;
      }
      throw caught;
    }
  },

  disconnect: async () => {
    // Nothing is held between connections: the session ended when the address was derived, and
    // the key can only come back from the authenticator.
  },
};
