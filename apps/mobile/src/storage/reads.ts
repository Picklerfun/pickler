import { deleteItemAsync, getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";
import { parseSession, type ReadsSession, serializeSession } from "../reads/session";

const KEY = "pickler.reads.v1";
// Sin gate biométrico (D6): la firma sólo autoriza créditos simulados y lecturas.
const ITEM_OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadReadsSession(): Promise<ReadsSession | undefined> {
  const raw = await getItemAsync(KEY, ITEM_OPTIONS);
  if (raw === null) return undefined;
  const s = parseSession(raw);
  if (s === undefined) await deleteItemAsync(KEY);
  return s;
}

export async function saveReadsSession(s: ReadsSession): Promise<void> {
  await setItemAsync(KEY, serializeSession(s), ITEM_OPTIONS);
}

export async function clearReadsSession(): Promise<void> {
  await deleteItemAsync(KEY);
}
