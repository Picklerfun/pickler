import type { EvmAddress } from "@category-labs/mera";
import { base64urlnopad } from "@scure/base";
import {
  deleteItemAsync,
  getItemAsync,
  type SecureStoreOptions,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "expo-secure-store";

const PRF_KEY = "pickler.prf.v1";
const ACCOUNT_KEY = "pickler.account.v1";
const PRF_OUTPUT_LENGTH = 32;

// Leer el PRF pide Face ID / passcode: es el secreto del que sale la llave.
const PRF_ITEM_OPTIONS = {
  requireAuthentication: true,
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  authenticationPrompt: "Unlock your Pickler account",
} satisfies SecureStoreOptions;

// La dirección no es secreta: se lee sin prompt para pintar Home al arrancar.
const UNGATED_ITEM_OPTIONS = {
  keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} satisfies SecureStoreOptions;

export type StoredAccount = { address: EvmAddress; credentialId: string };
export type StoredPrf = { credentialId: string; prfOutput: Uint8Array };

export function parseStoredAccount(raw: string): StoredAccount | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const { address, credentialId } = value as Record<string, unknown>;
  if (
    typeof address !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(address) ||
    typeof credentialId !== "string" ||
    credentialId.length > 2_048 ||
    !/^[A-Za-z0-9_-]+$/.test(credentialId)
  ) {
    return undefined;
  }
  return { address: address as EvmAddress, credentialId };
}

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadStoredAccount(): Promise<StoredAccount | undefined> {
  const raw = await getItemAsync(ACCOUNT_KEY);
  if (raw === null) return undefined;
  const account = parseStoredAccount(raw);
  if (account === undefined) await deleteItemAsync(ACCOUNT_KEY);
  return account;
}

export async function saveStoredAccount(account: StoredAccount): Promise<void> {
  await setItemAsync(ACCOUNT_KEY, JSON.stringify(account), UNGATED_ITEM_OPTIONS);
}

export async function storePrfResult(result: StoredPrf): Promise<void> {
  const stored = {
    credentialId: result.credentialId,
    prfOutput: base64urlnopad.encode(result.prfOutput),
  };
  await setItemAsync(PRF_KEY, JSON.stringify(stored), PRF_ITEM_OPTIONS);
}

/** Lanza si el usuario cancela la autenticación o el dato está corrupto. */
export async function readStoredPrfResult(): Promise<StoredPrf | undefined> {
  const stored = await getItemAsync(PRF_KEY, PRF_ITEM_OPTIONS);
  if (stored === null) return undefined;
  const { credentialId, prfOutput } = JSON.parse(stored) as Partial<{
    credentialId: string;
    prfOutput: string;
  }>;
  if (typeof credentialId !== "string" || typeof prfOutput !== "string") {
    throw new Error("Stored PRF result is malformed");
  }
  const bytes = new Uint8Array(base64urlnopad.decode(prfOutput));
  if (bytes.length !== PRF_OUTPUT_LENGTH) {
    throw new Error("Stored PRF output must be 32 bytes");
  }
  return { credentialId, prfOutput: bytes };
}

export async function clearStoredAccount(): Promise<void> {
  await deleteItemAsync(PRF_KEY);
  await deleteItemAsync(ACCOUNT_KEY);
}
