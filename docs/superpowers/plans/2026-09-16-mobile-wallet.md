# Wallet real (withdraw + movements) e iconos — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La sección *Wallet* deja de ser maqueta: *Withdraw* manda AUSD de verdad en Monad Testnet y *Movements* lista las transferencias reales de la dirección; la tab bar recibe iconos y el header de Market recupera el logo.

**Architecture:** Módulos puros nuevos sin `react-native` (`config/explorer.ts`, `wallet/explorer.ts`, `wallet/withdraw.ts`, ampliaciones de `config/chain.ts` y `wallet/chain.ts`) con tests unitarios; `useTreasury` los orquesta (movimientos, tx en vuelo, withdraw con el mismo desbloqueo que el faucet); `WalletScreen` y `WithdrawScreen` en `own.tsx` consumen el hook. Iconos vía `@expo/vector-icons` en `Shell.tsx`; logo como asset nuevo.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / React 19.2 / TypeScript 6 / viem 2.55 (ya instalados). Nuevo: `@expo/vector-icons` **15.1.1**. Historial vía Etherscan V2 (`chainid=10143`). Tests con Jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-09-16-mobile-wallet-design.md`

## Global Constraints

- Worktree `.claude/worktrees/mobile-wallet` (rama `feat/mobile-wallet`, base `main` `286bd0a`). Comandos `npm`/`npx` desde `apps/mobile/` de ese worktree. **Nunca `git add -A`**; archivos por nombre. Los pasos "Commit" asumen la autorización de commit que Jesús dio al arrancar la ejecución; **no hay push**.
- Versiones **exactas** en `package.json` (sin `^` ni `~`).
- Código nuevo en `.ts`/`.tsx`, comillas dobles, sin `import React`. `npx tsc --noEmit` limpio en **cada** tarea. Sin `any`.
- `config/`, `wallet/`, `storage/`, `hd/`, `store.ts`, `mock/` **no importan `react-native` ni `expo-constants`** salvo `config/rp.ts` y el nuevo `config/explorer.ts` (que sí lee `expo-constants`, como `rp.ts`). Los tests solo importan módulos puros.
- Solo transferencias **AUSD** son movimientos. Clases: `Faucet` (`from` = `AUSD_FAUCET_ADDRESS`), `Deposit` (`to` = yo), `Withdrawal` (`from` = yo). Comparaciones de dirección case-insensitive.
- Fee de withdraw **en MON** ("Network fee ~0.00xx MON"). "Platform fee 0.00 AUSD" se conserva.
- Píldoras del header (`★`, `Alerts`, `⚙`), `rpId`, `bundleIdentifier`, `version`, `buildNumber` **no cambian**.
- Copy de las pantallas: solo cambia lo que cada tarea indica; el resto queda como está.
- Cada test se corre también **contra el defecto** (paso "verificar que falla") antes de implementar.

---

## Mapa de archivos

**Se crean** (`apps/mobile/`):

| Archivo | Responsabilidad |
|---|---|
| `src/config/explorer.ts` | `MONADSCAN_KEY` (desde `expo-constants`; lanza si falta). |
| `src/wallet/explorer.ts` | `MONADSCAN_API`, `MONADSCAN_CHAIN_ID`, `Transfer`, `Movement`, `fetchAusdTransfers(address, key)`, `parseTokenTxResponse`, `toMovements`, `pendingMovement`. Puro salvo `fetch`. |
| `src/wallet/withdraw.ts` | `validateWithdraw` (pura). |
| `assets/pickler-mark.png` | Logo nuevo (reemplaza el truncado). |
| `__tests__/transfer.test.ts`, `__tests__/explorer.test.ts`, `__tests__/withdraw.test.ts` | Tests nuevos. |

**Se modifican:** `package.json` (+`@expo/vector-icons`), `app.config.ts` (+`extra.monadscanKey`), `src/config/chain.ts` (+`parseAusd`, `shortHash`, `transfer` en `ERC20_ABI`), `src/wallet/chain.ts` (+`transferCalldata`, `estimateAusdTransferFee`, `sendAusd`), `src/hooks/useTreasury.ts`, `src/screens/own.tsx` (Wallet, Withdraw), `src/Shell.tsx`, `__tests__/chain.test.ts`, `README.md`.

## Paralelismo

Tasks 1, 2, 3, 4 y 5 son independientes (archivos disjuntos) y pueden ir a subagentes en paralelo. Task 6 depende de 2, 3 y 4. Tasks 7 y 8 dependen de 6 y comparten `own.tsx` (el mismo agente, en orden). Task 9 cierra.

---

### Task 1: Iconos de la tab bar y logo del header

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/src/Shell.tsx:24` (`BOTTOM_TABS`) y `:88-103` (tab bar)
- Replace: `apps/mobile/assets/pickler-mark.png`

**Interfaces:**
- Consumes: nada.
- Produces: nada que use otra tarea.

- [ ] **Step 1: Instalar `@expo/vector-icons` con versión exacta**

Run: `cd apps/mobile && npm install --save-exact @expo/vector-icons@15.1.1`
Expected: `package.json` tiene `"@expo/vector-icons": "15.1.1"` (sin `^`). Verificar con `grep vector-icons package.json`.

- [ ] **Step 2: Comprobar que el logo actual está truncado (el defecto)**

Run:
```bash
python3 -c "from PIL import Image; im=Image.open('assets/pickler-mark.png'); im.load()"
```
Expected: `OSError: image file is truncated`.

- [ ] **Step 3: Generar el logo nuevo desde `~/Downloads/PickerLogo.png`**

