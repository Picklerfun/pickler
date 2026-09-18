# App móvil Pickler — Pulido de navegación: coming soon, arranque en Wallet, gestos y PnL en Trade

**Fecha**: 2026-09-18
**Estado**: F1 ejecutada (audit `docs/superpowers/audits/2026-09-18-mobile-polish-f1-rulings.md`)
**Slug**: `mobile-polish`
**Rama**: `feat/mobile-polish`, base `main` (`09a7ac9`)
**Contexto**: tras el build 3 de TestFlight (`docs/overview/dev/2026-09-16-testflight-build3.html`) sólo
dos de los cinco tabs hacen algo real: **Wallet** y **Trade**. Market, Activity y Portfolio siguen
mostrando el mock del port de UI. Jesús usó la app en su iPhone y pidió tres cosas: que los tabs sin
función lo digan con la estética de la app, que las rutas reales se sientan nativas (jalar para
actualizar, gesto de atrás desde el borde, como la app iOS de Proflores) y que el saldo de Trade
refleje la ganancia de su posición abierta (un long de BTC que en el bloque de posiciones marca
+5.82 AUSD mientras el saldo de arriba sigue en 200.00).

---

## TL;DR

Cinco piezas, ningún backend, ninguna dependencia nueva, ningún cambio nativo:

1. **Coming soon** en Market, Activity y Portfolio, con los tokens de la app. El mock no se borra.
2. **Arranque en Wallet** (o Sign in → Wallet si no hay cuenta).
3. **Jalar para actualizar** en Wallet y Trade con el `RefreshControl` nativo; el botón *Refresh*
   de Wallet desaparece.
4. **Swipe desde el borde izquierdo = atrás** en las pantallas que hoy muestran `←`.
5. **Trade**: línea de PnL no realizado bajo el saldo, y "in positions / free" calculados con
   datos que sí significan eso (Σ `c` de las posiciones y `b`), no con `lb`.

---

## 1. Decisiones que fija este spec

| # | Decisión | Valor | Por qué |
|---|---|---|---|
| D1 | Tabs "coming soon" | `market`, `activity`, `portfolio`. Lista pura `COMING_SOON` en `store.ts`. | Son los tres que siguen en mock. Trade y Wallet son reales. |
| D2 | Qué pasa con el mock | **Nada se borra.** `SCREENS` conserva `MarketScreen`, `ActivityScreen`, `PortfolioScreen`, `search`, `agent`, `post`, `ask`, `position`, `trade`, `mock/data.ts`. Sólo cambia qué renderiza el `Shell` cuando `S.screen ∈ COMING_SOON`. | Jesús: "no elimines nada, solo es por el momento". Cuando una ruta cobre vida se quita de la lista y vuelve la pantalla. |
| D3 | Pantalla inicial | `INITIAL.screen = "wallet"`. Al resolver la cuenta por primera vez, `bootState(s, hasAccount)`: con cuenta se queda en `wallet`; sin cuenta va a `signin` con `next: "wallet"`, `stack: []`. | Jesús eligió Wallet. `WalletScreen` no tiene estado propio sin cuenta (muestra "—"), así que el arranque sin cuenta pasa por Sign in, que ya aterriza en `wallet` por defecto (`afterSigninState`). |
| D4 | Header de los tabs coming soon | Título del tab, subtítulo **"Coming soon"**. Las píldoras `★` / `Alerts` de Market **no se muestran** mientras Market esté en la lista; `⚙` (solo `__DEV__`) sigue. El logo de Market en el header se conserva. | Las píldoras navegan al mock (`search`, `activity`); mostrarlas contradice el "coming soon". |
| D5 | Pull-to-refresh | `RefreshControl` (React Native core, `tintColor: C.lime`) en el `ScrollView` del `Shell` cuando `S.screen` es `wallet` o `perps`. Wallet: `treasury.refresh()` y `treasury.refreshMovements()` en paralelo. Trade: `perpl.refreshContext()`. El spinner se suelta cuando terminan (o fallan) todas. | Es el gesto nativo de iOS que Jesús conoce de Proflores; no necesita librería ni Xcode. La pista visual es el propio spinner al jalar. |
| D6 | Botón *Refresh* de Wallet | **Se quita** (`own.tsx`, bloque TESTNET). El **Retry** dentro del aviso de error de RPC se queda. | El gesto lo sustituye; el Retry sirve cuando el RPC falló y el usuario está leyendo el error. |
| D7 | Swipe atrás | `PanResponder` (RN core) sobre el cuerpo del `Shell`, activo sólo cuando `ctx.canBack`. Captura el gesto si empieza a **≤ 24 px** del borde izquierdo y `dx > dy` en valor absoluto; al soltar con **`dx > 60`** llama `back()`. Sin animación de transición. | Sin react-navigation no hay gesto de sistema. `PanResponder` no añade dependencias ni gestures nativos; un umbral de borde evita robar scroll horizontal. |
| D8 | Swipe entre tabs | **Fuera de alcance.** | Choca con D7 y con cualquier scroll horizontal futuro; con 25 días de bounty no vale el riesgo. Jesús aceptó dejarlo fuera. |
| D9 | Saldo grande de Trade | **Sigue siendo `b`** (lo que Perpl reporta como balance). | Jesús eligió la opción 2: no convertir el número grande en equity. |
| D10 | Línea bajo el saldo | `{Σc} in positions · {b} free` (hoy usa `lb` y `b − lb`). | El audit `2026-09-16-mobile-perpl-f1` midió que con posición abierta `lb` es 0 y `b` ya excluye el colateral: "0.00 locked · 89.99 free" con 10 AUSD en una posición. Σ `c` sí es el colateral en posiciones. |
| D11 | PnL no realizado | Nueva línea `+5.82 unrealised PnL` / `−1.20 unrealised PnL`, mono, `C.up` / `C.down`, sólo cuando hay ≥ 1 posición con mercado conocido. Σ de `positionPnl(p, market.mark, …)`, la misma función que ya usa cada `PositionRow`. | Es la ganancia que Jesús ve abajo y echa de menos arriba; sumarla con la misma fórmula garantiza que ambas cifras coinciden. |
| D12 | Re-medición de `b` vs `c` | Antes de fijar el copy de D10 se abre una posición pequeña en la cuenta #620 del simulador (testnet) y se registra `b` antes/después y `c` de la posición en el audit. Si `b` **no** baja por el colateral (contradiciendo el audit), "free" pasa a `b − Σc`. | El "200.00" de Jesús con un long de 200 sugiere que quizá `b` no excluye `c`; el spec no da por buena una medición de hace dos días. |
| D13 | Sin animaciones ni dependencias | No se añade `react-native-gesture-handler`, `react-native-reanimated` ni react-navigation. | Cualquiera obliga a rebuild nativo y a rehacer el store; no cabe antes del bounty. |

