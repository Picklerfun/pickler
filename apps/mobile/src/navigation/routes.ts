import type { NavigatorScreenParams } from "@react-navigation/native";
import type { Patch } from "../store";
import { GATED, type Screen } from "./screens";

// Tabla de rutas de react-navigation (spec mobile-nav D1/D2). Puro: sin react-native.

export type TabName = "MarketsTab" | "AgentsTab" | "PortfolioTab" | "WalletTab" | "LaunchpadTab" | "ActivityTab";

/** Params de Sign in: a dónde volver al terminar y con qué patch (D5). */
export type SigninParams = { next?: Screen; patch?: Patch } | undefined;

export type MarketsStackParamList = { markets: undefined; market: undefined };
export type AgentsStackParamList = { agents: undefined; agent: undefined };
export type PortfolioStackParamList = { portfolio: undefined; read: undefined };
export type WalletStackParamList = { wallet: undefined; deposit: undefined; withdraw: undefined; perpsFunds: undefined };
export type SoloStackParamList<K extends string> = Record<K, undefined>;
export type TabParamList = {
  MarketsTab: NavigatorScreenParams<MarketsStackParamList> | undefined;
  AgentsTab: NavigatorScreenParams<AgentsStackParamList> | undefined;
  PortfolioTab: NavigatorScreenParams<PortfolioStackParamList> | undefined;
  WalletTab: NavigatorScreenParams<WalletStackParamList> | undefined;
  LaunchpadTab: NavigatorScreenParams<SoloStackParamList<"launchpad">> | undefined;
  ActivityTab: NavigatorScreenParams<SoloStackParamList<"activity">> | undefined;
};
export type RootParamList = { Tabs: NavigatorScreenParams<TabParamList> | undefined; signin: SigninParams };

/** Pestañas pintadas en la barra (D1/D2). */
export const TAB_ORDER: readonly TabName[] = ["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab"];
/** Todas las registradas: Launchpad y Activity se integran después, fuera de la barra (D1). */
export const ALL_TABS: readonly TabName[] = [...TAB_ORDER, "LaunchpadTab", "ActivityTab"];

/** Pestaña dueña de cada pantalla (signin vive en el RootStack). */
export const TAB_OF: Record<Exclude<Screen, "signin">, TabName> = {
  markets: "MarketsTab", market: "MarketsTab",
  agents: "AgentsTab", agent: "AgentsTab",
  portfolio: "PortfolioTab", read: "PortfolioTab",
  wallet: "WalletTab", deposit: "WalletTab", withdraw: "WalletTab", perpsFunds: "WalletTab",
  launchpad: "LaunchpadTab", activity: "ActivityTab",
};

export const TAB_ROOT: Record<TabName, Screen> = {
  MarketsTab: "markets", AgentsTab: "agents", PortfolioTab: "portfolio", WalletTab: "wallet", LaunchpadTab: "launchpad", ActivityTab: "activity",
};

export const SCREENS_ALL: readonly Screen[] = [
  "markets", "market", "agents", "agent", "portfolio", "read", "wallet", "deposit", "withdraw", "perpsFunds", "launchpad", "activity", "signin",
];

/** Nombre de ruta enfocada → pantalla; null para navegadores (`Tabs`, `*Tab`) o sin estado. */
export function screenOfRoute(name: string | undefined): Screen | null {
  return name !== undefined && (SCREENS_ALL as readonly string[]).includes(name) ? (name as Screen) : null;
}

/** Gate de cuenta (D5): sin cuenta, las pantallas de GATED pasan por signin recordando el destino. */
export function gateTarget(hasAccount: boolean, target: Screen): { screen: Screen; next?: Screen } {
  if (hasAccount || !GATED.includes(target)) return { screen: target };
  return { screen: "signin", next: target };
}
