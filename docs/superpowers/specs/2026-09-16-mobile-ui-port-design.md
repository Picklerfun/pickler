# App móvil Pickler — Port de la UI de `pickler-mobile`

**Fecha**: 2026-09-16
**Estado**: aprobado por Jesús (diseño en chat), pendiente de plan
**Slug**: `mobile-ui-port`
**Contexto**: cierre de fase 1 (`docs/05-handoff-fase1.md`). Antes de la fase 2
(Perpl) la app adopta la UI completa del prototipo `jjesusaf/pickler-mobile`,
que implementa los *Pickler Mobile Wireframes*.

---

## TL;DR

Se reemplaza la app de dos pantallas (`Welcome`, `Home`) por las **13 pantallas del
prototipo `pickler-mobile`**, portadas a TypeScript dentro de `apps/mobile/src`. El
flujo real que ya funciona (passkey, saldos AUSD/MON, faucet, Lock, Sign out) se
inyecta en **tres pantallas**: *Wallet access*, *Wallet* y *Deposit*. Todo lo demás
queda idéntico al prototipo, con sus datos de ejemplo. **Solo UI: no se agrega
funcionamiento nuevo.**

---

## 1. Decisiones que fija este spec

| Decisión | Valor | Por qué |
|---|---|---|
| Modelo de acceso | **El de la UI**: la app abre en *Market*; Market, Search, Agent, Activity, Post y Ask no piden cuenta. *Wallet access* aparece al tocar Wallet, Portfolio o Buy sin cuenta. | Es el producto dibujado ("leer y seguir nunca requieren wallet"). Jesús lo eligió el 2026-09-16. |
| Saldos y faucet | Dentro de la pantalla **Wallet**, en un bloque *TESTNET* debajo de Deposit/Withdraw. Lock/Sign out en una fila *SESSION* al final. | La UI no tiene sitio para MON, faucet ni sesión; Jesús pidió meterlos en Wallet. |
| Panel "Prototype controls" (⚙) | Se conserva **solo con `__DEV__`**. Sus botones de *user state* ya no gobiernan cuenta ni saldo (siempre reales); solo `holder` sigue activando las posiciones de ejemplo. Se quita la barra falsa "9:41". | Sirve para llegar a pantallas sin entrada real todavía (9 estados de compra, post detail). En TestFlight no aparece. |
| Lenguaje | **TypeScript** (`.ts`/`.tsx`), tipos ligeros para store, contexto de pantalla y primitivas. | `tsc --noEmit` limpio es parte de la verificación del repo; los tipos del contexto (agente, saldo, fase) evitan errores al conectar datos reales en fase 2. |
| Navegación | Máquina de estados con back-stack, **como el prototipo**. Sin react-navigation. | Cambiarla rompe el "idéntico" y no aporta nada ahora. |
| Copy | Idéntico al prototipo salvo **una línea**: se quita el párrafo "Dependency: whether access is email, passkey or an external wallet is not decided" de *Wallet access*. | Esa decisión ya está tomada (passkey vía Mera). |
| Ícono, bundle id, rpId, passkeys | **No se tocan.** | Fuera del alcance. |

**Lo que este spec NO decide:** venue (Perpl vs Polymarket), trades reales,
posiciones reales. Ver `docs/04-roadmap-bounty.md`.

---

## 2. Estado y navegación

Tres unidades, cada una con una responsabilidad:

### 2.1 `useAccount` — `src/account/useAccount.ts`

Extraído de `App.tsx` **sin cambiar lógica**:

- Al arrancar carga la cuenta guardada (`loadStoredAccount`) sin gate biométrico.
- Expone `account: AccountState | null` (`null` = cargando; `none` / `locked` /
  `unlocked`) y las acciones `onWallet(wallet)`, `lock()`, `signOut()`.
- Mantiene la regla actual: al salir del estado `unlocked` se llama
  `wallet.session.end()`.

### 2.2 `useTreasury(address)` — `src/wallet/useTreasury.ts`

Extraído de `Home.tsx` **sin cambiar lógica**:

- `balances: { ausd, mon } | null`, `rpcError`, `refresh()`.
- `getTestAusd()`: refresca saldos, exige MON > 0, desbloquea con Face ID si la
  cuenta está `locked` (y avisa a `useAccount` vía `onUnlock`), manda la tx al
  faucet, espera el recibo y refresca. `busy`, `notice` (con hash) y `error`.
- Con `address` indefinida (sin cuenta) no consulta nada y devuelve `balances: null`.

### 2.3 `useAppStore(input)` — `src/store.ts`

Portado de `store.js` y tipado. Recibe `{ account, ausd }` y devuelve el contexto
que consumen `Shell` y las pantallas.

Estado propio (idéntico al prototipo): `screen`, `stack` (máx. 8), `agentId`,
`tab`, `postId`, `mode`, `phase`, `amount`, `sort`, `sellPct`, `following`,
`resume`, `askCtx`, `dataCase`, y un `mockHolder: boolean` que sustituye al
`user` ficticio.

