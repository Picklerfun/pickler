import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
// Key de MonadScan (Etherscan V2). Pública, solo lectura, testnet; se rota desde etherscan.io.
const monadscanKey = process.env.PICKLER_MONADSCAN_KEY ?? "AHQMBTI74BYK33SZS47XF49SIADAG9VUYW";
// Perpl: vacío = testnet (src/perpl/config.ts). Para mainnet se fijan ambas.
const perplRest = process.env.PICKLER_PERPL_REST ?? "";
const perplWs = process.env.PICKLER_PERPL_WS ?? "";
const bundleIdentifier = "fun.pickler.app";

const config: ExpoConfig = {
  name: "Pickler",
  slug: "pickler-mobile",
  version: "0.1.0",
  orientation: "portrait",
  // 1024x1024 sin alfa (Apple lo exige). Fuente: PicklerProfile.png del equipo.
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#05061A",
  ios: {
    bundleIdentifier,
    buildNumber: "5",
    supportsTablet: false,
    backgroundColor: "#05061A",
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
    ["expo-build-properties", { ios: { deploymentTarget: "18.0" } }],
  ],
  extra: { rpId, monadscanKey, perplRest, perplWs },
};

export default config;
