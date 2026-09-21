import { createNavigationContainerRef } from "@react-navigation/native";
import { type RootParamList, screenOfRoute, type SigninParams, TAB_OF, type TabName, TAB_ROOT } from "./routes";
import type { Screen } from "./screens";

// Adaptador de navegación (spec mobile-nav D2): las pantallas siguen hablando en `Screen`; aquí se traduce a rutas
// anidadas de react-navigation. Antes de `isReady()` las órdenes se encolan y `flushPending` las aplica en `onReady`.
//
// Semántica de `navigate` en react-navigation v7 (StackRouter, case NAVIGATE): si la ruta pedida no es la actual,
// la **apila de nuevo** aunque ya esté en la pila; sólo vuelve a la existente con `pop: true` (o con `getId`).
// Por eso cada orden lleva tres banderas:
//   - `pop: true` en el RootStack: si `Tabs` ya está debajo (p. ej. bajo `signin`), vuelve a él y saca lo de encima.
//   - `pop: true` anidado (`params.pop`, useNavigationBuilder lo reenvía como NAVIGATE al stack de la pestaña): vuelve a
//     `markets`/`wallet` ya existentes en vez de duplicarlos.
//   - `initial: false` en pantallas no raíz: si la pila de la pestaña se monta en frío, la pantalla pedida se apila
//     **sobre** la raíz de la pestaña (D10: Market sobre Markets) en vez de convertirse en la ruta inicial y única.
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

/** Ir a una pantalla por su pestaña: vuelve a `Tabs` (saca `signin`), enfoca la pestaña y apila/vuelve a la pantalla. */
export function navigateTo(screen: Screen, signinParams?: SigninParams): void {
  run(() => {
    if (screen === "signin") { navigationRef.navigate("signin", signinParams); return; }
    const tab = TAB_OF[screen];
    // `params: { screen }` anida un nivel más: Tabs → pestaña → pantalla de su pila.
    const nested = screen === TAB_ROOT[tab] ? { screen, pop: true } : { screen, initial: false, pop: true };
    navigationRef.navigate("Tabs", { screen: tab, params: nested } as never, { pop: true });
  });
}

/** Sólo enfoca la pestaña (tab bar): sin params anidados, su pila se conserva tal cual. */
export function switchTab(tab: TabName): void {
  run(() => navigationRef.navigate("Tabs", { screen: tab }, { pop: true }));
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
