# App móvil Pickler — Rediseño hi-fi: tema, navegación MARKETS, Wallet y Trade re-vestidos

**Fecha**: 2026-09-18
**Estado**: F1 y F2 ejecutadas (planes `docs/superpowers/plans/2026-09-18-mobile-hifi-f1.md`, `docs/superpowers/plans/2026-09-18-mobile-hifi-f2.md`; audits `docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md`, `docs/superpowers/audits/2026-09-18-mobile-hifi-f2-rulings.md`); build 0.1.0 (5) subido a TestFlight el 2026-09-19 (VALID, grupo Equipo; tracker `docs/overview/dev/2026-09-19-testflight-build5.html`)
**Slug**: `mobile-hifi`
**Rama**: `feat/mobile-hifi`, base `main` (`48f82a4`), worktree `.claude/worktrees/mobile-hifi`; F2 en `feat/mobile-hifi-f2`, worktree `.claude/worktrees/mobile-hifi-f2`
**Contexto**: el equipo subió hoy el diseño hi-fi de la app (`jjesusaf/pickler-mobile@a0e353e`,
"Implement Pickler Mobile App hi-fi design", 2026-09-18 22:35 UTC), portado desde el archivo de
Claude Design `Pickler Mobile App.dc.html`. Reemplaza los *wireframes* (`365585e`) que la app adoptó
en `mobile-ui-port`. La app real tiene hoy dos tabs vivos (Wallet y Trade sobre Perpl, con passkey y
tesorería AUSD) y tres en *coming soon*. Jesús pidió dos cosas: **adaptar Wallet y Trade al diseño
nuevo sin perder lo que ya funciona**, y **traer el resto de la UI nueva manteniendo el coming soon**.
Quedan 25 días para el bounty (13 oct 2026, 21:59 CST); la lista pendiente al build 5 de TestFlight
(reloj, fees, "Reconnect trading") se absorbe aquí porque toca las mismas pantallas.

---

## TL;DR

1. **Tema nuevo** (tokens, gradiente azul con estrellas, Chakra Petch para display, lucide) en toda
   la app. Cuatro dependencias nuevas; rebuild nativo, que ya es nuestro flujo.
2. **Tab bar del hi-fi**: MARKETS · LAUNCHPAD · ACTIVITY · PORTFOLIO · WALLET. **No hay tab Trade**:
   MARKETS absorbe todo Perpl (saldo de trading, fondos, mercados, posiciones) y cada mercado abre
   `Market` con pills Ask · **Trade** · Agents, donde Trade es nuestro ticket real.
3. **Wallet conserva todo lo real** (deposit/withdraw, movimientos, testnet, sesión) con el look nuevo.
4. **Coming soon** en Launchpad, Activity, Portfolio y en los pills Ask/Agents.
5. **El mock del wireframe se borra** (Jesús lo aprobó): el hi-fi lo reemplaza.
6. **Tres fixes del 17 sep** entran: desfase de reloj, fees a 4 decimales, *Reconnect trading*.
7. Dos fases con checkpoint; al cierre, build 5 de TestFlight.

---

## 1. Decisiones que fija este spec

