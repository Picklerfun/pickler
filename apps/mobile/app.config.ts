import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
const bundleIdentifier = "fun.pickler.app";

const config: ExpoConfig = {
  name: "Pickler",
  slug: "pickler-mobile",
  version: "0.1.0",
  orientation: "portrait",
  // 1024x1024 sin alfa (Apple lo exige). Fuente: PicklerProfile.png del equipo.
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#08080A",
  ios: {
    bundleIdentifier,
    buildNumber: "2",
    supportsTablet: false,
    backgroundColor: "#08080A",
    associatedDomains: [`webcredentials:${rpId}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-font",
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
