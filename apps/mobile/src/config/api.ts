import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra ?? {};
const raw = typeof extra.apiUrl === "string" ? extra.apiUrl.trim().replace(/\/+$/, "") : "";

/**
 * Base de la API del producto (`PICKLER_API_URL`, p. ej. https://pickler.fun/api/v1). null = sin configurar: la app no
 * entra a ninguna cuenta ni pide username, y se comporta como antes. Así un build sin la variable no cambia.
 */
export const API_URL: string | null = raw === "" ? null : raw;
