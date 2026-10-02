# App móvil Pickler — Wallet real (withdraw + movements) e iconos

**Fecha**: 2026-09-16
**Estado**: aprobado por Jesús (diseño en chat), pendiente de plan
**Slug**: `mobile-wallet`
**Rama**: `feat/mobile-wallet`, base `main` (`286bd0a`)
**Contexto**: cierre del port de UI (`docs/superpowers/audits/2026-09-16-mobile-ui-port-f1-rulings.md`). Antes de la fase 2
(Perpl) la sección *Wallet* deja de ser maqueta: *Withdraw* manda AUSD de verdad y
*Movements* lista las transferencias reales de la dirección. De paso, la tab bar
recibe iconos y el header de Market recupera el logo.

---

## TL;DR

Cuatro piezas, ningún backend, ningún cambio nativo:

1. **Tab bar** con iconos (`@expo/vector-icons`, Ionicons) en vez de cuadros.
2. **Logo del header** (`assets/pickler-mark.png`) rehecho desde `PickerLogo.png`.
3. **Withdraw real**: destino + monto → review → firma → recibo. ERC-20 `transfer` de
   AUSD en Monad Testnet, gas en MON.
4. **Movements reales**: transferencias AUSD de la dirección vía MonadScan (Etherscan
   V2, `chainid=10143`), más las tx propias en vuelo como *Confirming*.

---

## 1. Decisiones que fija este spec

