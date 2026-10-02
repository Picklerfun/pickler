"use client";

import { PRODUCT_HOSTS } from "@/server/hosts";
import { challenge, join, present, type ConnectResult } from "./connect";
import { MERA_RELYING_PARTY, meraAvailability, type MeraAvailability } from "./mera-availability";
import {
  PrfUnavailableError,
  promptFailure,
  runMeraCeremony,
  type PrfResult,
  type PrfSource,
} from "./mera-ceremony";
import { loadMeraKit } from "./mera-kit";
import { readNativeBalance } from "./native-balance";
import { TARGET_CHAIN } from "./provider";
import type { ConnectMode, SignerAccount, SignerAdapter } from "./signer";

/**
 * The Mera passkey wallet in a browser: the same account as in the mobile app.
 *
 * A passkey for `pickler.fun`, synced by the person's keychain, gives the same PRF output here as
 * on the phone, and `@pickler/mera-account` turns it into the same address. The key is derived
 * inside one ceremony and wiped before the ceremony returns (`mera-ceremony.ts`); this file only
 * decides where the wallet may be offered, runs the passkey prompts, and remembers which account
 * is connected.
 *
 * Nothing here may import Turnkey or the studio's passkey code, and nothing outside the
 * `mera-*.ts` files may import the Mera SDK: ESLint enforces both (docs/specs/mera-web-v1.md §4).
 */

const MEMORY = "pk.wallet.mera";

interface Remembered {
  address: string;
  credentialId: string;
}

function recall(): Remembered | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(MEMORY) ?? "null") as Remembered | null;
    return value && typeof value.address === "string" && typeof value.credentialId === "string"
      ? value
      : null;
  } catch {
    return null;
  }
}

function remember(value: Remembered | null) {
  try {
    if (value) {
      window.localStorage.setItem(MEMORY, JSON.stringify(value));
    } else {
      window.localStorage.removeItem(MEMORY);
    }
  } catch {
    // A browser that refuses storage asks for the passkey again next visit.
  }
}

function availability(): MeraAvailability {
  if (typeof window === "undefined" || typeof window.PublicKeyCredential === "undefined") {
    return { offered: false, reason: "This browser does not support passkeys." };
  }
  return meraAvailability({
    hostname: window.location.hostname,
    studioHost: PRODUCT_HOSTS.studio,
    marketplaceHost: PRODUCT_HOSTS.marketplace,
    relyingParty: MERA_RELYING_PARTY,
    production: process.env.NODE_ENV === "production",
    enabled: process.env.NEXT_PUBLIC_MERA_WEB !== "off",
  });
}

/** The closed-prompt shape a browser wallet throws, so one branch handles both wallets. */
const promptClosed = () =>
  Object.assign(new Error("The passkey prompt was closed"), { code: 4001 });

/** Runs one passkey prompt and names its two expected outcomes: nothing, and no PRF output. */
async function prompt(run: () => Promise<PrfResult>): Promise<PrfResult | null> {
  try {
    return await run();
  } catch (caught) {
    const { isMeraError } = await import("@category-labs/mera");
    const outcome = promptFailure(caught, isMeraError);
    if (outcome === "no_prf") {
      throw new PrfUnavailableError();
    }
    if (outcome === "closed") {
      return null;
    }
    throw caught;
  }
}

/** The passkey's name in the person's keychain, the same as the mobile app writes. */
const passkeyUser = () => ({
  name: "pickler",
  displayName: `Pickler ${new Date().toLocaleDateString()}`,
});

function source(rpId: string, mode: ConnectMode, credentialId?: string): PrfSource {
  return async () => {
    const mera = await import("@category-labs/mera");
    if (mode === "create") {
      return prompt(() =>
        mera.createPasskeyWithPrfOutput({ rp: { id: rpId, name: "Pickler" }, user: passkeyUser() }),
      );
    }
    return prompt(() =>
      mera.getPasskeyPrfOutput({
        rpId,
        // Restricted to one passkey when it is known; otherwise the platform offers every Pickler
        // passkey the person has, the app's included.
        ...(credentialId ? { credential: { credentialId } } : {}),
      }),
    );
  };
}

async function balanceOf(address: string): Promise<bigint | null> {
  const rpcUrl = TARGET_CHAIN.publicRpcUrls[0];
  return rpcUrl ? readNativeBalance(address, rpcUrl) : null;
}

