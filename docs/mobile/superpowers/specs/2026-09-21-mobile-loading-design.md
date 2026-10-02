# App móvil Pickler — Carga visible: skeletons por sección, sello «Updated» al jalar y splash con la marca

**Fecha**: 2026-09-21
**Estado**: F1 ejecutada (plan `2026-09-21-mobile-loading-f1.md`, audit `2026-09-21-mobile-loading-f1-rulings.md`); rama `feat/mobile-loading` lista para merge local. `expo-splash-screen` quedó en `~57.0.9`; `setOptions` existe en esa versión (D7 sin marca, se mantuvo tal cual).
**Slug**: `mobile-loading`
**Rama**: `feat/mobile-loading`, base `main` local (`4be010c`), worktree `.claude/worktrees/mobile-loading`
**Contexto**: en el build 6 de TestFlight (2026-09-21) la app abre con un splash **en blanco** (el storyboard
nativo apunta a una imagen `SplashScreenLogo` que no existe y usa el fondo del sistema; `expo-splash-screen`
no está instalado), cada sección con datos remotos muestra un texto «Loading…» o un `ActivityIndicator`
suelto, y el jalón de pull-to-refresh (Wallet, Markets, Market) sí vuelve a pedir los datos pero no deja
rastro visible de que algo se actualizó. Jesús pidió tres cosas: skeletons desde que carga la app, que el
jalón «se note», y un splash con el logo. Faltan 22 días para el bounty (13 oct 2026, 21:59 CST).

---

## TL;DR

1. **Skeleton por sección**: cada card o lista con datos remotos pinta su propio skeleton mientras su dato
   sea `null` y no haya error; cabecera, pills y tabs se ven desde el primer frame; las secciones «cuajan»
   una a una. Una sección con dato **nunca vuelve** a skeleton.
2. **Pull-to-refresh estándar iOS**: el dato viejo se queda, gira el spinner lima y, al resolver, la pantalla
   muestra un sello **`UPDATED HH:MM:SS`** bajo la cabecera. Si todo falló, `Couldn't refresh` 3 s y se
   conserva el sello anterior.
3. **Splash nativo con la P lima** centrada sobre `#05061A` (`expo-splash-screen`), oculto por la app cuando
   la cuenta local ya se resolvió; el fondo es el mismo, así que no hay salto.

## 1. Alcance

| Dentro | Fuera |
|---|---|
| Primitiva `Skeleton` en `src/ui/primitives.tsx` | Android (sin build) |
| Skeletons en Wallet, Markets, Market (Trade · Ask · Agents) | Launchpad, Activity, Portfolio (coming soon, sin datos), Sign in |
| Sello `UPDATED` por pantalla en `Shell.tsx` | Skeleton durante el jalón (regla A, rechazada en el brainstorm) |
| `reads.reads: Read[] \| null` | Transiciones más allá de un fade de 150 ms |
| `expo-splash-screen` + `assets/splash-mark.png` + hide controlado | Rediseño del icono o del storyboard a mano |

## 2. Decisiones

