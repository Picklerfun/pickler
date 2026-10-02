import { getRandomValues } from "expo-crypto";

// Hermes no trae CSPRNG; mera exige crypto.getRandomValues. Importar antes que
// cualquier otro módulo de la app.
if (typeof globalThis.crypto?.getRandomValues !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { ...globalThis.crypto, getRandomValues },
  });
}
