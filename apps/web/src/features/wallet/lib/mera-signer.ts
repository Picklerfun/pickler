"use client";

import type { SignerAdapter } from "./signer";

/**
 * The account from the Pickler app: a key held in a passkey-encrypted vault, opened with Face ID
 * or Touch ID and signed with in the page. Nothing to install and no chain to switch.
 *
 * It is not connectable yet, and this file is where that stops being true. Two things are missing
 * and both are named in `unavailableReason`, because a choice that does nothing should say why
 * rather than sit greyed out:
 *
 * 1. `@category-labs/mera` is not a dependency yet. The shape it will take is
 *    `decryptSecretVaultWithPasskey({ rpId, vault })` → `createSecp256k1SigningSession` →
 *    `toViemAccount`, and the session ends on disconnect rather than living for the tab.
 * 2. The vault itself. The passkey alone does not reproduce the account — Mera encrypts a random
 *    key into a vault, so the web needs the same vault the app made. Until Pickler stores it, the
 *    web can open nothing, and creating a fresh account here would quietly give the person a
 *    second one.
 *
 * The passkey is bound to the host, so the account only exists on the canonical domain. A vault
 * opened anywhere else would be a different account with different money in it, which is why the
 * host is checked before anything else.
 */

/** The host the app's passkeys are registered against. */
const PASSKEY_HOST = "pickler.fun";

const hostAllowsPasskeys = () =>
  typeof window !== "undefined" && window.location.hostname === PASSKEY_HOST;

const supportsPasskeys = () =>
  typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined";

export const meraSigner: SignerAdapter = {
  kind: "mera",

  unavailableReason: () => {
    if (!supportsPasskeys()) {
      return "This browser does not support passkeys.";
    }
    if (!hostAllowsPasskeys()) {
      return `The app account only opens on ${PASSKEY_HOST}.`;
    }
    return "Opening the Pickler app account on the web is not ready yet.";
  },

  resume: async () => null,
  connect: async () => null,
  disconnect: async () => {},
};