| # | Decisión | Detalle |
|---|---|---|
| D1 | **Primitiva `Skeleton`** | En `src/ui/primitives.tsx`: bloque con `borderRadius` 8, color `C.hair`, pulso de opacidad 0.45 → 1 en 900 ms con `Animated.loop` **compartido** (un solo `Animated.Value` a nivel de módulo, arrancado en el primer montaje y detenido cuando no queda ningún skeleton montado). Formas: `Skeleton.Line` (`h` = alto de texto por `s`, `w` = ancho en % o pt), `Skeleton.Card` (card `C.card`/`C.hair` con `lines` líneas), `Skeleton.Row` (fila de lista: título + valor a la derecha). Sin dependencias nuevas. |
| D2 | **«Sin dato todavía» = `null`** | Contrato ya vigente en los hooks: `treasury.balances`, `treasury.movements`, `perpl.context`, `perpl.live`, `reads.credits`, `reads.agents` arrancan en `null`. **`reads.reads` pasa de `[]` a `Read[] \| null`** (`useReads.ts:49`; los `setReads([])` de reset pasan a `null`; `readDots`, `focused` y My reads reciben `reads ?? []`). Regla única por sección: `dato === null && !error` → skeleton; `error` → la `Warn`/card de error existente; dato → contenido. |
| D3 | **Secciones** | Wallet: card de saldos (`Skeleton.Card` 2 líneas: cifra grande + línea), card de trading (`perpl.live === null` en `ready`), movimientos (`Skeleton.Row` × 3, sustituye «Loading movements…»). Markets: card `TRADING · AUSD` (`live === null`), lista de mercados (`Skeleton.Row` × 6, sustituye «Loading markets…»), posiciones (sólo si `live === null`). Market · Trade: mark y funding del ticket (`Skeleton.Line` en los valores mientras `context === null`). Market · Ask: fila de créditos (`credits === null`), matriz completa (`MatrixGrid` recibe `loading` y pinta la grilla en `C.hair` con la sparkline vacía mientras `context === null`). **(F1)** `MatrixGrid` no cambia: sin `context` no hay `market`, así que Market entero pinta `MarketSkeleton` (pills + card + 5 filas) — P2 del plan F1. **(F1)** Wallet, línea «in trading»: `perpl.live === null` NO es «cargando» ahí — el socket de Perpl sólo corre en `PERPL_SCREENS` (Markets/Market/perpsFunds), nunca en Wallet, y `lastBalance` no persiste, así que el skeleton quedaba permanente (C1 de la revisión final). La decisión vive en el helper puro `tradingLineState(live, lastBalance, socketActive)` → `"live" \| "lastSeen" \| "skeleton" \| "unknown"` (`store.ts`, con test): Wallet pasa `socketActive=false` y pinta «— AUSD in trading · Markets» (mismo `Touch`) sin dato; Markets pasa `true` y sí pinta skeleton mientras conecta. También en Market · Ask: chips de agentes (`agents === null`: 3 chips), My reads (`reads === null`: `Skeleton.Card` × 2). Market · Agents: `Skeleton.Card` × 3. |
| D4 | **Fade** | Al pasar de skeleton a contenido, el contenido entra con `Animated` opacity 0 → 1 en 150 ms (wrapper `Reveal` en primitives). Nada más. **(F1)** Toda transición skeleton→contenido pasa por `Reveal`, incluidas cifras escalares (créditos, saldos de Wallet/Markets, `TRADING · AUSD`) y estados vacíos («No reads on {symbol} yet.», posiciones/agents sin datos) — ruling de las revisiones de Tasks 3 y 4, que el spec manda por encima de los snippets literales del plan. |
| D5 | **Sello `UPDATED`** | `Shell.tsx` guarda `updatedAt: Partial<Record<Screen, number>>` en estado local. `onRefresh` lo fija con `Date.now()` cuando **al menos una** promesa del `allSettled` cumplió; si **todas** fallaron, muestra `Couldn't refresh` en `C.down` durante 3 s y conserva el sello anterior. La carga inicial también lo fija (primer `refresh` exitoso de la pantalla), para que el sello exista siempre que haya dato. Se pinta en `Shell` bajo la cabecera de la pantalla, mono 9.5, `C.faint`, formato `UPDATED HH:MM:SS` (hora local, 24 h). Un solo sello por pantalla, no por card. Formato en una función pura `updatedLabel(ts: number): string` en `src/store.ts` con test. **(F1)** `refreshFailed` es `Screen \| null`, no un booleano global: un jalón fallido en Wallet no debe pintar `COULDN'T REFRESH` en Markets si el usuario cambia de pantalla dentro de la ventana de 3 s — ruling de la revisión de Task 5. |
| D6 | **Splash nativo** | Dependencia nueva `expo-splash-screen` (versión de la tabla del SDK 57, `npx expo install`). Plugin en `app.config.ts`: `{ image: "./assets/splash-mark.png", imageWidth: 140, resizeMode: "contain", backgroundColor: "#05061A" }`. `assets/splash-mark.png`: la P lima recortada de `assets/icon.png` a 720 × 720 con fondo transparente (se genera en la ejecución con `sips`/PIL y se mira). `prebuild --clean` regenera el storyboard; el archive ya lo hace. |
| D7 | **Hide controlado** | En `App.tsx`: `SplashScreen.preventAutoHideAsync()` a nivel de módulo; `SplashScreen.hideAsync()` en un efecto cuando `account !== null` (`useAccount` arranca en `null` y su primer efecto lo resuelve a `none`/`locked`, `useAccount.ts:14`). Timeout de seguridad: `hideAsync()` a los 2 s pase lo que pase. `setOptions({ fade: true, duration: 200 })` si la API del SDK 57 lo expone. |
| D8 | **Verificación** | Tests puros: `updatedLabel`, `Skeleton` no se prueba (UI, P12 de F2 de Ask), `useReads` con `reads: null` → `readDots([])` y lista vacía sin crash (test de composición pura si existe; si no, `tsc`). Pantallas: `tsc` + simulador con capturas de **cada** sección en skeleton (arranque en frío con `PICKLER_READS_URL` inválida para Ask/Agents y el RPC tardando; para Perpl, el primer frame tras el launch), del sello tras un jalón, y de `Couldn't refresh` con modo avión. Splash: captura del primer frame tras `prebuild --clean` + `run:ios`. Sin build de TestFlight salvo petición. **(F1)** Capturado: skeleton de Wallet (saldo + movimientos), skeleton de créditos en Ask, sello `UPDATED` tras dos jalones consecutivos, splash nativo. No capturado: 6 filas de skeleton de Markets, `MarketSkeleton` de Market, chips de agentes en skeleton, `Warn` de Ask por timeout y `COULDN'T REFRESH` — el `perpl.context` y `reads` reales de este entorno resuelven en menos de 1 s contra producción, más rápido que cualquier ciclo de automatización disponible. Hallazgo: el truco de reiniciar Metro con `PICKLER_PERPL_REST`/`PICKLER_PERPL_WS`/`PICKLER_READS_URL` (P10 del plan) **no** llega a `Constants.expoConfig` en este dev client instalado (el config queda resuelto en el build nativo, no en el manifest dinámico que Metro sirve por HTTP); hace falta un rebuild (`run:ios`), no un relanzamiento. Detalle completo en el audit F1 (`docs/superpowers/audits/2026-09-21-mobile-loading-f1-rulings.md`). |

