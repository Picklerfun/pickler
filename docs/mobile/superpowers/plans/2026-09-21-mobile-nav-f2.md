# Navegación nativa (mobile-nav) — F2 Implementation Plan: tab bar con pastilla arrastrable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la tab bar de Pickler se comporte como la de iOS 26 / Proflores: una pastilla lima detrás del ítem activo que se desliza con resorte al cambiar de pestaña, que se puede **arrastrar con el dedo sin despegarlo** (tic háptico al cruzar de ítem) y que selecciona **al soltar**; y que la tab bar se **esconda y aparezca deslizando** al entrar y salir de una pantalla no raíz (hoy corta de golpe — residual P4 de F1).

**Architecture:** Un módulo puro `src/ui/tabbar.ts` (geometría: índice bajo el dedo, x de la pastilla, alto de la barra) con tests, y una reescritura de `src/ui/TabBar.tsx` sobre `react-native-reanimated` (`useSharedValue`, `useAnimatedStyle`, `withSpring`, `withTiming`, `runOnJS`) y `react-native-gesture-handler` (`Gesture.Pan` + `GestureDetector`), ya instalados y linkeados en el build 8. La barra pasa a estar **absolutamente posicionada** dentro del navegador de pestañas y se traslada en Y para esconderse (D13, nueva); `Page` reserva su alto con `paddingBottom` en las pantallas raíz. El índice activo sigue viniendo de `state.index` (D11); el arrastre sólo mueve la pastilla y, al soltar, llama `switchTab`.

**Tech Stack:** Expo SDK 57 / RN 0.86; `react-native-reanimated 4.5.1` + `react-native-worklets 0.10.1` (plugin de Babel automático), `react-native-gesture-handler ~2.32.0`, `expo-haptics ~57.0.3`; jest-expo (`__tests__/*.test.ts`), `npx tsc --noEmit`. Simulador iPhone 17 Pro `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`; capturas de transiciones con `xcrun simctl io <UDID> recordVideo` + ffmpeg (lección de F1: los taps sintéticos tienen jitter > 300 ms).

**Spec:** `docs/superpowers/specs/2026-09-21-mobile-nav-design.md` — D11 (pastilla) y la nueva **D13** (tab bar animada al entrar/salir de no-raíz), que Task 4 añade al spec con marca (F2). Overview `docs/overview/2026-09-21-mobile-nav.html` (F2 `pending` → `plan_ready` al guardar este plan → `completed` con el audit).

## Global Constraints