Run:
```bash
python3 - <<'EOF'
from PIL import Image
src = Image.open("/Users/josedejesusacevedoflores/Downloads/PickerLogo.png").convert("RGBA")
# Glifo (alfa alta) en ~490–1047 × 203–785; margen para el glow.
l, t, r, b = 490, 203, 1047, 785
cx, cy = (l + r) // 2, (t + b) // 2
half = max(r - l, b - t) // 2 + 90
box = (cx - half, cy - half, cx + half, cy + half)
out = src.crop(box).resize((160, 160), Image.LANCZOS)
out.save("assets/pickler-mark.png", optimize=True)
im = Image.open("assets/pickler-mark.png"); im.load()
print(im.size, im.mode, im.getchannel("A").getextrema())
EOF
```
Expected: `(160, 160) RGBA (0, 254)` sin error. Alfa mínima 0 en esquinas (fondo transparente).

- [ ] **Step 4: Reemplazar los cuadros de la tab bar por Ionicons**

En `src/Shell.tsx`, cambiar el import y `BOTTOM_TABS`:

```tsx
import Ionicons from "@expo/vector-icons/Ionicons";
```

```tsx
type TabIcon = "storefront" | "pulse" | "pie-chart" | "wallet";
const BOTTOM_TABS: readonly [Screen, string, TabIcon][] = [
  ["market", "Market", "storefront"],
  ["activity", "Activity", "pulse"],
  ["portfolio", "Portfolio", "pie-chart"],
  ["wallet", "Wallet", "wallet"],
];
```

Y en el render de la tab bar, reemplazar el `<View style={{ width: 18, height: 18, … }} />` por:

```tsx
          {BOTTOM_TABS.map(([k, label, icon]) => {
            const on = S.screen === k || (k === "portfolio" && S.screen === "position") || (k === "market" && S.screen === "search");
            const fg = on ? C.lime : C.mute;
            return (
              <Touch key={k} onPress={() => requireAccount(k)} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6 }}>
                <Ionicons name={on ? icon : `${icon}-outline`} size={20} color={fg} />
                <T w={600} s={11} color={fg}>{label}</T>
              </Touch>
            );
          })}
```

- [ ] **Step 5: Verificar tipos y tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc sin salida; jest 41/41 (los de antes).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/Shell.tsx assets/pickler-mark.png
git commit -m "feat(mobile): iconos Ionicons en la tab bar y logo del header sin truncar"
```

---

### Task 2: `parseAusd`, `shortHash` y `transfer` en el ABI

**Files:**
- Modify: `apps/mobile/src/config/chain.ts`
- Test: `apps/mobile/__tests__/chain.test.ts`

**Interfaces:**
- Produces: `parseAusd(text: string): bigint | undefined`; `shortHash(hash: string): string` (`0xabcd…ef12`); `ERC20_ABI` con `transfer(address to, uint256 value) returns (bool)`.

- [ ] **Step 1: Escribir los tests**

Añadir al final de `__tests__/chain.test.ts` (y `parseAusd`, `shortHash`, `ERC20_ABI` al import):

```ts
test("parseAusd turns decimal text into 6-decimal units", () => {
  expect(parseAusd("12")).toBe(12_000_000n);
  expect(parseAusd("12.5")).toBe(12_500_000n);
  expect(parseAusd("0.000001")).toBe(1n);
  expect(parseAusd(" 1,5 ")).toBe(1_500_000n);
});

test("parseAusd rejects empty, negative, too precise and non-numeric text", () => {
  expect(parseAusd("")).toBeUndefined();
  expect(parseAusd("-1")).toBeUndefined();
  expect(parseAusd("1.1234567")).toBeUndefined();
  expect(parseAusd("abc")).toBeUndefined();
  expect(parseAusd("1e3")).toBeUndefined();
  expect(parseAusd(".")).toBeUndefined();
});

test("shortHash keeps the first six and last four characters", () => {
  expect(shortHash("0x7ef471355eeca24d0ea11638b40140e57c0a42d2955652d0a1bd45b4dd962ef1")).toBe("0x7ef4…2ef1");
});

test("ERC20 ABI has transfer", () => {
  expect(ERC20_ABI.some((f) => f.type === "function" && f.name === "transfer")).toBe(true);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/chain.test.ts`
Expected: FAIL — `parseAusd`/`shortHash` no exportados; el test del ABI falla porque solo hay `balanceOf`.

- [ ] **Step 3: Implementar en `src/config/chain.ts`**

Reemplazar `ERC20_ABI` y añadir al final:

```ts
export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
]);
```

```ts
/** "12", "12.5", "1,5" → unidades de 6 decimales; undefined si no es un monto AUSD válido. */
export function parseAusd(text: string): bigint | undefined {
  const cleaned = text.trim().replace(",", ".");
  const m = /^(\d+)(?:\.(\d*))?$/.exec(cleaned) ?? /^()\.(\d+)$/.exec(cleaned);
  if (!m) return undefined;
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  if (whole === "" && frac === "") return undefined;
  if (frac.length > AUSD_DECIMALS) return undefined;
  return BigInt(whole || "0") * 10n ** BigInt(AUSD_DECIMALS) + BigInt((frac + "0".repeat(AUSD_DECIMALS)).slice(0, AUSD_DECIMALS) || "0");
}

