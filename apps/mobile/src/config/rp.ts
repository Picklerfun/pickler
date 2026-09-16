import Constants from "expo-constants";

const rpId = Constants.expoConfig?.extra?.rpId;
if (typeof rpId !== "string") {
  throw new Error("app.config.ts supplied no rpId");
}

export const RP_ID = rpId;
export const RP_NAME = "Pickler";