- Rama **`feat/mobile-nav-f2`** desde `main` local (`3ae5945`, build 8 en TestFlight), en el worktree existente `.claude/worktrees/mobile-nav` (`git -C <worktree> checkout -b feat/mobile-nav-f2 main`; `feat/mobile-nav` ya está mergeada). Primer comando: `cd apps/mobile && npm ci`. Nunca `cd` al checkout principal para editar. Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `fix(mobile): …` / `docs(mobile-nav): …` con trailers `Co-Authored-By: <modelo que escribe> <noreply@anthropic.com>` y `Claude-Session: <URL de la sesión>`. **Sin push, sin merge, sin TestFlight** salvo autorización explícita de Jesús.
- **Metro**: hoy corre en :8081 desde `.claude/worktrees/mobile-nav/apps/mobile` (mismo worktree; tras el `checkout -b` sigue sirviendo el árbol nuevo). El dev build instalado en el simulador ya linkea reanimated/gesture-handler/haptics: **no hace falta rebuild nativo** en F2. Simulador **siempre por UDID**; `xcrun simctl ui <UDID> content_size medium` antes de capturar; mirar cada captura. Cuenta #620: **no mover AUSD ni MON, ninguna orden, ningún Enable/Reconnect/Reset**.
- D11 (vinculante): pastilla `borderRadius` 999, alto = alto de la fila de ítems, ancho = ítem − 2·inset, lima translúcido (`C.limeBg14`, sin blur); `translateX` en un `sharedValue` con `withSpring` (rigidez media, sin rebote exagerado); `Pan` sobre la fila con `activeOffsetX` ±6 px para no robar el tap; mientras se arrastra, `tabIndexAt(x, rowWidth, 5)` mueve la pastilla al ítem bajo el dedo y dispara `Haptics.selectionAsync()` al cruzar; **al soltar**, `switchTab(TAB_ORDER[i])` (nada si es la activa); el tap simple sigue siendo tap; el índice activo viene de `state.index`. Puros con test: `tabIndexAt`, `pillX`.
- D13 (nueva, aprobada en el checkpoint del build 8): la tab bar queda **montada siempre** y se esconde deslizando hacia abajo (`translateY` = su alto, `withTiming` 220 ms) cuando la pantalla enfocada no está en `SHOW_TABS`; reaparece igual. Mientras está oculta no recibe toques (`pointerEvents="none"`, `Pan.enabled(false)`). Las pantallas raíz reservan su alto con `paddingBottom` (`tabBarHeight(insets.bottom)`); las no raíz siguen con `edges` inferior de `SafeAreaView`.
- Sin dependencias nuevas. Copy en inglés; comentarios en español; tests en inglés. `npm test` (hoy 32 suites / 239 tests) y `npx tsc --noEmit` en verde al cierre de cada task que toca código. Sin tests de UI (P12): `TabBar`/`Page` por `tsc` + simulador.
- Docs: contrato `docs/CLAUDE.md`; `npm run docs:html`; `docs:check` errors=0; `agents:check` `"errors": []`.
- API verificada en `node_modules` el 2026-09-21: reanimated exporta `useSharedValue`, `useAnimatedStyle`, `withSpring`, `withTiming`, `runOnJS` (`react-native-reanimated/lib/typescript/index.d.ts`); gesture-handler `Gesture.Pan()` con `.enabled()`, `.activeOffsetX([a, b])`, `.failOffsetY([a, b])`, `.onStart/.onUpdate/.onEnd/.onFinalize` y `GestureDetector`; `expo-haptics` `selectionAsync(): Promise<void>`. `GestureHandlerRootView` ya envuelve la app (F1 Task 1). `newArchEnabled` no está fijado en `app.config.ts` → default del SDK 57 (nueva arquitectura activa; reanimated 4 la exige y el build 8 ya corre con ella).

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | **Geometría en un módulo puro** `src/ui/tabbar.ts` con constantes (`ROW_PAD_X` 6, `PILL_INSET` 2, `ROW_TOP` 8, `ROW_H` 45, `ROW_BOTTOM` 12) y funciones `itemWidth`, `tabIndexAt`, `pillX`, `pillWidth`, `tabBarHeight`. `TabBar` y `Page` importan de ahí. | Un solo sitio para el layout; testeable sin RN; el alto de la barra es determinista (sin `onLayout` para el alto). |
| P2 | **El ancho de la fila sí se mide** (`onLayout` → `useState` + `sharedValue`), porque depende del dispositivo; hasta medir, la pastilla no se pinta (`width === 0`). | El iPhone 17 Pro mide 402 pt pero otros no. |
| P3 | **Tab bar absoluta dentro del navegador de pestañas** (`position: "absolute", left/right/bottom: 0`) con `translateY` animado. bottom-tabs sigue montándola como `tabBar`; su contenedor mide 0 de alto, así que las escenas ocupan toda la altura y `Page` reserva el hueco en las raíces. | Es lo que hace iOS (`hidesBottomBarWhenPushed`): la barra se va deslizando mientras la página entra. Sin esto (P4 de F1) corta de golpe. |
| P4 | **Selección sólo al soltar** y sólo si el índice final ≠ `state.index`; se emite `tabPress` como en el tap (paridad con F1). Si el gesto se cancela (`onFinalize` sin éxito), la pastilla vuelve al activo. | D11 A del brainstorm. |
| P5 | **Resorte**: `{ damping: 18, stiffness: 220, mass: 0.6 }` para la pastilla; `withTiming` 220 ms para esconder/mostrar. | «Rigidez media, sin rebote exagerado». Se ajusta en Task 3 si en el simulador se ve lento o rebota; anotar el valor final. |
| P6 | **Haptic por `runOnJS`** desde el worklet de `onUpdate` sólo cuando cambia el índice (no por frame). En simulador no hay háptica: se verifica que no lance error (log de Metro limpio). | `selectionAsync` es JS. |
| P7 | **Capturas por video** (`recordVideo` + ffmpeg) para la pastilla a medio arrastre y para la barra deslizando en push/pop; el arrastre se genera con Maestro `swipe` lento sobre la fila (y = centro de la tab bar) — a diferencia del borde, aquí no hay `UIScreenEdgePanGestureRecognizer`, así que el swipe sintético sí debe activar el `Pan`. Si no activa (RNGH ignora eventos sintéticos), anotarlo y probar con `idb ui swipe`. | Lección de F1 Task 7. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/src/ui/tabbar.ts`, `__tests__/tabbar.test.ts` | 1 | geometría pura + tests |
| `apps/mobile/src/ui/TabBar.tsx`, `apps/mobile/src/ui/Page.tsx` | 2 | pastilla, arrastre, háptica, barra absoluta animada; hueco inferior en raíces |
| Simulador | 3 | capturas (pastilla a medio arrastre, tras soltar, barra deslizando) |
| `docs/superpowers/specs/2026-09-21-mobile-nav-design.md` (D11 (F2), D13), `docs/overview/2026-09-21-mobile-nav.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-21-mobile-nav-f2-rulings.md`, `docs/superpowers/audits/img/*.png`, `apps/mobile/README.md` | 4 | docs |

---

### Task 1: Geometría pura de la tab bar (`ui/tabbar.ts`)

**Files:**
- Create: `apps/mobile/src/ui/tabbar.ts`
- Test: `apps/mobile/__tests__/tabbar.test.ts`

**Interfaces:**
- Produces (los usa Task 2): `TAB_COUNT = 5`, `ROW_PAD_X = 6`, `PILL_INSET = 2`, `ROW_TOP = 8`, `ROW_H = 45`, `ROW_BOTTOM = 12`; `itemWidth(rowWidth, count?)`, `tabIndexAt(x, rowWidth, count?)`, `pillX(index, rowWidth, count?)`, `pillWidth(rowWidth, count?)`, `tabBarHeight(insetBottom)`.

- [ ] **Step 0: Rama y línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav
git status --short && git checkout -b feat/mobile-nav-f2 main && git log --oneline -1
cd apps/mobile && npm ci 2>&1 | tail -1 && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio; HEAD `3ae5945` (o el commit de este plan si ya está en `main`); `Tests: 239 passed` / `32 passed`; `TSC-OK`.

- [ ] **Step 1: Tests (RED)** — crear `__tests__/tabbar.test.ts`:

```ts
import { itemWidth, pillWidth, pillX, ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight, tabIndexAt } from "../src/ui/tabbar";

// iPhone 17 Pro: 402 pt de ancho; fila con 6 pt de padding a cada lado → 5 ítems de 78 pt.
const W = 402;

test("itemWidth splits the row minus its horizontal padding", () => {
  expect(itemWidth(W)).toBe(78);
  expect(itemWidth(W, 4)).toBe(97.5);
});

test("tabIndexAt maps a finger x to the item under it and clamps at both ends", () => {
  expect(tabIndexAt(0, W)).toBe(0);
  expect(tabIndexAt(-20, W)).toBe(0);
  expect(tabIndexAt(6 + 77.9, W)).toBe(0);
  expect(tabIndexAt(6 + 78, W)).toBe(1);
  expect(tabIndexAt(200, W)).toBe(2);
  expect(tabIndexAt(401, W)).toBe(4);
  expect(tabIndexAt(900, W)).toBe(4);
});

test("pillX and pillWidth sit the pill inside its item with a 2 pt inset", () => {
  expect(pillX(0, W)).toBe(8);
  expect(pillX(2, W)).toBe(6 + 2 * 78 + 2);
  expect(pillX(4, W)).toBe(6 + 4 * 78 + 2);
  expect(pillWidth(W)).toBe(74);
});

test("tabBarHeight is the row plus the bottom inset (deterministic, no measuring)", () => {
  expect(tabBarHeight(0)).toBe(ROW_TOP + ROW_H + ROW_BOTTOM);
  expect(tabBarHeight(34)).toBe(8 + 45 + 34 + 12);
});
```

```bash
npx jest __tests__/tabbar.test.ts 2>&1 | tail -6
```
Expected: FAIL — `Cannot find module '../src/ui/tabbar'`.

- [ ] **Step 2: Implementar** — crear `src/ui/tabbar.ts`:

```ts
// Geometría de la tab bar (spec mobile-nav D11/D13). Puro: sin react-native, para poder testearlo.
// La fila mide `ROW_TOP + ROW_H` y se apoya sobre `insetBottom + ROW_BOTTOM`; los ítems reparten el ancho menos
// `ROW_PAD_X` a cada lado; la pastilla vive dentro de su ítem con `PILL_INSET` a cada lado.

export const TAB_COUNT = 5;
export const ROW_PAD_X = 6;
export const PILL_INSET = 2;
export const ROW_TOP = 8;
/** Alto de la fila de ítems: 6 + icono 19 + gap 5 + etiqueta 9 + 6 (los mismos valores que pinta TabBar). */
export const ROW_H = 45;
export const ROW_BOTTOM = 12;

