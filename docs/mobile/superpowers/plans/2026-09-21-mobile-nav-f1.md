# Navegación nativa (mobile-nav) — F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar la navegación de la app a react-navigation nativa (`native-stack` dentro de `bottom-tabs`, una pila por pestaña) sin cambiar la API que usan las pantallas, de modo que el gesto atrás sea el interactivo de iOS, el «adelante» anime, la cabecera viaje con la página y cada pestaña conserve su pila.

**Architecture:** Se construye **al lado** de lo que existe y se conmuta en una sola task. Piezas nuevas: `src/navigation/routes.ts` (tabla pura `Screen → {tab, ruta}` y tipos de params), `src/navigation/ref.ts` (adaptador sobre `navigationRef`: `navigateTo`, `goBackIfCan`, `resetTo`, cola hasta `isReady`), `src/hooks/useRefreshSeal.ts` (el sello sale del `Shell`), `src/hooks/useCurrentScreen.ts` (pantalla activa por ruta), `src/ui/Page.tsx` (cabecera + `ScrollView` + refresh + sello + fondo opaco, por ruta), `src/ui/TabBar.tsx` (aspecto de hoy sobre la prop `tabBar`), `src/navigation/Navigator.tsx` (RootStack → Tabs → pila por pestaña, `withPage`, `AppCtx` por contexto). La conmutación (Task 6) deja el store sólo con datos, monta `NavigationContainer` en `App.tsx`, elimina `Shell.tsx` y `ui/gestures.ts`, y pasa Sign in a leer `next` de `route.params`.

**Tech Stack:** Expo SDK 57 / RN 0.86 / React 19.2; `@react-navigation/native` 7.4.x, `@react-navigation/native-stack` 7.19.x, `@react-navigation/bottom-tabs` 7.19.x; `react-native-screens ~4.26.0`, `react-native-gesture-handler ~2.32.0`, `react-native-reanimated 4.5.1` + `react-native-worklets 0.10.1` (plugin de Babel automático en `babel-preset-expo`), `expo-haptics ~57.0.3` (F2, se instala aquí para no repetir el rebuild); jest-expo, `npx tsc --noEmit`. Simulador iPhone 17 Pro `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Maestro (`taplabel.sh`).

**Spec:** `docs/superpowers/specs/2026-09-21-mobile-nav-design.md` (D1–D10, D12; D11 es F2). Overview `docs/overview/2026-09-21-mobile-nav.html` (F1 `pending` → `plan_ready` al guardar este plan → `completed` con el audit).

## Global Constraints

- Worktree `.claude/worktrees/mobile-nav`, rama `feat/mobile-nav` desde `main` = `6e9326c`. Primer comando en el worktree: `cd apps/mobile && npm ci`. Nunca `cd` al checkout principal para editar. Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `fix(mobile): …` / `docs(mobile-nav): …` con trailers `Co-Authored-By: <modelo que escribe> <noreply@anthropic.com>` y `Claude-Session: <URL de la sesión que ejecuta>`. **Sin push, sin merge, sin TestFlight** salvo autorización explícita de Jesús en la sesión.
- **Metro**: hoy corre en :8081 desde `.claude/worktrees/mobile-loading/apps/mobile` (ya mergeado). Para las tasks con simulador hay que **matarlo** (`lsof -tiTCP:8081 -sTCP:LISTEN | xargs kill`) y arrancarlo desde **este** worktree. Task 1 cambia nativo → `npx expo prebuild --platform ios --clean` + `npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0` (reinstala el dev build; puede borrar la cuenta local: sign in con el passkey «pickler» de Apple Passwords + Face ID `xcrun simctl spawn <UDID> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`). Simulador **siempre por UDID**, nunca `booted`; `xcrun simctl ui <UDID> content_size medium` antes de capturar (otra sesión lo deja en XXXL). Capturas con `xcrun simctl io <UDID> screenshot …` y **mirar cada una**. Cuenta #620: **no mover AUSD ni MON, ninguna orden, ningún Enable/Reconnect/Reset**.
- **Las pantallas no cambian de API** (D2): `ctx.nav(screen, patch)`, `ctx.back()`, `ctx.requireAccount(screen, patch)`, `ctx.finishSignin()`, `ctx.signedOut()` conservan nombre y semántica. Los `accessibilityLabel` existentes (`tab-*`, `market-*`, `back`, `dev-controls`, `pill-*`, `sign-out`, `deposit`, `withdraw`…) se conservan.
- **Store sólo con datos** (D3): `StoreState` pierde `screen`, `stack`, `next`, `nextPatch`. react-navigation es la única dueña de la pila; nada en la app guarda una pila propia.
- **Cabecera propia** (D6): `headerShown: false` en todos los stacks; la cabecera vive en `Page` y cada `Page` lleva fondo opaco (gradiente + puntos). Gesto y transición nativos (D8): `gestureEnabled: true`, `fullScreenGestureEnabled: false`, `animation: "default"`; tabs con `animation: "none"`.
- Copy en inglés; comentarios en español donde el archivo vecino los tenga; tests en inglés. `npm test` (hoy 31 suites / 242 tests) y `npx tsc --noEmit` en verde al cierre de cada task que toca código. Sin tests de UI (P12 de Ask F2): pantallas por `tsc` + simulador.
- Docs: contrato `docs/CLAUDE.md`; `npm run docs:html`; `docs:check` errors=0; `agents:check` `"errors": []`.
- Doc verificada el 2026-09-21: Expo v57 reanimated (`npx expo install react-native-reanimated react-native-worklets`, «No additional configuration is required» para Babel), gesture-handler (`npx expo install react-native-gesture-handler`); react-navigation v7: `navigate("Tabs", { screen, params })` para rutas anidadas, `navigate` a una ruta ya presente en la pila **vuelve** a ella, `popTo`, `navigationRef.isReady()/getCurrentRoute()/addListener("state")/resetRoot`, `tabBar` custom recibe `{ state, descriptors, navigation, insets }` y **debe emitir `tabPress`** (con la pestaña ya enfocada, la pila anidada hace `popToTop` sola), `animation` de bottom-tabs por defecto `none`, `getFocusedRouteNameFromRoute`.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | **Construir al lado y conmutar en Task 6.** Tasks 2–5 crean módulos nuevos que compilan sin usarse; Task 6 cambia store/App, borra `Shell.tsx` y `ui/gestures.ts`. | `tsc` verde en cada task; el store no puede perder `screen/stack` mientras `Shell` lo lea. |
| P2 | **`AppCtx` por React context** (`AppCtxProvider`/`useAppCtx` en `Navigator.tsx`); `withPage(screen, Component)` lee el contexto y renderiza `<Page screen><Component {...ctx} /></Page>`. | react-navigation monta las pantallas con `route`/`navigation`, no con nuestro `ctx`; el contexto evita cambiar las firmas de las 10 pantallas. |
| P3 | **`navigate` a rutas anidadas hace el trabajo del gate de vuelta**: `navigateTo("markets")` desde `Signin` = `navigationRef.navigate("Tabs", { screen: "MarketsTab", params: { screen: "markets" } })`; como `Tabs` ya está en el RootStack, react-navigation vuelve a ella (saca `Signin`) y aplica lo anidado. `finishSignin` sólo hace `resetRoot` cuando `Signin` fue la ruta inicial (sin `Tabs` debajo). | Un solo camino para «volver a Tabs + ir a next»; sin `popTo` manual. |
| P4 | **Pestaña con ruta no raíz → la tab bar custom devuelve `null`** (`SHOW_TABS` sobre `getFocusedRouteNameFromRoute`), no `tabBarStyle: display none`. La `SafeAreaView` inferior la pone `Page` cuando la tab bar no está (`edges` incluye `"bottom"` si `!SHOW_TABS.includes(screen)`). | Menos opciones por ruta; el mismo array `SHOW_TABS` que hoy. Limitación conocida: en el gesto de vuelta a una raíz la tab bar aparece al terminar la transición (no se anima) — residual anotado. |
| P5 | **Pantalla activa**: `useCurrentScreen()` escucha `navigationRef.addListener("state")` y lee `getCurrentRoute()?.name`; vale `"wallet"` hasta que haya estado. `useAppStore` recibe `scr` como input. | D4; el socket de Perpl y `readsActive` cuelgan de `scr` como hoy de `S.screen`. |
| P6 | **`held` de Sign in** = `heldActionFor(route.params?.next)`; `finishSignin` lee `next`/`patch` de los params del `Signin` enfocado (`navigationRef.getCurrentRoute()?.params`). | El store ya no tiene `next`; los params son la memoria del gate. |
| P7 | **Cola de navegación hasta `isReady`** en `ref.ts` (`pending`), vaciada en `onReady` del container. La cola de push por `account === null` de `App.tsx` se conserva tal cual. | El push en frío llega antes de que el container exista. |
| P8 | **`CAN_BACK` se mantiene** como filtro del botón `←`: se pinta si `CAN_BACK.includes(screen) && navigation.canGoBack()`. | Sign in como ruta inicial no tiene `←`; `deposit` sí. |
| P9 | **Tests**: `routes.test.ts` (cobertura de las 10 pantallas, `screenOfRoute`, `gateTarget`), `store.test.ts` recortado (fuera `nav/back/afterSignin/boot/canBack/reset`; dentro gate como `gateTarget`, `heldActionFor`, sets D5, `ROOT_OF`, headers, Ask, sello, `tradingLineState`, `screenHasData`), `gestures.test.ts` borrado. | Lo puro sigue testeado; la pila la prueba el simulador. |
| P10 | **Rebuild en Task 1, no al final**: instalar deps + `GestureHandlerRootView` + prebuild + run:ios con la app **vieja** y comprobar que arranca. | Si reanimated/worklets/screens rompen el build, se sabe antes de escribir la migración. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/package.json`, `package-lock.json`, `App.tsx` (root view) | 1 | dependencias + `GestureHandlerRootView` + rebuild |
| `apps/mobile/src/navigation/routes.ts`, `__tests__/routes.test.ts` | 2 | tipos de params, `TAB_OF`, `TAB_ROOT`, `TAB_ORDER`, `SCREENS_ALL`, `screenOfRoute`, `gateTarget` |
| `apps/mobile/src/navigation/ref.ts` | 3 | `navigationRef`, `navigateTo`, `goBackIfCan`, `resetRootTo`, `flushPending`, `currentParams` |
| `apps/mobile/src/hooks/useRefreshSeal.ts`, `src/hooks/useCurrentScreen.ts` | 4 | sello por pantalla (fuera de Shell); pantalla activa por ruta |
| `apps/mobile/src/ui/Page.tsx`, `src/ui/TabBar.tsx`, `src/navigation/Navigator.tsx` | 5 | página (cabecera/refresh/sello/fondo), tab bar (aspecto de hoy), árbol de navegación + `AppCtx` por contexto |
| `apps/mobile/src/store.ts`, `App.tsx`, `src/ctx.ts`, `src/screens/signin.tsx`, `src/DevControls.tsx`, `__tests__/store.test.ts`; **borrar** `src/Shell.tsx`, `src/ui/gestures.ts`, `__tests__/gestures.test.ts` | 6 | conmutación |
| Simulador | 7 | capturas (D12) |
| `docs/superpowers/specs/2026-09-21-mobile-nav-design.md`, `docs/overview/2026-09-21-mobile-nav.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-21-mobile-nav-f1-rulings.md`, `docs/superpowers/audits/img/*.png`, `apps/mobile/README.md`, `docs/overview/dev/2026-09-21-markets-ask-gate.html` (nota D10) | 8 | docs |

