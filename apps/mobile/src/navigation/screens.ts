// Pantallas y conjuntos puros (spec mobile-nav D3/D5). Viven aparte de store.ts para que routes.ts no lo importe
// en tiempo de ejecución: store.ts → ref.ts → routes.ts → store.ts era un ciclo que Metro avisaba en cada arranque.
// store.ts los re-exporta: pantallas y tests siguen importando de "../store".

export type Screen =
  | "markets" | "market" | "perpsFunds"
  | "launchpad" | "activity" | "portfolio"
  | "wallet" | "deposit" | "withdraw" | "signin";

/** Pantallas que exigen cuenta. Los coming soon nunca la piden. */
export const GATED: readonly Screen[] = ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw"];
export const CAN_BACK: readonly Screen[] = ["market", "perpsFunds", "deposit", "withdraw", "signin"];
export const SHOW_TABS: readonly Screen[] = ["markets", "launchpad", "activity", "portfolio", "wallet"];
/** Qué tab se ilumina en cada pantalla (D4). */
export const ROOT_OF: Record<Screen, Screen> = {
  markets: "markets", market: "markets", perpsFunds: "markets",
  launchpad: "launchpad", activity: "activity", portfolio: "portfolio",
  wallet: "wallet", deposit: "wallet", withdraw: "wallet", signin: "wallet",
};