Derivados que **dejan de ser ficticios**:

| Derivado | Valor |
|---|---|
| `hasAccount` | `account.status !== "none"` |
| `user` | sin cuenta → `"new"`; con cuenta → `mockHolder ? "holder" : "funded"` |
| `balance` | AUSD real como número (6 decimales); `0` si no hay cuenta o no cargó |
| `address` | la real, o `undefined` |
| `holds` / `tradeHolds` | como el prototipo, calculados a partir de `user` |

`nav(screen, patch)` y `back()` no cambian. Se añade `next?: Screen` al estado:
lo fija `requireAccount` y lo consume *Wallet access*.

### 2.4 Gate de acceso — `requireAccount(target, patch)`

Función del store. Si `hasAccount`, equivale a `nav(target, patch)`. Si no,
`nav("signin", { next: target, resume: target === "trade" })` y guarda `patch`
para aplicarlo al llegar.

Quién la usa:

- Tab bar: **Wallet** y **Portfolio**.
- Barra del agente: **Buy** (el prototipo ya manda a `trade` con
  `phase: balance === 0 ? "insufficient" : "quote"`; ahora `balance` es real).
- Panel de dev: saltar a `wallet`, `portfolio`, `position`, `deposit`,
  `withdraw` sin cuenta pasa por el gate también.

Market, Search, Agent, Activity, Post y Ask **nunca** piden cuenta.

---

## 3. Las tres pantallas que tocan lo real

### 3.1 Wallet access (`signin`)

- Layout idéntico: tarjeta violeta "Your purchase is being held" solo si
  `resume`, texto explicativo, dos botones.
- "Create a wallet" → `createAccount()`. "I already have one" → `signIn()`.
  Spinner en el botón en curso, ambos deshabilitados mientras corre, error
  debajo con `describeError` (misma regla que `Welcome`: cancelación biométrica
  no es error).
- Éxito → `onWallet(wallet)` y `nav(next ?? "wallet", patchGuardado)`. Si venía
  de una compra sin saldo, `next` es `deposit` con `resume: true`, como el
  wireframe.
- Se elimina el párrafo "Dependency: …" (ver §1).

### 3.2 Wallet (`wallet`)

De arriba abajo:

1. Tarjeta "Available to spend" con **AUSD real** (`formatAusd`); mientras carga,
   "—". El texto de *pending* queda como en el prototipo (ejemplo).
2. Botones Deposit / Withdraw, idénticos.
3. **Bloque nuevo `TESTNET`** (etiqueta mono como `MOVEMENTS`, tarjetas con el
   estilo de la UI):
   - `MON (gas)` con su valor (`formatMon`) o "—".
   - Botón primario "Get test AUSD" (`getTestAusd`, spinner con `busy`).
   - Botón secundario "Get test MON" (abre `MON_FAUCET_URL`).
   - Botón secundario "Refresh".
   - Aviso de tx (`notice`, tocable → `EXPLORER_TX_URL(hash)`) o `error` /
     `rpcError` con botón "Retry".
4. Lista `MOVEMENTS` con los movimientos de ejemplo, idéntica.
5. **Fila nueva `SESSION`**: "Locked" / "Unlocked"; botón "Lock" solo si
   `unlocked`; botón "Sign out". Sign out → `signOut()` y `nav("market")` con
   stack vacío.

### 3.3 Deposit (`deposit`)

- Idéntico, con la **dirección real** completa en mono.
- "Copy address" → `Clipboard.setStringAsync(address)` y **se queda** en la
  pantalla (en el prototipo navegaba a `trade`; eso era atajo de demo).
- "I've sent it" mantiene la navegación del prototipo
  (`trade`, `phase: "quote"`, `resume: true`).
- El cuadro punteado "QR code · deposit address" queda como placeholder.

### 3.4 Todo lo demás

Market, Search, Agent, Trade (9 estados con cotización de ejemplo), Activity,
Post, Ask, Portfolio, Position, Withdraw: **idénticos** al prototipo, datos de
ejemplo intactos.

---

## 4. Archivos

### 4.1 Nuevos en `apps/mobile/src`