export function itemWidth(rowWidth: number, count = TAB_COUNT): number {
  return (rowWidth - 2 * ROW_PAD_X) / count;
}

/** Índice del ítem bajo la x del dedo, acotado a [0, count). */
export function tabIndexAt(x: number, rowWidth: number, count = TAB_COUNT): number {
  const i = Math.floor((x - ROW_PAD_X) / itemWidth(rowWidth, count));
  return Math.min(count - 1, Math.max(0, i));
}

export function pillX(index: number, rowWidth: number, count = TAB_COUNT): number {
  return ROW_PAD_X + index * itemWidth(rowWidth, count) + PILL_INSET;
}

export function pillWidth(rowWidth: number, count = TAB_COUNT): number {
  return itemWidth(rowWidth, count) - 2 * PILL_INSET;
}

/** Alto total de la barra (para el `paddingBottom` de las páginas raíz y para esconderla con translateY). */
export function tabBarHeight(insetBottom: number): number {
  return ROW_TOP + ROW_H + insetBottom + ROW_BOTTOM;
}
```

- [ ] **Step 3: Verde y commit**

```bash
npx jest __tests__/tabbar.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/ui/tabbar.ts __tests__/tabbar.test.ts
git commit -m "feat(mobile): geometría pura de la tab bar (tabIndexAt, pillX, tabBarHeight) con tests" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: 4 tests nuevos; 33 suites / 243 tests; `TSC-OK`.