---

### Task 1: Dependencias nativas, `GestureHandlerRootView` y rebuild con la app actual

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json` (vía `npx expo install` / `npm install`)
- Modify: `apps/mobile/App.tsx` (envolver el árbol en `GestureHandlerRootView`)

**Interfaces:**
- Produces: las siete dependencias instaladas con las versiones del SDK 57; el dev build reinstalado con `react-native-screens`, `gesture-handler`, `reanimated` y `worklets` linkeados. Tasks 2–6 importan de ellas.

- [ ] **Step 1: Línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav/apps/mobile
git status --short && git log --oneline -1
npm ci 2>&1 | tail -1 && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio, HEAD `6fa0499` (o el commit de este plan); `Tests: 242 passed` / `31 passed`; `TSC-OK`.

- [ ] **Step 2: Instalar**

```bash
npx expo install react-native-screens react-native-gesture-handler react-native-reanimated react-native-worklets expo-haptics 2>&1 | tail -3
npm install @react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs 2>&1 | tail -2
grep -n '"react-native-screens"\|"react-native-gesture-handler"\|"react-native-reanimated"\|"react-native-worklets"\|"expo-haptics"\|"@react-navigation/' package.json
```
Expected: `react-native-screens ~4.26.x`, `react-native-gesture-handler ~2.32.x`, `react-native-reanimated 4.5.x`, `react-native-worklets 0.10.x`, `expo-haptics ~57.0.x`, `@react-navigation/native ^7.4.x`, `native-stack ^7.19.x`, `bottom-tabs ^7.19.x`. Anotar las versiones exactas en el reporte. `npx expo-doctor 2>&1 | tail -3` sin quejas de versiones.

- [ ] **Step 3: `GestureHandlerRootView`** — en `App.tsx`, añadir `import { GestureHandlerRootView } from "react-native-gesture-handler";` y envolver el `return` final:

```tsx
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
          <Shell ctx={ctx} />
        </View>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
```

- [ ] **Step 4: `tsc` antes del build nativo**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
```
Expected: `TSC-OK`, 31 / 242.

- [ ] **Step 5: Prebuild + run:ios**

```bash
U=2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
SC=/Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav/.superpowers/sdd/2026-09-21-mobile-nav-f1
mkdir -p "$SC/shots"
lsof -tiTCP:8081 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 1
npx expo prebuild --platform ios --clean 2>&1 | tail -3
grep -c "RNScreens\|RNGestureHandler\|RNReanimated\|RNWorklets" ios/Podfile.lock
nohup npx expo run:ios --device "$U" > "$SC/run.log" 2>&1 &
```
Esperar `Build Succeeded` / `Installing on` / `Opening` en `run.log` (3–8 min; sondear con `sleep 60`). Expected: `Podfile.lock` menciona los cuatro pods; la app abre en Wallet (o en Sign in si la reinstalación borró la cuenta: firmar con el passkey). Captura `$SC/shots/t1-boot.png` y **mirarla**: la app se ve igual que el build 7 (skeletons, sello). Si Metro muestra un error rojo de reanimated/worklets («Mismatch between JavaScript part and native part» o similar), parar y reportar BLOCKED con el texto exacto.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json App.tsx
git commit -m "feat(mobile): react-navigation, screens, gesture-handler, reanimated/worklets y haptics (SDK 57) + GestureHandlerRootView" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `git status` sin `ios/` (ignorado).

---

### Task 2: Tabla de rutas y gate puros (`navigation/routes.ts`)

**Files:**
- Create: `apps/mobile/src/navigation/routes.ts`
- Test: `apps/mobile/__tests__/routes.test.ts`

**Interfaces:**
- Consumes: `Screen`, `Patch`, `GATED` de `../store` (existen hoy).
- Produces (los usan Tasks 3, 5, 6):
  - `type TabName = "MarketsTab" | "LaunchpadTab" | "ActivityTab" | "PortfolioTab" | "WalletTab"`
  - `type SigninParams = { next?: Screen; patch?: Patch } | undefined`
  - `type MarketsStackParamList`, `WalletStackParamList`, `SoloStackParamList<K>`, `TabParamList`, `RootParamList`
  - `const TAB_OF: Record<Exclude<Screen, "signin">, TabName>`, `TAB_ROOT: Record<TabName, Screen>`, `TAB_ORDER: readonly TabName[]`, `SCREENS_ALL: readonly Screen[]`
  - `screenOfRoute(name: string | undefined): Screen | null`
  - `gateTarget(hasAccount: boolean, target: Screen): { screen: Screen; next?: Screen }`