| Decisión | Valor | Por qué |
|---|---|---|
| Fuente del historial | **MonadScan / Etherscan V2** (`api.etherscan.io/v2/api?chainid=10143`, `module=account&action=tokentx&contractaddress=AUSD&address=…`). | Medido el 2026-09-16: el RPC público limita `eth_getLogs` a 100 bloques (~40 s de cadena); Ankr/dRPC/monadinfra limitan igual; SQD sin key tarda ~12 min por consulta con `529 overloaded`. MonadScan devuelve todo en una llamada y la key gratuita funcionó (`status 1 OK`). |
| Dónde vive la key | `app.config.ts` → `extra.monadscanKey`, con `process.env.PICKLER_MONADSCAN_KEY` como override, leída en `src/config/explorer.ts` igual que `rpId` en `rp.ts`. | Es una key pública de explorer (solo lectura, testnet, 100k llamadas/día); va en el bundle como cualquier key de explorer. Si se abusa, se rota. |
| Qué es un "movement" | Solo transferencias **AUSD** de/hacia la dirección. Tres clases: **Faucet** (`from` = faucet de AUSD), **Deposit** (`to` = yo), **Withdrawal** (`from` = yo). | Compras/ventas de tokens no existen todavía (llegan con Perpl). MON no se lista: es gas, no dinero del usuario. |
| Fee de withdraw | Se muestra **en MON**, estimada con `estimateGas` × precio de gas: "Network fee ~0.00xx MON". "Platform fee 0.00 AUSD" se conserva. | La maqueta decía "−0.15 AUSD · example"; el gas real es MON y mentir en la pantalla de dinero no es opción. |
| Línea de pending bajo el saldo | Real: "N transfers confirming" mientras haya tx propias sin recibo; si no, "Nothing pending." | Era copy congelado ("50.00 AUSD pending…") en la lista de pendientes de Jesús; al tener datos reales deja de tener sentido inventarla. |
| Iconos | `@expo/vector-icons` 15.1.1, familia **Ionicons**, outline inactivo / relleno activo: Market `storefront`, Activity `pulse`, Portfolio `pie-chart`, Wallet `wallet`. | Solo JS + fuentes (`expo-font` ya está): no toca Xcode ni pods. |
| Píldoras del header (`★`, `Alerts`, `⚙`) | **No se tocan.** | Copy congelado del spec anterior; Jesús no pidió cambiarlas. |
| Logo | Recorte cuadrado de `~/Downloads/PickerLogo.png` (1536×1024 RGBA, glifo en ~490–1047 × 203–785) con margen de glow, exportado a **160 px** como `assets/pickler-mark.png`. | Se pinta a 26 pt; 160 px cubre @3x. Fondo transparente sobre `C.phone` (#0B0B0E), que coincide con el negro del original. |
| Withdraw de MON, QR real en Deposit, backend de usuarios | **Fuera de alcance.** | No lo pidió nadie; YAGNI. |

---

## 2. Unidades

### 2.1 `src/config/explorer.ts` — nuevo

- `MONADSCAN_KEY` desde `Constants.expoConfig.extra.monadscanKey` (lanza si falta,
  como `rp.ts`).
- `MONADSCAN_API = "https://api.etherscan.io/v2/api"`, `MONADSCAN_CHAIN_ID = 10143`.

### 2.2 `src/wallet/explorer.ts` — nuevo

- `type Transfer = { hash: Hex; block: bigint; timestamp: number; from: Address; to: Address; value: bigint }`.
- `fetchAusdTransfers(address): Promise<Transfer[]>` — `GET tokentx` con `sort=desc`;
  parsea `result` (strings → `bigint`/`number`), tolera `status: "0"` con
  `message: "No transactions found"` (→ `[]`) y lanza en cualquier otro error.
- `type Movement = { kind: "Faucet" | "Deposit" | "Withdrawal"; amount: bigint; sign: "+" | "-"; when: number; hash: Hex; status: "Complete" | "Confirming" | "Reverted" }`.
- `toMovements(transfers, self): Movement[]` — **pura**: clasifica por `from`/`to`
  (comparación case-insensitive), signo, orden descendente por `block`.

### 2.3 `src/wallet/chain.ts` — se amplía

- `transferCalldata(to, amount): Hex` — `encodeFunctionData` de `transfer(address,uint256)`.
- `estimateAusdTransferFee(from, to, amount): Promise<bigint>` — `estimateGas` ×
  `getGasPrice`, en wei de MON.
- `sendAusd(wallet, to, amount): Promise<Hex>` — mismo patrón que `requestAusdFromFaucet`.
- `ERC20_ABI` gana `transfer`.

### 2.4 `src/config/chain.ts` — se amplía

- `parseAusd(text): bigint | undefined` — acepta `"12"`, `"12.5"`, `"0.000001"`;
  rechaza vacío, negativo, más de 6 decimales, no numérico.
- `shortHash(hash)` → `0xabcd…ef12` (compartido por Movements y el resumen de Withdraw).

### 2.5 `src/hooks/useTreasury.ts` — se amplía

Sin cambiar lo que ya hace (saldos, faucet, unlock). Añade:

- `movements: Movement[] | null` y `movementsError: string`. `refresh()` lee saldos
  **y** movimientos en paralelo; el fallo del explorer no toca los saldos.
- `pending: Movement[]` — tx propias (faucet, withdraw) desde que se mandan hasta el
  recibo; se pintan arriba de la lista con `status: "Confirming"`. Al recibir el
  recibo se quitan y se llama `refresh()`; si `reverted`, la fila queda como
  `Reverted` hasta el siguiente `refresh()`.
- `withdraw(to, amount): Promise<void>` — refresca saldos, exige `mon > 0` (mismo
  mensaje del faucet) y `amount ≤ ausd`, desbloquea igual que `getTestAusd`, manda
  con `sendAusd`, registra en `pending`, espera recibo. Errores vía `describeError`.
- `estimateFee(to, amount): Promise<bigint>` — expone `estimateAusdTransferFee` para
  la pantalla.

### 2.6 `WithdrawScreen` — `src/screens/own.tsx`

Estado local de pantalla (no en el store): `step: "edit" | "review" | "sent" | "done" | "failed"`.

- **edit**: `TextInput` mono para destino con botón *Paste* (`expo-clipboard`);
  `TextInput` numérico para monto con botón *Max* (= saldo AUSD). Debajo, el saldo
  disponible real (`formatAusd`). Validación pura `validateWithdraw({ to, amount, ausd })`
  → mensaje o `ok`. *Review withdrawal* deshabilitado hasta `ok`.
- **review**: tarjeta con destino completo, monto, "Network fee ~x MON", "You receive
  = monto" (el fee no sale del AUSD). *Confirm* llama `treasury.withdraw`; *Edit* vuelve.
- **sent / done / failed**: mismo lenguaje visual que el bloque TESTNET (aviso mono
  con hash → explorer). *Done* → botón "Back to wallet" (`nav("wallet")`).

### 2.7 `WalletScreen` — `src/screens/own.tsx`

- Lista `[...treasury.pending, ...treasury.movements]` con el mismo layout de tarjeta
  que hoy; tap abre `EXPLORER_TX_URL(hash)`.
- Estados: `movements === null` → "Loading movements…"; `movementsError` → aviso
  ámbar con *Retry* (mismo estilo que `rpcError`); lista vacía → "Nothing has ever
  arrived in this wallet."
- Línea bajo el saldo: `pending.length > 0 ? "N transfers confirming" : "Nothing pending."`.

### 2.8 `Shell.tsx`

- `BOTTOM_TABS` gana el nombre del icono; el cuadro se reemplaza por `<Ionicons
  name={on ? icon : icon + "-outline"} size={20} color={fg} />`.

---

## 3. Errores

| Caso | Comportamiento |
|---|---|
| Explorer caído / key inválida | Saldos normales; sección Movements con aviso y *Retry*. Nunca bloquea Withdraw. |
| Sin MON | Withdraw no manda: mismo mensaje que el faucet ("You need test MON for gas…"). |
| Monto > saldo | Validación en pantalla antes de Review. |
| Cancelar Face ID | `describeError` devuelve `""`; la pantalla regresa a *review* sin aviso. |
| Tx revertida | Fila `Reverted` en rojo; aviso con hash. |
| Dirección igual a la propia | Se permite (es una transferencia válida); no vale la pena un caso especial. |

---

## 4. Pruebas

Unitarias (Jest, `__tests__/`), cada una corrida también **contra el defecto**:

- `parseAusd`: "12" → 12_000_000n; "12.5"; "0.000001"; rechaza "", "-1", "1.1234567", "abc".
- `transferCalldata`: selector `0xa9059cbb` + args codificados.
- `toMovements`: faucet → Faucet "+", entrante → Deposit "+", saliente → Withdrawal "−";
  orden por bloque desc; `from`/`to` en mayúsculas/minúsculas.
- `validateWithdraw`: dirección inválida, monto 0, monto > saldo, caso ok.
- `fetchAusdTransfers`: parseo de una respuesta real grabada (fixture) y del caso
  "No transactions found".

`npx tsc --noEmit` limpio y `npm test` completo.

Manual en simulador (iPhone 17 Pro, Face ID inscrito): retirar 1 AUSD a otra
dirección, ver el hash en MonadScan, y verlo en Movements con fecha real; tab bar con
iconos; header de Market con el logo. Capturas en el scratchpad como evidencia.

---

## 5. Fuera de alcance

Compras/ventas en Movements (Perpl), QR en Deposit, retirar MON, backend de usuarios,
píldoras del header, copy congelado restante de `docs/superpowers/audits/2026-09-16-mobile-ui-port-f1-rulings.md`.
