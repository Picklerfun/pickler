import Constants from "expo-constants";

const key = Constants.expoConfig?.extra?.monadscanKey;
if (typeof key !== "string" || key === "") {
  throw new Error("app.config.ts supplied no monadscanKey");
}

/** Key pública de explorer (solo lectura, testnet). Se rota desde etherscan.io si hace falta. */
export const MONADSCAN_KEY = key;
