import { getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";

const KEY = "pickler.onboarded.v1";
// No es secreto: sin gate biométrico, igual que la dirección de la cuenta.
const OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

/** Un fallo de lectura cuenta como «ya visto»: mejor no mostrar hojas que bloquear el alta. */
export async function loadOnboarded(): Promise<boolean> {
  try { return (await getItemAsync(KEY, OPTIONS)) === "1"; } catch { return true; }
}

export async function saveOnboarded(): Promise<void> {
  try { await setItemAsync(KEY, "1", OPTIONS); } catch { /* sin flag, a lo sumo se repiten las hojas en el próximo alta */ }
}
