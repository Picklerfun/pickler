import type { ReadsSessionStatus } from "../hooks/useReads";

export type ReadMissingCopy = { title: string; body: string };

/**
 * Estado "missing" de la pantalla Read (revisión final F1 mobile-light, I2). fetchOne devuelve null tanto si
 * Face ID se canceló como si falló la red: sin sesión lista se pide desbloquear; si no, un fallo genérico.
 * Ambos llevan "Try again".
 */
export function readMissingCopy(session: ReadsSessionStatus): ReadMissingCopy {
  return session === "ready"
    ? { title: "Couldn't load this read", body: "Check your connection and try again." }
    : { title: "Unlock to open this read", body: "Your reads are tied to your wallet. Unlock to load it." };
}