---

## 2. Unidades

### 2.1 `src/store.ts` — se amplía

- `COMING_SOON: readonly Screen[] = ["market", "activity", "portfolio"]`.
- `INITIAL.screen = "wallet"`.
- `bootState(s, hasAccount): StoreState` — pura. Con cuenta devuelve `s` tal cual (ya está en
  `wallet`); sin cuenta devuelve `{ ...s, screen: "signin", stack: [], next: "wallet", nextPatch: undefined, resume: false }`.
- `useAppStore` expone `boot: (hasAccount: boolean) => void`.
- `headerFor`: `market` / `activity` / `portfolio` devuelven `[título, "Coming soon"]`.
- `AppStore` gana `comingSoon: boolean` (`COMING_SOON.includes(S.screen)`).

### 2.2 `App.tsx` — se amplía

- `useEffect` que corre **una vez** cuando `account` deja de ser `null`: `boot(hasAccount)`.
  Guardado con un `useRef` para no repetirse al hacer sign in/out después.

### 2.3 `src/screens/comingSoon.tsx` — nuevo

- `ComingSoonScreen({ screen, nav }: Pick<AppCtx, "nav"> & { screen: Screen })`.
- Centrado vertical dentro del cuerpo (`flex: 1`, `justifyContent: "center"`, padding 16).
- Disco de 72 px, fondo `C.surf`, borde 1 px `rgba(200,240,58,0.35)`, con el **mismo Ionicon
  del tab** (`storefront` / `pulse` / `pie-chart`, variante outline) en `C.lime` a 30 px.
- Título `T w={800} s={22}` con el nombre del tab; `Tag` punteado **COMING SOON** en `C.lime`.
- Copy de una línea por tab (`C.dim`, 13 px, centrado): Market → "Agents and their tokens";
  Activity → "What the agents you follow are doing"; Portfolio → "Your token positions".
- Botón secundario "Go to Wallet" (`nav("wallet")`) — estilo `secondaryBtn` de las pantallas reales.
- Mapa `COMING_SOON_COPY: Record<"market"|"activity"|"portfolio", { icon, title, copy }>` exportado
  para el test.

### 2.4 `src/Shell.tsx` — se amplía

- `Current`: si `ctx.comingSoon` renderiza `ComingSoonScreen`; si no, `SCREENS[ctx.scr]`.
- `headerActions`: la rama `S.screen === "market"` sólo aplica cuando **no** es coming soon.
- `ScrollView` recibe `refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.lime} />}`
  sólo cuando `S.screen === "wallet" || S.screen === "perps"`; `onRefresh` según D5, con
  `Promise.allSettled` y `setRefreshing(false)` en `finally`.
