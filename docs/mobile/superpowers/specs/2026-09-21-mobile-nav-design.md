# App móvil Pickler — Navegación nativa: gesto atrás interactivo, pilas por pestaña y tab bar con pastilla arrastrable

**Fecha**: 2026-09-21
**Estado**: F1 y F2 ejecutadas (audits `2026-09-21-mobile-nav-f1-rulings.md` y `2026-09-21-mobile-nav-f2-rulings.md`); rama `feat/mobile-nav-f2` lista para merge local.
**Slug**: `mobile-nav`
**Rama**: `feat/mobile-nav` (F1, mergeada en `165accf`) y `feat/mobile-nav-f2` (F2), base `main`; worktree `.claude/worktrees/mobile-nav`
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
| `TabBar` con pastilla arrastrable (F2) — hecho | Blur / «liquid glass» real (no hay `expo-blur`) |

## 2. Decisiones

| # | Decisión | Detalle |
|---|---|---|
| D1 | **Árbol de navegación** | `NavigationContainer` (con `navigationRef` global) → `RootStack` (native-stack): `Tabs` y `signin`. `Tabs` (bottom-tabs, `tabBar` custom, `animation: "none"`): `MarketsTab` = pila `markets → market → perpsFunds`; `WalletTab` = pila `wallet → deposit → withdraw`; `LaunchpadTab`, `ActivityTab`, `PortfolioTab` = una pantalla coming soon cada una. Ruta inicial: `Tabs/WalletTab` con cuenta; `signin` sin cuenta. |
| D2 | **Las pantallas no cambian de API** | `ctx.nav(screen, patch)`, `ctx.back()`, `ctx.requireAccount(screen, patch)` se mantienen. Implementación en `src/navigation/adapter.ts`: tabla pura `ROUTE_OF: Record<Screen, { tab: TabName; route: string }>` y `navigate(screen, patch)` = aplicar `patch` al store y `navigationRef.navigate(tab, { screen: route })`; `back()` = `navigationRef.goBack()` si `canGoBack()`. `DevControls` usa el mismo adaptador. **(F1)** La premisa v6 de que `navigate` a una ruta ya presente en la pila «vuelve» a ella no aplica a react-navigation 7 (`@react-navigation/routers` 7.6.4: sin `pop: true`, `StackRouter` apila). El adaptador real (`ref.ts`) usa `navigationRef.navigate("Tabs", { screen: tab, params: { screen, pop: true, initial?: false } }, { pop: true })` para las pantallas de pestaña, y un `switchTab(tab)` separado (`navigate("Tabs", { screen: tab }, { pop: true })`, sin params anidados) para la tab bar — ruling R5 del audit F1. |
| D3 | **Store sólo con datos** | `StoreState` pierde `screen`, `stack`, `next`, `nextPatch`; conserva `perpsMarketId`, `perpsSide`, `marketTab`, `fundsMode`, `askView`, `askCell`, `askAgentId`, `askFocusReadId`, `tradeLevel`. `navState`/`backState`/`afterSigninState`/`bootState`/`resetState`/`canBackFor` desaparecen con sus tests; `signedOutState` queda como «limpiar Ask». `ROOT_OF`, `SHOW_TABS`, `GATED`, `CAN_BACK`, `headerFor`, `heldActionFor`, `marketEntryTab` siguen (puros, con tests). **(F1)** `Screen`, `GATED`, `CAN_BACK`, `SHOW_TABS` y `ROOT_OF` terminaron en `src/navigation/screens.ts` (nuevo), re-exportados desde `store.ts`: el ciclo de imports `store.ts ↔ navigation/routes.ts` producía un `Require cycle` de Metro que tapaba la tab bar con un LogBox amarillo en el simulador. |
| D4 | **Pantalla activa por ruta** | `ctx.scr` sale de un listener `state` del container (`navigationRef.getCurrentRoute()?.name` → `Screen`), no del store. De ahí cuelgan `PERPL_SCREENS` (socket), `headerFor`, `comingSoon` y el sello. Antes de `isReady()` vale `"wallet"`. |
| D5 | **Gate de cuenta** | `requireAccount(target, patch)` con cuenta → `navigate(target, patch)`; sin cuenta → `navigate("signin", { next: target, patch })` (`signin` encima de `Tabs`, con `←`). Al terminar sign-in con `next`: `popTo("Tabs")` + `navigate(next, patch)` — `signin` no queda en la pila. Sin `next`: `popTo("Tabs")`. La tarjeta «We kept what you were about to do» lee `route.params.next` con `heldActionFor`. Arranque sin cuenta: `signin` como ruta inicial (sin `←`); al firmar, `reset` a `Tabs/WalletTab`. Sign out: limpiar Ask en el store + `reset` a `signin`. **(F1)** El código no usa `popTo`: `finishSignin` hace `resetRoot("Tabs")` sólo cuando `signin` es la raíz (arranque sin cuenta) y en todos los casos `nav(next ?? "wallet", patch)` → `navigate("Tabs", …, { pop: true })`, que saca `signin` si `Tabs` está debajo (R5). Sin `next` aterriza en `WalletTab/wallet`. |
| D6 | **Cabecera y página** | `headerShown: false` en ambos stacks; la cabecera actual (marca en raíz, `←` si `canGoBack`, título/subtítulo de `headerFor`, `⚙` en dev) se pinta dentro de `Page`, así **viaja con la página** en el gesto. `Page` = `SafeAreaView` (`edges: ["top"]`), cabecera, `ScrollView` propio con `RefreshControl` lima, sello `UPDATED`/`COULDN'T REFRESH`, contenido; **fondo opaco** (el gradiente actual) para tapar la página de abajo durante el gesto. Cada ruta es `withPage(Screen)`; cada página conserva su scroll (se elimina el `scrollTo(0)` del `Shell`). |
| D7 | **Sello por pantalla** | `updatedAt`/`refreshFailed` salen del `Shell` a `useRefreshSeal()` a nivel de App (mismo contrato: `refreshOk`, `screenHasData`, reset al cambiar `accountAddress`); `Page` lo consume por `screen`. Helpers puros y tests de `mobile-loading` no cambian. **(F1)** Implementado como contador + efecto: `onRefreshDone` sólo incrementa un contador con la pantalla; un efecto sobre ese contador evalúa `refreshOk` con los errores de ESE render y sella o marca `failed`. El sello inicial también sale del propio hook (efecto sobre `REFRESHABLE.map(hasData)`), declarado después del efecto de reset por cuenta y con `address` en sus deps para que se re-evalúe al cambiar de cuenta con saldo ya cargado — rulings R1–R3 del audit F1. |
| D8 | **Gesto y transición** | Los nativos de `native-stack`: `gestureEnabled: true`, `fullScreenGestureEnabled: false` (sólo desde el borde, estándar iOS), `animation: "default"` (slide desde la derecha con parallax y velo del sistema). Se **elimina** `PanResponder` + `ui/gestures.ts` y sus tests. Cambiar de pestaña: sin animación. Tocar la pestaña activa: `popToTop` de esa pila. **(F1)** «Tocar la pestaña activa → popToTop» queda inalcanzable en la práctica bajo D9: la tab bar se oculta fuera de la raíz de cada pestaña, así que nunca hay un momento en que la pestaña activa esté visible y tocable estando en una pantalla no-raíz de esa misma pestaña. Comportamiento latente (el `navigation.emit("tabPress")` estándar de bottom-tabs sigue ahí, sin código muerto que quitar); anotado como residual, no como bug. |
| D9 | **Tab bar oculta en no-raíz** | Como `SHOW_TABS` hoy: en `market`, `perpsFunds`, `deposit`, `withdraw` la tab bar no se muestra (`tabBarStyle: { display: "none" }` por ruta enfocada, calculado con `getFocusedRouteNameFromRoute`). La `SafeAreaView` inferior vive en la tab bar (o en `Page` cuando la tab bar está oculta), nunca dentro de la página que se desliza. |
| D10 | **Cross-tab y push** | «Market desde Wallet» y el tap en un push de read hacen `navigate("MarketsTab", { screen: "market" })` + patch: la app salta a la pestaña Markets y apila Market **sobre Markets** (atrás → Markets), no sobre Wallet como dejó el fix gate. En frío, el push espera `navigationRef.isReady()` (se conserva la cola de `App.tsx`). |
| D11 | **Tab bar con pastilla (F2)** | `src/ui/TabBar.tsx` (prop `tabBar` de bottom-tabs). Fila de 5 ítems como hoy sobre `C.deep50`; detrás del activo, una pastilla `borderRadius` 999, alto ≈ 44, ancho = ítem − 8, lima translúcido (`C.lime` con alpha ≈ 0.16), sin blur. `translateX` en un `sharedValue` de reanimated con `withSpring` (rigidez media, sin rebote exagerado) al cambiar el índice activo, que **viene de `state.index`** de bottom-tabs (no de estado propio). `Pan` de gesture-handler sobre la fila (`minDistance` ≈ 6 px para no robar el tap): mientras se arrastra, `index = tabIndexAt(x, rowWidth, 5)` mueve la pastilla al ítem bajo el dedo y dispara `Haptics.selectionAsync()` al cruzar; **al soltar** `requireAccount(TABS[index])` (o `popToTop` si es la activa). El tap simple sigue siendo tap. Puros con test en `src/ui/tabbar.ts`: `tabIndexAt(x, rowWidth, count)`, `pillX(index, rowWidth, count)`. **(F2)** La geometría pura vive en `src/ui/tabBarLayout.ts` (no `tabbar.ts`: colisión de casing con `TabBar.tsx` en macOS — ruling F2-R1 del audit F2), con `"worklet"` en `itemWidth`/`tabIndexAt`/`pillX` porque el `Pan` corre en el hilo UI de reanimated. Pastilla: `backgroundColor: C.limeBg14`, resorte final `SPRING = { damping: 18, stiffness: 220, mass: 0.6 }`. Gesto: `activeOffsetX([-6, 6])` (no roba el tap) y `failOffsetY([-12, 12])`; `onStart`/`onUpdate` mueven la pastilla y disparan el haptic (`scheduleOnRN(tick)` — no `runOnJS`, deprecado en reanimated 4, ruling F2-R2); **al soltar** (`onEnd` con guard `success`, para no reaccionar a una cancelación) `select(index)` emite `tabPress` siempre (para que el listener de native-stack resuelva `popToTop` en la pestaña ya activa) y sólo si el índice es otra pestaña y nadie previno el evento llama `switchTab(route.name)` (no `requireAccount`: la tab bar nunca gatea, D5 sigue viviendo en `requireAccount` para el resto de la app); cancelado (`onFinalize` con `success=false`, y sólo si el `Pan` llegó a activarse) devuelve la pastilla al índice activo vigente. |
| D13 | **Tab bar animada al entrar/salir de no-raíz (F2)** | La barra queda **siempre montada y absoluta** (ya no `return null` fuera de raíz como en F1/D9): un `sharedValue` `ty` anima `translateY` con `withTiming` (`HIDE_MS = 220` ms) entre `0` (visible) y `tabBarHeight(insets.bottom)` (oculta bajo el borde inferior) según si la ruta enfocada está en `SHOW_TABS`. Oculta: `pointerEvents="none"` y `Pan.enabled(false)` — no intercepta toques ni arrastres de la pantalla que queda debajo. Las páginas raíz reservan el hueco fijo con `paddingBottom: tabBarHeight(insets.bottom)` en su `ScrollView` (`Page.tsx`, D6); las no-raíz no lo necesitan porque la barra está fuera de vista. Fondo **opaco** `C.bgBottom` (mismo color del final del gradiente, unión invisible) con la hairline superior — no translúcido: sin `expo-blur` un fondo con alpha dejaba leer el contenido de la pantalla entre los iconos (ruling F2-R2 del audit F2). |
| D12 | **Verificación** | Tests puros: `ROUTE_OF` cubre las 10 pantallas; gate (`gateTarget(hasAccount, target)` → ruta o `signin`+`next`); `heldActionFor`; sello; `tabIndexAt`/`pillX`. Simulador (cuenta #620, sin mover fondos): capturas de **gesto atrás a medio camino** (Market sobre Markets, como la captura de Proflores), adelante animado (frames del push a Market), botón `←`, push en frío → Market en la pestaña Markets, sign-in con `next`, sign out, tab bar oculta en Market/Deposit, scroll conservado al volver, y en F2 la pastilla a medio arrastre y tras soltar. Sin build de TestFlight salvo petición (sería el build 8). **(F1)** Capturado 5/5: `market-no-tabs`, `signin-next` y `scroll-kept` directas en el simulador; `gesture-mid` y `push-forward` vía `xcrun simctl io recordVideo` + extracción de frames con `ffmpeg` (los screenshots cronometrados nunca atraparon un frame intermedio: el jitter de arranque de Maestro/idb es mayor que la animación de ~300 ms), con un cambio temporal `fullScreenGestureEnabled: true` (revertido antes del commit de Task 8) porque el swipe sintético desde el borde no dispara `UIScreenEdgePanGestureRecognizer` en este entorno de pruebas. El gesto real desde el borde queda pendiente de verificar en el iPhone de Jesús. |

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
| **(F1)** `navigate` a una ruta ya presente en la pila no «vuelve» a ella en react-navigation 7 — la semántica v6 asumida por el plan (P3) es incorrecta | Verificado en el fuente (`@react-navigation/core`/`routers` 7.6.4, `StackRouter.tsx:385-395`): usar `{ pop: true }` explícito en las opciones y en los params anidados (con `initial: false` para no-raíces); `switchTab(tab)` separado (sin params anidados) para la tab bar. Ruling R5, Task 6 fix round 1 (`824a2f2`). |

## 5. Fases

- **F1 — Migración a react-navigation** (D1–D10, D12 sin F2): dependencias + `prebuild --clean` + rebuild, árbol de navegación, adaptador, `Page` con cabecera/refresh/sello, store sólo datos, ruta activa, gate/sign-in/sign-out, push, tab bar con el aspecto de hoy (cinco `Touch`) montada por `tabBar`. Audit al cierre.
- **F2 — Tab bar con pastilla arrastrable y barra animada** (D11, D13): `TabBar.tsx`, `tabBarLayout.ts` con tests, haptics; barra siempre montada que se esconde/aparece con `translateY`; `Page` reserva el hueco en las raíces. Capturas del arrastre y de la barra al ocultarse/reaparecer. Audit al cierre.

`ios/` no está versionado: los cambios nativos entran por `app.config.ts`/`package.json` y `prebuild`.
