import { MONAD_MAINNET, MONAD_TESTNET } from "@pickler/chain";

/** Presentation availability, not authorization or a mainnet launch switch. */
export const PRODUCT_NETWORKS = [
  { network: MONAD_TESTNET, label: "Testnet", available: true },
  { network: MONAD_MAINNET, label: "Mainnet — Coming soon", available: false },
] as const;

// Both products operate on testnet until the backend supports isolated network contexts.
export const ACTIVE_PRODUCT_NETWORK = MONAD_TESTNET;
export const MAINNET_NOTE = "Mainnet is coming soon. Pickler currently operates on Monad Testnet.";