---

### Task 2: `TabBar` con pastilla arrastrable y barra que se esconde deslizando; `Page` reserva el hueco

**Files:**
- Modify: `apps/mobile/src/ui/TabBar.tsx` (reescritura completa)
- Modify: `apps/mobile/src/ui/Page.tsx` (`paddingBottom` en raíces)

**Interfaces:**
- Consumes: Task 1; `switchTab` de `useAppCtx()` (F1); `TAB_ORDER`, `TAB_ROOT`, `TabName` de `../navigation/routes`; `ROOT_OF`, `SHOW_TABS`, `Screen` de `../store`; `Icon`, `T`, `Touch` de `./primitives`; `C` de `./theme`.
- Produces: `TabBar(props: BottomTabBarProps)` (misma firma; `TABS` sigue exportado para `comingSoonCopy.ts`).

- [ ] **Step 1: `src/ui/TabBar.tsx`** — sustituir el archivo por:

```tsx
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useAppCtx } from "../navigation/context";
import { TAB_ORDER, type TabName, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { pillWidth, pillX, ROW_BOTTOM, ROW_H, ROW_PAD_X, ROW_TOP, TAB_COUNT, tabBarHeight, tabIndexAt } from "./tabbar";
import { C } from "./theme";

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Resorte de la pastilla: rigidez media, sin rebote exagerado (P5 del plan F2). */
const SPRING = { damping: 18, stiffness: 220, mass: 0.6 };
const HIDE_MS = 220;

/**
 * Tab bar custom de bottom-tabs (spec mobile-nav D11/D13). Siempre montada y absoluta: se esconde deslizando
 * hacia abajo cuando la pantalla enfocada no es raíz (D13). La pastilla lima sigue a `state.index` con resorte y
 * se puede arrastrar sin despegar el dedo; la pestaña cambia sólo al soltar (D11). El tap sigue siendo tap.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { switchTab } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  const visible = SHOW_TABS.includes(focusedScreen);
  const height = tabBarHeight(insets.bottom);

  // Ancho real de la fila (depende del dispositivo, P2): estado para React y sharedValue para los worklets.
  const [width, setWidth] = useState(0);
  const rowW = useSharedValue(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => { const w = e.nativeEvent.layout.width; setWidth(w); rowW.value = w; }, [rowW]);

  // Pastilla: x animada; `drag` = índice bajo el dedo durante el arrastre (−1 = sin arrastre).
  const pill = useSharedValue(0);
  const drag = useSharedValue(-1);
  useEffect(() => { if (width > 0) pill.value = withSpring(pillX(state.index, width), SPRING); }, [state.index, width, pill]);

  // Esconder/mostrar (D13): translateY = alto de la barra.
  const ty = useSharedValue(visible ? 0 : height);
  useEffect(() => { ty.value = withTiming(visible ? 0 : height, { duration: HIDE_MS }); }, [visible, height, ty]);

  const select = useCallback((i: number) => {
    if (i === state.index) return;
    const route = state.routes[i];
    // El listener `tabPress` de native-stack es quien hace popToTop en la pila anidada al tocar la pestaña ya
    // enfocada; aquí sólo se emite y, si nadie lo previene, se cambia de pestaña (paridad con el tap, P4).
    const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (!e.defaultPrevented) switchTab(route.name as TabName);
  }, [state.index, state.routes, navigation, switchTab]);
  const tick = useCallback(() => { void Haptics.selectionAsync(); }, []);

  const pan = Gesture.Pan()
    .enabled(visible && width > 0)
    .activeOffsetX([-6, 6]) // el tap no se roba: el Pan sólo activa con 6 pt horizontales
    .failOffsetY([-12, 12])
    .onStart((e) => {
      const i = tabIndexAt(e.x, rowW.value, TAB_COUNT);
      drag.value = i;
      pill.value = withSpring(pillX(i, rowW.value, TAB_COUNT), SPRING);
    })
    .onUpdate((e) => {
      const i = tabIndexAt(e.x, rowW.value, TAB_COUNT);
      if (i !== drag.value) {
        drag.value = i;
        pill.value = withSpring(pillX(i, rowW.value, TAB_COUNT), SPRING);
        runOnJS(tick)();
      }
    })
    .onEnd(() => { runOnJS(select)(drag.value); })
    .onFinalize((_e, success) => {
      if (!success) pill.value = withSpring(pillX(state.index, rowW.value, TAB_COUNT), SPRING); // cancelado: vuelve al activo
      drag.value = -1;
    });

  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
  const pillStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pill.value }] }));

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height, paddingTop: ROW_TOP, paddingBottom: insets.bottom + ROW_BOTTOM, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.deep50 }, barStyle]}
    >
      <GestureDetector gesture={pan}>
        <View onLayout={onLayout} style={{ flexDirection: "row", height: ROW_H, paddingHorizontal: ROW_PAD_X }}>
          {width > 0 ? (
            <Animated.View pointerEvents="none" style={[{ position: "absolute", top: 0, left: 0, width: pillWidth(width), height: ROW_H, borderRadius: 999, backgroundColor: C.limeBg14 }, pillStyle]} />
          ) : null}
          {state.routes.map((route, i) => {
            const root = TAB_ROOT[route.name as TabName];
            const [, label, icon] = TABS.find(([k]) => k === root)!;
            const fg = ROOT_OF[focusedScreen] === root ? C.lime : C.faint;
            return (
              <Touch key={route.key} onPress={() => select(i)} accessibilityLabel={`tab-${root}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
                <Icon name={icon} size={19} color={fg} />
                <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
              </Touch>
            );
          })}
        </View>
      </GestureDetector>
    </Animated.View>
  );
}
```
Notas: `TAB_ORDER` sólo se importa si se usa (aquí el índice va por `state.routes[i]`, que es el mismo orden — si `tsc` marca `TAB_ORDER` sin uso, quitarlo del import). Si `tsc` exige tipar `e` en los callbacks del gesto o se queja de `runOnJS(select)` con argumento, ajustar tipos sin cambiar la semántica y anotarlo.

- [ ] **Step 2: `src/ui/Page.tsx`** — reservar el hueco de la barra en las raíces (D13): import `useSafeAreaInsets` de `react-native-safe-area-context` y `tabBarHeight` de `./tabbar`; dentro de `Page`, `const insets = useSafeAreaInsets();` y en el `ScrollView`:

```tsx
          contentContainerStyle={{ flexGrow: 1, paddingBottom: showTabs ? tabBarHeight(insets.bottom) : 0 }}
