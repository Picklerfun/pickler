# App móvil Pickler — Fase 2: trading manual en Perpl (pestaña Trade)

**Fecha**: 2026-09-16
**Estado**: aprobado por Jesús (diseño en chat), pendiente de plan
**Slug**: `mobile-perpl`
**Rama**: `feat/mobile-perpl`, base `main` (`2d928fc`, merge de `feat/mobile-wallet`)
**Contexto**: el bounty exige "executes trades through Perpl". El equipo decidió el
2026-09-16 que el venue es Perpl (Polymarket sale), que el perp lo operan tanto una persona
como un agente, y que se empieza por el manual. Esta fase es ese manual. Verificación previa
contra la testnet: `docs/investigacion/perpl.md` (cuenta #619, API key, WS y orden real).

---

## TL;DR

Una pestaña nueva **Trade** donde el usuario, con su cuenta de Mera y su AUSD:

1. **Habilita trading** (una vez): `approve` + `createAccount(≥100 AUSD)` +
   `allowOrderForwarding(true)` + registro de una **API key** Ed25519 firmada con la wallet.
2. Ve **saldo de trading**, **mercados** (precio de marca y cambio 24h) y **posiciones**
   con PnL y precio de liquidación.
3. **Abre** un perp (Long/Short, monto en AUSD, 1x–5x) con orden de mercado por WebSocket,
   y lo **cierra** completo.
4. **Mueve fondos** entre la wallet y la cuenta de trading (Add funds ≥10, Withdraw).

Sin backend. Todo firma en el teléfono: secp256k1 (sesión de Mera / viem) para las tx y el
EIP-712; Ed25519 (`@noble/curves`, ya en `node_modules` vía viem) para la API key.

---

## 1. Decisiones que fija este spec

| Decisión | Valor | Por qué |
|---|---|---|
| Dónde vive | Pestaña **Trade** nueva (5.ª tab, icono Ionicons `trending-up`, entre Market y Activity). Market, Trade-de-tokens (`screen: "trade"`), Portfolio, Activity, Wallet **no cambian** de copy ni de flujo. | Jesús: "pestaña totalmente nueva"; lo del token es F3. |
| Nombre interno | Pantallas `perps`, `perpsMarket`, `perpsFunds`; la pantalla existente `trade` (compra de tokens) **conserva su id**. | Evitar renombrar lo que no se toca. |
| Colateral | **AUSD de Agora testnet** (`0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC`, 6 decimales) — el mismo de la wallet. | Verificado en `GET /api/v1/pub/context` → `tokens[0]`. |
| Contrato | Exchange proxy `0x1964c32f0be608e7d29302aff5e61268e72080cc` (Monad Testnet 10143). Funciones: `createAccount(uint256)`, `allowOrderForwarding(bool)`, `getAccountByAddr(address) → uint256` (**revierte** si no hay cuenta), `depositCollateral(uint256)`, `withdrawCollateral(uint256)`. | Selectores confirmados en la implementación `0xbcbd37…adbb`; `withdrawCollateral` simulado OK. Los mínimos (`min_account_open_amount` 100, `min_deposit_amount` 10, `min_withdraw_amount` 0.01 AUSD) **se leen de `context.instances[0]`**, no se fijan. |
| API | REST `https://testnet.perpl.xyz/api`, WS `wss://testnet.perpl.xyz/ws/v1/trading`. Constantes en `perpl/config.ts`, con override por `app.config.ts → extra` para mainnet después. | Spike. |
| API key | Generada en el teléfono; enrolada con `POST /v1/api-key/payload` + `/enroll` **sin header `Origin`**, `scope_mask: 3`, `label: "Pickler iOS"`. Guardada en SecureStore `pickler.perpl.v1` **sin gate biométrico**. | Sin `Origin` funciona (200); con `Origin` propio da 422. La llave **no puede retirar ni transferir** (regla de Perpl), solo operar; gate por Face ID obligaría a un prompt en cada conexión. Riesgo aceptado para testnet; se revisa antes de mainnet. |
| Apalancamiento | Selector **1x · 2x · 3x · 5x**, default **1x**. Con `lv > 1` se muestra advertencia y el precio de liquidación se resalta. | Jesús eligió B. |
| Órdenes | Solo **mercado** (`p: 0`, `fl: 4` IOC, `ms` = `order_max_market_slippage_bps` del mercado). Cierre **total** (`CloseLong`/`CloseShort`, `s` = tamaño de la posición). | F3: límite, TP/SL, parcial. |
| Mercados | Todos los que devuelva `context.markets` con `config.is_open`. Lista ordenada por `id`. | Sin lista fija. |
| Captura del monto | En **AUSD** (colateral). Tamaño = `floor(ausd × lv × 10^(pd+sd) / (mrk × 10^6))` unidades escaladas (`pd` = `price_decimals`, `sd` = `size_decimals`, `mrk` = precio de marca escalado). Se muestra el tamaño resultante en unidades del activo. | El usuario piensa en dólares; Perpl en unidades. |
| Fondos | **Enable trading**: monto editable ≥ mínimo (default = mínimo). **Add funds**: ≥ `min_deposit_amount`, ≤ AUSD en wallet. **Withdraw to wallet**: ≥ `min_withdraw_amount`, ≤ saldo libre (`b − lb`). Las tres son tx de la wallet con Face ID si está `locked`. | Jesús eligió "A completo". |
| Fuente de verdad | **WebSocket de trading** para cuenta, órdenes, posiciones (snapshots `mt: 19/23/26` + updates `21/24/25/27`). `pub/context` para precios (polling cada 5 s solo con la pestaña abierta). REST firmado **no se usa** en F2. | Sin `mt: 3/24` no hay forma limpia de saber qué pasó con una orden. |
| `rq` y `lb` | `rq` = `max(lfr, último enviado) + 1`, semilla `as[0].lfr` del snapshot, actualizado con `mt: 21`. `lb` = `head + order_ttl_blocks` del mercado, `head` = `h` del último heartbeat. **Nunca** timestamp ni `lb: 0`. | Trampas medidas en el spike (`sr: 32`; `lb: 0` no se forwardea). |
| Conexión | El socket vive mientras la pestaña Trade (o sus subpantallas) está activa; ping `mt: 1` cada 3 s (idle 10 s testnet, 5 s mainnet); reconexión con backoff 1·2·4·8·16·30 s. Sign out y "Reset trading key" lo cierran. | Ahorra batería y evita estados fantasma. |
| Copy | Inglés, mismo tono que el resto de la app. Números: AUSD con `formatAusd`; precios con `price_decimals` del mercado; PnL con signo y color `C.up`/`C.down`. | Consistencia. |

**Lo que este spec NO decide:** cómo opera el agente (F3), caps, token, mainnet.

---

## 2. Unidades

Todo lo nuevo en `apps/mobile/src/perpl/` es **puro** (sin `react-native` ni `expo-constants`;
solo `fetch`, `WebSocket` global de RN y viem/noble), testeable en Jest.

### 2.1 `perpl/config.ts`

`PERPL_CHAIN_ID = 10143`, `PERPL_REST`, `PERPL_WS`, `EXCHANGE_ADDRESS`, `EXCHANGE_ABI`
(`parseAbi` con las 5 funciones), `TRADING_KEY_LABEL = "Pickler iOS"`, `PING_MS = 3000`,
`ORDER_TIMEOUT_MS = 30_000`, `CONTEXT_POLL_MS = 5000`, `LEVERAGES = [1, 2, 3, 5]`.

### 2.2 `perpl/context.ts`

```ts
type Market = { id; symbol; name; priceDecimals; sizeDecimals; ttlBlocks; maxSlippageBps; maintenanceMarginBps; takerFeeMicros; isOpen; mark: bigint; prev: bigint };
type Instance = { exchange: Address; minAccountOpen: bigint; minDeposit: bigint; minWithdraw: bigint };
parseContext(body: unknown): { markets: Market[]; instance: Instance; geoBlock: string[] }   // pura, lanza si falta algo
fetchContext(): Promise<...>                                                                    // GET /v1/pub/context, timeout 15 s (AbortController)
```

### 2.3 `perpl/onboarding.ts`

Calldata puro + envío con la sesión de Mera, mismo patrón que `wallet/chain.ts`:

```ts
readAccountId(address): Promise<bigint>            // getAccountByAddr; revert → 0n
readAllowance(address): Promise<bigint>
approveCalldata(amount) / createAccountCalldata(amount) / allowForwardingCalldata() / depositCalldata(amount) / withdrawCalldata(amount): Hex
approveExchange(wallet, amount) / createExchangeAccount(wallet, amount) / enableForwarding(wallet) / depositCollateral(wallet, amount) / withdrawCollateral(wallet, amount): Promise<Hex>
```

Cada `send*` usa `maxPriorityFeePerGas` explícito (20 gwei) para que un reintento reemplace
una tx descartada (lección del spike).

### 2.4 `perpl/apiKey.ts`

```ts
generateTradingKey(): { privateKey: Uint8Array; publicKeyHex: Hex }        // ed25519 de @noble/curves
wsSigninCanonical(chainId, timestampMs, nonce): string                              // 4 campos
signWsSignin(privateKey, chainId): { timestamp; nonce; signature }                  // base64url sin padding
normalizeTypedData(typed_data): TypedDataDefinition   // quita EIP712Domain de types; chainId y message.time de hex a bigint
enrollTradingKey(wallet: Wallet, publicKeyHex): Promise<string>   // payload → signTypedData → PoP ed25519 sobre hashTypedData → enroll → api_key
```

Errores de enroll con significado: 404 → "Create the trading account first" (orden de pasos);
409 → generar otro par; 423 → "Too many trading keys; revoke one at testnet.perpl.xyz/apikeys".

### 2.5 `perpl/orders.ts` (puro)

```ts
sizeFromAusd(ausd: bigint, lv: number, mark: bigint, pd: number, sd: number): bigint
notionalAusd(size, mark, pd, sd): bigint
takerFee(notional, takerFeeMicros): bigint
liquidationPrice(entry: bigint, lv: number, side: "long" | "short", maintenanceBps: number): bigint
   // long: entry × (1 − 1/lv + mm); short: entry × (1 + 1/lv − mm). Estimación; se rotula "est."
orderFrame({ sn, rq, mkt, acc, type, size, ms, lv, lb }): OrderRequest
closeFrame(position, { sn, rq, ms, lb }): OrderRequest      // CloseLong (3) si sd = long, CloseShort (4) si short
describeOrderStatus(st, sr?, fr?): { kind: "sent" | "filled" | "open" | "failed"; text: string }
```

Tabla mínima de `sr`/`fr` con copy: `32` "Order id too low — retrying", `34` "One-click
trading is off. Enable trading again", `35` "Placed", `37`/`fr 8` "Not enough collateral for
this size", `39` "Below the market minimum", `40` "Price out of range", `42` "Size out of
range", `43` "Filled", `44` "Couldn't settle — try a smaller size"; default: `Failed (sr N)`.

### 2.6 `perpl/ws.ts`

`class TradingSocket` (sin React):

- `connect({ apiKey, privateKey, onEvent })` → abre, manda `mt: 29` como primer frame, arranca ping.
- Estado interno: `status: "connecting" | "live" | "reconnecting" | "closed"`, `head`, `lfr`,
  `account`, `orders: Map<oid, Order>`, `positions: Map<pid, Position>`, `pending: Map<sn, PendingOrder>`.
- `placeOrder(frame)` → asigna `sn`, `rq = max(lfr, lastRq) + 1`, `lb = head + ttl`; devuelve
  `Promise<OrderOutcome>` que resuelve con el primer `mt: 24` no-fallo para ese `rq` (o el
  primer fallo si solo hay fallos), rechaza si `mt: 3 code ≠ 0`, y resuelve `unknown` a los
  30 s. Un `sr: 32` reintenta **una vez** con `rq` nuevo.
- Parsers puros exportados: `parseFrame(json)`, `applyFrame(state, frame)` (para tests con
  fixtures del spike).
- Reconexión: backoff hasta 30 s; al reconectar, snapshots frescos reemplazan el estado;
  pendientes sin resolver pasan a `unknown`. Dos `3401` seguidos → evento `keyRejected`.

### 2.7 `storage/perpl.ts`

`pickler.perpl.v1` (SecureStore, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, sin `requireAuthentication`):
`{ accountId: string; apiKey: string; privateKey: base64url }`. `loadTradingKey`,
`saveTradingKey`, `clearTradingKey` (se llama desde `signOut` junto a `clearStoredAccount`). **(gate, 2026-09-21)** `signOut` ya **no** la llama: la key sobrevive al sign out (opción B; `usePerpl` la ignora si la `address` no coincide). No hay borrado explícito desde la UI: «Reset trading key» (visible sólo con key rechazada) enrola una key **nueva**; `clearTradingKey` queda exportado sin llamadores. Motivo: cada Reconnect cuesta una tx de gas y registra otra key en Perpl (límite `423`); follow-up post-bounty: key derivada de una firma determinista de la wallet (patrón dYdX v4), sin nada en disco.
Entrada malformada → se borra y se lee como ausente (misma regla que `storage.ts`).

### 2.8 `hooks/usePerpl.ts`

```ts
type PerplState =
  | { status: "loading" }
  | { status: "none" }                                   // sin cuenta en Perpl o sin key guardada
  | { status: "onboarding"; step: 1 | 2 | 3 | 4; error?: string }
  | { status: "ready"; accountId: bigint; key: TradingKey };
type Perpl = {
  state; context: Context | null; contextError: string;
  live: { status; account; positions: Position[]; orders: Order[] } | null;
  enable(amount: bigint): Promise<void>;      // pasos 1–4, reanudable
  addFunds(amount): Promise<Hex>; withdraw(amount): Promise<Hex>;
  open(market, side, ausd, lv): Promise<OrderOutcome>; close(position): Promise<OrderOutcome>;
  resetKey(): Promise<void>;                  // genera + enrola otra key
  setActive(active: boolean);                 // la pestaña avisa; controla socket y polling
};
```

Reglas: `enable` verifica antes de cada paso (`readAccountId`, `readAllowance`, `fw` del
snapshot o `getAccountByAddr` + reintento, `loadTradingKey`) y **nunca repite `createAccount`**
si ya hay id. Desbloqueo con el mismo `openWallet` de `useTreasury` (se extrae a
`hooks/useUnlock.ts` compartido). Tras `addFunds`/`withdraw` → `treasury.refresh()`.

### 2.9 `screens/perps.tsx` y `Shell.tsx`

- `Screen` gana `"perps" | "perpsMarket" | "perpsFunds"`; `GATED` los incluye; `SHOW_TABS`
  incluye `perps`; `CAN_BACK` incluye `perpsMarket` y `perpsFunds`; `headerFor`: `perps` →
  ["Trade", "Perps on Perpl · Monad"], `perpsMarket` → [`${symbol} Perp`, "Market order"],
  `perpsFunds` → ["Trading funds", "Between wallet and trading"].
- `BOTTOM_TABS`: `["market","Market","storefront"], ["perps","Trade","trending-up"], ["activity",…], ["portfolio",…], ["wallet",…]`.
- `StoreState` gana `perpsMarketId?: number`, `perpsSide?: "long" | "short"`, `fundsMode?: "add" | "withdraw"`.

---

## 3. Pantallas

### 3.1 Trade — sin cuenta (`state.status === "none"`)

Tarjeta: "Enable trading" / "Moves AUSD from your wallet into a Perpl trading account. One
Face ID, four steps." Campo de monto (default = `minAccountOpen`, validación ≥ mínimo y ≤
AUSD en wallet; sin MON → mensaje del faucet). Botón **Enable trading**. Durante `onboarding`:
lista de 4 pasos con check/spinner/error (Approve AUSD · Create trading account · Allow
one-click trading · Register trading key) y botón **Retry** en el paso fallido. Debajo,
MARKETS en modo solo lectura (precios) para que la pestaña no esté vacía.

