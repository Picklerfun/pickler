import type { EvmAddress } from "@category-labs/mera";
import { base64urlnopad } from "@scure/base";
import {
  deleteItemAsync,
  getItemAsync,
  type SecureStoreOptions,
  setItemAsync,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY,
} from "expo-secure-store";

const KEY = "pickler.perpl.v1";
const PRIVATE_KEY_LENGTH = 32;

// Sin gate biométrico: la key solo puede operar (scope read|trade), nunca retirar. Se revisa antes de mainnet.
const ITEM_OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

export type TradingKey = { address: EvmAddress; accountId: bigint; apiKey: string; privateKey: Uint8Array };

export function serializeTradingKey(key: TradingKey): string {
  return JSON.stringify({
    address: key.address,
    accountId: key.accountId.toString(),
    apiKey: key.apiKey,
    privateKey: base64urlnopad.encode(key.privateKey),
  });
}

export function parseTradingKey(raw: string): TradingKey | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const { address, accountId, apiKey, privateKey } = value as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  if (typeof accountId !== "string" || !/^[1-9]\d*$/.test(accountId)) return undefined;
  if (typeof apiKey !== "string" || apiKey === "" || apiKey.length > 512) return undefined;
  if (typeof privateKey !== "string") return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(privateKey);
  } catch {
    return undefined;
  }
  if (bytes.length !== PRIVATE_KEY_LENGTH) return undefined;
  return { address: address as EvmAddress, accountId: BigInt(accountId), apiKey, privateKey: bytes };
}

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadTradingKey(): Promise<TradingKey | undefined> {
  const raw = await getItemAsync(KEY, ITEM_OPTIONS);
  if (raw === null) return undefined;
  const key = parseTradingKey(raw);
  if (key === undefined) await deleteItemAsync(KEY);
  return key;
}

export async function saveTradingKey(key: TradingKey): Promise<void> {
  await setItemAsync(KEY, serializeTradingKey(key), ITEM_OPTIONS);
}

export async function clearTradingKey(): Promise<void> {
  await deleteItemAsync(KEY);
}