```
El `SafeAreaView edges={showTabs ? ["top"] : ["top", "bottom"]}` se queda igual.

- [ ] **Step 3: `tsc`, tests y humo**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
U=2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
SC=/Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav/.superpowers/sdd/2026-09-21-mobile-nav-f2
mkdir -p "$SC/shots"; lsof -tiTCP:8081 -sTCP:LISTEN >/dev/null || (nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 &)
xcrun simctl ui $U content_size medium; xcrun simctl terminate $U fun.pickler.app; xcrun simctl launch $U fun.pickler.app; sleep 4
xcrun simctl io $U screenshot "$SC/shots/t2-wallet.png"
```
**Mirar** `t2-wallet.png`: Wallet con la pastilla lima detrás de WALLET, la lista de movimientos no queda tapada por la barra (hay hueco abajo); Metro sin rojo ni `[Reanimated]`/`[GestureHandler]` warnings. Tocar `tab-markets` (`taplabel.sh`): la pastilla se desliza a MARKETS (captura `t2-markets.png`). `market-BTC`: la barra se desliza hacia abajo mientras entra Market (video en Task 3); Market sin barra y sin hueco extra abajo (`t2-market.png`). `back`: la barra vuelve deslizando.

- [ ] **Step 4: Commit**

```bash
git add src/ui/TabBar.tsx src/ui/Page.tsx
git commit -m "feat(mobile): tab bar con pastilla lima arrastrable (reanimated + gesture-handler, haptics) y barra que se esconde deslizando en no-raíz; Page reserva el hueco" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`; 33 / 243.