### 3.2 Trade — listo

- Tarjeta "Trading balance": `formatAusd(b)` grande; línea "`formatAusd(lb)` locked in
  positions · `formatAusd(b − lb)` free"; chip de conexión ("Live" lima / "Reconnecting…" ámbar
  / "Offline" gris).
- Botones **Add funds** (→ `perpsFunds`, `fundsMode: "add"`) y **Withdraw to wallet** (`"withdraw"`).
- **MARKETS**: fila por mercado: símbolo + nombre, precio de marca formateado, cambio 24h
  `(mark − prev)/prev` con signo y color; tap → `perpsMarket`.
- **POSITIONS**: vacío → "No open positions. Pick a market above."; fila: `LONG`/`SHORT` (tag
  lima/rojo), "`size` `symbol` · `lv`x", entrada → marca, PnL no realizado (signo, color), "Liq.
  est. `price`", botón **Close**.

### 3.3 Mercado → orden (`perpsMarket`)

Segmento **Long / Short**. Monto en AUSD (TextInput `decimal-pad`, `Max` = libre). Selector
1x · 2x · 3x · 5x. Tarjeta resumen: "Size ≈ N `symbol`", "Est. price `mark`", "Fee ≈ `fee`
AUSD", "Liquidation est. `price`" (resaltado si `lv > 1`, con "Higher leverage means a closer
liquidation price."). Validación: monto > 0, ≤ libre, tamaño > 0. Botón **Review** →
tarjeta de confirmación → **Confirm long/short** → estados:
*Sent* ("Order accepted — waiting for the fill", spinner) → *Filled* ("Filled `fs` `symbol`
at `fp` · fee `f` AUSD", botón "Back to Trade") / *Failed* (razón de `describeOrderStatus`,
botones "Edit" y "Back") / *Unknown* a los 30 s ("No confirmation yet. Check your positions.").

