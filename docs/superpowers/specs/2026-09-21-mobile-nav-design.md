# App móvil Pickler — Navegación nativa: gesto atrás interactivo, pilas por pestaña y tab bar con pastilla arrastrable

**Fecha**: 2026-09-21
**Estado**: diseño aprobado por Jesús el 2026-09-21 (brainstorm de esta fecha, secciones 1–5); sin plan todavía.
**Slug**: `mobile-nav`
**Rama**: `feat/mobile-nav`, base `main` (`6e9326c`, build 7 en TestFlight), worktree `.claude/worktrees/mobile-nav`
**Contexto**: tras probar el build 7 en su iPhone, Jesús pidió dos cosas mirando dos capturas de la app nativa
de Proflores: (1) que el gesto de «atrás» sea el de iOS — la pantalla actual se desliza a la derecha siguiendo
el dedo y debajo se va descubriendo la anterior, un poco desplazada y con un velo que se aclara —, y (2) que la
tab bar tenga una pastilla que se pueda arrastrar con el dedo sin despegarlo y suelte sobre la pestaña elegida.
Hoy la app navega con un store propio (`screen` + `stack`), el `Shell` pinta **una sola** pantalla, el swipe
desde el borde (`PanResponder`) cambia de pantalla **de golpe** al soltar y la tab bar son cinco `Touch`.
Faltan 22 días para el bounty (13 oct 2026, 21:59 CST).

---

## TL;DR

1. **La navegación pasa a react-navigation nativa**: `native-stack` (sobre `react-native-screens`, o sea
   `UINavigationController`) dentro de `bottom-tabs`, con **una pila por pestaña**. El gesto atrás, el
   «adelante» animado y el botón `←` son los de iOS, sin código de animación nuestro.
2. **Las pantallas no cambian de API**: siguen usando `ctx.nav / back / requireAccount`; un adaptador traduce
   `Screen` → ruta. El store deja de guardar `screen/stack/next` y conserva sólo datos.
3. **La cabecera es nuestra y viaja con la página** (`headerShown: false`); pull-to-refresh y sello
   `UPDATED` viven en un `Page` por ruta.
4. **Tab bar custom con pastilla lima** que sigue el dedo (`gesture-handler` + `reanimated`) y selecciona **al
   soltar**; el tap sigue siendo tap. Cambiar de pestaña no anima (como iOS).

## 1. Alcance

| Dentro | Fuera |
|---|---|
| `@react-navigation/native` + `native-stack` + `bottom-tabs`, `react-native-screens`, `react-native-gesture-handler`, `react-native-reanimated`, `expo-haptics` | Android (sin build) |
| `RootStack` (Tabs, Signin) y cinco pilas de pestaña | Cabecera nativa de iOS (large title) |
| Adaptador `navigate(screen, patch)` / `back()` / `requireAccount` sobre `navigationRef` | Transiciones distintas de la nativa; deep links por URL |
| `Page` (cabecera + `ScrollView` + refresh + sello) por ruta | Rediseño visual de cabecera, pantallas o iconos |
| Socket de Perpl, push y DevControls sobre la ruta activa | Pilas persistidas entre arranques |
| `TabBar` con pastilla arrastrable (F2) | Blur / «liquid glass» real (no hay `expo-blur`) |

## 2. Decisiones

