import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
const bundleIdentifier = "fun.pickler.app";

const config: ExpoConfig = {
  name: "Pickler",
  slug: "pickler-mobile",
  version: "0.1.0",
  orientation: "portrait",
  ios: {
    bundleIdentifier,
    buildNumber: "1",
    supportsTablet: false,
    associatedDomains: [`webcredentials:${rpId}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    [
      "expo-secure-store",
      {
        faceIDPermission:
          "Pickler uses Face ID to unlock the account stored on this device.",
      },
    ],
  ],
  extra: { rpId },
};

export default config;