### 3.4 Close

Desde la fila de posición: hoja de confirmación "Close `size` `symbol` `LONG` at market ·
Est. PnL `±x` AUSD" → **Close position** → mismos estados que 3.3 con copy de cierre
("Closed · realised `±x` AUSD").

### 3.5 Trading funds (`perpsFunds`)

Cabecera con los dos saldos (Wallet `formatAusd(treasury.ausd)` · Trading free). Monto con
`Max`; validación por modo (add: ≥ `minDeposit`, ≤ wallet; withdraw: ≥ `minWithdraw`, ≤
free). **Review** → **Confirm** → Face ID si `locked` → "Sent: 0x…" → "Confirmed" y ambos
saldos refrescados. Add funds hace `approve` solo si la allowance es insuficiente.

### 3.6 Wallet

Bajo "Available to spend" se añade la línea "`formatAusd(b)` AUSD in trading · Trade tab"
cuando `perpl.state.status === "ready"` (si el socket no está vivo, se muestra el último
valor conocido con "· last seen"). Nada más cambia en Wallet.

---

## 4. Estado y datos

- `PerplState` sale de `storage/perpl.ts` al arrancar (`loading` → `none`/`ready`), en
  paralelo con `useAccount`; `ready` no implica socket abierto.
- `usePerpl.setActive(true)` cuando `S.screen ∈ {perps, perpsMarket, perpsFunds}`; el hook
  abre el socket y el polling de `context`; `false` los cierra (con 2 s de gracia para
  navegaciones internas).