- [ ] **Step 1: Tests (RED)** — crear `__tests__/routes.test.ts`:

```ts
import { GATED, ROOT_OF, SHOW_TABS, type Screen } from "../src/store";
import { gateTarget, SCREENS_ALL, screenOfRoute, TAB_OF, TAB_ORDER, TAB_ROOT } from "../src/navigation/routes";

test("every screen except signin belongs to exactly one tab, and each tab has a root that lights it up (D1)", () => {
  const screens = SCREENS_ALL.filter((s) => s !== "signin");
  expect(screens).toHaveLength(9);
  for (const s of screens) {
    const tab = TAB_OF[s as Exclude<Screen, "signin">];
    expect(TAB_ORDER).toContain(tab);
    expect(ROOT_OF[s]).toBe(TAB_ROOT[tab]); // el tab que se ilumina es la raíz de la pila
  }
  expect(TAB_ORDER).toEqual(["MarketsTab", "LaunchpadTab", "ActivityTab", "PortfolioTab", "WalletTab"]);
  expect(TAB_ORDER.map((t) => TAB_ROOT[t])).toEqual(SHOW_TABS);
});

test("screenOfRoute maps route names back to screens and ignores navigator names", () => {
  expect(screenOfRoute("market")).toBe("market");
  expect(screenOfRoute("signin")).toBe("signin");
  expect(screenOfRoute("Tabs")).toBeNull();
  expect(screenOfRoute("MarketsTab")).toBeNull();
  expect(screenOfRoute(undefined)).toBeNull();
});

test("gateTarget sends gated screens to signin without an account and remembers where to go (D5)", () => {
  expect(gateTarget(false, "markets")).toEqual({ screen: "signin", next: "markets" });
  expect(gateTarget(true, "markets")).toEqual({ screen: "markets" });
  expect(gateTarget(false, "launchpad")).toEqual({ screen: "launchpad" }); // coming soon never asks
  for (const s of GATED) expect(gateTarget(false, s).screen).toBe("signin");
});
```

```bash
npx jest __tests__/routes.test.ts 2>&1 | tail -6
```
Expected: FAIL — `Cannot find module '../src/navigation/routes'`.

- [ ] **Step 2: Implementar** — crear `src/navigation/routes.ts`:

```ts
import type { NavigatorScreenParams } from "@react-navigation/native";
import { GATED, type Patch, type Screen } from "../store";

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
```

- [ ] **Step 3: Verde y commit**

```bash
npx jest __tests__/routes.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/navigation/routes.ts __tests__/routes.test.ts
git commit -m "feat(mobile): tabla de rutas y gate puros para react-navigation (routes.ts)" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: 3 tests nuevos; 32 suites / 245 tests; `TSC-OK`.

---

### Task 3: Adaptador sobre `navigationRef` (`navigation/ref.ts`)

**Files:**
- Create: `apps/mobile/src/navigation/ref.ts`

**Interfaces:**
- Consumes: `RootParamList`, `SigninParams`, `TAB_OF`, `screenOfRoute` (Task 2); `Screen` de `../store`.
- Produces (los usan Tasks 4, 5, 6):
  - `navigationRef` (para `NavigationContainer ref={navigationRef}` y `onReady={flushPending}`)
  - `navigateTo(screen: Screen, signinParams?: SigninParams): void` — anidado por pestaña; encola si el container no está listo
  - `goBackIfCan(): void`
  - `resetRootTo(route: "Tabs" | "signin"): void`
  - `flushPending(): void`
  - `currentScreen(): Screen | null`, `currentParams(): SigninParams`
  - `signinIsRoot(): boolean` — la primera ruta del RootStack es `signin`

- [ ] **Step 1: Implementar** — crear `src/navigation/ref.ts`:

```ts
import { createNavigationContainerRef } from "@react-navigation/native";
import type { Screen } from "../store";
import { type RootParamList, screenOfRoute, type SigninParams, TAB_OF } from "./routes";

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
```

- [ ] **Step 2: Verificar y commit** (sin test propio: todo depende del container; lo cubre el simulador en Task 7)

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/navigation/ref.ts
git commit -m "feat(mobile): adaptador de navegación sobre navigationRef (navigateTo, goBackIfCan, resetRootTo, cola hasta isReady)" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK` (si `navigate("Tabs", …)` exige un cast distinto de `as never` en la versión instalada, usar el que `tsc` acepte y anotarlo), 32 / 245.

---

### Task 4: `useRefreshSeal` y `useCurrentScreen`

**Files:**
- Create: `apps/mobile/src/hooks/useRefreshSeal.ts` (lógica extraída de `src/Shell.tsx:57-95`, que sigue intacto hasta Task 6)
- Create: `apps/mobile/src/hooks/useCurrentScreen.ts`

**Interfaces:**
- Consumes: `refreshOk`, `screenHasData`, `updatedLabel`, `type RefreshErrors`, `type Screen` de `../store`; `accountAddress` de `../account`; `navigationRef`, `currentScreen` (Task 3); `screenOfRoute` (Task 2).
- Produces:
  - `type RefreshSeal = { updatedAt: Partial<Record<Screen, number>>; failed: Screen | null; onRefreshDone: (screen: Screen) => void; labelFor: (screen: Screen) => string | null; failedOn: (screen: Screen) => boolean }`
  - `useRefreshSeal(input: { account: AccountState; errors: RefreshErrors; hasData: (screen: Screen) => boolean }): RefreshSeal` (Task 6 lo mete en `ctx.seal`)
  - `useCurrentScreen(): Screen` (Task 6 lo pasa a `useAppStore` y a los `setActive`)

- [ ] **Step 1: `useRefreshSeal.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { type AccountState, accountAddress } from "../account";
import { type RefreshErrors, refreshOk, type Screen, updatedLabel } from "../store";

export type RefreshSeal = {
  updatedAt: Partial<Record<Screen, number>>;
  failed: Screen | null;
  /** Lo llama Page al terminar un jalón: sella o marca COULDN'T REFRESH con los errores de ese momento (P4 de mobile-loading). */
  onRefreshDone: (screen: Screen) => void;
  labelFor: (screen: Screen) => string | null;
  failedOn: (screen: Screen) => boolean;
};

/** Sello UPDATED / COULDN'T REFRESH por pantalla (spec mobile-loading D5), fuera del Shell: lo consume cada Page. */
export function useRefreshSeal({ account, errors, hasData }: { account: AccountState; errors: RefreshErrors; hasData: (screen: Screen) => boolean }): RefreshSeal {
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Screen, number>>>({});
  const [failed, setFailed] = useState<Screen | null>(null);
  // Los errores del render actual, leídos al terminar el jalón sin depender de closures viejas.
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  const hasDataRef = useRef(hasData);
  hasDataRef.current = hasData;

  const onRefreshDone = useCallback((screen: Screen) => {
    if (refreshOk(screen, errorsRef.current)) { setUpdatedAt((u) => ({ ...u, [screen]: Date.now() })); setFailed(null); return; }
    setFailed(screen);
  }, []);
  useEffect(() => {
    if (failed === null) return;
    const t = setTimeout(() => setFailed(null), 3000);
    return () => clearTimeout(t);
  }, [failed]);

  // Sello inicial: la primera vez que una pantalla tiene su dato principal (P5 de mobile-loading). Page lo pide por pantalla.
  const seen = useRef(new Set<Screen>());
  const markInitial = useCallback((screen: Screen) => {
    if (seen.current.has(screen) || !hasDataRef.current(screen)) return;
    seen.current.add(screen);
    setUpdatedAt((u) => (u[screen] === undefined ? { ...u, [screen]: Date.now() } : u));
  }, []);

  // Otra cuenta = otro sello (I1 de la revisión final de mobile-loading).
  const address = accountAddress(account);
  useEffect(() => { setUpdatedAt({}); setFailed(null); seen.current.clear(); }, [address]);

  const labelFor = useCallback((screen: Screen) => {
    markInitial(screen);
    const ts = updatedAt[screen];
    return ts === undefined ? null : updatedLabel(ts);
  }, [updatedAt, markInitial]);
  const failedOn = useCallback((screen: Screen) => failed === screen, [failed]);

  return { updatedAt, failed, onRefreshDone, labelFor, failedOn };
}
```
Nota: `markInitial` se dispara desde `labelFor` (que `Page` llama en cada render); el `setUpdatedAt` con guard `u[screen] === undefined` evita renders extra. Si `accountAddress` no acepta `AccountState` con `status: "none"`, comprobar su firma en `src/account.ts` y adaptar el import/tipo (no la semántica).