---

### Task 3: Recorrido en el simulador (capturas)

**Files:** ninguno del repo. Workspace `SC=<worktree>/.superpowers/sdd/2026-09-21-mobile-nav-f2` (lo crea `scripts/sdd-workspace`); copiar `taplabel.sh`, `tap-point.yaml`, `gear.sh` y `flows/` desde `<worktree>/.superpowers/sdd/2026-09-21-mobile-nav-f1/` y ajustar `SC` en `taplabel.sh`/`gear.sh`.

**Interfaces:**
- Produces: `$SC/task-3-report.md`; PNG a `docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-{pill-drag,pill-landed,bar-hiding,bar-shown}.png` (reducidos con `sips -Z 1300`).

- [ ] **Step 0: Estado** — Metro desde el worktree, `content_size medium`, app en Wallet con sesión; anotar saldos (`00-wallet-before.png`).

- [ ] **Step 1: Arrastre de la pastilla** — grabar `xcrun simctl io $U recordVideo --codec h264 --force $SC/shots/vid-drag.mp4 &`; Maestro `swipe` **lento** sobre la fila de la tab bar: `start "88%, Y%" end "12%, Y%" duration 1800` con `Y` = centro de la fila (≈ 100 − (ROW_TOP + ROW_H/2 + insets.bottom + ROW_BOTTOM) / altoPantalla·100; en el iPhone 17 Pro ≈ 93 %); parar la grabación (`kill -INT`), extraer frames (`ffmpeg -i vid-drag.mp4 -vf fps=30 $SC/shots/drag-%03d.png`) y contact sheet; elegir un frame con la pastilla **entre** dos ítems o sobre uno intermedio (`01-pill-drag.png`) y el final tras soltar con la pantalla ya cambiada (`02-pill-landed.png`: Markets con la pastilla en MARKETS). Si el swipe sintético no activa el `Pan` (la pastilla no se mueve), probar `idb ui swipe` si está instalado; si tampoco, anotarlo como no capturado y verificar al menos que el tap sigue funcionando.

