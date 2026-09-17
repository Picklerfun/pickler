# Perpl testnet — spike de verificación (2026-09-16)

Objetivo: saber, midiendo contra la testnet real, qué hace falta para que la app coloque una
orden en Perpl (requisito del bounty). Todo lo de abajo se ejecutó con la cuenta de prueba del
repo (vector KAT `fill(7)`, `0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f`), sin código que se
quede. Scripts de usar-y-tirar en el scratchpad de la sesión (`perpl/*.cjs`).

## Resultado: el camino completo funciona desde fuera de un navegador

| Paso | Cómo | Evidencia |
|---|---|---|
| 1. Colateral | Es **el mismo AUSD de Agora testnet** (`0xa9012a…`); `GET /api/v1/pub/context` lo devuelve en `tokens[0]`. El "USD `0xdf5b…`" del README de Perpl está desactualizado. | `context.instances[0]`: exchange `0x1964c32f0be608e7d29302aff5e61268e72080cc`, `min_account_open_amount` 100 AUSD, `min_deposit_amount` 10, `min_withdraw_amount` 0.01 |
| 2. Cuenta en el exchange | `approve(AUSD → exchange)` + `createAccount(100e6)` | tx `0x85cf2c…9542` (approve), `0xda6803…cd86` (createAccount) → cuenta **#619** |
| 3. Order forwarding | `allowOrderForwarding(true)` desde la wallet | tx `0xafcdaf…7590`; snapshot `fw: true` |
| 4. API key sin web UI | `POST /api/v1/api-key/payload` **sin header `Origin`** → 200 con EIP-712; firmar con la wallet (viem `signTypedData`, convirtiendo `chainId`/`time` de hex a bigint) + prueba de posesión Ed25519 sobre el digest → `POST /enroll` 200. Con `Origin: https://pickler.fun` → 422 (no está en lista blanca; no hace falta). Enrolar **antes** de tener cuenta da 404 "Target profile not found". | key scope 3 (`read|trade`), `origin: ""` |
| 5. REST firmado | `X-API-Key/Timestamp/Nonce/Signature` sobre la cadena canónica | `order-history`, `fills`, `account-history`, `position-history` 200 |
| 6. WS de trading | `wss://testnet.perpl.xyz/ws/v1/trading`, primer frame `mt: 29` firmado | `WalletSnapshot` (mt 19) con `as[0]` = cuenta 619, `lfr`, saldo |
| 7. Orden de mercado | `mt: 22`, `t: 1` (OpenLong), `p: 0`, `fl: 4` (IOC), `ms: 100`, `s: 500` (MON enteros), `lv: 100` (1x), `lb: head + ttl`, `rq: lfr + 1` | tx `0x3469a0…6323`: `st: 4 · sr: 43 TakerOrderFilled` a 0.02220; fill y posición en `mt: 25/27` |
| 8. Cierre y cancelación | `t: 3` (CloseLong) IOC → filled a 0.02210; `t: 5` (Cancel) con `oid` | tx `0xdd6bf9…e1ad`, `0xf8234d…55e1`; cuenta plana, saldo 99.94 AUSD |

Costo total del spike: 0.03 MON de gas (createAccount 202k gas, forwarding 71k) + 0.0076 AUSD
de fees + $0.05 de spread. Las órdenes forwardeadas **no gastan gas del usuario** (las paga
el forwarder `0x45f106…8473`).

## Trampas encontradas (no están claras en la doc)

1. **`rq` debe ser `lfr + 1`, pequeño y estrictamente creciente.** Un `rq` = timestamp en ms
   llega a la cadena y falla con `sr: 32 OrderDescIdTooLow` (tx `0x9a2a00…f6f2`). El ejemplo
   de la doc con `rq: Date.now()` no sirve en testnet. `lfr` viene en `WalletSnapshot.as[0].lfr`
   y se actualiza en cada `mt: 21`.
2. **`lb: 0` no se forwardea en testnet** (la doc dice que es legal): la orden recibe `mt: 3
   code 0` y nunca llega ni un `mt: 24`. Con `lb = head + order_ttl_blocks` (20 en MON Perp)
   sí. `head` sale del último heartbeat `mt: 100 (h)`.
3. **Un `rq` repetido se ignora en silencio** (idempotencia): `mt: 3 code 0` y nada más. Hay
   que llevar el contador con cuidado.
4. **El nonce EVM de una tx descartada por falta de MON sigue "vivo"** en el nodo de Monad:
   el reintento con el mismo nonce responde `rejected`; hay que reemplazarla con más
   `maxPriorityFeePerGas` (20 gwei bastó).
5. `getAccountByAddr` **revierte** (`0x03a0e277`) si la wallet no tiene cuenta, no devuelve 0.
6. Geo-bloqueo en `context.geo_block`: US, GB, UA, RU, BY, CU, IR, KP, SY — aplica a testnet.
   Relevante para la demo si los jueces están en US.

## Lo que implica para la app (insumo del diseño de fase 2)

- La app ya tiene todo lo criptográfico que hace falta: secp256k1 (wallet de Mera/viem) para
  `approve`/`createAccount`/`allowOrderForwarding`/EIP-712, y Ed25519 vía `@noble/curves`
  (ya viene con viem) para la API key. **No hace falta backend ni web UI.**
- Onboarding a Perpl = 3 tx del usuario (approve, createAccount ≥ 100 AUSD, forwarding) +
  1 firma EIP-712 (API key). Todas piden Face ID si la sesión está `locked`; una vez
  `unlocked`, la sesión de Mera firma sin prompt.
- La API key (token + llave Ed25519 privada) hay que guardarla en `SecureStore` junto a la
  cuenta; si se pierde se enrola otra (máx. 16 activas por cuenta).
- Después del onboarding, operar es solo WebSocket: sign-in firmado, `mt: 22` por orden,
  `mt: 3/24/25/27` para el estado. La pantalla Trade (Quote → Confirm → Sent → Done/Failed)
  mapea directo: `code 0` = Sent, `st: 4` = Done, `st: 7` = Failed con `sr`.
- Saldo "en Perpl" (`as[0].b`) es distinto del saldo AUSD en la wallet: la UI tiene que
  mostrar ambos o decidir cuál es "Available to spend".

## Enlaces

- API docs: https://github.com/PerplFoundation/api-docs (README, authentication, integrations,
  websocket, types, rest-endpoints).
- Testnet: REST `https://testnet.perpl.xyz/api`, WS `wss://testnet.perpl.xyz`, web
  `https://testnet.perpl.xyz` (API keys en `/apikeys`).