- Órdenes en vuelo: `TradingSocket.pending` por `sn`; la pantalla espera la promesa.
- Sign out: `clearTradingKey()`, socket cerrado, `state = none`. **(gate)** sin `clearTradingKey()`: socket cerrado por el cambio de `address`; con la misma wallet el estado vuelve a `ready` sin Reconnect. Residual: un Reconnect real (reinstalación) sigue reenviando `enableForwarding` porque no hay getter on-chain. Cambio de cuenta (otra
  passkey): la key guardada pertenece a otra `address` → se detecta (`address` guardada ≠
  actual) y se trata como `none`.
- `AppCtx` gana `perpl: Perpl`.

---

## 5. Errores

| Caso | Comportamiento |
|---|---|
| `context` no carga | Trade muestra "Couldn't load markets · Retry"; el resto de la pestaña sigue (saldo por WS). |
| Socket cerrado (1008 idle, red) | "Reconnecting…", backoff; snapshots al volver. |
| `3401` dos veces | Aviso "Trading key rejected" + botón **Reset trading key** (`resetKey`). |
| `mt: 3 code ≠ 0` | *Failed* inmediato con el `error` del gateway; nunca se espera `mt: 24`. |
| `sr: 32` | Un reintento automático con `rq` nuevo; si repite, *Failed*. |
| `sr: 34` | *Failed* "One-click trading is off" + botón **Enable** que corre solo el paso 3. |
| Sin `mt: 24` en 30 s | *Unknown*; al siguiente snapshot se reconcilia. |
| Onboarding falla en el paso N | Se queda en `onboarding` con `error`; **Retry** reanuda en N. Cancelar Face ID → sin aviso, vuelve a `none` con lo hecho conservado on-chain. |
| Tx descartada (nonce vivo) | El reintento lleva `maxPriorityFeePerGas` 20 gwei; si el nodo responde `rejected`, se muestra "Network refused the transaction — try again in a moment". |
| Sin MON | Antes de cualquier tx: mensaje del faucet (mismo que hoy). |
| Geo-bloqueo | La app no conoce el país. Tras 3 fallos de auth seguidos (`3401`/`403`) con una key recién enrolada, el aviso incluye "Perpl isn't available in some regions (see testnet.perpl.xyz)". |