- [ ] **Step 2: Barra deslizando** — grabar `vid-push.mp4` mientras `taplabel.sh market-BTC`; frames: uno con la barra **a medio camino** hacia abajo y Market entrando (`03-bar-hiding.png`); luego `back` grabando `vid-pop.mp4`: barra subiendo (`04-bar-shown.png`). Confirmar en el frame final de Market que no hay hueco vacío abajo, y en Markets que la lista no queda bajo la barra.

- [ ] **Step 3: Tap y resorte** — `tab-wallet` → captura a ~120 ms por video (`05-pill-spring.png`, pastilla en tránsito) y final (`06-wallet.png`). Comprobar que un tap en la pestaña activa no hace nada raro.

- [ ] **Step 4: Sin regresiones** — jalar en Wallet → sello; `deposit` → Deposit sin barra y con el inset inferior correcto (botones no tapados); `back` → barra vuelve; gate (Dev controls → «Markets» sin cuenta) **no** aplica si hay cuenta: no cerrar sesión. Saldos al final (`99-wallet-after.png`) iguales.

- [ ] **Step 5: Reporte** — `$SC/task-3-report.md`: tabla captura → qué se ve (✓ mirada), valores finales de `SPRING`/`HIDE_MS` si se ajustaron, no capturado y por qué, defectos (pastilla desalineada, barra que no vuelve, hueco/solape, tap robado por el Pan, warnings de Reanimated). Copiar los 4 PNG de evidencia con `sips -Z 1300`.

---