| Archivo | Origen | Contenido |
|---|---|---|
| `ui/theme.ts` | `theme.js` | Tokens `C`, fuentes `F`, `fam()`, `type()`. Reemplaza la paleta actual. |
| `ui/primitives.tsx` | `ui.js` | `T`, `Touch`, `Tag`, `Hair`, `StatGrid`, `KV`, `Avatar`, `Segmented`, `EmptyPanel`, `TouchCard`. |
| `mock/data.ts` | `data.js` | `AGENTS`, `POSTS`, `KINDS`. |
| `mock/helpers.ts` | `helpers.js` | `money`, `quoteFor`, `sellQuoteFor`, `pill`. (`balanceFor` desaparece: el saldo es real.) |
| `store.ts` | `store.js` | §2.3 y §2.4. |
| `account/useAccount.ts` | `App.tsx` | §2.1. |
| `wallet/useTreasury.ts` | `screens/Home.tsx` | §2.2. |
| `Shell.tsx` | `Shell.js` | Header, cuerpo, barra del agente, tab bar. Sin barra "9:41". Monta `DevControls` solo si `__DEV__`. |
| `DevControls.tsx` | `Shell.js` (ControlsModal) | Panel ⚙: `mockHolder`, agente sin historial, `dataCase`, pantallas, estados de compra, journeys. |
| `screens/discover.tsx` | `discover.js` | Market, Search, Agent. |
| `screens/trade.tsx` | `trade.js` | Trade, Wallet access (§3.1). |
| `screens/follow.tsx` | `follow.js` | Activity, Post, Ask. |
| `screens/own.tsx` | `own.js` | Portfolio, Position, Wallet (§3.2), Deposit (§3.3), Withdraw. |
| `assets/pickler-mark.png` | igual | Marca del header en Market. |

`App.tsx`: carga de fuentes (`useFonts`, spinner lima mientras tanto),
`useAccount`, `useTreasury`, `useAppStore`, `Shell`. `SafeAreaProvider` y
`StatusBar` como hoy.

### 4.2 Se borran

`screens/Welcome.tsx`, `screens/Home.tsx`, `ui/Button.tsx`, `ui/Field.tsx`.
La paleta vieja de `ui/theme.ts` se sustituye por completo.

### 4.3 Dependencias (versiones fijas, como el resto del `package.json`)

| Paquete | Versión |
|---|---|
| `expo-font` | 57.0.4 |
| `@expo-google-fonts/manrope` | 0.4.2 |
| `@expo-google-fonts/jetbrains-mono` | 0.4.1 |

`expo-font` es módulo nativo: tras instalar, `npx pod-install` (o el
`expo run:ios` que lo hace) y rebuild.

### 4.4 `app.config.ts`

Se agregan `userInterfaceStyle: "dark"`, `backgroundColor: "#08080A"` (raíz e
`ios`) y el plugin `"expo-font"`. Nada más cambia.

---

## 5. Tipos mínimos

- `Screen`: unión de los 13 ids (`"market" | "search" | … | "withdraw"`).
- `Phase`: los 9 estados de compra. `Mode`: `"buy" | "sell"`. `UserKind`:
  `"new" | "funded" | "holder"`. `DataCase`: `"normal" | "loading" | "empty" | "stale"`.
- `Agent`, `Post` según `data.js` (campos tal cual).
- `StoreState` (estado propio) y `AppCtx` (lo que devuelve `useAppStore`, más
  `account`, `treasury` y las acciones de cuenta). Las pantallas reciben `AppCtx`.
- Primitivas: props explícitas (`T` con `w`, `s`, `lh`, `ls`, `mono`, `color`,
  `style`, `numberOfLines`). Sin `any` fuera de lo estrictamente necesario.

---

## 6. Errores

- Passkey: misma política que hoy (`describeError`; cancelación → sin mensaje).
- RPC caído: "Available to spend" muestra "—" y el bloque TESTNET muestra
  `rpcError` + "Retry". El resto de la app sigue usable.
- Faucet sin MON: mismo mensaje de hoy ("You need test MON for gas…").
- Fuentes que no cargan: spinner indefinido, como el prototipo. (Fuentes locales
  al bundle; no hay red de por medio.)

---

## 7. Verificación

1. `npx tsc --noEmit` limpio.
2. `npm test`: los 19 tests actuales (account, chain, faucet, hd, storage) sin
   tocar, más nuevos:
   - `store`: `nav`/`back` y límite del stack; `requireAccount` sin cuenta manda
     a `signin` con `next` y `resume`; con cuenta navega directo; `user`
     derivado (`new` sin cuenta aunque `mockHolder` sea true; `holder` solo con
     cuenta); `balance` 0 sin saldo.
   - `mock/helpers`: `money`, `quoteFor`, `sellQuoteFor`.
   - Cada test se corre también contra el defecto (rompiendo la regla) para
     comprobar que detecta.
3. Prueba manual en simulador con Face ID inscrito, con capturas:
   - Abre en Market sin cuenta; Activity y Agent navegan sin pedir cuenta.
   - Wallet → Wallet access → "Create a wallet" → Face ID → Wallet con AUSD real.
   - Bloque TESTNET: MON visible; "Get test AUSD" pide Face ID si está locked y
     muestra el hash; "Refresh" actualiza.
   - Deposit muestra la dirección real y "Copy address" copia.
   - Lock cambia a "Locked"; Sign out regresa a Market y Wallet vuelve a pedir
     acceso.
   - Panel ⚙ visible en dev; los estados de compra y journeys navegan.
4. Revisión independiente por subagente antes de entregar.

---

## 8. Fuera de alcance

Trades reales, posiciones reales, movimientos reales, QR de depósito, Withdraw
real, notificaciones, build 2 a TestFlight, Android. Todo eso es fase 2 o
posterior (`docs/04-roadmap-bounty.md`).