/**
 * A passkey that "Create one" made and whose sign-in then failed: the network dropped, the server
 * refused. It exists in the person's keychain, so pressing "Create one" again must open it rather
 * than make a second passkey with the same name and another address. A credential id is not a
 * secret. Kept for the page's life only, and for one retry: see `picked`.
 */
let unfinished: string | null = null;

interface Restriction {
  /** The only passkey the prompt may offer. */
  credentialId?: string;
  /** The account the passkey must open. */
  expectedAddress?: string;
}

type Present<Answer> = (message: string, signature: string) => Promise<Answer>;

const signInWith: Present<ConnectResult> = (message, signature) =>
  present(message, signature, "mera");

async function ceremony<Answer>(
  mode: ConnectMode,
  presenting: Present<Answer>,
  only: Restriction = {},
  /** The wallet this passkey's account is to let in: asks for that message, not a sign-in. */
  joining?: string,
) {
  const place = availability();
  if (!place.offered) {
    return null;
  }
  return runMeraCeremony({
    prf: source(place.rpId, mode, only.credentialId),
    kit: await loadMeraKit(),
    challenge: (address) => challenge(address, TARGET_CHAIN.chainId, fetch, joining),
    present: presenting,
    ...(mode === "create"
      ? {
          onPasskey: (credentialId: string) => {
            unfinished = credentialId;
          },
        }
      : {}),
    ...(only.expectedAddress ? { expectedAddress: only.expectedAddress } : {}),
  });
}

/**
 * A ceremony the person picked from the chooser. "Create one" after a create that made its passkey
 * and then failed opens that passkey. One retry: if that prompt is closed too, the next press
 * makes a new passkey, so a passkey the person has since deleted cannot leave the button doing
 * nothing.
 */
async function picked<Answer>(mode: ConnectMode, presenting: Present<Answer>) {
  const retried = mode === "create" ? unfinished : null;
  if (retried) {
    unfinished = null;
  }
  try {
    const opened = retried
      ? await ceremony("existing", presenting, { credentialId: retried })
      : await ceremony(mode, presenting);
    if (opened) {
      unfinished = null;
    }
    return opened;
  } catch (caught) {
    // Still there and still not presented: the next press opens it again.
    if (retried && !(caught instanceof PrfUnavailableError)) {
      unfinished = retried;
    }
    throw caught;
  }
}

export const meraSigner: SignerAdapter = {
  kind: "mera",

  unavailableReason: () => {
    const place = availability();
    return place.offered ? null : place.reason;
  },

  note: () => {
    const place = availability();
    return place.offered ? place.note : null;
  },

  // A passkey prompt has to follow the click that asked for it: a browser that sees a download in
  // between may refuse the prompt. So the libraries are fetched when the chooser opens, and the
  // ceremony finds them already there.
  prepare: () => {
    if (availability().offered) {
      void loadMeraKit().catch(() => {});
    }
  },

  // The address is not a secret: a reload shows whose wallet this is without a prompt. Signing
  // anything still needs the passkey, because nothing else was kept.
  resume: async (): Promise<SignerAccount | null> => {
    const connected = availability().offered ? recall() : null;
    return connected
      ? { address: connected.address, chainId: null, balance: await balanceOf(connected.address) }
      : null;
  },

  // One prompt: the passkey opens the account and signs in with it, in the same ceremony.
  connect: async (mode: ConnectMode = "existing"): Promise<SignerAccount | null> => {
    const opened = await picked(mode, signInWith);
    if (!opened) {
      return null;
    }
    remember({ address: opened.address, credentialId: opened.credentialId });
    return {
      address: opened.address,
      chainId: null,
      balance: await balanceOf(opened.address),
      session: opened.answer,
    };
  },

  signIn: async (expectedAddress: string): Promise<ConnectResult> => {
    const known = recall();
    const same = known && known.address.toLowerCase() === expectedAddress.toLowerCase();
    const opened = await ceremony("existing", signInWith, {
      expectedAddress,
      ...(same ? { credentialId: known.credentialId } : {}),
    });
    if (!opened) {
      throw promptClosed();
    }
    return opened.answer;
  },

  // The passkey of the account the person already has: the same ceremony, presented with the
  // session of the account being given up. That passkey is not remembered as the connected
  // wallet; the page keeps the one it had.
  join: async (token: string, joining: string) => {
    const opened = await ceremony(
      "existing",
      (message, signature) => join(message, signature, token),
      {},
      joining,
    );
    return opened && { address: opened.address, session: opened.answer };
  },

  disconnect: async () => {
    // No key was kept, so there is nothing to wipe: only which account this browser showed.
    remember(null);
  },
};