---

## 6. Pruebas

Unitarias (Jest), contra el defecto:

- `wsSigninCanonical` con vector fijo; firma Ed25519 verificable con la pública; base64url
  sin padding.
- `normalizeTypedData` con el `typed_data` real del spike (chainId `0x279f` → 10143n, `time` hex → bigint).
- `parseContext` con el JSON real de testnet (mercado 64: pd 5, sd 0, ttl 20, mm 500, taker 345).
- `sizeFromAusd` (11.1 AUSD a 1x con mark 2220 → 500 MON; BTC con sd 5), `takerFee`
  (11.1 AUSD × 345 micros → 3830), `liquidationPrice` (long 1x ≈ 0.05×entry; 5x ≈ 0.85×entry).
- `orderFrame`/`closeFrame`: `rq = lfr + 1`, `lb = head + ttl`, `t` 3/4 según lado, `p: 0`, `fl: 4`.
- `applyFrame` con los frames reales del spike: `mt: 19` (cuenta 619, `lfr`), `mt: 24`
  filled (`st: 4, sr: 43`), failed (`st: 7, sr: 32`), `mt: 27` apertura y cierre, `mt: 21`
  actualiza `lfr` y saldo.
- `describeOrderStatus` para 32/34/35/43/44 y desconocido.
- Onboarding: máquina de pasos con mocks de `readAccountId`/`readAllowance`/`loadTradingKey`
  — reanuda en el paso correcto y nunca llama `createAccount` dos veces.