- [ ] **Step 2: `useCurrentScreen.ts`**

```ts
import { useEffect, useState } from "react";
import { currentScreen, navigationRef } from "../navigation/ref";
import type { Screen } from "../store";

/** Pantalla enfocada según react-navigation (spec mobile-nav D4). Vale "wallet" hasta que el container tiene estado. */
export function useCurrentScreen(): Screen {
  const [scr, setScr] = useState<Screen>(() => currentScreen() ?? "wallet");
  useEffect(() => {
    const read = () => { const s = currentScreen(); if (s !== null) setScr(s); };
    read();
    return navigationRef.addListener("state", read);
  }, []);
  return scr;
}
```

- [ ] **Step 3: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/hooks/useRefreshSeal.ts src/hooks/useCurrentScreen.ts
git commit -m "feat(mobile): useRefreshSeal (sello fuera del Shell) y useCurrentScreen (pantalla activa por ruta)" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 32 / 245.

---

### Task 5: `Page`, `TabBar` y `Navigator` (compilan sin usarse)

**Files:**
- Create: `apps/mobile/src/ui/Page.tsx`
- Create: `apps/mobile/src/ui/TabBar.tsx`
- Create: `apps/mobile/src/navigation/Navigator.tsx`

**Interfaces:**
- Consumes: `AppCtx` (`../ctx`) — **en esta task todavía sin `seal`**: `Page` importa `RefreshSeal` de Task 4 y lo toma de `ctx.seal`, así que Task 5 añade el campo a `AppCtx` en `src/ctx.ts` (`seal: RefreshSeal`) y `App.tsx` lo rellena en Task 6 → para que `tsc` pase en Task 5, `App.tsx` debe construir `seal` ya en esta task (ver Step 4). `headerFor`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF`, `Screen` de `../store`; `TABS`/`Backdrop` de `../Shell` (se copian aquí; `Shell` se borra en Task 6); `TAB_OF`, `TAB_ORDER`, `TAB_ROOT`, tipos de params (Task 2); `navigationRef`, `flushPending` (Task 3).
- Produces:
  - `Page({ screen, children })`, `withPage(screen, Component)`
  - `TabBar(props: BottomTabBarProps)`
  - `AppCtxProvider`, `useAppCtx()`, `Navigator({ initial }: { initial: "Tabs" | "signin" })`, `TABS`, `Backdrop`

- [ ] **Step 1: `src/ctx.ts`** — añadir el sello al contexto:

```ts
import type { RefreshSeal } from "./hooks/useRefreshSeal";
// …
export type AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury; perpl: Perpl; reads: Reads; notifications: Notifications; seal: RefreshSeal };
```

- [ ] **Step 2: `src/ui/Page.tsx`** (cabecera, cuerpo y sello que hoy están en `Shell.tsx:108-149`, por ruta):

```tsx
import { useNavigation } from "@react-navigation/native";
import { type ReactElement, type ReactNode, useCallback, useState } from "react";
import { Image, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppCtx } from "../navigation/Navigator";
import { CAN_BACK, headerFor, ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, T, Tag, Touch } from "./primitives";
import { C } from "./theme";

/** Fondo del teléfono: gradiente + campo de puntos (D10 del hi-fi). Va dentro de cada Page: opaco, tapa la página de abajo durante el gesto (spec mobile-nav D6). */
export function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[C.bgTop, C.bgMid, C.bgBottom]} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}>
        <Defs>
          <Pattern id="dots" patternUnits="userSpaceOnUse" width="130" height="130">
            <Circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.7)" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dots)" />
      </Svg>
    </View>
  );
}

const REFRESHABLE: readonly Screen[] = ["wallet", "markets", "market"];

