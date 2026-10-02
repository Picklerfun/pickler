import type { ConnectResult } from "./connect";

/**
 * One Mera ceremony: a passkey prompt, the account derived from it, one signature over the
 * server's sign-in message, and no key kept (docs/specs/mera-web-v1.md, M4).
 *
 * What is held, and for how long:
 *
 * - The PRF output is zeroed as soon as the key is derived from it, before any request.
 * - The key is needed to sign the server's message, and the server's message needs the address,
 *   so the key lives across one request (the challenge, which has a timeout) and no other. It is
 *   wiped — the signing session ended, the bytes zeroed — before the signature is presented, and
 *   in a `finally`, so also when the ceremony is refused or throws half-way.
 *
 * What this cannot wipe, because JavaScript gives no way to: the mnemonic, which is a string, the
 * big integers the curve library computes with, and the browser's own copy of the PRF output
 * inside the credential it returned. They are unreachable once this returns and are left to the
 * garbage collector. "No key kept" means nothing reachable holds one, not that memory was scrubbed.
 *
 * Its parts are handed in — the prompt, the key libraries, the two requests — so all of that is
 * tested without a browser.
 */

/** The passkey gave no PRF output: it exists and cannot open a wallet. The screen says why. */
export class PrfUnavailableError extends Error {
  constructor() {
    super("That passkey cannot open a Pickler wallet");
    this.name = "PrfUnavailableError";
  }
}

/** The passkey opened an account, and it is not the one that is connected. */
export class WrongPasskeyError extends Error {
  constructor() {
    super("That passkey opens a different wallet from the one connected here");
    this.name = "WrongPasskeyError";
  }
}

/** As much of a Mera SDK error as this reads, so a test can make one without a browser. */
interface SdkError {
  code: string;
  cause?: unknown;
}

/**
 * What a passkey prompt that threw was: the person closing it (or letting it time out), a passkey
 * that exists and gives no PRF output, or a real failure. The first two are answers the screen
 * has words for; only the third is an error.
 */
export function promptFailure(
  caught: unknown,
  isSdkError: (value: unknown) => value is SdkError,
): "closed" | "no_prf" | "failed" {
  if (!isSdkError(caught)) {
    return "failed";
  }
  if (caught.code === "PRF_UNAVAILABLE") {
    return "no_prf";
  }
  const name = (caught.cause as { name?: unknown } | null | undefined)?.name;
  const closed = name === "NotAllowedError" || name === "AbortError";
  return caught.code === "PASSKEY_OPERATION_FAILED" && closed ? "closed" : "failed";
}

export interface PrfResult {
  credentialId: string;
  /** 32 bytes. The ceremony zeroes them; the caller must not keep another copy. */
  prfOutput: Uint8Array;
}

/** A passkey prompt. Null when the person closed it; `PrfUnavailableError` when it gave nothing. */
export type PrfSource = () => Promise<PrfResult | null>;

/** A private key held just long enough to sign with. */
export interface OpenedKey {
  address: string;
  signMessage(message: string): Promise<string>;
  /** Wipes the key inside the signing session. */
  end(): void;
}

/** The key libraries, loaded on demand (`mera-kit.ts`) and handed in so a test uses the same ones. */
export interface MeraKit {
  /** The account's private key from a PRF output. The one rule, from `@pickler/mera-account`. */
  privateKeyFromPrf(prfOutput: Uint8Array): Uint8Array;
  openKey(privateKey: Uint8Array): OpenedKey;
}

export interface MeraCeremony {
  prf: PrfSource;
  kit: MeraKit;
  /** The server's sign-in message for this address. The one request the key waits for. */
  challenge: (address: string) => Promise<string>;
  /** Presents the signed message. Called only after the key is wiped. */
  present: (message: string, signature: string) => Promise<ConnectResult>;
  /** The passkey prompt returned a credential, before anything else can fail. */
  onPasskey?: (credentialId: string) => void;
  /** The account already connected. A passkey that opens any other is refused. */
  expectedAddress?: string;
}

export interface MeraOpened {
  address: string;
  credentialId: string;
  session: ConnectResult;
}

/** Null when the person closed the prompt. Throws what the prompt, the key or the server threw. */
export async function runMeraCeremony(ceremony: MeraCeremony): Promise<MeraOpened | null> {
  const passkey = await ceremony.prf();
  if (!passkey) {
    return null;
  }
  ceremony.onPasskey?.(passkey.credentialId);

  let privateKey: Uint8Array | undefined;
  let opened: OpenedKey | undefined;
  const wipe = () => {
    try {
      opened?.end();
    } finally {
      privateKey?.fill(0);
      passkey.prfOutput.fill(0);
      opened = undefined;
    }
  };

  let address: string;
  let message: string;
  let signature: string;
  try {
    try {
      privateKey = ceremony.kit.privateKeyFromPrf(passkey.prfOutput);
    } finally {
      passkey.prfOutput.fill(0);
    }
    opened = ceremony.kit.openKey(privateKey);
    address = opened.address;

    const expected = ceremony.expectedAddress;
    if (expected && expected.toLowerCase() !== address.toLowerCase()) {
      throw new WrongPasskeyError();
    }

    message = await ceremony.challenge(address);
    signature = await opened.signMessage(message);
  } finally {
    wipe();
  }

  // The key is gone. What is left to send is a string and its signature.
  const session = await ceremony.present(message, signature);
  return { address, credentialId: passkey.credentialId, session };
}
