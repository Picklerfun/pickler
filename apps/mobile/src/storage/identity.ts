import { deleteItemAsync, getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";
import { parseIdentity, serializeIdentity, type StoredIdentity } from "../identity/state";

const KEY = "pickler.identity.v1";
// El username es público: sin gate biométrico, igual que la dirección. El token de la API no se guarda.
const OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

/** Una entrada malformada se borra y se lee como ausente; un fallo de lectura también es ausente (se vuelve a preguntar). */
export async function loadIdentity(): Promise<StoredIdentity | undefined> {
  try {
    const raw = await getItemAsync(KEY, OPTIONS);
    if (raw === null) return undefined;
    const s = parseIdentity(raw);
    if (s === undefined) await deleteItemAsync(KEY);
    return s;
  } catch {
    return undefined;
  }
}

export async function saveIdentity(s: StoredIdentity): Promise<void> {
  try { await setItemAsync(KEY, serializeIdentity(s), OPTIONS); } catch { /* sin guardar, se pregunta de nuevo al desbloquear */ }
}

export async function clearIdentity(): Promise<void> {
  try { await deleteItemAsync(KEY); } catch { /* nada que borrar */ }
}