- `PanResponder` (D7) envuelve el `ScrollView` en un `View` con los `panHandlers` cuando
  `ctx.canBack`. Lógica de umbrales en una función pura `edgeSwipeBack(start, dx, dy)`
  exportada desde `src/ui/gestures.ts` para poder testearla sin RN.

### 2.5 `src/ui/gestures.ts` — nuevo

- `EDGE_PX = 24`, `BACK_DX = 60`.
- `shouldCaptureEdgeSwipe(x0, dx, dy): boolean` — `x0 <= EDGE_PX && Math.abs(dx) > Math.abs(dy)`.
- `shouldGoBack(dx): boolean` — `dx > BACK_DX`.

### 2.6 `src/perpl/orders.ts` — se amplía

- `lockedCollateral(positions: readonly { c: bigint }[]): bigint` — Σ `c`.
- `unrealisedPnl(positions: readonly PositionLike[], markets: readonly Market[]): bigint | null` —
  Σ `positionPnl(p, m.mark, m.priceDecimals, m.sizeDecimals)` sobre las posiciones cuyo `mkt`
  tiene mercado; `null` si ninguna lo tiene (la UI oculta la línea).

### 2.7 `src/screens/perps.tsx` — se ajusta

- `locked = lockedCollateral(positions)`; línea `"{locked} in positions · {b} free"` (o
  `b − locked` si D12 lo obliga; el plan fija cuál con la medición).
- Nueva línea D11 debajo, con el mismo formato de signo que `PositionRow`
  (`pnl >= 0n ? "+" : "−"` y `formatAusd(abs)`).

### 2.8 `src/screens/own.tsx` — se ajusta

- Se elimina el `Touch` "Refresh" del bloque TESTNET (D6). Nada más cambia.

---

## 3. Flujo de arranque

```
App monta → account === null → spinner
account resuelve → boot(hasAccount)
  hasAccount   → screen "wallet", tabs visibles
  !hasAccount  → screen "signin", next "wallet"; tras login → afterSigninState → "wallet"
```

Sign out: `signedOutState` = limpiar + Sign in con `next: "wallet"` (cambiado en ejecución a petición
de Jesús; el diseño original decía "no cambia" y aterrizaba en Market, hoy coming soon).

---

## 4. Pruebas

Jest (`apps/mobile`, `npm test`) — todas corren también contra el defecto (la afirmación negativa
falla si se quita la implementación):

- `store.test.ts`: `bootState` con y sin cuenta; `INITIAL.screen === "wallet"`; `headerFor`
  devuelve "Coming soon" para los tres tabs y **no** para `wallet`/`perps`; `COMING_SOON` no
  incluye `wallet` ni `perps`.
- `gestures.test.ts`: captura sólo desde el borde (`x0 = 25` no captura), no captura si el
  gesto es vertical, `shouldGoBack(60)` es falso y `shouldGoBack(61)` es verdadero.
- `orders.test.ts`: `lockedCollateral` suma `c`; `unrealisedPnl` con un long en ganancia, un short en
  pérdida, mezcla de ambos, posición sin mercado (se ignora) y sin ninguna con mercado (`null`).
- `comingSoon.test.ts`: `COMING_SOON_COPY` cubre exactamente las claves de `COMING_SOON`.

Manual, en el simulador (capturas en el audit):

- Arranque con cuenta → Wallet; arranque sin cuenta (sign out + relanzar) → Sign in → Wallet.
- Market, Activity, Portfolio muestran la pantalla coming soon con el ícono correcto; el header de
  Market no tiene `★`/`Alerts`.
- Jalar en Wallet y en Trade: spinner lime, datos actualizados, spinner se suelta también cuando
  el RPC falla (modo avión).
- Swipe desde el borde en Deposit/Withdraw/perpsMarket regresa; el mismo gesto en Wallet (sin
  `←`) no hace nada.
- Trade con una posición abierta en #620: la línea de PnL coincide con la del `PositionRow`; `b`
  y `c` medidos antes/después (D12).

Cierre: `npx tsc --noEmit` y `npm test` en verde con salida pegada; `npm run agents:check` y
`npm run docs:check` en la raíz.

---

## 5. Fuera de alcance

- Swipe entre tabs (D8), animaciones de transición, react-navigation.
- Build 4 de TestFlight: se registra con su propio tracker cuando Jesús decida el alcance.
- Detección de desfase de reloj, fees con 4 decimales, "Reconnect trading" (lista del build 4).
- Borrar o reescribir el mock de Market/Activity/Portfolio.
