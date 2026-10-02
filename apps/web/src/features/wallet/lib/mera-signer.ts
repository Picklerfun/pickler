"use client";

import { PRODUCT_HOSTS } from "@/server/hosts";
import { signIn, type ConnectResult } from "./connect";
import { meraAvailability, type MeraAvailability } from "./mera-availability";
import {
  PrfUnavailableError,
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
    relyingParty: process.env.NEXT_PUBLIC_MERA_RP_ID ?? "pickler.fun",
    production: process.env.NODE_ENV === "production",
    enabled: process.env.NEXT_PUBLIC_MERA_WEB !== "off",
  });
}

/** What a browser throws when the person closes a passkey prompt, or lets it time out. */
const closedPrompt = (cause: unknown) => {
  const name = (cause as { name?: unknown } | null)?.name;
  return name === "NotAllowedError" || name === "AbortError";
};

/** The closed-prompt shape a browser wallet throws, so one branch handles both wallets. */
const promptClosed = () =>
  Object.assign(new Error("The passkey prompt was closed"), { code: 4001 });

/** Runs one passkey prompt and names its two expected outcomes: nothing, and no PRF output. */
async function prompt(run: () => Promise<PrfResult>): Promise<PrfResult | null> {
  try {
    return await run();
  } catch (caught) {
    const { isMeraError } = await import("@category-labs/mera");
    if (isMeraError(caught) && caught.code === "PRF_UNAVAILABLE") {
      throw new PrfUnavailableError();
    }
    if (
      isMeraError(caught) &&
      caught.code === "PASSKEY_OPERATION_FAILED" &&
      closedPrompt(caught.cause)
    ) {
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
        // Restricted to the connected passkey when there is one; otherwise the platform offers
        // every Pickler passkey the person has, the app's included.
        ...(credentialId ? { credential: { credentialId } } : {}),
      }),
    );
  };
}

const balanceOf = (address: string) =>
  readNativeBalance(address, TARGET_CHAIN.publicRpcUrls[0] ?? "");

async function ceremony(mode: ConnectMode, connected?: Remembered) {
  const place = availability();
  if (!place.offered) {
    return null;
  }
  return runMeraCeremony({
    prf: source(place.rpId, mode, connected?.credentialId),
    kit: await loadMeraKit(),
    chainId: TARGET_CHAIN.chainId,
    signIn: (signer) => signIn(signer, fetch, "mera"),
    ...(connected ? { expectedAddress: connected.address } : {}),
  });
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
    const opened = await ceremony(mode);
    if (!opened) {
      return null;
    }
    remember({ address: opened.address, credentialId: opened.credentialId });
    return {
      address: opened.address,
      chainId: null,
      balance: await balanceOf(opened.address),
      session: opened.session,
    };
  },

  signIn: async (expectedAddress: string): Promise<ConnectResult> => {
    const known = recall();
    const connected =
      known && known.address.toLowerCase() === expectedAddress.toLowerCase() ? known : undefined;
    const opened = await ceremony(
      "existing",
      connected ?? { address: expectedAddress, credentialId: "" },
    );
    if (!opened) {
      throw promptClosed();
    }
    return opened.session;
  },

  disconnect: async () => {
    // No key was kept, so there is nothing to wipe: only which account this browser showed.
    remember(null);
  },
};