/** Una página de react-navigation: cabecera propia (viaja con el gesto), ScrollView con pull-to-refresh y sello, fondo opaco. */
export function Page({ screen, children }: { screen: Screen; children: ReactNode }) {
  const ctx = useAppCtx();
  const navigation = useNavigation();
  const { S, perpl, treasury, reads, seal, back, setControls } = ctx;
  const perpsSymbol = (perpl.context?.markets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;
  const [title, sub] = headerFor(screen, perpsSymbol, S.marketTab);
  const isRoot = ROOT_OF[screen] === screen;
  const canBack = CAN_BACK.includes(screen) && navigation.canGoBack();
  const showTabs = SHOW_TABS.includes(screen);
  const refreshable = REFRESHABLE.includes(screen);

  const [refreshing, setRefreshing] = useState(false);
  // Wallet = saldos + movimientos; Markets/Market = contexto de Perpl (+ reads en Market). allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(
        screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()]
        : screen === "market" ? [perpl.refreshContext(), reads.refresh()]
        : [perpl.refreshContext()],
      );
    } finally {
      setRefreshing(false);
      seal.onRefreshDone(screen);
    }
  }, [screen, treasury, perpl, reads, seal]);

  const label = refreshable ? seal.labelFor(screen) : null;
  const failed = refreshable && seal.failedOn(screen);

  return (
    <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={showTabs ? ["top"] : ["top", "bottom"]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 9, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair, backgroundColor: C.deep50 }}>
          {canBack ? (
            <Touch onPress={back} accessibilityLabel="back" style={{ width: 31, height: 31, borderRadius: 999, borderWidth: 1, borderColor: C.hair22, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={16} color={C.ink} />
            </Touch>
          ) : null}
          {isRoot ? <Image source={require("../../assets/pickler-mark.png")} style={{ width: 24, height: 24 }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={16.5} lh={1.15} ls={-0.01} display numberOfLines={1}>{title}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} numberOfLines={1} style={{ marginTop: 2 }}>{sub}</T>
          </View>
          {__DEV__ ? (
            <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
              <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
            </Touch>
          ) : null}
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
        >
          {failed || label !== null ? (
            <View style={{ paddingHorizontal: 15, paddingTop: 10 }}>
              <Tag color={failed ? C.down : C.faint}>{failed ? "COULDN'T REFRESH" : label}</Tag>
            </View>
          ) : null}
          {children}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** Registra una pantalla existente como ruta: recibe el ctx por contexto y lo pasa como props (P2). */
export function withPage(screen: Screen, Component: (ctx: ReturnType<typeof useAppCtx>) => ReactElement): () => ReactElement {
  const Wrapped = () => {
    const ctx = useAppCtx();
    return <Page screen={screen}><Component {...ctx} /></Page>;
  };
  Wrapped.displayName = `Page(${screen})`;
  return Wrapped;
}
```
`setControls` no existe en `AppCtx` hoy: Task 5 lo añade a `AppCtx` en `src/ctx.ts` como `setControls: (v: boolean) => void` y Task 6 lo implementa en `App.tsx` (estado de `DevControls`, que sale del `Shell`). Para que Task 5 compile, `App.tsx` ya debe pasar `seal` y `setControls` en el `ctx` (Step 4).

- [ ] **Step 3: `src/ui/TabBar.tsx`** (aspecto de hoy, `Shell.tsx:152-166`; la pastilla arrastrable es F2):

```tsx
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { View } from "react-native";
import { useAppCtx } from "../navigation/Navigator";
import { type TabName, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { C } from "./theme";

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Tab bar custom de bottom-tabs. Oculta en pantallas no raíz (SHOW_TABS, P4); el ítem activo sale de `state.index`. */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { requireAccount } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  if (!SHOW_TABS.includes(focusedScreen)) return null;
  return (
    <View style={{ flexDirection: "row", paddingTop: 8, paddingHorizontal: 6, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.deep50 }}>
      {state.routes.map((route, i) => {
        const root = TAB_ROOT[route.name as TabName];
        const [, label, icon] = TABS.find(([k]) => k === root)!;
        const focused = state.index === i;
        const fg = ROOT_OF[focusedScreen] === root ? C.lime : C.faint;
        const onPress = () => {
          // tabPress es lo que hace popToTop en la pila anidada cuando la pestaña ya está enfocada (doc bottom-tabs).
          const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !e.defaultPrevented) requireAccount(root);
        };
        return (
          <Touch key={route.key} onPress={onPress} accessibilityLabel={`tab-${root}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
            <Icon name={icon} size={19} color={fg} />
            <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
          </Touch>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 4: `src/navigation/Navigator.tsx`** (árbol D1; `AppCtx` por contexto P2):

```tsx
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { createContext, type ReactNode, useContext } from "react";
import type { AppCtx } from "../ctx";
import { ComingSoonScreen } from "../screens/comingSoon";
import { MarketScreen } from "../screens/market";
import { MarketsScreen } from "../screens/markets";
import { PerpsFundsScreen } from "../screens/perpsFunds";
import { SigninScreen } from "../screens/signin";
import { DepositScreen, WalletScreen, WithdrawScreen } from "../screens/wallet";
import { TabBar } from "../ui/TabBar";
import { withPage } from "../ui/Page";
import { C } from "../ui/theme";
import { flushPending, navigationRef } from "./ref";
import type { MarketsStackParamList, RootParamList, SoloStackParamList, TabParamList, WalletStackParamList } from "./routes";

const Ctx = createContext<AppCtx | null>(null);
export function AppCtxProvider({ value, children }: { value: AppCtx; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useAppCtx(): AppCtx {
  const v = useContext(Ctx);
  if (v === null) throw new Error("useAppCtx fuera de AppCtxProvider");
  return v;
}

// Cabecera propia y gesto estándar de iOS (spec D6/D8).
const STACK: NativeStackNavigationOptions = { headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false, animation: "default", contentStyle: { backgroundColor: C.bgBottom } };

const Root = createNativeStackNavigator<RootParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
const MarketsStack = createNativeStackNavigator<MarketsStackParamList>();
const WalletStack = createNativeStackNavigator<WalletStackParamList>();
const LaunchpadStack = createNativeStackNavigator<SoloStackParamList<"launchpad">>();
const ActivityStack = createNativeStackNavigator<SoloStackParamList<"activity">>();
const PortfolioStack = createNativeStackNavigator<SoloStackParamList<"portfolio">>();

const Markets = withPage("markets", MarketsScreen);
const Market = withPage("market", MarketScreen);
const PerpsFunds = withPage("perpsFunds", PerpsFundsScreen);
const Wallet = withPage("wallet", WalletScreen);
const Deposit = withPage("deposit", DepositScreen);
const Withdraw = withPage("withdraw", WithdrawScreen);
const Launchpad = withPage("launchpad", (ctx) => <ComingSoonScreen screen="launchpad" requireAccount={ctx.requireAccount} />);
const Activity = withPage("activity", (ctx) => <ComingSoonScreen screen="activity" requireAccount={ctx.requireAccount} />);
const Portfolio = withPage("portfolio", (ctx) => <ComingSoonScreen screen="portfolio" requireAccount={ctx.requireAccount} />);
const Signin = withPage("signin", SigninScreen);

function MarketsTab() {
  return (
    <MarketsStack.Navigator screenOptions={STACK}>
      <MarketsStack.Screen name="markets" component={Markets} />
      <MarketsStack.Screen name="market" component={Market} />
      <MarketsStack.Screen name="perpsFunds" component={PerpsFunds} />
    </MarketsStack.Navigator>
  );
}
function WalletTab() {
  return (
    <WalletStack.Navigator screenOptions={STACK}>
      <WalletStack.Screen name="wallet" component={Wallet} />
      <WalletStack.Screen name="deposit" component={Deposit} />
      <WalletStack.Screen name="withdraw" component={Withdraw} />
    </WalletStack.Navigator>
  );
}
function LaunchpadTab() { return <LaunchpadStack.Navigator screenOptions={STACK}><LaunchpadStack.Screen name="launchpad" component={Launchpad} /></LaunchpadStack.Navigator>; }
function ActivityTab() { return <ActivityStack.Navigator screenOptions={STACK}><ActivityStack.Screen name="activity" component={Activity} /></ActivityStack.Navigator>; }
function PortfolioTab() { return <PortfolioStack.Navigator screenOptions={STACK}><PortfolioStack.Screen name="portfolio" component={Portfolio} /></PortfolioStack.Navigator>; }

function TabsNav() {
  return (
    <Tabs.Navigator initialRouteName="WalletTab" tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: C.bgBottom } }}>
      <Tabs.Screen name="MarketsTab" component={MarketsTab} />
      <Tabs.Screen name="LaunchpadTab" component={LaunchpadTab} />
      <Tabs.Screen name="ActivityTab" component={ActivityTab} />
      <Tabs.Screen name="PortfolioTab" component={PortfolioTab} />
      <Tabs.Screen name="WalletTab" component={WalletTab} />
    </Tabs.Navigator>
  );
}

/** Árbol de navegación (spec D1). `initial`: Tabs con cuenta, signin sin ella (D5). */
export function Navigator({ initial }: { initial: "Tabs" | "signin" }) {
  return (
    <NavigationContainer ref={navigationRef} onReady={flushPending}>
      <Root.Navigator initialRouteName={initial} screenOptions={STACK}>
        <Root.Screen name="Tabs" component={TabsNav} />
        <Root.Screen name="signin" component={Signin} />
      </Root.Navigator>
    </NavigationContainer>
  );
}
```
Orden de las pestañas: `TAB_ORDER` de Task 2 (Markets, Launchpad, Activity, Portfolio, Wallet); `initialRouteName="WalletTab"` porque la app arranca en Wallet (`INITIAL.screen`).

- [ ] **Step 5: Hacer compilar `App.tsx` sin conmutar todavía** — en `App.tsx`, construir `seal` y `setControls` y pasarlos al `ctx` (el `Shell` sigue pintando; ignora los campos nuevos):

```tsx
import { useRefreshSeal } from "./src/hooks/useRefreshSeal";
// … dentro de App(), después de `const reads = …`:
  const [controls, setControls] = useState(false); // Task 6 monta DevControls aquí; hasta entonces el Shell tiene el suyo
  const seal = useRefreshSeal({
    account: account ?? NONE,
    errors: { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.session === "ready" ? reads.listError : null },
    hasData: (s) => screenHasData(s, { balances: treasury.balances, context: perpl.context }),
  });
  // … en el ctx:
  const ctx: AppCtx = { ...store, account, treasury, perpl, reads, notifications, onWallet, lock, signOut, seal, setControls };
```
(`useState` al import de react; `screenHasData` al import de `./src/store`; `controls` queda sin usar hasta Task 6 — si `tsc`/lint lo marca, `void controls;`.)

- [ ] **Step 6: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/ctx.ts src/ui/Page.tsx src/ui/TabBar.tsx src/navigation/Navigator.tsx App.tsx
git commit -m "feat(mobile): Page (cabecera + refresh + sello por ruta), TabBar y Navigator (RootStack → Tabs → pila por pestaña), sin conmutar" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 32 / 245. Si `tsc` señala que `withPage` no acepta `SigninScreen`/`WalletScreen` por su tipo de props (`AppCtx` exacto vs. `ReturnType<typeof useAppCtx>`), tipar el parámetro como `(ctx: AppCtx) => ReactElement` importando `AppCtx` de `../ctx`.

---

### Task 6: Conmutación — store sólo con datos, `App.tsx` con `Navigator`, adiós `Shell`

**Files:**
- Modify: `apps/mobile/src/store.ts` (tipos, `useAppStore`, borrar `navState/backState/afterSigninState/bootState/resetState/canBackFor/requireAccountState`, `STACK_MAX`)
- Modify: `apps/mobile/App.tsx` (montar `Navigator`, `AppCtxProvider`, `DevControls`, pantalla activa, push por adaptador)
- Modify: `apps/mobile/src/screens/signin.tsx` (`held` de `route.params`)
- Modify: `apps/mobile/src/DevControls.tsx` (usar `ctx.scr` en vez de `S.screen` si lo lee)
- Modify: `apps/mobile/__tests__/store.test.ts`
- Delete: `apps/mobile/src/Shell.tsx`, `apps/mobile/src/ui/gestures.ts`, `apps/mobile/__tests__/gestures.test.ts`

**Interfaces:**
- Consumes: todo lo de Tasks 2–5.
- Produces: `useAppStore({ hasAccount, perpsMarkets, scr })` → `AppStore` con `S` (sólo datos), `set`, `nav`, `back`, `requireAccount`, `finishSignin`, `signedOut`, `scr`, `hasAccount`, `comingSoon`; **sin** `boot`, `headerTitle`, `headerSub`, `canBack`, `showTabs`, `held` (los calcula `Page`/`Signin`).

- [ ] **Step 1: Tests del store (RED)** — en `__tests__/store.test.ts`: **borrar** los tests «nav pushes…», «the back-stack keeps…», «back pops…», «without an account, gated screens…», «with an account the gate…», «coming-soon tabs never ask…», «after sign-in the app lands…», «the app starts on Wallet; boot…», «canBackFor requires…», «reset clears…», «sign out lands on Sign in and comes back…» (líneas 6–53, 93–122 aprox.) y quitar del import lo que ya no exista (`navState`, `backState`, `requireAccountState`, `afterSigninState`, `bootState`, `resetState`, `canBackFor`, `INITIAL` si sólo lo usaban esos). Sustituir el test «sign out lands on Sign in and clears the Ask state» por:

```ts
test("signedOutState clears the Ask state (the stack is react-navigation's now)", () => {
  const s = { ...INITIAL, askView: "mine" as const, askCell: { levelBps: 100, horizonMin: 240 }, askAgentId: "a", askFocusReadId: "r", tradeLevel: { marketId: 1, levelBps: 100, horizonMin: 240, target: 1, expiresAt: "x" } };
  expect(signedOutState(s)).toEqual({ ...INITIAL });
});
```
Ajustar el test «Ask state: New read by default, a cell, an agent and a focused read travel in the patch» para que use `{ ...INITIAL, ...patch }` en vez de `navState(...)`. Los tests de `heldActionFor`, sets D5, `ROOT_OF`, headers, `marketEntryTab`, sello, `tradingLineState` y `screenHasData` se quedan.

```bash
npx jest __tests__/store.test.ts 2>&1 | tail -6
```
Expected: FAIL por tipos/exports (`INITIAL` aún tiene `screen`/`stack`, `signedOutState` aún devuelve `screen: "signin"`).

- [ ] **Step 2: `src/store.ts`** —
  - `StoreState`: quitar `screen`, `stack`, `next`, `nextPatch`. `Patch = Partial<StoreState>`. `INITIAL = { marketTab: "trade", askView: "new" }`.
  - Borrar `STACK_MAX`, `navState`, `backState`, `requireAccountState`, `afterSigninState`, `bootState`, `resetState`, `canBackFor`. Conservar `Screen`, `MarketTab`, `AskView`, `AskCell`, `TradeLevel`, `isComingSoonTab`, `GATED`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF`, `heldActionFor`, `marketEntryTab`, `headerFor`, sello, `tradingLineState`, `screenHasData`.
  - `signedOutState(s)`: `return { ...s, askView: "new", askCell: undefined, askAgentId: undefined, askFocusReadId: undefined, tradeLevel: undefined };` (comentario: la pila la resetea el adaptador).
  - `AppStore`:

```ts
export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  /** Sign in terminado: vuelve a Tabs y aterriza en el `next` del gate (D5). */
  finishSignin: () => void;
  signedOut: () => void;
  hasAccount: boolean;
  /** Pantalla enfocada según react-navigation (D4). */
  scr: Screen;
  comingSoon: boolean;
};

export function useAppStore({ hasAccount, scr }: { hasAccount: boolean; scr: Screen }): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);
  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => { if (patch) set(patch); navigateTo(screen); }, [set]);
  const back = useCallback(() => goBackIfCan(), []);
  const requireAccount = useCallback((target: Screen, patch?: Patch) => {
    const g = gateTarget(hasAccount, target);
    if (g.screen === "signin") { navigateTo("signin", { next: g.next, patch }); return; }
    nav(target, patch);
  }, [hasAccount, nav]);
  const finishSignin = useCallback(() => {
    const p = currentParams();
    if (signinIsRoot()) resetRootTo("Tabs"); // arranque sin cuenta: no hay Tabs debajo (P3)
    nav(p?.next ?? "wallet", p?.patch); // con Tabs debajo, navigate vuelve a Tabs y saca signin
  }, [nav]);
  const signedOut = useCallback(() => { setS(signedOutState); resetRootTo("signin"); }, []);
  return { S, set, nav, back, requireAccount, finishSignin, signedOut, hasAccount, scr, comingSoon: isComingSoonTab(scr) };
}
```
Imports: `import { gateTarget } from "./navigation/routes"; import { currentParams, goBackIfCan, navigateTo, resetRootTo, signinIsRoot } from "./navigation/ref";` — **ojo al ciclo**: `routes.ts` importa `GATED`/tipos de `./store` y `store.ts` importa `gateTarget` de `./navigation/routes`. Es un ciclo de módulos ES con sólo funciones y constantes usadas en tiempo de llamada (no al evaluar el módulo), así que funciona; si `tsc` o jest se quejan, mover `GATED`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF` y los tipos `Screen`/`Patch` a `src/navigation/screens.ts` y re-exportarlos desde `store.ts` (anotarlo en el reporte).

- [ ] **Step 3: `App.tsx`** — sustituir el cuerpo por:

```tsx
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { DevControls } from "./src/DevControls";
import type { AppCtx } from "./src/ctx";
import { useAccount } from "./src/hooks/useAccount";
import { useCurrentScreen } from "./src/hooks/useCurrentScreen";
import { useNotifications } from "./src/hooks/useNotifications";
import { usePerpl } from "./src/hooks/usePerpl";
import { useReads } from "./src/hooks/useReads";
import { useRefreshSeal } from "./src/hooks/useRefreshSeal";
import { useTreasury } from "./src/hooks/useTreasury";
import { AppCtxProvider, Navigator } from "./src/navigation/Navigator";
import type { PushTarget } from "./src/reads/push";
import { patchForPush } from "./src/reads/push";
import { type Screen, screenHasData, useAppStore } from "./src/store";
// (los imports de fuentes y SplashScreen se quedan como están)

const NONE = { status: "none" } as const;
const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds"];

export default function App() {
  const [fontsLoaded] = useFonts({ /* igual */ });
  const { account, onWallet, lock, signOut } = useAccount();
  const treasury = useTreasury(account ?? NONE, onWallet);
  const perpl = usePerpl(account ?? NONE, onWallet, treasury);
  const hasAccount = account !== null && account.status !== "none";
  const scr = useCurrentScreen();
  const store = useAppStore({ hasAccount, scr });
  const { requireAccount } = store;
  // Tap en un push (P7 de Ask): igual que antes; la cola por cuenta se conserva y el adaptador encola hasta isReady.
  const pendingPush = useRef<PushTarget | null>(null);
  const accountLoaded = account !== null;
  const accountLoadedRef = useRef(accountLoaded);
  accountLoadedRef.current = accountLoaded;
  const onPushTarget = useCallback((t: PushTarget) => {
    if (!accountLoadedRef.current) { pendingPush.current = t; return; }
    requireAccount("market", patchForPush(t));
  }, [requireAccount]);
  useEffect(() => {
    if (!accountLoaded || pendingPush.current === null) return;
    const t = pendingPush.current;
    pendingPush.current = null;
    requireAccount("market", patchForPush(t));
  }, [accountLoaded, requireAccount]);
  const notifications = useNotifications(onPushTarget);
  const reads = useReads(account ?? NONE, onWallet, notifications, store.S.perpsMarketId);
  const ready = fontsLoaded && account !== null;
  useEffect(() => {
    if (ready) { void SplashScreen.hideAsync(); return; }
    const t = setTimeout(() => { void SplashScreen.hideAsync(); }, 2000);
    return () => clearTimeout(t);
  }, [ready]);
  const perpsActive = PERPL_SCREENS.includes(scr);
  const readsActive = scr === "market" && store.S.marketTab !== "trade";
  const { setActive } = perpl;
  const { setActive: setReadsActive } = reads;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);
  useEffect(() => { setReadsActive(readsActive); }, [readsActive, setReadsActive]);
  const [controls, setControls] = useState(false);
  const seal = useRefreshSeal({
    account: account ?? NONE,
    errors: { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.session === "ready" ? reads.listError : null },
    hasData: (s) => screenHasData(s, { balances: treasury.balances, context: perpl.context }),
  });
  // La ruta inicial se decide una sola vez, cuando la cuenta ya se conoce (D5): con cuenta Tabs, sin cuenta signin.
  const initial = useRef<"Tabs" | "signin" | null>(null);
  if (ready && initial.current === null) initial.current = hasAccount ? "Tabs" : "signin";

  if (!ready || initial.current === null) return null; // el splash nativo sigue en pantalla

  const ctx: AppCtx = { ...store, account, treasury, perpl, reads, notifications, onWallet, lock, signOut, seal, setControls };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <AppCtxProvider value={ctx}>
          <Navigator initial={initial.current} />
          {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
        </AppCtxProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
```
Se eliminan `useLayoutEffect`, `booted`, `boot`, el `View` con fondo (cada `Page` lleva el suyo) y el import de `Shell`/`C` si quedan sin uso. `perpsMarkets` deja de ser input del store (lo lee `Page` de `perpl.context`).

- [ ] **Step 4: `src/screens/signin.tsx`** — `held` sale de los params:

```tsx
import { useRoute } from "@react-navigation/native";
import { heldActionFor } from "../store";
import type { SigninParams } from "../navigation/routes";
// firma: export function SigninScreen({ onWallet, finishSignin }: AppCtx) {
//   const held = heldActionFor((useRoute().params as SigninParams)?.next);
```
El resto igual (`held` se usa donde ya se usaba).

- [ ] **Step 5: `src/DevControls.tsx`** — si lee `S.screen` (para mostrar la pantalla actual o similar), usar `ctx.scr`; `signedOut()` y `requireAccount(...)` siguen iguales. Comprobar con `grep -n "S\.screen\|S\.stack\|S\.next" src/DevControls.tsx`.

- [ ] **Step 6: Borrar el Shell y los gestos**

```bash
git rm -q src/Shell.tsx src/ui/gestures.ts __tests__/gestures.test.ts
grep -rn "from \"./Shell\"\|from \"../Shell\"\|ui/gestures\|S\.screen\|S\.stack\|S\.next\b\|nextPatch\|headerTitle\|headerSub\|showTabs\|canBack\b" src App.tsx | grep -v "canBack = CAN_BACK" || echo "sin referencias"
```
Expected: `sin referencias` (si algo queda, es un consumidor que hay que pasar a `ctx.scr`/`Page`; citarlo en el reporte).

- [ ] **Step 7: Verde**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
```
Expected: `TSC-OK`; 31 suites (32 − gestures) / ≈ 236 tests (245 − 11 borrados + 1 nuevo; anotar el número real).

- [ ] **Step 8: Humo en el simulador** — Metro desde este worktree (`nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 &`), relaunch por UDID, mirar `$SC/shots/t6-wallet.png`: Wallet con cabecera, sello y tab bar como antes. `tab-markets` → Markets; `market-BTC` → Market entra deslizando desde la derecha y **sin tab bar**; swipe desde el borde → vuelve a Markets. Si la app muestra pantalla roja, adjuntar el texto al reporte y corregir antes de commitear.

- [ ] **Step 9: Commit**

```bash
git add src/store.ts App.tsx src/screens/signin.tsx src/DevControls.tsx __tests__/store.test.ts
git commit -m "feat(mobile): navegación nativa con react-navigation — store sólo con datos, Navigator en App, Sign in con next por params; fuera Shell y gestos propios" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
(`git rm` ya dejó los borrados en el índice.)

---

### Task 7: Recorrido en el simulador (capturas D12)

**Files:** ninguno del repo. Workspace `SC=<worktree>/.superpowers/sdd/2026-09-21-mobile-nav-f1` (lo crea `scripts/sdd-workspace`); copiar `taplabel.sh`, `tap-point.yaml` y `flows/` desde `<repo>/.claude/worktrees/mobile-loading/.superpowers/sdd/2026-09-21-mobile-loading-f1/` y ajustar `SC` en `taplabel.sh`. Capturas en `$SC/shots/`.

**Interfaces:**
- Labels: `tab-wallet`, `tab-markets`, `market-BTC`, `back`, `deposit`, `withdraw`, `add-funds`, `back-to-markets`, `pill-ask`, `segment-mine`, `sign-out`, `dev-controls`.
- Produces: `$SC/task-7-report.md`; PNG a `docs/superpowers/audits/img/2026-09-21-mobile-nav-{gesture-mid,push-forward,market-no-tabs,signin-next,scroll-kept}.png` (reducidos con `sips -Z 1300`).

- [ ] **Step 0: Estado** — dev build de Task 1 + Metro de Task 6 desde este worktree; `content_size medium`; sign in si hace falta. Wallet → anotar AUSD/MON (`00-wallet-before.png`).

- [ ] **Step 1: Gesto atrás a medio camino** — `tab-markets` → `market-BTC` → con Maestro un swipe **lento** desde el borde que no termine: `flows/edge-drag.yaml` = `swipe: start "1%, 50%", end "45%, 50%", duration 2500` y `takeScreenshot` a mitad no es posible en un solo comando; hacerlo con dos procesos: lanzar el flow en background y `xcrun simctl io $U screenshot $SC/shots/01-gesture-mid.png` a los ~1.2 s. **Mirar**: Market desplazada a la derecha con su cabecera, Markets asomando a la izquierda con velo (como la captura de Proflores). Repetir hasta 5 veces si el instante no cae; anotar intentos. Luego completar el gesto (`ptr`-style swipe hasta 90 %) → Markets, `02-after-back.png`.

- [ ] **Step 2: Adelante animado** — desde Markets, `market-BTC` y captura a los 120 ms (`03-push-mid.png`: Market entrando desde la derecha) y a 600 ms (`04-market.png`). Sin tab bar en Market. Botón `back` (`taplabel.sh back`) → Markets animado.

- [ ] **Step 3: Pila por pestaña** — Markets → BTC (queda en Market) → `tab-wallet` (instantáneo; sin animación) → `tab-markets` → **debe seguir en Market BTC** (`05-tab-stack-kept.png`). Tocar `tab-markets` de nuevo → `popToTop` → Markets (`06-poptotop.png`).

- [ ] **Step 4: Wallet → Deposit → «I've sent it»** — `deposit` → Deposit sin tab bar y con `←` (`07-deposit.png`); botón «I've sent it» (`nav("wallet")`) → vuelve a Wallet animado (pop). Scroll: en Wallet bajar hasta TESTNET, `deposit`, `back` → Wallet **conserva** el scroll (`08-scroll-kept.png`; hoy volvía arriba).

- [ ] **Step 5: Push en frío** — `xcrun simctl terminate $U fun.pickler.app`; `xcrun simctl push $U fun.pickler.app $SC/push.apns` con el payload del audit de Ask F2 (`{"aps":{"alert":{"title":"…"}},"pickler":{"kind":"read","readId":"<id real de My reads>","marketId":<id BTC>}}`, ver `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` para el formato exacto) y tocar el banner (`flows/tap-banner.yaml`) → la app abre en **MarketsTab / Market · Ask · My reads** (`09-push-cold.png`); `back` → Markets (no Wallet; D10).

- [ ] **Step 6: Gate y sign-in con `next`** — Dev controls → Sign out → Sign in (sin `←`, `10-signin-root.png`); en Sign in **no** firmar aún: relanzar la app → sigue en Sign in; firmar (passkey + Face ID) → Wallet. Luego Sign out otra vez → Sign in → `tab-markets` no existe (sin tab bar en Sign in) → usar Dev controls → «Markets» → Sign in con tarjeta «We kept what you were about to do · Trading on Perpl» (`11-signin-next.png`) → firmar → aterriza en **Markets** y `←` no aparece (`12-after-signin-next.png`).

- [ ] **Step 7: Sello y skeleton siguen** — Wallet: jalar → `UPDATED HH:MM:SS` (`13-updated.png`); relaunch → skeleton de Wallet en el primer segundo (`14-skeleton.png`).

- [ ] **Step 8: Reporte** — `$SC/task-7-report.md`: tabla captura → qué se ve (✓ mirada), saldos antes/después (iguales), no capturado y por qué, **defectos** (tab bar que no aparece al volver, cabecera que no viaja, doble cabecera, pantalla en blanco bajo el gesto, push que abre en la pestaña equivocada…). Copiar los 5 PNG de evidencia a `docs/superpowers/audits/img/` con `sips -Z 1300`.

---

### Task 8: Docs — marcas (F1), F1 `completed`, audit, README, nota en el tracker del fix gate

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-mobile-nav-design.md` (Estado, D-marks (F1) si hubo desviaciones), `docs/overview/2026-09-21-mobile-nav.html` (F1 `completed`, tasks, «Rulings en ejecución»), `docs/overview/data/manifest.js` (`phases[0].status = 'completed'`, `types: ['spec', 'plan']`), `apps/mobile/README.md` (sección «Navegación»: árbol, adaptador, `Page`, cómo añadir una pantalla; conteo de tests real), `docs/overview/dev/2026-09-21-markets-ask-gate.html` (nota: «Market sobre Wallet» sustituido por D10 de mobile-nav)
- Create: `docs/superpowers/audits/2026-09-21-mobile-nav-f1-rulings.md`, `docs/superpowers/audits/img/2026-09-21-mobile-nav-*.png` (Task 7)

- [ ] **Step 1: Spec** — Estado: «F1 ejecutada (plan `2026-09-21-mobile-nav-f1.md`, audit `2026-09-21-mobile-nav-f1-rulings.md`); rama `feat/mobile-nav` lista para merge local; F2 pendiente.» Marcar **(F1)** en las decisiones donde la ejecución se apartó (p. ej. ciclo `store ↔ routes` movido a `screens.ts`, cast de `navigate`, tab bar que aparece al terminar el gesto).

- [ ] **Step 2: Overview y manifest** — phase-card F1 → `completed`, tasks 1–8 (las de este plan) `checked` según evidencia, `<h3 class="section-sub">Rulings en ejecución</h3><ol>…` con los rulings del ledger; F2 sigue `pending`. Manifest: `types: ['spec', 'plan']`, `phases: [{ num: 1, status: 'completed' }, { num: 2, status: 'pending' }]`, `status: 'active'`. `npm run docs:html`; render-check a 390 px y **mirar**.

- [ ] **Step 3: Audit** — `docs/superpowers/audits/2026-09-21-mobile-nav-f1-rulings.md`: §1 por task con evidencia real (versiones instaladas, `git log --oneline 6fa0499..HEAD`, `git diff --stat`), §2 tests/tsc + tabla de capturas con `![…](img/…)`, §3 rulings (P1–P10 + ledger), §4 correcciones, §5 cuentas al cierre, §6 residuales (tab bar sin animación al volver a raíz; Sign in por gesto; lo no capturado; Android).

- [ ] **Step 4: README y tracker del fix gate** — README: sección «Navegación» (árbol D1, `ROUTE_OF`/`TAB_OF`, `withPage`, «para añadir una pantalla: tipo `Screen`, `TAB_OF`, `Screen` en la pila de su pestaña, `withPage`»), conteo de tests. Tracker `dev/2026-09-21-markets-ask-gate.html`: una línea en Validación: «Desde mobile-nav F1 (D10) un push abre Market en la pestaña Markets, no sobre Wallet.»

- [ ] **Step 5: Checks y commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK && cd ../..
git status --short
git add docs/superpowers/specs/2026-09-21-mobile-nav-design.md docs/superpowers/specs/2026-09-21-mobile-nav-design.html docs/superpowers/plans/2026-09-21-mobile-nav-f1.md docs/superpowers/plans/2026-09-21-mobile-nav-f1.html docs/overview/2026-09-21-mobile-nav.html docs/overview/data/manifest.js docs/overview/dev/2026-09-21-markets-ask-gate.html docs/superpowers/audits/2026-09-21-mobile-nav-f1-rulings.md docs/superpowers/audits/img/2026-09-21-mobile-nav-gesture-mid.png docs/superpowers/audits/img/2026-09-21-mobile-nav-push-forward.png docs/superpowers/audits/img/2026-09-21-mobile-nav-market-no-tabs.png docs/superpowers/audits/img/2026-09-21-mobile-nav-signin-next.png docs/superpowers/audits/img/2026-09-21-mobile-nav-scroll-kept.png apps/mobile/README.md
git commit -m "docs(mobile-nav): F1 completed — spec (F1), overview, audit con capturas, README, nota en el tracker del fix gate" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `docs:check` errors=0; `agents:check` `"errors": []`; tests y `TSC-OK`; árbol limpio. (Si alguna captura no existió, quitarla del `git add` y del audit.) Handoff: rama lista para merge local (decisión de Jesús); siguiente: plan F2 (tab bar con pastilla) y, si lo pide, build 8.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec**: D1 → Task 5 (`Navigator`); D2 → Tasks 2–3 (`routes`, `ref`) + Task 6 (`useAppStore` conserva `nav/back/requireAccount`); D3 → Task 6 (store); D4 → Task 4 (`useCurrentScreen`) + Task 6 (`scr`); D5 → Task 2 (`gateTarget`) + Task 6 (`requireAccount`, `finishSignin`, `signedOut`, `initial`) + Task 5 (`SigninParams`); D6 → Task 5 (`Page`, `headerShown: false`, `Backdrop` por página); D7 → Task 4 (`useRefreshSeal`) + Task 5 (`Page`); D8 → Task 5 (`STACK` options, tabs `animation: "none"`) + Task 6 (borrar `PanResponder`/`gestures`); D9 → Task 5 (`TabBar` devuelve `null`, `Page` edges); D10 → Task 6 (`navigateTo("market")` desde Wallet/push) + Task 7 Step 5 + Task 8 (nota tracker); D12 → Tasks 2, 6 (tests), 7 (capturas), 8 (docs). D11 es F2. Sin gaps.
- **Placeholders**: `<modelo>`, `<url>`, `<worktree>`, `<repo>`, el id real de una read y el número real de tests tras Task 6 los rellena el ejecutor con datos medidos. Ningún «TBD».
- **Consistencia de tipos**: `navigateTo(screen, signinParams?)` (Task 3) usado en Task 6; `gateTarget(hasAccount, target) → { screen, next? }` (Task 2) usado en Task 6; `useRefreshSeal({ account, errors, hasData }) → RefreshSeal { onRefreshDone, labelFor, failedOn }` (Task 4) usado en `Page` (Task 5) y `App.tsx` (Tasks 5–6); `useAppStore({ hasAccount, scr })` (Task 6) coincide con `App.tsx` (Task 6); `AppCtx` gana `seal` y `setControls` (Task 5) y los usan `Page` y `App.tsx`; `withPage(screen, Component)` (Task 5) usado en `Navigator` (Task 5); `TAB_OF`/`TAB_ROOT`/`TAB_ORDER` (Task 2) usados en `ref.ts`, `TabBar`, `routes.test.ts`.
- **Trampa conocida**: ciclo de imports `store.ts ↔ navigation/routes.ts` (Task 6 Step 2 trae la salida: `navigation/screens.ts`).
