import type { NavigatorScreenParams } from "@react-navigation/native";
import type { Patch } from "../store";
import { GATED, type Screen } from "./screens";

// Tabla de rutas de react-navigation (spec mobile-nav D1/D2). Puro: sin react-native.

export type TabName = "MarketsTab" | "LaunchpadTab" | "ActivityTab" | "PortfolioTab" | "WalletTab";

/** Params de Sign in: a dónde volver al terminar y con qué patch (D5). */
export type SigninParams = { next?: Screen; patch?: Patch } | undefined;

export type MarketsStackParamList = { markets: undefined; market: undefined; perpsFunds: undefined };
export type WalletStackParamList = { wallet: undefined; deposit: undefined; withdraw: undefined };
export type SoloStackParamList<K extends string> = Record<K, undefined>;
export type TabParamList = {
  MarketsTab: NavigatorScreenParams<MarketsStackParamList> | undefined;
  LaunchpadTab: NavigatorScreenParams<SoloStackParamList<"launchpad">> | undefined;
  ActivityTab: NavigatorScreenParams<SoloStackParamList<"activity">> | undefined;
  PortfolioTab: NavigatorScreenParams<SoloStackParamList<"portfolio">> | undefined;
  WalletTab: NavigatorScreenParams<WalletStackParamList> | undefined;
};
export type RootParamList = { Tabs: NavigatorScreenParams<TabParamList> | undefined; signin: SigninParams };

export const TAB_ORDER: readonly TabName[] = ["MarketsTab", "LaunchpadTab", "ActivityTab", "PortfolioTab", "WalletTab"];

/** Pestaña dueña de cada pantalla (signin vive en el RootStack). */
export const TAB_OF: Record<Exclude<Screen, "signin">, TabName> = {
  markets: "MarketsTab", market: "MarketsTab", perpsFunds: "MarketsTab",
  launchpad: "LaunchpadTab", activity: "ActivityTab", portfolio: "PortfolioTab",
  wallet: "WalletTab", deposit: "WalletTab", withdraw: "WalletTab",
};

export const TAB_ROOT: Record<TabName, Screen> = {
  MarketsTab: "markets", LaunchpadTab: "launchpad", ActivityTab: "activity", PortfolioTab: "portfolio", WalletTab: "wallet",
};

export const SCREENS_ALL: readonly Screen[] = [
  "markets", "market", "perpsFunds", "launchpad", "activity", "portfolio", "wallet", "deposit", "withdraw", "signin",
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
