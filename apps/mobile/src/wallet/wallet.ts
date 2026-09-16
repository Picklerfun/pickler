import {
  createPasskeyWithPrfOutput,
  createSecp256k1SigningSession,
  type EvmAddress,
  getEvmAddress,
  getPasskeyPrfOutput,
  isMeraError,
  type Secp256k1SigningSession,
} from "@category-labs/mera";
import { reactNativeWebAuthnClient } from "@category-labs/mera/react-native-webauthn-client";
import { toViemAccount } from "@category-labs/mera/viem";
import type { PasskeyError } from "react-native-passkey";
import { BaseError as ViemError, type LocalAccount } from "viem";
import { RP_ID, RP_NAME } from "../config/rp";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../hd/hd";
import {
  readStoredPrfResult,
  saveStoredAccount,
  type StoredPrf,
  storePrfResult,
} from "../storage/storage";

export type Wallet = {
  address: EvmAddress;
  credentialId: string;
  session: Secp256k1SigningSession;
  account: LocalAccount;
};

const USER_NAME = "pickler";
const displayName = (): string => `Pickler ${new Date().toLocaleDateString()}`;

export async function createAccount(): Promise<Wallet> {
  const created = await createPasskeyWithPrfOutput({
    rp: { id: RP_ID, name: RP_NAME },
    user: { name: USER_NAME, displayName: displayName() },
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return storeAndOpen(created);
}

/** Sin credential fijada: iOS ofrece todos los passkeys de pickler.fun. */
export async function signIn(): Promise<Wallet> {
  const asserted = await getPasskeyPrfOutput({
    rpId: RP_ID,
    webAuthnClient: reactNativeWebAuthnClient,
  });
  return storeAndOpen(asserted);
}

/** Lee el PRF guardado (pide Face ID) y re-deriva; sin prompt de passkey. */
export async function unlockStoredWallet(): Promise<Wallet | undefined> {
  const stored = await readStoredPrfResult();
  return stored === undefined ? undefined : toWallet(stored);
}

async function storeAndOpen(result: StoredPrf): Promise<Wallet> {
  await storePrfResult(result);
  const wallet = toWallet(result);
  try {
    await saveStoredAccount({ address: wallet.address, credentialId: wallet.credentialId });
  } catch (error) {
    wallet.session.end();
    throw error;
  }
  return wallet;
}

/** Limpia los buffers de llave tras derivar. */
function toWallet({ credentialId, prfOutput }: StoredPrf): Wallet {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prfOutput));
  prfOutput.fill(0);
  let privateKey: Uint8Array | undefined;
  try {
    privateKey = deriveEvmPrivateKey(seed, 0);
    const session = createSecp256k1SigningSession({ privateKey });
    return {
      address: getEvmAddress(session.publicKey),
      credentialId,
      session,
      account: toViemAccount(session),
    };
  } finally {
    seed.fill(0);
    privateKey?.fill(0);
  }
}

export function describeError(error: unknown): string {
  if (isMeraError(error)) {
    switch (error.code) {
      case "PRF_UNAVAILABLE":
        return "This device can't create a passkey with PRF. Use an iPhone with iOS 18 or newer.";
      case "PASSKEY_OPERATION_FAILED":
        return describePasskeyFailure(error.cause);
      case "SESSION_ENDED":
        return "The session has ended. Unlock again.";
      case "CRYPTO_UNAVAILABLE":
        return "The runtime provides no secure random source.";
      default:
        return error.message;
    }
  }
  if (error instanceof ViemError) return error.shortMessage;
  return error instanceof Error ? error.message : String(error);
}

function describePasskeyFailure(cause: unknown): string {
  const { error, message } = (cause ?? {}) as Partial<PasskeyError>;
  switch (error) {
    case "RequestFailed":
      return `iOS refused a passkey for ${RP_ID}. Check that https://${RP_ID}/.well-known/apple-app-site-association names this app.`;
    case "NoCredentials":
      return "No passkey for Pickler on this device. Create an account first.";
    case "UserCancelled":
      return "";
    default:
      return typeof message === "string" ? message : "The passkey request failed.";
  }
}