## 3. Flujo de arranque (referencia)

```
launch → splash nativo (P sobre #05061A)
      → JS: useAccount resuelve locked/none  → hideAsync (≤ 2 s)
      → pantalla con cabecera + skeletons por sección
      → treasury.refresh / perpl.refreshContext / reads.refresh responden en su orden
      → cada sección: fade 150 ms al contenido; Shell fija UPDATED en el primer éxito
pull  → spinner lima, dato viejo visible → UPDATED HH:MM:SS  |  Couldn't refresh (3 s)
```

## 4. Riesgos

| Riesgo | Mitigación |
|---|---|
| `expo-splash-screen` en SDK 57 cambió API (`setOptions`, plugin) | Leer `https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/` antes del plan (regla de `apps/mobile/AGENTS.md`); el plan cita la versión instalada. |
| `reads.reads: null` rompe un consumidor no listado | `tsc` lo señala; D2 enumera los tres usos conocidos (`ask.tsx:224/246/281-282`). |
| Splash que no se oculta (`loadStoredAccount` nunca resuelve) | Timeout de 2 s (D7). |
| Pulso animado con muchos skeletons a la vez (matriz) | Un solo `Animated.Value` compartido (D1); la matriz usa un bloque por fila, no por celda. |

## 5. Fases

Una sola fase (**F1**): D1–D8 completas, con audit al cierre. `ios/` no está versionado (`.gitignore`), así que
el splash sólo toca `app.config.ts`, `package.json`/lock y `assets/`; el storyboard lo regenera `prebuild`.