| # | Decisión | Detalle |
|---|---|---|
| D1 | **Árbol de navegación** | `NavigationContainer` (con `navigationRef` global) → `RootStack` (native-stack): `Tabs` y `Signin`. `Tabs` (bottom-tabs, `tabBar` custom, `animation: "none"`): `MarketsTab` = pila `markets → market → perpsFunds`; `WalletTab` = pila `wallet → deposit → withdraw`; `LaunchpadTab`, `ActivityTab`, `PortfolioTab` = una pantalla coming soon cada una. Ruta inicial: `Tabs/WalletTab` con cuenta; `Signin` sin cuenta. |
| D2 | **Las pantallas no cambian de API** | `ctx.nav(screen, patch)`, `ctx.back()`, `ctx.requireAccount(screen, patch)` se mantienen. Implementación en `src/navigation/adapter.ts`: tabla pura `ROUTE_OF: Record<Screen, { tab: TabName; route: string }>` y `navigate(screen, patch)` = aplicar `patch` al store y `navigationRef.navigate(tab, { screen: route })`; `back()` = `navigationRef.goBack()` si `canGoBack()`. `DevControls` usa el mismo adaptador. |
| D3 | **Store sólo con datos** | `StoreState` pierde `screen`, `stack`, `next`, `nextPatch`; conserva `perpsMarketId`, `perpsSide`, `marketTab`, `fundsMode`, `askView`, `askCell`, `askAgentId`, `askFocusReadId`, `tradeLevel`. `navState`/`backState`/`afterSigninState`/`bootState`/`resetState`/`canBackFor` desaparecen con sus tests; `signedOutState` queda como «limpiar Ask». `ROOT_OF`, `SHOW_TABS`, `GATED`, `CAN_BACK`, `headerFor`, `heldActionFor`, `marketEntryTab` siguen (puros, con tests). |
| D4 | **Pantalla activa por ruta** | `ctx.scr` sale de un listener `state` del container (`navigationRef.getCurrentRoute()?.name` → `Screen`), no del store. De ahí cuelgan `PERPL_SCREENS` (socket), `headerFor`, `comingSoon` y el sello. Antes de `isReady()` vale `"wallet"`. |
| D5 | **Gate de cuenta** | `requireAccount(target, patch)` con cuenta → `navigate(target, patch)`; sin cuenta → `navigate("signin", { next: target, patch })` (`Signin` encima de `Tabs`, con `←`). Al terminar sign-in con `next`: `popTo("Tabs")` + `navigate(next, patch)` — `Signin` no queda en la pila. Sin `next`: `popTo("Tabs")`. La tarjeta «We kept what you were about to do» lee `route.params.next` con `heldActionFor`. Arranque sin cuenta: `Signin` como ruta inicial (sin `←`); al firmar, `reset` a `Tabs/WalletTab`. Sign out: limpiar Ask en el store + `reset` a `Signin`. |
| D6 | **Cabecera y página** | `headerShown: false` en ambos stacks; la cabecera actual (marca en raíz, `←` si `canGoBack`, título/subtítulo de `headerFor`, `⚙` en dev) se pinta dentro de `Page`, así **viaja con la página** en el gesto. `Page` = `SafeAreaView` (`edges: ["top"]`), cabecera, `ScrollView` propio con `RefreshControl` lima, sello `UPDATED`/`COULDN'T REFRESH`, contenido; **fondo opaco** (el gradiente actual) para tapar la página de abajo durante el gesto. Cada ruta es `withPage(Screen)`; cada página conserva su scroll (se elimina el `scrollTo(0)` del `Shell`). |
| D7 | **Sello por pantalla** | `updatedAt`/`refreshFailed` salen del `Shell` a `useRefreshSeal()` a nivel de App (mismo contrato: `refreshOk`, `screenHasData`, reset al cambiar `accountAddress`); `Page` lo consume por `screen`. Helpers puros y tests de `mobile-loading` no cambian. |
| D8 | **Gesto y transición** | Los nativos de `native-stack`: `gestureEnabled: true`, `fullScreenGestureEnabled: false` (sólo desde el borde, estándar iOS), `animation: "default"` (slide desde la derecha con parallax y velo del sistema). Se **elimina** `PanResponder` + `ui/gestures.ts` y sus tests. Cambiar de pestaña: sin animación. Tocar la pestaña activa: `popToTop` de esa pila. |
| D9 | **Tab bar oculta en no-raíz** | Como `SHOW_TABS` hoy: en `market`, `perpsFunds`, `deposit`, `withdraw` la tab bar no se muestra (`tabBarStyle: { display: "none" }` por ruta enfocada, calculado con `getFocusedRouteNameFromRoute`). La `SafeAreaView` inferior vive en la tab bar (o en `Page` cuando la tab bar está oculta), nunca dentro de la página que se desliza. |
| D10 | **Cross-tab y push** | «Market desde Wallet» y el tap en un push de read hacen `navigate("MarketsTab", { screen: "market" })` + patch: la app salta a la pestaña Markets y apila Market **sobre Markets** (atrás → Markets), no sobre Wallet como dejó el fix gate. En frío, el push espera `navigationRef.isReady()` (se conserva la cola de `App.tsx`). |
| D11 | **Tab bar con pastilla (F2)** | `src/ui/TabBar.tsx` (prop `tabBar` de bottom-tabs). Fila de 5 ítems como hoy sobre `C.deep50`; detrás del activo, una pastilla `borderRadius` 999, alto ≈ 44, ancho = ítem − 8, lima translúcido (`C.lime` con alpha ≈ 0.16), sin blur. `translateX` en un `sharedValue` de reanimated con `withSpring` (rigidez media, sin rebote exagerado) al cambiar el índice activo, que **viene de `state.index`** de bottom-tabs (no de estado propio). `Pan` de gesture-handler sobre la fila (`minDistance` ≈ 6 px para no robar el tap): mientras se arrastra, `index = tabIndexAt(x, rowWidth, 5)` mueve la pastilla al ítem bajo el dedo y dispara `Haptics.selectionAsync()` al cruzar; **al soltar** `requireAccount(TABS[index])` (o `popToTop` si es la activa). El tap simple sigue siendo tap. Puros con test en `src/ui/tabbar.ts`: `tabIndexAt(x, rowWidth, count)`, `pillX(index, rowWidth, count)`. |
| D12 | **Verificación** | Tests puros: `ROUTE_OF` cubre las 10 pantallas; gate (`gateTarget(hasAccount, target)` → ruta o `signin`+`next`); `heldActionFor`; sello; `tabIndexAt`/`pillX`. Simulador (cuenta #620, sin mover fondos): capturas de **gesto atrás a medio camino** (Market sobre Markets, como la captura de Proflores), adelante animado (frames del push a Market), botón `←`, push en frío → Market en la pestaña Markets, sign-in con `next`, sign out, tab bar oculta en Market/Deposit, scroll conservado al volver, y en F2 la pastilla a medio arrastre y tras soltar. Sin build de TestFlight salvo petición (sería el build 8). |

## 3. Flujos de referencia

```
arranque con cuenta   → Tabs/WalletTab (wallet)
arranque sin cuenta   → Signin (sin ←) → firma → reset Tabs/WalletTab
tab Markets sin cuenta→ Signin { next: markets } → firma → popTo Tabs + navigate markets
Markets → BTC         → MarketsTab: markets → market (slide nativo) ; ← o gesto → markets (interactivo)
Wallet → Deposit      → WalletTab: wallet → deposit ; tab bar oculta
push read resuelta    → MarketsTab: markets → market (askView mine, askFocusReadId) ; atrás → markets
Market desde Wallet   → salta a MarketsTab y apila market sobre markets
sign out              → limpiar Ask + reset Signin
tab activa tocada     → popToTop de su pila
arrastre en tab bar   → pastilla sigue el dedo (haptic al cruzar) → al soltar requireAccount(tab)
```

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| Versiones: `react-native-screens`, `gesture-handler`, `reanimated` deben ser las del SDK 57 | `npx expo install` para todas; leer `https://docs.expo.dev/versions/v57.0.0/` y `https://reactnavigation.org/docs/` (v7: `popTo`, `getFocusedRouteNameFromRoute`, `animation: "none"` en bottom-tabs) antes del plan; el plan cita versiones instaladas. |
| Reanimated exige el plugin de Babel al final de `babel.config.js` y `GestureHandlerRootView` en la raíz | Task explícita del plan con `tsc` + arranque en simulador antes de seguir. |
| `ctx.scr` por ruta llega un frame después que el store | Antes de `isReady()` vale `"wallet"`; el socket de Perpl tolera un frame (ya reconecta por `active`). |
| Pantallas que dependían de `S.stack` (`canBack`) | Sólo `Shell` lo usaba; `Page` usa `navigation.canGoBack()`. |
| El fix gate (Market sobre Wallet desde un push) cambia a Market sobre Markets | Aprobado en el brainstorm (sección 1); anotar en el tracker `markets-ask-gate` como comportamiento sustituido. |
| Maestro por `accessibilityLabel` | Se conservan `tab-*`, `market-*`, `back`, `dev-controls`, `pill-*`. |
| Dos `ScrollView` vivos (página de abajo y de arriba) con `RefreshControl` | El de abajo no recibe toques durante la transición (lo gestiona `react-native-screens`). |

## 5. Fases

- **F1 — Migración a react-navigation** (D1–D10, D12 sin F2): dependencias + `prebuild --clean` + rebuild, árbol de navegación, adaptador, `Page` con cabecera/refresh/sello, store sólo datos, ruta activa, gate/sign-in/sign-out, push, tab bar con el aspecto de hoy (cinco `Touch`) montada por `tabBar`. Audit al cierre.
- **F2 — Tab bar con pastilla arrastrable** (D11): `TabBar.tsx`, `tabbar.ts` con tests, haptics; capturas del arrastre. Audit al cierre.

`ios/` no está versionado: los cambios nativos entran por `app.config.ts`/`package.json` y `prebuild`.
