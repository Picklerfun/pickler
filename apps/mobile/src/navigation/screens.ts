// Pantallas y conjuntos puros (spec mobile-nav D3/D5). Viven aparte de store.ts para que routes.ts no lo importe
// en tiempo de ejecución: store.ts → ref.ts → routes.ts → store.ts era un ciclo que Metro avisaba en cada arranque.
// store.ts los re-exporta: pantallas y tests siguen importando de "../store".

export type Screen =
  | "markets" | "market"
  | "agents" | "agent"
  | "portfolio" | "read"
  | "wallet" | "deposit" | "withdraw" | "perpsFunds"
  | "launchpad" | "activity" | "signin";

/** Pantallas que exigen cuenta (D23). La lista de Agents es pública; los coming soon nunca la piden. */
export const GATED: readonly Screen[] = ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "portfolio", "read", "agent"];
export const CAN_BACK: readonly Screen[] = ["market", "perpsFunds", "deposit", "withdraw", "signin", "agent", "read"];
/** Raíces con tab bar: las 4 visibles y las 2 ocultas (Launchpad y Activity siguen siendo raíces de su pestaña, D1). */
export const SHOW_TABS: readonly Screen[] = ["markets", "agents", "portfolio", "wallet", "launchpad", "activity"];
/** Qué tab se ilumina en cada pantalla. */
export const ROOT_OF: Record<Screen, Screen> = {
  markets: "markets", market: "markets",
  agents: "agents", agent: "agents",
  portfolio: "portfolio", read: "portfolio",
  wallet: "wallet", deposit: "wallet", withdraw: "wallet", perpsFunds: "wallet",
  launchpad: "launchpad", activity: "activity", signin: "wallet",
};
