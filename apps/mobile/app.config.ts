import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
// Key de MonadScan (Etherscan V2). Pública, solo lectura, testnet; se rota desde etherscan.io.
const monadscanKey = process.env.PICKLER_MONADSCAN_KEY ?? "AHQMBTI74BYK33SZS47XF49SIADAG9VUYW";
// Perpl: vacío = testnet (src/perpl/config.ts). Para mainnet se fijan ambas.
const perplRest = process.env.PICKLER_PERPL_REST ?? "";
const perplWs = process.env.PICKLER_PERPL_WS ?? "";
const perplMarketDataWs = process.env.PICKLER_PERPL_MARKET_DATA_WS ?? "";
// Servicio de reads (services/reads, Supabase pickler). Vacío = el de producción (src/config/reads.ts).
const readsUrl = process.env.PICKLER_READS_URL ?? "";
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
    buildNumber: "10",
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
    ["expo-notifications", { enableBackgroundRemoteNotifications: false }],
    ["expo-splash-screen", { image: "./assets/splash-mark.png", imageWidth: 140, resizeMode: "contain", backgroundColor: "#05061A" }],
  ],
  extra: { rpId, monadscanKey, perplRest, perplWs, perplMarketDataWs, readsUrl },
};

export default config;