| # | Decisión | Valor | Por qué |
|---|---|---|---|
| D1 | Dónde vive Perpl | **Tab MARKETS** = la pantalla Perps actual re-vestida (card de saldo de trading, Add funds / Withdraw to wallet, lista de mercados, posiciones, gate Enable/Reconnect). Tocar un mercado abre `market` con pills **Ask · Trade · Agents**; Trade es el ticket real; Ask y Agents muestran una tarjeta *coming soon* inline. Portfolio es coming soon completo. | Jesús eligió esta opción: todo Perpl en un lugar, sin partir la lógica real en dos tabs. Los mercados del diseño (BTC-PERP, ETH-PERP, MON-PERP) *son* mercados de Perpl. |
| D2 | Ticket de Trade | **Nuestro ticket real con el look del hi-fi**: Long/Short, monto AUSD con Max, chips de apalancamiento del mercado, KV `NOTIONAL · EST. PRICE · FEE · TAKER · LIQUIDATION ≈`, CTA "Review long · X AUSD", Review, y Sent/Filled/Failed/Unknown como `StatusCard`. **Sin la grilla nivel × horizonte.** | La grilla promete "cierra al horizonte si no toca el target" (reduce-only por tiempo + TP). Perpl nos da orden a mercado; mostrar la grilla sería UI falsa sobre dinero real. |
| D3 | Wallet | **Conservar todo, re-vestido.** Card principal del diseño (`AVAILABLE · AUSD`, address `· CONNECTED`, línea "X AUSD in trading") + Deposit/Withdraw reales con el botón `outline2` del diseño + `MOVEMENTS` con las filas del diseño + secciones `TESTNET` y `SESSION` con las mismas tarjetas. | El hi-fi deja Deposit/Withdraw como placeholders y no contempla MON, faucets ni Sign out; sin ellos no se puede operar ni probar en TestFlight. |
| D4 | Tab bar | `[["markets","MARKETS","chart"],["launchpad","LAUNCHPAD","rocket"],["activity","ACTIVITY","activity"],["portfolio","PORTFOLIO","layers"],["wallet","WALLET","wallet"]]`, iconos lucide, etiqueta mono 9 px `ls .04`, lima al activo, `faint` al resto. Activo = `ROOT_OF[screen] === tab`. | Es la barra del diseño (`src/Shell.js` TABS). |
| D5 | Set de pantallas | `Screen = "markets" \| "market" \| "perpsFunds" \| "launchpad" \| "activity" \| "portfolio" \| "wallet" \| "deposit" \| "withdraw" \| "signin"`. `COMING_SOON = ["launchpad","activity","portfolio"]`. `GATED = ["markets","market","perpsFunds","wallet","deposit","withdraw"]`. `CAN_BACK = ["market","perpsFunds","deposit","withdraw","signin"]`. `SHOW_TABS = ["markets","launchpad","activity","portfolio","wallet"]`. `ROOT_OF`: `market`/`perpsFunds` → `markets`; `deposit`/`withdraw`/`signin` → `wallet`. | `perps` → `markets` y `perpsMarket` → `market` son renombres; el resto del wireframe desaparece (D6). |
| D6 | Mock del wireframe | **Se borran** `screens/discover.tsx`, `screens/follow.tsx`, `screens/trade.tsx` (token), `PortfolioScreen`/`PositionScreen` de `own.tsx`, `mock/data.ts`, `mock/helpers.ts` (`pill` se muda a `ui/theme.ts`, `money` deja de usarse), y en `store.ts` los campos `agentId`, `tab`, `postId`, `mode`, `phase`, `amount`, `sort`, `sellPct`, `following`, `askCtx`, `dataCase`, `mockHolder`, `resume` (sólo servía a la compra retenida), con `deriveUser`/`deriveTradeHolds`/`deriveBalance`/`holds`/`tradeHolds`/`showAgentBar`/`buying`/`agent`/`post`/`balance`. `assets/pickler-mark.png` (160×160, cuadrado) **se conserva** como logo del header: el `assets/logo.png` del diseño mide 1536×1024 y a 24 px queda ilegible. | Jesús aprobó borrarlo: el hi-fi reemplaza al wireframe y re-vestir UI muerta es trabajo perdido. Git conserva el historial. |
| D7 | Arranque y gestos | `INITIAL.screen = "wallet"`, `bootState`, swipe atrás (`gestures.ts`) y pull-to-refresh (`wallet` → tesorería + movimientos; `markets` → `refreshContext`) **se conservan** tal cual. | Decisiones D3/D5/D7 de `mobile-polish`; nada en el hi-fi las contradice. Desde F2 el `Shell` vuelve al inicio del scroll al cambiar de pantalla (ruling del recorrido de F2). |
| D8 | Tokens de color | `ui/theme.ts` adopta **tal cual** `C` de `pickler-mobile/src/theme.js`: `ink #F5F6FF`, `dim #C3C9E4`, `faint #8891B5`, familia `hair*`, `card*`, `deep*`, `onDeep #05061A`, `slab`, `vio #B9A5FF` / `vioSolid #9B7BFF` / `vioBd*` / `vioBg*`, `lime #C8F03A` / `onLime #0B1200` / `limeBd*` / `limeBg*`, `up = lime`, `down #FF5FA2` / `downBd*` / `downBg`, `warn #FFC93F` / `warnBd` / `warnBg`, `cyan`, `blue`, `spark`, `disabled #5C5C58`, `bgTop #1B1F6B` / `bgMid #0A0B2E` / `bgBottom #05061A`. Los nombres viejos (`mute`, `surf`, `tile`, `chip`, `phone`, `panel`, `hairSoft`, `hairFaint`, `violet`, `violetInk`, `onInk`) desaparecen. `pill(on)` vive aquí. | Portar 1:1 desde el diseño evita inventar equivalencias; el `theme.test.ts` fija los valores. |
| D9 | Tipografía | `textStyle(w, s, { lh, ls, mono, display, color })`. Familias: Manrope 400/500/600/700 (**800 → 700**: el hi-fi no usa ExtraBold y deja de cargarse), JetBrains Mono 400/500/**700**, **Chakra Petch 600/700** (`display`). `fam(weight, kind)` como en el diseño. | Es el `type()` del hi-fi; `display` es lo que distingue títulos y cifras grandes. |
| D10 | Fondo y chrome | `Shell` pinta `Backdrop`: `LinearGradient` `[bgTop, bgMid, bgBottom]` `locations [0, .48, 1]` + `Svg` con `Pattern` de puntos 130×130 (`r=1`, `rgba(255,255,255,.7)`, opacidad .4). Header: círculo `←` 31 px `hair22` si `canBack`, logo 24 px en raíz, título `display 700 16.5`, subtítulo `400 11 faint`, `⚙` sólo `__DEV__` (a la derecha del header, no en una fila de status). **Sin** el reloj falso "9:41". Tab bar `deep50` con `hair` arriba, `paddingBottom 12`. `app.config.ts` `backgroundColor` y `ios.backgroundColor` → `#05061A`; splash sin cambio. | Es el marco del diseño. La fila "9:41 ⚙" es del prototipo; el simulador ya dibuja la hora real. |
| D11 | Dependencias | `expo-linear-gradient` y `react-native-svg` a la versión que resuelva `npx expo install` para SDK 57 (hoy 57.0.2 y 15.15.x), `lucide-react-native 1.47.0` (peer `react-native-svg ^15`), `@expo-google-fonts/chakra-petch 0.4.1`. Sale `@expo/vector-icons`. Pines exactos como el resto del `package.json`. Rebuild: `npx expo run:ios` (pods nuevos). | Las cuatro las usa el diseño; ninguna toca el store ni exige react-navigation. |
| D12 | Primitivas | `ui/primitives.tsx` adopta el vocabulario de `pickler-mobile/src/ui.js` para portar pantallas 1:1: `T` (+`display`), **`Tag` = línea mono mayúscula 9.5 px `ls .1`** (la píldora actual `Tag` pasa a llamarse **`Chip`**), `Card`, `TouchCard`, `KV` (mono 10, `k`/`v`/`vFg`), `KVList`, `Hair`, `Avatar`, `Btn` (variantes `outline`, `outline2`, `outline20`, `lime`, `violet`, `violetSoft`, `violetSoft10`, `violetLine`, `ghost`, `dashed`; props `arrow`, `icon`, `flex`, `disabled`), `Segmented` (`options: [key,label][]`, `value`, `onChange`), `PillTabs`, `Bar`, `Warn`, `StatusCard`, `Screen` (`Screen` se llama **`Page`** en el código desde F2, para no sombrear el tipo `Screen` de D5), `Icon` (lucide: `back arrow search send sliders help chart rocket activity layers wallet`). `Touch`/`TouchCard` aceptan `accessibilityLabel` y `hitSlop`. **No** se portan `Sparkline` ni `SearchBox`. `StatGrid` y `EmptyPanel` se conservan re-vestidos (`card`/`hair14`). | Mismo nombre que el diseño = diff legible contra `ui.js`. `Sparkline`/`SearchBox` sólo sirven a la grilla y a buscadores que no existen. |
| D13 | Markets (raíz) | `screens/markets.tsx` (hoy `perps.tsx`). Orden: card `TRADING · AUSD` (`Tag` + cifra `display 30` + `Chip` de conexión Live/Connecting/Reconnecting/Offline + "{Σc} in positions · {b} free" + línea PnL), avisos (`Warn`: reloj D19, key rechazada, forwarding off), fila `Btn` **Add funds** (`lime`) / **Withdraw to wallet** (`outline2`), `Tag MARKETS` + `TouchCard` por mercado (par `700 14`, "name · up to Nx" `faint`, mark mono `700 13`, 24h `up`/`down`), `Tag POSITIONS` + filas (`Chip` LONG/SHORT, tamaño·lv, PnL mono, "ep → mark · Liq. est."), `Btn Close` `outline`. Cierre de posición: `Card` de confirmación + `OrderResultCard`. Gate `none`/`onboarding`: `Card` **Enable trading** con input `display 26`, mínimos, pasos `ENABLE_STEPS` con `ActivityIndicator`/✓/×, o **Reconnect trading** (D21). Lista de mercados en gate `readOnly` (opacidad .7). | Toda la lógica es la de `perps.tsx`; sólo cambia la piel y el orden de bloques para parecerse a `MarketsScreen` del diseño. |
| D14 | Market (ticket) | `screens/market.tsx` (hoy `perpsMarket.tsx`). Header `[symbol, "Perpl · isolated margin · market order"]`. `PillTabs` **Ask · Trade · Agents** (`S.marketTab`, default `trade`). Ask/Agents → `ComingSoonCard` inline (D17). Trade: `Segmented` Long/Short (lima al long, `down` al short), card `MARGIN · AUSD` con `TextInput` `display 32` + `Chip Max`, "X AUSD free in trading", chips de apalancamiento `pill(on)` (`leveragesFor(market)`), `Card` KV `NOTIONAL` / `EST. PRICE` / `FEE · TAKER` / `LIQUIDATION ≈` (`down` si lv > 1), `Btn` `arrow` "Review long · 25.00 AUSD" (o "Enter a margin" deshabilitado). Review: `Card` con `Tag YOU OPEN`, cifra `display 22`, KV, `Btn lime` "Confirm long" / "Connecting…" deshabilitado si el socket no está `live`, `Btn ghost` "Change amount". Resultado: `StatusCard` con tonos `sent` (`hair2`/`slab`), `filled` (`limeBd`/`limeBg06`), `failed` (`downBd`/`downBg`), `unknown` (`warnBd`/`warnBg`) + `Btn` "Back to Markets" / "Edit". | Es `TradeTab` del diseño sin grilla, con nuestras validaciones (`units + fee ≤ free`, Max con sitio para la fee). |
| D15 | Funds | `screens/perpsFunds.tsx` re-vestido: `StatGrid` Wallet / Trading · free, `Segmented` Add funds / Withdraw, card de monto `display 30` + `Chip Max`, `Card` KV From / To / Network, `Btn lime` Confirm, estados como `StatusCard` con hash tocable. Lógica intacta (`validateFunds`, allowance). | Igual que hoy con las primitivas nuevas. |
| D16 | Wallet, Deposit, Withdraw | `screens/wallet.tsx` (hoy `own.tsx` sin Portfolio/Position). Wallet: `Card` `AVAILABLE · AUSD` + cifra `display 30` + `{shortHash} · CONNECTED` mono `faint` + "Nothing pending." / "N transfers confirming" + `Touch` "X AUSD in trading · Markets" (`nav("markets")`, sólo con `perpl.state.status === "ready"`); fila `Btn outline2` Deposit / Withdraw; `Tag MOVEMENTS` + filas (`600 12.5` kind, `mono 9.5 faint` "SEP 18 14:02 · 0x4d1a…9e02", monto `mono 700 12` `up` si `+`, status `Complete`/`Confirming`/`Reverted` en `up`/`warn`/`down`), errores y vacío como hoy; `Tag TESTNET` + tarjetas MON (gas) / Your address + `Btn lime` Get test AUSD / `Btn outline2` Get test MON · copies address + aviso RPC/notice/error; `Tag SESSION` + `Chip` Lock / Sign out. Deposit y Withdraw: mismas máquinas de estado (`WithdrawStep`), cajas `deep` con borde `hair`, cifra `display 30`, `Btn lime` primario, KV mono. | D3. El copy "Nothing has ever arrived in this wallet." y el `MonadScan` como historial siguen. |
| D17 | Coming soon | Pantalla completa (`launchpad`, `activity`, `portfolio`): disco 72 px `card` con borde `vioBd40`, icono lucide del tab en `vio` 30 px, título `display 700 22`, `Chip` **COMING SOON** `dashed` lima, copy `dim 13` centrado, `Btn outline` "Go to Wallet". Copy: Launchpad → "Agents with a token"; Activity → "What the agents you follow are doing"; Portfolio → "Tokens · Perps · Reads". `COMING_SOON_COPY` alimenta también el subtítulo del header ("Coming soon") y la `ComingSoonCard` inline de Ask ("Ask an agent for a read on this market") y Agents ("Who trades and who reads this market"). | Mantiene el patrón del polish con la estética nueva; subtítulos derivados del mapa (minor del audit). |
| D18 | Sign in | `screens/signin.tsx` (hoy en `trade.tsx`). Header `["Wallet access", "Passkey on this device"]`. Con `S.next` distinto de `wallet` (el gate retuvo Markets, Funds, Deposit o Withdraw): `Card` `vioBd45`/`vioBg08` "We kept what you were about to do" + la acción retenida ("Trading on Perpl", "Moving trading funds", "A deposit", "A withdrawal"). Copy del diseño: "Reading and following never need an account. The wallet appears the first time money moves." y "Connecting is not signing. Every operation is confirmed on its own." Botones `Btn lime` Create / `Btn outline` Sign in con passkey (lógica `useUnlock`/`useAccount` intacta). | Quita el copy heredado "One step, then back to your purchase" y adopta el gate del hi-fi. |
| D19 | Fix reloj | `fetchContext` devuelve además `serverTime: number \| null` leído del header `Date` de `GET /v1/pub/context` (`res.headers.get("date")`); `usePerpl` guarda `clockSkewMs = serverTime − Date.now()` en cada refresh (`null` si no hay header). Con `|clockSkewMs| > 20_000` Markets muestra `Warn` "Your phone's clock is off by N s. Perpl rejects signatures more than 30 s off — turn on *Set automatically* in Settings › General › Date & Time." y el aviso de `keyRejected` pasa a "Trading key rejected. Check the phone clock first; if it is right, Perpl may not be available in your region." (en el código el aviso lleva título «Trading key rejected» y `KEY_REJECTED_COPY` es sólo el cuerpo, desde F2; `serverTime` suma el header `Age` del CDN) con los mismos botones Reset trading key / Open Perpl. | Causa real de los dos `3401` en el iPhone de Jesús (audit polish). El umbral 20 s deja margen bajo el ±30 s del servidor. |
| D20 | Fix fees | `formatAusd(raw, decimals = 2)`; los KV `FEE · TAKER` (ticket y review), "Fee X AUSD" del resultado y el `detail` del cierre usan `formatAusd(fee, 4)`. Saldos y montos siguen a 2. | "0.00 AUSD" en fees de 0.0005 era ilegible. |
| D21 | Fix Reconnect trading | Con `perpl.state.status === "none"`, `usePerpl` sondea `readAccountId(address)` una vez (y en cada `refreshContext`) y expone `existingAccountId: bigint \| null`. Si `> 0n`, el gate de Markets muestra **Reconnect trading** ("This wallet already has Perpl account #620. Reconnect registers a trading key on this phone; no AUSD moves.") sin input de monto y `Btn lime` **Reconnect** → `perpl.enable(0n)`. `runEnable` con `id ≠ 0` ya salta approve/create (pasos 3–4 solamente); el paso 1 no consulta `walletAusd` cuando hay id. Sign out sigue borrando la key (spec fase 2 §4). | El caso reproducible del simulador (cuenta #620 con 104.87 AUSD y Trade pidiendo 100 AUSD nuevos). |
| D22 | Minors del audit polish | PnL: `|x| < 0.005` → "+0.00" (fila y suma) (en el código de F2 el umbral es un centavo mostrado, `ONE_CENT = 10_000n`: `formatAusd` trunca, así que sólo ese umbral garantiza que nunca salga «−0.00»). `accessibilityLabel` en tabs (`tab-markets`…), filas de mercado (`market-BTC`) y botones primarios. `headerFor` deriva "Coming soon" de `COMING_SOON_COPY`. `resetTo` se elimina del store. `useCallback(onRefresh)` se queda como está (sin efecto en corrección). | Cierran los residuales listados en `2026-09-18-mobile-polish-f1-rulings.md`. |
| D23 | DevControls | Se poda a: saltar a cada pantalla real (`markets`, `market` con el primer mercado, `perpsFunds`, `wallet`, `deposit`, `withdraw`, `signin`, los tres coming soon), estado de sesión (Lock / Sign out), `Reset`. Estilo con `Chip`/`pill`. Sin *holder*, *dataCase* ni fases de token. | Todo lo que controlaba era mock. |
| D24 | Fases | **F1**: D8–D12, D16–D18, D23 y el `Shell` (tema, primitivas, tabs, Wallet/Deposit/Withdraw, Sign in, coming soon, borrado del mock) con Markets/Market/Funds compilando con las primitivas nuevas pero sin re-maquetar. **F2**: D13–D15 (re-maquetado Perpl) + D19–D22 → build 5 de TestFlight (`pickler-dev-new`). | Checkpoint a mitad: F1 se puede mirar en simulador sin tocar dinero; F2 concentra lo que exige cuenta #620 y iPhone real. |
| D25 | Fuera de alcance | Grilla nivel × horizonte, reads (Ask/Confirm/Read/Follow-up/Result), Launchpad y compra de tokens, Portfolio real, Follow, Android, animaciones de transición, react-navigation. | 25 días; nada de esto tiene backend. |

---

## 2. Unidades

### 2.1 `src/ui/theme.ts` — se reescribe (D8, D9)

- `C` con los tokens del diseño; `F` con las nueve familias; `fam(weight, kind?: "mono" | "display")`;
  `textStyle(w, s, opts)`; `pill(on): { bd, bg, fg }`.
- Test `theme.test.ts`: `fam(800)` → `Manrope_700Bold`; `fam(700, "mono")` → `JetBrainsMono_700Bold`;
  `fam(600, "display")` → `ChakraPetch_600SemiBold`; `textStyle(700, 16.5, { display: true, ls: -0.01 })`
  → `{ fontFamily: "ChakraPetch_700Bold", fontSize: 16.5, color: "#F5F6FF", letterSpacing: -0.17 }`;
  `C.bgBottom === "#05061A"`, `C.down === "#FF5FA2"`.

### 2.2 `src/ui/primitives.tsx` — se reescribe (D12)

Una función por primitiva, sin estado. `Btn` recibe `label`, `onPress`, `variant`, `arrow`, `icon`,
`s`, `py`, `flex`, `disabled`, `fg`, `bd`, `accessibilityLabel`. `Segmented` deja de recibir estilos por
opción: `options: readonly [string, string][]`, `value`, `onChange`, opcional `tone?: (key) => { bg, fg }`
para el Long/Short de D14. `Icon` mapea nombre → componente lucide.

### 2.3 `src/Shell.tsx` — se reescribe (D4, D10)

- `Backdrop`, header, `ScrollView` con `RefreshControl` (`refreshable = screen ∈ {wallet, markets}`),
  `PanResponder` como hoy, tab bar con `ROOT_OF`, `DevControls` en `__DEV__`.
- `SCREENS: Record<Screen, …>` con las diez pantallas de D5.

### 2.4 `src/store.ts` — se reduce (D5, D6, D7, D22)

- `StoreState`: `screen`, `stack`, `next`, `nextPatch`, `perpsMarketId`, `perpsSide`,
  `fundsMode`, `marketTab: "ask" | "trade" | "agents"`.
- Listas `COMING_SOON`, `GATED`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF` (D5). `requireAccountState` pierde el
  caso `buying` (`next = target` siempre). `headerFor(screen, balance, perpsSymbol)` con los títulos:
  `markets` → `["Markets", "Perps on Perpl · Monad"]`; `market` → `[symbol + " Perp", "Perpl · isolated margin · market order"]`;
  `perpsFunds` → `["Trading funds", "Between wallet and trading"]`; `wallet` → `["Wallet", "AUSD available and movements"]`;
  `deposit` → `["Deposit AUSD", "Monad network"]`; `withdraw` → `["Withdraw AUSD", "To an external address"]`;
  `signin` → `["Wallet access", "Passkey on this device"]`; coming soon → `[COMING_SOON_COPY[k].title, "Coming soon"]`.
- `AppStore` pierde `agent`, `post`, `holds`, `tradeHolds`, `buying`, `showAgentBar`, `resetTo`, `user`.
- Test `store.test.ts` se reescribe contra el set nuevo (gates, coming soon, back, boot, sign out, header).

### 2.5 `src/screens/` — resultado final

`markets.tsx` (D13), `market.tsx` (D14), `perpsFunds.tsx` (D15), `wallet.tsx` con `WalletScreen`,
`DepositScreen`, `WithdrawScreen` (D16), `signin.tsx` (D18), `comingSoon.tsx` + `comingSoonCopy.ts`
(`ComingSoonScreen`, `ComingSoonCard`, `COMING_SOON_COPY` con `icon` lucide) (D17). Se borran
`discover.tsx`, `follow.tsx`, `trade.tsx`, `own.tsx`, `perps.tsx`, `perpsMarket.tsx`.
`OrderResultCard` vive en `market.tsx` y lo importa `markets.tsx` (como hoy).

### 2.6 `src/perpl/context.ts`, `src/hooks/usePerpl.ts` — se amplían (D19, D21)

- `Context` gana `serverTime: number | null` (ms desde epoch, `Date.parse(res.headers.get("date"))`;
  `null` si el header falta o no parsea). `parseContext(body)` no cambia; `fetchContext` lo completa.
  El test usa un `fetch` falso que devuelve el header `date`.
- `Perpl` gana `clockSkewMs: number | null` y `existingAccountId: bigint | null`; `enable(0n)` permitido
  sólo cuando `existingAccountId > 0n` (si no, el gate no lo ofrece).
- Tests: `perpl-context.test.ts` (header presente / ausente / inválido), `perpl-enable.test.ts`
  (con `readAccountId → 620n` y `amount 0n`: no llama `walletAusd`, `approve` ni `createAccount`; sí
  `isForwarding` y `loadKey`).

### 2.7 `src/config/chain.ts` — se amplía (D20)

`formatAusd(raw, decimals = 2)`; test con `formatAusd(500n, 4) === "0.0005"` y `formatAusd(500n) === "0.00"`.

### 2.8 `App.tsx`, `app.config.ts`, `package.json` (D9–D11)

Carga de fuentes nueva (Manrope 4, JetBrains 3, Chakra 2); `PERPL_SCREENS = ["markets","market","perpsFunds"]`;
`backgroundColor #05061A`; dependencias de D11.

---

## 3. Verificación

- `npm test` y `npx tsc --noEmit` en verde en cada fase, con salida pegada en el audit.
- **F1**: capturas en simulador de Wallet (con y sin movimientos), Deposit, Withdraw (edit/review),
  Sign in (con y sin `resume`), los tres coming soon y Markets/Market compilando con el tema nuevo.
  Fuente Chakra Petch visible en títulos; gradiente y puntos visibles; tab activa en lima.
- **F2**: en simulador con la cuenta #620: Reconnect trading (D21) desde estado `none`; ticket con
  fee a 4 decimales; abrir y cerrar una posición pequeña; skew forzado (reloj del simulador ±2 min)
  muestra el `Warn` y el copy nuevo de `keyRejected`. En el iPhone de Jesús: mismo recorrido con su
  cuenta real. Todo con capturas antes/después y saldos re-medidos por RPC en el audit.
- Antes de cerrar cada fase: revisión independiente por subagente con requisitos, diff y evidencia
  (regla global), `npm run agents:check` y `npm run docs:check`.

---

## 4. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| `react-native-svg` / `expo-linear-gradient` exigen pods nuevos; el archive de TestFlight usa `scripts/ios-archive.sh`. | F1 corre `npx expo run:ios` y deja el pod install en el audit; el script de archive no cambia. |
| `lucide-react-native` renderiza vía SVG; iconos a 19–30 px en tab bar y coming soon. | Tamaños fijados en D4/D17; si un glifo se ve delgado se sube `strokeWidth` a 2.2 (decisión del plan). |
| Renombrar `Tag`→`Chip` toca todas las pantallas. | Ocurre en F1 junto con el borrado del mock; `tsc` detecta cualquier uso viejo. |
| El header `Date` puede faltar detrás de un CDN o venir redondeado a segundos. | `serverTime: null` desactiva el aviso; umbral de 20 s absorbe el redondeo. Cloudflare cachea `pub/context` 10 s: se suma `Age`. |
| `enable(0n)` con `existingAccountId` desfasado (cuenta creada desde otro dispositivo justo antes). | `runEnable` relee `readAccountId` en el paso 1; si es 0 con amount 0 falla con "Enter an amount" y el gate vuelve a Enable. |