- Store: `GATED`, `SHOW_TABS`, `CAN_BACK`, `headerFor` para las tres pantallas nuevas.

`npx tsc --noEmit` limpio y `npm test` completo.

Manual en simulador (cuenta nueva o la del simulador `0xe371…`, fondeada desde la KAT):
Enable trading con 100 AUSD (4 pasos, Face ID) → long 1x de 10 AUSD en MON → Filled →
posición con PnL → Close → Add funds 10 → Withdraw 5 → Wallet muestra "in trading".
Capturas y hashes como evidencia; la cuenta KAT #619 sirve de respaldo para probar el socket
sin repetir el onboarding.

---

## 7. Fuera de alcance

Agente como operador delegado y caps (F3); órdenes límite, TP/SL, cierre parcial; historial de
fills (REST firmado); conectar Market/Portfolio/Trade-de-tokens a Perpl; token/launchpad;
mainnet (URLs y contrato cambian; la key en SecureStore sin gate se revisa); Android.

---

## 8. Fuentes verificadas (2026-09-16)

- `GET https://testnet.perpl.xyz/api/v1/pub/context`: instancia 12, exchange
  `0x1964c3…80cc`, token AUSD `0xa9012a…`, mínimos 100/10/0.01, 7 mercados (BTC 16, ETH 32,
  SOL 48, MON 64, ZEC 256, LIT 272, PUMP 320), `geo_block`.
- Implementación del Exchange `0xbcbd3701ed0bde8acbb727f0d92a8b85a169adbb` (slot EIP-1967):
  selectores `cab13915 createAccount`, `7962f910 allowOrderForwarding`, `12e8eb2c
  getAccountByAddr`, `bad4a01f depositCollateral`, `6112fe2e withdrawCollateral`.
- Tx reales: createAccount `0xda6803…cd86`, forwarding `0xafcdaf…7590`, fill
  `0x3469a0…6323`, cierre `0xdd6bf9…e1ad`, cancel `0xf8234d…55e1`.
- API docs: `PerplFoundation/api-docs` (README, authentication, integrations, websocket,
  types, rest-endpoints); desactualizado en el token de testnet y en `rq: Date.now()` / `lb: 0`.
