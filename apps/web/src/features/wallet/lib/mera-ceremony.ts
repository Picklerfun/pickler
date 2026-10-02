import type { ConnectResult, Signer } from "./connect";

/**
 * One Mera ceremony: a passkey prompt, the account derived from it, one signature over the
 * server's sign-in message, and nothing left behind.
 *
 * The key exists for the length of this function. The PRF output the passkey gave, the seed and
 * the private key are zeroed in a `finally`, so they are gone whether the ceremony finished, was
 * refused by the server or threw half-way (docs/specs/mera-web-v1.md, M4). Its parts are handed in
 * — the prompt, the key libraries, the sign-in — so all of that is tested without a browser.
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
  chainId: number;
  /** Signs in as the opened account: asks the API for its message, signs it, presents it. */
  signIn: (signer: Signer) => Promise<ConnectResult>;
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

  let privateKey: Uint8Array | undefined;
  let opened: OpenedKey | undefined;
  try {
    privateKey = ceremony.kit.privateKeyFromPrf(passkey.prfOutput);
    opened = ceremony.kit.openKey(privateKey);

    const expected = ceremony.expectedAddress;
    if (expected && expected.toLowerCase() !== opened.address.toLowerCase()) {
      throw new WrongPasskeyError();
    }

    const key = opened;
    const session = await ceremony.signIn({
      address: key.address,
      chainId: ceremony.chainId,
      signMessage: (message) => key.signMessage(message),
    });
    return { address: key.address, credentialId: passkey.credentialId, session };
  } finally {
    opened?.end();
    privateKey?.fill(0);
    passkey.prfOutput.fill(0);
  }
}