/** 0x7ef4…2ef1 */
export function shortHash(hash: string): string {
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx jest __tests__/chain.test.ts && npx tsc --noEmit`
Expected: PASS todos; tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add src/config/chain.ts __tests__/chain.test.ts
git commit -m "feat(mobile): parseAusd, shortHash y transfer en el ABI de AUSD"
```

---

### Task 3: `transferCalldata`, `estimateAusdTransferFee` y `sendAusd`

**Files:**
- Modify: `apps/mobile/src/wallet/chain.ts`
- Test: `apps/mobile/__tests__/transfer.test.ts`

**Interfaces:**
- Consumes: `ERC20_ABI` con `transfer` (Task 2), `Wallet` de `wallet/wallet.ts`.
- Produces: `transferCalldata(to: Address, amount: bigint): Hex`; `transferTxRequest(to, amount): { to: Address; data: Hex; value: bigint }`; `estimateAusdTransferFee(from: Address, to: Address, amount: bigint): Promise<bigint>` (wei de MON); `sendAusd(wallet: Wallet, to: Address, amount: bigint): Promise<Hex>`.

- [ ] **Step 1: Escribir el test**

`__tests__/transfer.test.ts`:

```ts
import { encodeFunctionData } from "viem";
import { AUSD_ADDRESS, ERC20_ABI } from "../src/config/chain";
import { transferCalldata, transferTxRequest } from "../src/wallet/chain";

const to = "0x51289183f21d0cfb0d698ca13c332c438749eb09" as const;

test("transfer calldata is transfer(to, amount) with the ERC-20 selector", () => {
  const data = transferCalldata(to, 5_000_000n);
  expect(data).toBe(encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, 5_000_000n] }));
  // selector de transfer(address,uint256); coincide con methodId de una tx real en MonadScan (0x7ef471…2ef1).
  expect(data.slice(0, 10)).toBe("0xa9059cbb");
});

test("transfer tx targets the AUSD contract with zero native value", () => {
  const tx = transferTxRequest(to, 1n);
  expect(tx.to).toBe(AUSD_ADDRESS);
  expect(tx.value).toBe(0n);
  expect(tx.data).toBe(transferCalldata(to, 1n));
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx jest __tests__/transfer.test.ts`
Expected: FAIL — `transferCalldata` no existe.

- [ ] **Step 3: Implementar en `src/wallet/chain.ts`**

```ts
export function transferCalldata(to: Address, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [to, amount] });
}

export function transferTxRequest(to: Address, amount: bigint): { to: Address; data: Hex; value: bigint } {
  return { to: AUSD_ADDRESS, data: transferCalldata(to, amount), value: 0n };
}

/** Gas estimado × precio de gas, en wei de MON. Revierte si `from` no tiene el AUSD. */
export async function estimateAusdTransferFee(from: Address, to: Address, amount: bigint): Promise<bigint> {
  const tx = transferTxRequest(to, amount);
  const [gas, gasPrice] = await Promise.all([
    publicClient.estimateGas({ account: from, ...tx }),
    publicClient.getGasPrice(),
  ]);
  return gas * gasPrice;
}

/** Firma con la sesión de mera (sin prompt de passkey) y envía. Devuelve el hash. */
export async function sendAusd(wallet: Wallet, to: Address, amount: bigint): Promise<Hex> {
  const walletClient = createWalletClient({ account: wallet.account, chain: CHAIN, transport: http() });
  const tx = transferTxRequest(to, amount);
  return walletClient.sendTransaction({ ...tx, account: wallet.account, chain: CHAIN });
}
```

`AUSD_ADDRESS` ya está importado de `../config/chain`.

- [ ] **Step 4: Verificar que pasa**

Run: `npx jest __tests__/transfer.test.ts && npx tsc --noEmit`
Expected: PASS 2/2; tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/chain.ts __tests__/transfer.test.ts
git commit -m "feat(mobile): transferencia de AUSD (calldata, fee estimada, envío)"
```

---

### Task 4: Explorer — `fetchAusdTransfers`, `toMovements`, key en config

**Files:**
- Create: `apps/mobile/src/config/explorer.ts`
- Create: `apps/mobile/src/wallet/explorer.ts`
- Modify: `apps/mobile/app.config.ts` (`extra`)
- Test: `apps/mobile/__tests__/explorer.test.ts`

**Interfaces:**
- Consumes: `AUSD_ADDRESS`, `AUSD_FAUCET_ADDRESS` de `config/chain.ts`.
- Produces:
  ```ts
  export type Transfer = { hash: Hex; block: bigint; timestamp: number; from: Address; to: Address; value: bigint };
  export type MovementKind = "Faucet" | "Deposit" | "Withdrawal";
  export type MovementStatus = "Complete" | "Confirming" | "Reverted";
  export type Movement = { kind: MovementKind; amount: bigint; sign: "+" | "-"; when: number; hash: Hex; status: MovementStatus };
  export function parseTokenTxResponse(body: unknown): Transfer[];      // lanza si status "0" con mensaje distinto de "No transactions found"
  export async function fetchAusdTransfers(address: Address, key: string): Promise<Transfer[]>;
  export function toMovements(transfers: Transfer[], self: Address): Movement[];
  export function pendingMovement(kind: MovementKind, amount: bigint, hash: Hex): Movement;  // status "Confirming", when = Date.now()/1000
  ```
  más `MONADSCAN_API`, `MONADSCAN_CHAIN_ID = 10143` en el mismo módulo; y en `config/explorer.ts` solo `MONADSCAN_KEY`.

- [ ] **Step 1: Escribir los tests**

`__tests__/explorer.test.ts`:

```ts
import type { Address } from "viem";
import { AUSD_FAUCET_ADDRESS } from "../src/config/chain";
import { parseTokenTxResponse, pendingMovement, toMovements, type Transfer } from "../src/wallet/explorer";

const ME = "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f" as const;
const OTHER = "0x51289183f21d0cfb0d698ca13c332c438749eb09" as const;

// Respuesta real de api.etherscan.io/v2 (chainid 10143, tokentx) del 2026-09-16, recortada a los campos que se usan.
const REAL = {
  status: "1",
  message: "OK",
  result: [
    { blockNumber: "62852614", timeStamp: "1789507960", hash: "0x7ef471355eeca24d0ea11638b40140e57c0a42d2955652d0a1bd45b4dd962ef1", from: "0x29458c602e3db4fc3b54ec2bbee26dbe64c7779f", to: OTHER, value: "5000000", tokenDecimal: "6" },
    { blockNumber: "62852451", timeStamp: "1789507911", hash: "0x74ddd9e604c8dc73298e5d91428b836b95418cd928969c35bce7c053f9eb9dc6", from: AUSD_FAUCET_ADDRESS.toLowerCase(), to: "0x29458c602e3db4fc3b54ec2bbee26dbe64c7779f", value: "10000000000", tokenDecimal: "6" },
  ],
};

test("parseTokenTxResponse turns the explorer payload into Transfers", () => {
  const t = parseTokenTxResponse(REAL);
  expect(t).toHaveLength(2);
  expect(t[0]).toEqual({ hash: REAL.result[0].hash, block: 62852614n, timestamp: 1789507960, from: REAL.result[0].from, to: OTHER, value: 5_000_000n });
});

test("parseTokenTxResponse treats 'No transactions found' as empty and other errors as failures", () => {
  expect(parseTokenTxResponse({ status: "0", message: "No transactions found", result: [] })).toEqual([]);
  expect(() => parseTokenTxResponse({ status: "0", message: "NOTOK", result: "Missing/Invalid API Key" })).toThrow(/Missing\/Invalid API Key/);
  expect(() => parseTokenTxResponse({ nonsense: true })).toThrow();
});

test("toMovements classifies faucet, deposit and withdrawal, case-insensitively, newest first", () => {
  const transfers: Transfer[] = [
    { hash: "0x1", block: 10n, timestamp: 100, from: OTHER, to: ME.toLowerCase() as Address, value: 7n },
    { hash: "0x3", block: 30n, timestamp: 300, from: ME.toLowerCase() as Address, to: OTHER, value: 5n },
    { hash: "0x2", block: 20n, timestamp: 200, from: AUSD_FAUCET_ADDRESS.toLowerCase() as Address, to: ME, value: 9n },
  ];
  const m = toMovements(transfers, ME);
  expect(m.map((x) => [x.hash, x.kind, x.sign, x.amount, x.status])).toEqual([
    ["0x3", "Withdrawal", "-", 5n, "Complete"],
    ["0x2", "Faucet", "+", 9n, "Complete"],
    ["0x1", "Deposit", "+", 7n, "Complete"],
  ]);
});

test("pendingMovement is a Confirming row with the right sign", () => {
  const w = pendingMovement("Withdrawal", 3n, "0xab");
  expect(w.status).toBe("Confirming");
  expect(w.sign).toBe("-");
  expect(pendingMovement("Faucet", 3n, "0xcd").sign).toBe("+");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/explorer.test.ts`
Expected: FAIL — módulo `../src/wallet/explorer` no existe.

- [ ] **Step 3: Crear `src/config/explorer.ts`**

Solo la key. Este módulo lee `expo-constants` y **lanza** si falta la key, así que ningún módulo puro (ni los tests) debe importarlo; lo consume `useTreasury`.

```ts
import Constants from "expo-constants";

const key = Constants.expoConfig?.extra?.monadscanKey;
if (typeof key !== "string" || key === "") {
  throw new Error("app.config.ts supplied no monadscanKey");
}

/** Key pública de explorer (solo lectura, testnet). Se rota desde etherscan.io si hace falta. */
export const MONADSCAN_KEY = key;
```

- [ ] **Step 4: Crear `src/wallet/explorer.ts`**

Puro salvo `fetch`; no importa `expo-constants` ni `react-native`.

```ts
import type { Address, Hex } from "viem";
import { AUSD_ADDRESS, AUSD_FAUCET_ADDRESS } from "../config/chain";

export const MONADSCAN_API = "https://api.etherscan.io/v2/api";
export const MONADSCAN_CHAIN_ID = 10143;

export type Transfer = { hash: Hex; block: bigint; timestamp: number; from: Address; to: Address; value: bigint };
export type MovementKind = "Faucet" | "Deposit" | "Withdrawal";
export type MovementStatus = "Complete" | "Confirming" | "Reverted";
export type Movement = { kind: MovementKind; amount: bigint; sign: "+" | "-"; when: number; hash: Hex; status: MovementStatus };

type TokenTx = { blockNumber: string; timeStamp: string; hash: string; from: string; to: string; value: string };

function isTokenTx(v: unknown): v is TokenTx {
  if (v === null || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return ["blockNumber", "timeStamp", "hash", "from", "to", "value"].every((k) => typeof r[k] === "string");
}

/** Lanza si la respuesta no es la de Etherscan V2 o trae un error distinto de "No transactions found". */
export function parseTokenTxResponse(body: unknown): Transfer[] {
  if (body === null || typeof body !== "object") throw new Error("Explorer returned no JSON object");
  const { status, message, result } = body as Record<string, unknown>;
  if (status === "0") {
    if (message === "No transactions found") return [];
    throw new Error(typeof result === "string" ? result : typeof message === "string" ? message : "Explorer error");
  }
  if (status !== "1" || !Array.isArray(result)) throw new Error("Explorer returned an unexpected payload");
  return result.map((row) => {
    if (!isTokenTx(row)) throw new Error("Explorer returned a malformed transfer");
    return {
      hash: row.hash as Hex,
      block: BigInt(row.blockNumber),
      timestamp: Number(row.timeStamp),
      from: row.from as Address,
      to: row.to as Address,
      value: BigInt(row.value),
    };
  });
}

export async function fetchAusdTransfers(address: Address, key: string): Promise<Transfer[]> {
  const url = `${MONADSCAN_API}?chainid=${MONADSCAN_CHAIN_ID}&module=account&action=tokentx&contractaddress=${AUSD_ADDRESS}&address=${address}&sort=desc&apikey=${key}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Explorer responded ${res.status}`);
  return parseTokenTxResponse(await res.json());
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function classify(t: Transfer, self: Address): { kind: MovementKind; sign: "+" | "-" } {
  if (same(t.from, AUSD_FAUCET_ADDRESS)) return { kind: "Faucet", sign: "+" };
  if (same(t.from, self)) return { kind: "Withdrawal", sign: "-" };
  return { kind: "Deposit", sign: "+" };
}

/** Más reciente primero. */
export function toMovements(transfers: Transfer[], self: Address): Movement[] {
  return [...transfers]
    .sort((a, b) => (a.block < b.block ? 1 : a.block > b.block ? -1 : 0))
    .map((t) => ({ ...classify(t, self), amount: t.value, when: t.timestamp, hash: t.hash, status: "Complete" as const }));
}

export function pendingMovement(kind: MovementKind, amount: bigint, hash: Hex): Movement {
  return { kind, amount, sign: kind === "Withdrawal" ? "-" : "+", when: Math.floor(Date.now() / 1000), hash, status: "Confirming" };
}
```

- [ ] **Step 5: Añadir la key a `app.config.ts`**

```ts
const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
// Key de MonadScan (Etherscan V2). Pública, solo lectura, testnet; se rota desde etherscan.io.
const monadscanKey = process.env.PICKLER_MONADSCAN_KEY ?? "AHQMBTI74BYK33SZS47XF49SIADAG9VUYW";
```
y `extra: { rpId, monadscanKey }`.

- [ ] **Step 6: Verificar que pasan**

Run: `npx jest __tests__/explorer.test.ts && npx tsc --noEmit`
Expected: PASS 4/4; tsc limpio.

- [ ] **Step 7: Commit**

```bash
git add src/config/explorer.ts src/wallet/explorer.ts app.config.ts __tests__/explorer.test.ts
git commit -m "feat(mobile): historial de transferencias AUSD vía MonadScan"
```

---

### Task 5: `validateWithdraw`

**Files:**
- Create: `apps/mobile/src/wallet/withdraw.ts`
- Test: `apps/mobile/__tests__/withdraw.test.ts`

**Interfaces:**
- Consumes: `parseAusd` (Task 2), `isAddress` de viem.
- Produces:
  ```ts
  export type WithdrawInput = { to: string; amount: string; ausd: bigint };
  export type WithdrawCheck = { ok: true; to: Address; amount: bigint } | { ok: false; error: string };
  export function validateWithdraw(input: WithdrawInput): WithdrawCheck;
  ```

- [ ] **Step 1: Escribir el test**

`__tests__/withdraw.test.ts`:

```ts
import { validateWithdraw } from "../src/wallet/withdraw";

const to = "0x51289183f21d0cfb0d698ca13c332c438749eb09";

test("a valid address and an amount within balance are ok", () => {
  expect(validateWithdraw({ to, amount: "1.5", ausd: 2_000_000n })).toEqual({ ok: true, to, amount: 1_500_000n });
});

test("an invalid address is rejected", () => {
  expect(validateWithdraw({ to: "0x123", amount: "1", ausd: 2_000_000n })).toEqual({ ok: false, error: "That is not a valid Monad address." });
  expect(validateWithdraw({ to: "", amount: "1", ausd: 2_000_000n })).toEqual({ ok: false, error: "Paste the destination address." });
});

test("zero, unparsable and over-balance amounts are rejected", () => {
  expect(validateWithdraw({ to, amount: "0", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "abc", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "", ausd: 2_000_000n })).toEqual({ ok: false, error: "Enter an amount above zero." });
  expect(validateWithdraw({ to, amount: "2.000001", ausd: 2_000_000n })).toEqual({ ok: false, error: "That is more than the 2.00 AUSD available." });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx jest __tests__/withdraw.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Crear `src/wallet/withdraw.ts`**

```ts
import { type Address, isAddress } from "viem";
import { formatAusd, parseAusd } from "../config/chain";

export type WithdrawInput = { to: string; amount: string; ausd: bigint };
export type WithdrawCheck = { ok: true; to: Address; amount: bigint } | { ok: false; error: string };

/** Validación previa a Review. No toca la red. */
export function validateWithdraw({ to, amount, ausd }: WithdrawInput): WithdrawCheck {
  const dest = to.trim();
  if (dest === "") return { ok: false, error: "Paste the destination address." };
  if (!isAddress(dest)) return { ok: false, error: "That is not a valid Monad address." };
  const units = parseAusd(amount);
  if (units === undefined || units === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (units > ausd) return { ok: false, error: `That is more than the ${formatAusd(ausd)} AUSD available.` };
  return { ok: true, to: dest, amount: units };
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx jest __tests__/withdraw.test.ts && npx tsc --noEmit`
Expected: PASS 3/3; tsc limpio.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/withdraw.ts __tests__/withdraw.test.ts
git commit -m "feat(mobile): validación pura de withdraw"
```

---

### Task 6: `useTreasury` — movimientos, tx en vuelo y withdraw

**Files:**
- Modify: `apps/mobile/src/hooks/useTreasury.ts`

**Interfaces:**
- Consumes: `fetchAusdTransfers`, `toMovements`, `pendingMovement`, `Movement` (Task 4); `MONADSCAN_KEY` (Task 4); `sendAusd`, `estimateAusdTransferFee` (Task 3); `waitForReceipt`, `readBalances`, `requestAusdFromFaucet` (existentes).
- Produces (añadido a `Treasury`):
  ```ts
  movements: Movement[] | null;      // null = cargando
  movementsError: string;
  pending: Movement[];               // tx propias sin recibo (Confirming) o revertidas (Reverted) hasta el siguiente refresh
  refreshMovements: () => Promise<void>;
  estimateFee: (to: Address, amount: bigint) => Promise<bigint>;
  withdraw: (to: Address, amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;  // rechaza con el error crudo
  ```
  `refresh()` ahora también dispara `refreshMovements()`. El faucet registra su tx en `pending` como `Faucet`.

- [ ] **Step 1: Reescribir `src/hooks/useTreasury.ts`**

```ts
import { useCallback, useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { accountAddress, type AccountState } from "../account";
import { MONADSCAN_KEY } from "../config/explorer";
import { estimateAusdTransferFee, readBalances, requestAusdFromFaucet, sendAusd, waitForReceipt } from "../wallet/chain";
import { fetchAusdTransfers, type Movement, type MovementKind, pendingMovement, toMovements } from "../wallet/explorer";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

export type Balances = { ausd: bigint; mon: bigint };

export type Treasury = {
  balances: Balances | null;
  rpcError: string;
  busy: boolean;
  notice: string;
  error: string;
  movements: Movement[] | null;
  movementsError: string;
  pending: Movement[];
  refresh: () => Promise<void>;
  refreshMovements: () => Promise<void>;
  getTestAusd: () => Promise<void>;
  estimateFee: (to: Address, amount: bigint) => Promise<bigint>;
  withdraw: (to: Address, amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
};

const FAUCET_AMOUNT = 10_000_000_000n; // 10,000 AUSD, lo que da requestFunds

export function useTreasury(account: AccountState, onUnlock: (w: Wallet) => void): Treasury {
  const address = accountAddress(account);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [movementsError, setMovementsError] = useState("");
  const [pending, setPending] = useState<Movement[]>([]);

  const refreshMovements = useCallback(async () => {
    setMovementsError("");
    if (!address) {
      setMovements(null);
      return;
    }
    try {
      setMovements(toMovements(await fetchAusdTransfers(address, MONADSCAN_KEY), address));
    } catch (e) {
      setMovementsError(describeError(e) || "Couldn't load movements.");
    }
  }, [address]);

  const refresh = useCallback(async () => {
    setRpcError("");
    if (!address) {
      setBalances(null);
      setPending([]);
      void refreshMovements();
      return;
    }
    setPending((p) => p.filter((m) => m.status === "Confirming")); // las Reverted viven hasta el siguiente refresh
    const [result] = await Promise.all([
      readBalances(address).then((b) => ({ ok: true as const, b })).catch((e: unknown) => ({ ok: false as const, e })),
      refreshMovements(),
    ]);
    if (result.ok) {
      setBalances(result.b);
    } else {
      setBalances(null);
      setRpcError(describeError(result.e));
    }
  }, [address, refreshMovements]);

  useEffect(() => {
    setNotice("");
    setError("");
    void refresh();
  }, [refresh]);

  /** Wallet desbloqueada: la de la cuenta, o la guardada (pide Face ID) avisando a useAccount. */
  const openWallet = useCallback(async (): Promise<Wallet> => {
    if (account.status === "unlocked") return account.wallet;
    const unlocked = await unlockStoredWallet();
    if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
    onUnlock(unlocked);
    return unlocked;
  }, [account, onUnlock]);

  /** Registra la tx en vuelo, espera el recibo y refresca. Quita la fila si confirmó; la deja como Reverted si no. */
  const track = useCallback(async (kind: MovementKind, amount: bigint, hash: Hex): Promise<"success" | "reverted"> => {
    const row = pendingMovement(kind, amount, hash);
    setPending((p) => [row, ...p]);
    const status = await waitForReceipt(hash);
    setPending((p) => status === "success" ? p.filter((m) => m.hash !== hash) : p.map((m) => m.hash === hash ? { ...m, status: "Reverted" } : m));
    await refresh();
    return status;
  }, [refresh]);

  const getTestAusd = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fresh = await readBalances(address);
      setBalances(fresh);
      if (fresh.mon === 0n) {
        throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
      }
      const wallet = await openWallet();
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await track("Faucet", FAUCET_AMOUNT, hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, openWallet, track]);

  const estimateFee = useCallback(async (to: Address, amount: bigint): Promise<bigint> => {
    if (!address) throw new Error("No account.");
    return estimateAusdTransferFee(address, to, amount);
  }, [address]);

  const withdraw = useCallback(async (to: Address, amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted"> => {
    if (!address) throw new Error("No account.");
    const fresh = await readBalances(address);
    setBalances(fresh);
    if (fresh.mon === 0n) throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
    if (amount > fresh.ausd) throw new Error("That is more than the AUSD available.");
    const wallet = await openWallet();
    const hash = await sendAusd(wallet, to, amount);
    onSent(hash);
    return track("Withdrawal", amount, hash);
  }, [address, openWallet, track]);

  return { balances, rpcError, busy, notice, error, movements, movementsError, pending, refresh, refreshMovements, getTestAusd, estimateFee, withdraw };
}
```

Con Sign out (`address` = null) `pending` se vacía; un `refresh()` manual limpia las filas `Reverted` y conserva las `Confirming`.

- [ ] **Step 2: Verificar tipos y tests**

Run: `npx tsc --noEmit && npm test`
Expected: tsc limpio (nada consume aún los campos nuevos, pero `Treasury` cambió y `App.tsx` sigue compilando); jest todo en verde.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useTreasury.ts
git commit -m "feat(mobile): useTreasury con movimientos reales, tx en vuelo y withdraw"
```

---

### Task 7: `WalletScreen` — movements reales y línea de pending

**Files:**
- Modify: `apps/mobile/src/screens/own.tsx` (`WalletScreen`, tipo `Move`)

**Interfaces:**
- Consumes: `treasury.movements`, `treasury.movementsError`, `treasury.pending`, `treasury.refreshMovements` (Task 6); `formatAusd`, `shortHash`, `EXPLORER_TX_URL` (config/chain); `Movement` (wallet/explorer).

- [ ] **Step 1: Reemplazar la lista mock por la real**

En `own.tsx`: borrar `type Move` y el arreglo `moves`; importar `shortHash` de `../config/chain` y `type Movement` de `../wallet/explorer`. Añadir arriba de `WalletScreen`:

```tsx
function movementDate(when: number): string {
  return new Date(when * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

const STATUS_FG: Record<Movement["status"], string> = { Complete: C.up, Confirming: C.warn, Reverted: C.down };

function MovementRow({ m }: { m: Movement }) {
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
        <T w={600} s={13} lh={1.2}>{m.kind}</T>
        <T w={500} s={13} lh={1.2} mono color={m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)} AUSD</T>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
        <T w={400} s={11} lh={1.3} mono color={C.mute}>{movementDate(m.when)} · {shortHash(m.hash)}</T>
        <T w={500} s={11} lh={1.3} color={STATUS_FG[m.status]}>{m.status}</T>
      </View>
    </Touch>
  );
}
```

En `WalletScreen`, reemplazar el cálculo de `pending` y la sección MOVEMENTS:

```tsx
  const confirming = treasury.pending.filter((m) => m.status === "Confirming").length;
  const pending = confirming === 0
    ? "Nothing pending."
    : `${confirming} transfer${confirming === 1 ? "" : "s"} confirming`;
  const rows = [...treasury.pending, ...(treasury.movements ?? [])];
```

```tsx
      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>MOVEMENTS</T>
        <View style={{ gap: 6 }}>
          {treasury.movementsError ? (
            <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12, gap: 8 }}>
              <T w={400} s={12} lh={1.4} color={C.warn}>Couldn't load movements. {treasury.movementsError}</T>
              <Touch onPress={() => { void treasury.refreshMovements(); }} style={{ alignSelf: "flex-start", ...chipBtn }}>
                <T w={600} s={12}>Retry</T>
              </Touch>
            </View>
          ) : null}
          {treasury.movements === null && !treasury.movementsError ? (
            <T w={400} s={12} lh={1.4} color={C.mute}>Loading movements…</T>
          ) : null}
          {treasury.movements !== null && rows.length === 0 ? (
            <T w={400} s={12} lh={1.4} color={C.mute}>Nothing has ever arrived in this wallet.</T>
          ) : null}
          {rows.map((m) => <MovementRow key={m.hash} m={m} />)}
        </View>
      </View>
```

`balance` deja de usarse en `WalletScreen`: quitarlo de la destructuración.

- [ ] **Step 2: Verificar tipos y tests**

Run: `npx tsc --noEmit && npm test`
Expected: limpio y verde.

- [ ] **Step 3: Commit**

```bash
git add src/screens/own.tsx
git commit -m "feat(mobile): Movements reales en Wallet con tx en vuelo"
```

---

### Task 8: `WithdrawScreen` real

**Files:**
- Modify: `apps/mobile/src/screens/own.tsx` (`WithdrawScreen`)

**Interfaces:**
- Consumes: `validateWithdraw` (Task 5); `treasury.balances`, `treasury.estimateFee`, `treasury.withdraw` (Task 6); `formatAusd`, `formatMon`, `shortHash`, `EXPLORER_TX_URL`; `describeError` (wallet/wallet); `textStyle` (ui/theme); `TextInput` y `Linking` de react-native; `expo-clipboard`.

- [ ] **Step 1: Reemplazar `WithdrawScreen`**

Imports nuevos en `own.tsx`: `TextInput` de `react-native`; `textStyle` de `../ui/theme`; `validateWithdraw` de `../wallet/withdraw`; `describeError` de `../wallet/wallet`; `formatMon` ya viene de `../config/chain`; `type Address, type Hex` de `viem`.

```tsx
type WithdrawStep = { step: "edit" } | { step: "review"; to: Address; amount: bigint; fee: bigint | null } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex };

const inputStyle = { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair2, borderRadius: 11, backgroundColor: C.surf } as const;

export function WithdrawScreen({ nav, treasury }: AppCtx) {
  const ausd = treasury.balances?.ausd ?? 0n;
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [st, setSt] = useState<WithdrawStep>({ step: "edit" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = validateWithdraw({ to, amount, ausd });

  const review = async () => {
    if (!check.ok) return;
    setError("");
    setSt({ step: "review", to: check.to, amount: check.amount, fee: null });
    try {
      const fee = await treasury.estimateFee(check.to, check.amount);
      setSt((s) => s.step === "review" ? { ...s, fee } : s);
    } catch (e) {
      setError(describeError(e) || "Couldn't estimate the network fee.");
    }
  };

  const confirm = async () => {
    if (st.step !== "review") return;
    setBusy(true);
    setError("");
    try {
      const status = await treasury.withdraw(st.to, st.amount, (hash) => setSt({ step: "sent", hash }));
      setSt((s) => s.step === "sent" ? { step: status === "success" ? "done" : "failed", hash: s.hash } : s);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (st.step === "sent" || st.step === "done" || st.step === "failed") {
    const tone = st.step === "done" ? { title: "Withdrawal complete", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)" }
      : st.step === "failed" ? { title: "Withdrawal reverted", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)" }
      : { title: "Sent · waiting for confirmation", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" };
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
          <T w={700} s={14} color={tone.fg}>{tone.title}</T>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}>
            <T w={400} s={11.5} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
        </View>
        {st.step !== "sent" ? (
          <Touch onPress={() => nav("wallet")} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" }}>
            <T w={700} s={14.5} color={C.onLime}>Back to wallet</T>
          </Touch>
        ) : <ActivityIndicator color={C.lime} />}
      </View>
    );
  }

  if (st.step === "review") {
    const rows = [
      { label: "Network", value: "Monad", fg: C.ink },
      { label: "Network fee", value: st.fee === null ? "estimating…" : `~${formatMon(st.fee)} MON`, fg: C.dim },
      { label: "Platform fee", value: "0.00 AUSD", fg: C.dim },
      { label: "You receive", value: `${formatAusd(st.amount)} AUSD`, fg: C.lime },
    ];
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 13, borderWidth: 1, borderColor: C.hair, borderRadius: 13, backgroundColor: C.surf }}>
          <T w={400} s={11} color={C.mute}>Destination address</T>
          <T w={500} s={12.5} lh={1.45} mono style={{ marginTop: 6 }}>{st.to}</T>
        </View>
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount to withdraw</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(st.amount)}</T>
            <T w={500} s={14} mono color={C.mute}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          {rows.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
        </View>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => { setError(""); setSt({ step: "edit" }); }} disabled={busy} style={secondaryBtn}>
            <T w={700} s={13.5}>Edit</T>
          </Touch>
          <Touch onPress={() => { void confirm(); }} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>Confirm withdrawal</T>}
          </Touch>
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.mute}>Gas is paid in MON from this wallet. The AUSD amount arrives in full.</T>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      <View style={inputStyle}>
        <T w={400} s={11} color={C.mute}>Destination address</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Paste a Monad address"
            placeholderTextColor={C.mute}
            autoCapitalize="none"
            autoCorrect={false}
            style={[textStyle(500, 12.5, { mono: true, color: C.ink }), { flex: 1, paddingVertical: 6 }]}
          />
          <Touch onPress={() => { void Clipboard.getStringAsync().then((s) => setTo(s.trim())); }} style={chipBtn}>
            <T w={600} s={12}>Paste</T>
          </Touch>
        </View>
      </View>
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount to withdraw</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.mute}
            keyboardType="decimal-pad"
            style={[textStyle(800, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]}
          />
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
          <Touch onPress={() => setAmount(formatAusd(ausd))} style={chipBtn}>
            <T w={600} s={12}>Max</T>
          </Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{formatAusd(ausd)} AUSD available</T>
      </View>
      {!check.ok && (to !== "" || amount !== "") ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Touch onPress={() => { void review(); }} disabled={!check.ok} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: check.ok ? C.lime : C.tile, alignItems: "center" }}>
        <T w={700} s={14.5} color={check.ok ? C.onLime : C.disabled}>Review withdrawal</T>
      </Touch>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Only AUSD on Monad. Gas is paid in MON from this wallet.</T>
    </View>
  );
}
```

`money` y `balance` dejan de usarse en `WithdrawScreen`; si `money` ya no se usa en `own.tsx` (Portfolio sí lo usa), dejar el import.

- [ ] **Step 2: Verificar tipos y tests**

Run: `npx tsc --noEmit && npm test`
Expected: limpio y verde.

- [ ] **Step 3: Commit**

```bash
git add src/screens/own.tsx
git commit -m "feat(mobile): Withdraw real de AUSD con review, firma y recibo"
```

---

### Task 9: README y verificación manual en simulador

**Files:**
- Modify: `apps/mobile/README.md`

- [ ] **Step 1: Documentar la key y el historial en `README.md`**

Añadir, junto a donde se explica `PICKLER_RP_ID`/`app.config.ts`:

```md
### Historial de movimientos (MonadScan)

*Wallet → Movements* lee las transferencias AUSD de la dirección desde Etherscan V2
(`chainid=10143`, MonadScan). La key va en `app.config.ts` → `extra.monadscanKey`
(override con `PICKLER_MONADSCAN_KEY`). Es una key pública de solo lectura; si se
agota la cuota (100k llamadas/día) se crea otra en https://etherscan.io/myapikey.
El RPC público no sirve para esto: `eth_getLogs` está limitado a 100 bloques.
```

- [ ] **Step 2: Arrancar en el simulador**

Run (desde `apps/mobile`): `npx expo run:ios --port 8090` (8081 puede estar ocupado por otro worktree; no matar Metros ajenos). Simulador "iPhone 17 Pro" iOS 26.5 con Face ID inscrito (`docs/05-handoff-fase1.md` §3). Si `app.config.ts` cambió, `expo run:ios` regenera el prebuild solo.

- [ ] **Step 3: Verificar y capturar (scratchpad `shots/`)**

1. Market: tab bar con cuatro iconos (Market relleno en lima) y logo en el header sin hueco → `01-market-icons.png`.
2. Wallet con cuenta: MOVEMENTS lista real (al menos el faucet de fase 1 si es la cuenta de prueba, o "Nothing has ever arrived…" en cuenta nueva); línea "Nothing pending." → `02-wallet-movements.png`.
3. Withdraw: pegar una dirección válida distinta (p. ej. `0x51289183f21d0cfb0d698ca13c332c438749eb09`), monto `1`, botón habilitado; Review muestra "Network fee ~0.00xx MON" real → `03-withdraw-review.png`.
4. Confirm → Face ID (`xcrun simctl spawn <udid> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`) → "Sent · waiting" → "Withdrawal complete" → `04-withdraw-done.png`. Anotar el hash.
5. Back to wallet: la fila `Withdrawal −1.00 AUSD` aparece con `Complete` y la fecha de hoy; saldo AUSD bajó 1.00 → `05-wallet-after.png`. Abrir el hash en https://testnet.monadscan.com/tx/<hash> y confirmar `transfer` de 1,000,000 unidades.
6. Contra el defecto: dirección `0x123` → "That is not a valid Monad address."; monto mayor al saldo → "That is more than the X AUSD available."; botón deshabilitado.
7. Sin red (Wi-Fi del Mac apagado un momento o key inválida vía `PICKLER_MONADSCAN_KEY=bad`): saldos siguen, Movements muestra "Couldn't load movements… Retry".

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(mobile): historial vía MonadScan y key de explorer"
```

---

## Verificación final de la fase

- `npx tsc --noEmit` limpio; `npm test` completo en verde (41 previos + chain 4 + transfer 2 + explorer 4 + withdraw 3).
- Capturas 01–05 en el scratchpad y hash del withdraw real en MonadScan.
- Revisión independiente de la rama completa por subagente (lógica, firma, manejo de errores, contrato del hook) antes de cerrar.
- Handoff en `docs/07-handoff-wallet.md`: qué quedó, decisiones tomadas en ejecución, pendientes (build 3 sigue con su lista en `docs/06-handoff-ui-port.md`).
