import { createNavigationContainerRef } from "@react-navigation/native";
import { type RootParamList, screenOfRoute, type SigninParams, TAB_OF } from "./routes";
import type { Screen } from "./screens";

// Adaptador de navegación (spec mobile-nav D2): las pantallas siguen hablando en `Screen`; aquí se traduce a rutas
// anidadas de react-navigation. Antes de `isReady()` las órdenes se encolan y `flushPending` las aplica en `onReady`.
export const navigationRef = createNavigationContainerRef<RootParamList>();

let pending: (() => void)[] = [];

function run(fn: () => void): void {
  if (navigationRef.isReady()) fn();
  else pending.push(fn);
}

export function flushPending(): void {
  const q = pending;
  pending = [];
  for (const fn of q) fn();
}

/** Ir a una pantalla por su pestaña. `navigate` vuelve a `Tabs` si está debajo (saca `signin`) y aplica lo anidado (P3). */
export function navigateTo(screen: Screen, signinParams?: SigninParams): void {
  run(() => {
    if (screen === "signin") { navigationRef.navigate("signin", signinParams); return; }
    const tab = TAB_OF[screen];
    // `params: { screen }` anida un nivel más: Tabs → pestaña → pantalla de su pila.
    navigationRef.navigate("Tabs", { screen: tab, params: { screen } } as never);
  });
}

export function goBackIfCan(): void {
  run(() => { if (navigationRef.canGoBack()) navigationRef.goBack(); });
}

/** Deja el RootStack con una sola ruta (sign out → signin; primer sign-in → Tabs). */
export function resetRootTo(route: "Tabs" | "signin"): void {
  run(() => navigationRef.resetRoot({ index: 0, routes: [{ name: route }] }));
}

export function currentScreen(): Screen | null {
  return navigationRef.isReady() ? screenOfRoute(navigationRef.getCurrentRoute()?.name) : null;
}

export function currentParams(): SigninParams {
  return navigationRef.isReady() ? (navigationRef.getCurrentRoute()?.params as SigninParams) : undefined;
}

export function signinIsRoot(): boolean {
  return navigationRef.isReady() && navigationRef.getRootState()?.routes[0]?.name === "signin";
}