### Task 4: Docs — D11 (F2), D13, F2 `completed`, audit, README, checks

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-mobile-nav-design.md` (D11 marca (F2) con `SPRING`/`HIDE_MS` finales; **D13** nueva fila: «Tab bar animada al entrar/salir de no-raíz» con el texto de la Global Constraint D13 y marca (F2); Estado: «F1 y F2 ejecutadas; rama `feat/mobile-nav-f2` lista para merge local»; §5 Fases: F2 con D13), `docs/overview/2026-09-21-mobile-nav.html` (phase-card F2 → `completed`, tasks 1–4 `checked`, D13 en la tabla de decisiones, rulings de F2 en «Rulings en ejecución»), `docs/overview/data/manifest.js` (`phases[1].status = 'completed'`; `status: 'active'` se queda hasta el merge), `apps/mobile/README.md` (en «Navegación»: párrafo «Tab bar»: geometría en `ui/tabbar.ts`, pastilla/arrastre/`switchTab`, barra absoluta + `paddingBottom` en raíces; conteo de tests 33 / 243)
- Create: `docs/superpowers/audits/2026-09-21-mobile-nav-f2-rulings.md`, `docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-*.png` (Task 3)

- [ ] **Step 1: Spec, overview, manifest, README** como arriba. `npm run docs:html`; render-check del overview a 390 px y **mirar** (F2 completed, 4/4, D13 en decisiones).
- [ ] **Step 2: Audit** — §1 por task con evidencia real (RED/GREEN de Task 1, `tsc`/tests, humo de Task 2, tabla de capturas de Task 3 con `![…](img/…)`), §2 tests/tsc/diffstat (`git log --oneline main..HEAD`), §3 rulings (P1–P7 + ledger), §4 correcciones (D13 nace en F2; lo que cambió del spec D11), §5 cuentas al cierre, §6 residuales (háptica no verificable en simulador; arrastre sintético si no activó; Android).
- [ ] **Step 3: Checks y commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-nav
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK && cd ../..
git status --short
git add docs/superpowers/specs/2026-09-21-mobile-nav-design.md docs/superpowers/specs/2026-09-21-mobile-nav-design.html docs/superpowers/plans/2026-09-21-mobile-nav-f2.md docs/superpowers/plans/2026-09-21-mobile-nav-f2.html docs/overview/2026-09-21-mobile-nav.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-21-mobile-nav-f2-rulings.md docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-pill-drag.png docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-pill-landed.png docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-bar-hiding.png docs/superpowers/audits/img/2026-09-21-mobile-nav-f2-bar-shown.png apps/mobile/README.md
git commit -m "docs(mobile-nav): F2 completed — spec D11 (F2) y D13, overview, audit con capturas, README" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `docs:check` errors=0; `agents:check` `"errors": []`; 33 / 243; `TSC-OK`; árbol limpio. (Si alguna captura no existió, quitarla del `git add` y del audit.) Handoff: rama lista para merge local (decisión de Jesús) y build 9 cuando lo pida; el proyecto `mobile-nav` pasa a `completed` en el manifest con el merge.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura**: D11 → Task 1 (geometría + tests) + Task 2 (`TabBar`); D13 (nueva) → Task 2 (`translateY`, `pointerEvents`, `Pan.enabled`) + `Page` (`paddingBottom`) + Task 4 (spec); verificación → Task 3 (capturas por video) + Task 4 (docs). Sin gaps.
- **Placeholders**: `<modelo>`, `<url>`, el `Y%` del swipe (se calcula en Task 3 con la geometría de `tabbar.ts` y el alto de pantalla) y los valores finales de `SPRING`/`HIDE_MS` si se ajustan. Ningún «TBD».
- **Consistencia de tipos**: `tabIndexAt(x, rowWidth, count)`, `pillX(index, rowWidth, count)`, `pillWidth(rowWidth, count)`, `tabBarHeight(insetBottom)` iguales en Tasks 1 y 2; `TabBar(props: BottomTabBarProps)` conserva la firma de F1; `switchTab(tab: TabName)` existe desde F1 (`store.ts`); `C.limeBg14`, `C.deep50`, `C.hair` existen en `theme.ts`.
- **Trampas conocidas**: (1) `useAnimatedStyle` con `transform` y `position: "absolute"` en el mismo `style` array — OK en reanimated 4; (2) `runOnJS(select)(drag.value)` requiere que `select` sea estable entre renders (está en `useCallback`); (3) si el `Pan` roba el tap, subir `activeOffsetX` a ±10; (4) la barra absoluta se pinta encima de la escena: el `paddingBottom` de `Page` evita que el último ítem de una lista quede tapado.
