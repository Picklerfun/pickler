# Trading manual en Perpl (pestaña Trade) — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una pestaña nueva **Trade** donde el usuario habilita trading en Perpl (approve + createAccount + forwarding + API key), ve saldo/mercados/posiciones por WebSocket, abre y cierra perps con orden de mercado (1x–5x, capado por mercado) y mueve AUSD entre la wallet y la cuenta de trading.

**Architecture:** Módulos puros nuevos en `src/perpl/` (config, context, orders, apiKey, onboarding, enable, ws) sin `react-native` ni `expo-constants`, testeados en Jest con **fixtures reales** capturados contra la testnet (`__tests__/fixtures/perpl/`). `storage/perpl.ts` guarda la key en SecureStore. `hooks/usePerpl.ts` orquesta (estado, socket, polling de `context`, onboarding reanudable, fondos, órdenes) y comparte el desbloqueo con `useTreasury` vía `hooks/useUnlock.ts`. Tres pantallas (`perps`, `perpsMarket`, `perpsFunds`) en archivos separados; `store.ts`/`Shell.tsx` las registran.

**Tech Stack:** Expo SDK 57 / RN 0.86 / React 19.2 / TS 6 / viem 2.55.13 / `@noble/curves` **2.2.0** (Ed25519; ya instalado como transitiva de viem, se fija como dependencia directa). Jest (`jest-expo`).

**Spec:** `docs/superpowers/specs/2026-09-16-mobile-perpl-design.md` (autoridad). Insumos: `docs/investigacion/perpl.md` (trampas), `docs/07-handoff-wallet.md` (lecciones).

## Global Constraints

- Worktree `.claude/worktrees/mobile-perpl` (rama `feat/mobile-perpl`, base `main` `2d928fc`). Comandos `npm`/`npx` desde `apps/mobile/` de ese worktree; `node_modules` ya instalado (**no** correr `npm ci`/`npm install` en paralelo con otros agentes). **Nunca `git add -A`**; archivos por nombre. Los agentes que corren en paralelo **no commitean**: el coordinador commitea por nombre. **No hay push.**
- Versiones **exactas** en `package.json`. Código nuevo `.ts`/`.tsx`, comillas dobles, sin `import React`, sin `any`. `npx tsc --noEmit` limpio en **cada** tarea; `npm test` completo en verde.
- `src/perpl/*`, `src/storage/perpl.ts`, `src/store.ts` **no importan `react-native` ni `expo-constants`** (solo `fetch`, `WebSocket` global, viem, noble, scure). El único módulo que lee `expo-constants` es `src/config/perpl.ts` (como `config/explorer.ts`); ningún test lo importa.
- **APIs web se verifican contra el polyfill de RN**: timeouts con `AbortController` + `setTimeout` (nunca `AbortSignal.timeout`); `WebSocket` global de RN (eventos `onopen/onmessage/onclose/onerror`, `ev.data` string); nada de `Buffer` (usar `@scure/base` y `TextEncoder`).
- Montos AUSD en `bigint` de 6 decimales (`formatAusd`/`parseAusd` de `config/chain.ts`). Precios y tamaños escalados de Perpl en `number` (son enteros JSON < 2^53). Apalancamiento en hundredths en el wire (`lv: 100` = 1x).
- `rq = max(lfr, último enviado) + 1`; `lb = head + order_ttl_blocks`; **nunca** timestamp ni `lb: 0`. Un `rq` repetido se ignora en silencio. Ping `mt: 1` cada 3 s. Sign-in `mt: 29` como **primer** frame.
- `getAccountByAddr` **revierte** sin cuenta (selector de error `0x03a0e277`) → se lee como `0n`. Devuelve un struct; el primer word es el id (decodificar como `uint256` lee el id).
- `enroll` **sin header `Origin`**, `scope_mask: 3`, `label: "Pickler iOS"`. Key en SecureStore `pickler.perpl.v1` **sin** `requireAuthentication`.
- Copy en inglés, tono de la app. `C.up`/`C.down` para PnL; precios con `priceDecimals` del mercado. Pantallas existentes (Market, Trade de tokens, Portfolio, Activity, Wallet salvo la línea nueva) **no cambian**.
- Cada test se corre **contra el defecto** (paso "verificar que falla") antes de implementar. Mensajes de commit: conventional commits, cuerpo opcional, **línea en blanco antes de los trailers**.

## Rulings (desviaciones medidas del spec, 2026-09-16)

1. **`initial_margin` es el apalancamiento máximo ×100**, no un porcentaje. Medido: `lv: 500` en MON (im 300) se acepta pero la posición queda con `lv: 300` (fixture `positionOpenedLv500Clamped`). El selector muestra solo `LEVERAGES.filter(lv => lv * 100 <= market.initialMargin)` (MON: 1x·2x·3x; BTC: hasta 5x). `Market` gana `maxLeverage = initialMargin / 100`.
2. **`maintenance_margin` es fracción del margen inicial en bps** (MON 500 = 5 %, BTC 2500 = 25 %). Fracción de mantenimiento sobre nominal = `mm / 10000 / maxLeverage` (MON ≈ 1.67 %). La estimación de liquidación usa esa fracción; se rotula "est.".
3. **Fee taker redondea hacia arriba**: notional 2,221,000 × 345 micros = 766.2 → cobrado 767 (fixture `orderFilledOpen`). `takerFee` usa `ceil`.
4. **`getAccountByAddr` devuelve un struct** (id, balance, …); decodificar como `uint256` lee el id (verificado por RPC: `0x26b` = 619).
5. **Paso 3 (forwarding) no tiene getter on-chain**: en un reintento se vuelve a enviar `allowOrderForwarding(true)` salvo que el hook ya lo haya hecho en esta sesión o el snapshot vivo diga `fw: true`. Es idempotente (71k gas).
6. Los `sr` reales medidos: `32` (rq ≤ lfr), `43` (filled), `st: 7` con `r: true` y `oid: 0` para fallos. `mt: 3 code 400` con `lb ≤ head` **no consume `rq`**.

---

## Mapa de archivos

**Se crean** (`apps/mobile/`):

| Archivo | Responsabilidad |
|---|---|
| `src/perpl/config.ts` | Constantes (chain, URLs testnet, exchange, ABI, label, tiempos, `LEVERAGES`). Puro. |
| `src/config/perpl.ts` | `PERPL_URLS` desde `expo-constants` (`extra.perplRest/perplWs`) con fallback a `perpl/config.ts`. Solo lo importa `usePerpl`. |
| `src/perpl/context.ts` | `Market`, `Instance`, `Context`, `parseContext`, `fetchContext(rest)`. |
| `src/perpl/orders.ts` | Matemática (`sizeFromAusd`, `notionalAusd`, `takerFee`, `liquidationPrice`, `positionPnl`, `change24h`), `leveragesFor`, `OrderIntent`/`orderFrame`/`openIntent`/`closeIntent`, `describeOrderStatus`, `formatPrice`, `formatSize`. |
| `src/perpl/apiKey.ts` | Ed25519: `generateTradingKey`, `wsSigninCanonical`, `signWsSignin`, `normalizeTypedData`, `enrollTradingKey`. |
| `src/perpl/onboarding.ts` | Calldata + lecturas + envíos on-chain (approve, createAccount, forwarding, deposit, withdraw). |
| `src/perpl/enable.ts` | Máquina de 4 pasos reanudable (`runEnable`) con dependencias inyectadas. |
| `src/perpl/ws.ts` | Tipos de frames, `parseFrame`, `applyFrame` (puros) y `class TradingSocket`. |
| `src/storage/perpl.ts` | `TradingKey`, `parseTradingKey`, `loadTradingKey`, `saveTradingKey`, `clearTradingKey`. |
| `src/hooks/useUnlock.ts` | `useUnlock(account, onUnlock)` → `openWallet` compartido. |
| `src/hooks/usePerpl.ts` | `Perpl`, `PerplState`, `usePerpl(...)`. |
| `src/screens/perps.tsx` | `PerpsScreen` (none / onboarding / ready: saldo, mercados, posiciones, Close). |
| `src/screens/perpsMarket.tsx` | `PerpsMarketScreen` (Long/Short, monto, lv, review, confirm, resultado) y `OrderResultCard` compartida. |
| `src/screens/perpsFunds.tsx` | `PerpsFundsScreen` (Add funds / Withdraw to wallet). |
| `__tests__/fixtures/perpl/context.json`, `ws-frames.json`, `apikey-payload.json` | Capturas reales de testnet (ya en el worktree). |
| `__tests__/perpl-config.test.ts`, `perpl-context.test.ts`, `perpl-orders.test.ts`, `perpl-apikey.test.ts`, `perpl-onboarding.test.ts`, `perpl-storage.test.ts`, `perpl-frames.test.ts`, `perpl-socket.test.ts`, `perpl-enable.test.ts` | Tests nuevos. |

**Se modifican:** `package.json` (+`@noble/curves`), `app.config.ts` (+`extra.perplRest/perplWs`), `src/config/chain.ts` (+`approve`/`allowance` en `ERC20_ABI`), `src/store.ts`, `__tests__/store.test.ts`, `src/hooks/useAccount.ts` (signOut borra la key), `src/hooks/useTreasury.ts` (usa `useUnlock`), `src/ctx.ts`, `App.tsx`, `src/Shell.tsx`, `src/screens/own.tsx` (línea "in trading"), `README.md`.

## Paralelismo

- **Task 1** sola (toca `package.json`/`node_modules`).
- **Ola A** (archivos disjuntos, en paralelo): Tasks 2, 3, 4, 5, 6, 7, 9, 10.
- **Task 8** después de 7 (mismo archivo `ws.ts`).
- **Task 11** después de 2–10.
- **Ola B** (paralelo): Tasks 12 y 13.
- **Task 14** al final (integra `perps.tsx`, `Shell.tsx`, `own.tsx`, README).

---

### Task 1: Config de Perpl, ABI ERC-20 ampliado y dependencia Ed25519

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.config.ts`
- Modify: `apps/mobile/src/config/chain.ts:11-14` (`ERC20_ABI`)
- Create: `apps/mobile/src/perpl/config.ts`
- Create: `apps/mobile/src/config/perpl.ts`
- Test: `apps/mobile/__tests__/perpl-config.test.ts`, `__tests__/chain.test.ts`
- Ya commiteados con el plan: `apps/mobile/__tests__/fixtures/perpl/*.json`

**Interfaces:**
- Produces: `PERPL_CHAIN_ID`, `PERPL_REST`, `PERPL_WS`, `EXCHANGE_ADDRESS`, `EXCHANGE_ABI`, `TRADING_KEY_LABEL`, `PING_MS`, `ORDER_TIMEOUT_MS`, `CONTEXT_POLL_MS`, `CONTEXT_TIMEOUT_MS`, `LEVERAGES`, `RECONNECT_DELAYS_MS`, `PRIORITY_FEE_WEI`; `ERC20_ABI` con `approve`/`allowance`; `PERPL_URLS: { rest: string; ws: string }`.

- [ ] **Step 1: Fijar `@noble/curves` como dependencia directa (versión exacta, la ya instalada)**

Run: `cd apps/mobile && npm install --save-exact @noble/curves@2.2.0`
Expected: `grep '"@noble/curves"' package.json` → `"@noble/curves": "2.2.0"`; `git diff --stat package-lock.json` pequeño (solo la entrada de dependencias raíz).

- [ ] **Step 2: Escribir los tests**

`__tests__/perpl-config.test.ts`:

```ts
import { toFunctionSelector } from "viem";
import {
  EXCHANGE_ABI,
  EXCHANGE_ADDRESS,
  LEVERAGES,
  PERPL_CHAIN_ID,
  PERPL_REST,
  PERPL_WS,
  PING_MS,
  TRADING_KEY_LABEL,
} from "../src/perpl/config";

test("Perpl testnet constants match the verified context", () => {
  expect(PERPL_CHAIN_ID).toBe(10143);
  expect(PERPL_REST).toBe("https://testnet.perpl.xyz/api");
  expect(PERPL_WS).toBe("wss://testnet.perpl.xyz/ws/v1/trading");
  expect(EXCHANGE_ADDRESS).toBe("0x1964c32f0be608e7d29302aff5e61268e72080cc");
  expect(TRADING_KEY_LABEL).toBe("Pickler iOS");
  expect(PING_MS).toBe(3000);
  expect(LEVERAGES).toEqual([1, 2, 3, 5]);
});

// Selectores confirmados en la implementación 0xbcbd37…adbb (docs/investigacion/perpl.md).
test.each([
  ["createAccount", "0xcab13915"],
  ["allowOrderForwarding", "0x7962f910"],
  ["getAccountByAddr", "0x12e8eb2c"],
  ["depositCollateral", "0xbad4a01f"],
  ["withdrawCollateral", "0x6112fe2e"],
])("exchange ABI %s has the on-chain selector", (name, selector) => {
  const fn = EXCHANGE_ABI.find((f) => f.type === "function" && f.name === name);
  expect(fn).toBeDefined();
  expect(toFunctionSelector(fn!)).toBe(selector);
});
```

Añadir al final de `__tests__/chain.test.ts`:

```ts
test("ERC20 ABI has approve and allowance", () => {
  const names = ERC20_ABI.filter((f) => f.type === "function").map((f) => f.name);
  expect(names).toEqual(expect.arrayContaining(["balanceOf", "transfer", "approve", "allowance"]));
});
```

- [ ] **Step 3: Verificar que fallan**

Run: `npx jest __tests__/perpl-config.test.ts __tests__/chain.test.ts`
Expected: FAIL — `../src/perpl/config` no existe; el test del ABI falla por `approve`/`allowance` ausentes.

- [ ] **Step 4: Implementar**

`src/config/chain.ts` — reemplazar `ERC20_ABI`:

```ts
export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);
```

`src/perpl/config.ts`:

```ts
import { type Address, parseAbi } from "viem";

// Perpl testnet, verificado contra GET /api/v1/pub/context el 2026-09-16 (docs/investigacion/perpl.md).
export const PERPL_CHAIN_ID = 10143;
export const PERPL_REST = "https://testnet.perpl.xyz/api";
export const PERPL_WS = "wss://testnet.perpl.xyz/ws/v1/trading";
export const PERPL_WEB = "https://testnet.perpl.xyz";

export const EXCHANGE_ADDRESS: Address = "0x1964c32f0be608e7d29302aff5e61268e72080cc";
// getAccountByAddr devuelve un struct; el primer word es el id, así que decodificar uint256 lo lee. Revierte (0x03a0e277) sin cuenta.
export const EXCHANGE_ABI = parseAbi([
  "function createAccount(uint256 amount) returns (uint256)",
  "function allowOrderForwarding(bool allow)",
  "function getAccountByAddr(address addr) view returns (uint256)",
  "function depositCollateral(uint256 amount)",
  "function withdrawCollateral(uint256 amount)",
]);

export const TRADING_KEY_LABEL = "Pickler iOS";
export const TRADING_KEY_SCOPE = 3; // read | trade; nunca withdraw

export const PING_MS = 3000; // idle 10 s testnet, 5 s mainnet
export const ORDER_TIMEOUT_MS = 30_000;
export const CONTEXT_POLL_MS = 5000;
export const CONTEXT_TIMEOUT_MS = 15_000;
export const ENROLL_TIMEOUT_MS = 15_000;
export const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const;
export const SOCKET_GRACE_MS = 2000;

export const LEVERAGES = [1, 2, 3, 5] as const;
export type Leverage = (typeof LEVERAGES)[number];

/** Un reintento debe reemplazar una tx descartada por falta de MON (lección del spike). */
export const PRIORITY_FEE_WEI = 20_000_000_000n;
```

`src/config/perpl.ts`:

```ts
import Constants from "expo-constants";
import { PERPL_REST, PERPL_WS } from "../perpl/config";

const extra = Constants.expoConfig?.extra ?? {};
const rest = typeof extra.perplRest === "string" && extra.perplRest !== "" ? extra.perplRest : PERPL_REST;
const ws = typeof extra.perplWs === "string" && extra.perplWs !== "" ? extra.perplWs : PERPL_WS;

/** URLs de Perpl con override desde app.config.ts (mainnet después). */
export const PERPL_URLS = { rest, ws } as const;
```

`app.config.ts` — debajo de `monadscanKey`:

```ts
// Perpl: vacío = testnet (src/perpl/config.ts). Para mainnet se fijan ambas.
const perplRest = process.env.PICKLER_PERPL_REST ?? "";
const perplWs = process.env.PICKLER_PERPL_WS ?? "";
```

y `extra: { rpId, monadscanKey, perplRest, perplWs },`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-config.test.ts __tests__/chain.test.ts`
Expected: tsc sin salida; 2 suites en verde (5 selectores + constantes + ABI).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.config.ts src/config/chain.ts src/config/perpl.ts src/perpl/config.ts __tests__/perpl-config.test.ts __tests__/chain.test.ts
git commit -m "feat(mobile): config de Perpl testnet, ABI del exchange y fixtures reales"
```

---

### Task 2: `perpl/context.ts` — mercados e instancia desde `pub/context`

**Files:**
- Create: `apps/mobile/src/perpl/context.ts`
- Test: `apps/mobile/__tests__/perpl-context.test.ts`

**Interfaces:**
- Consumes: `CONTEXT_TIMEOUT_MS` de `perpl/config.ts`.
- Produces:

```ts
export type Market = {
  id: number; symbol: string; name: string;
  priceDecimals: number; sizeDecimals: number; ttlBlocks: number;
  maxSlippageBps: number; maintenanceBps: number; maxLeverage: number;
  takerFeeMicros: number; isOpen: boolean; mark: number; prev: number;
};
export type Instance = { exchange: Address; minAccountOpen: bigint; minDeposit: bigint; minWithdraw: bigint };
export type Context = { markets: Market[]; instance: Instance; geoBlock: string[] };
export function parseContext(body: unknown): Context;            // lanza si falta algo
export async function fetchContext(rest: string): Promise<Context>; // GET `${rest}/v1/pub/context`
```

- [ ] **Step 1: Escribir los tests**

```ts
import contextJson from "./fixtures/perpl/context.json";
import { fetchContext, parseContext } from "../src/perpl/context";

test("parseContext reads the MON market from the real testnet payload", () => {
  const ctx = parseContext(contextJson);
  const mon = ctx.markets.find((m) => m.id === 64);
  expect(mon).toMatchObject({ symbol: "MON", name: "MON Perp", priceDecimals: 5, sizeDecimals: 0, ttlBlocks: 20, maxSlippageBps: 100, maintenanceBps: 500, maxLeverage: 3, takerFeeMicros: 345, isOpen: true });
  expect(mon!.mark).toBeGreaterThan(0);
  expect(ctx.markets.map((m) => m.id)).toEqual([16, 32, 48, 64, 256, 272, 320]);
});

test("parseContext reads the instance minimums and exchange", () => {
  const { instance, geoBlock } = parseContext(contextJson);
  expect(instance).toEqual({ exchange: "0x1964c32f0be608e7d29302aff5e61268e72080cc", minAccountOpen: 100_000_000n, minDeposit: 10_000_000n, minWithdraw: 10_000n });
  expect(geoBlock).toContain("US");
});

test("parseContext drops closed markets and sorts by id", () => {
  const closed = JSON.parse(JSON.stringify(contextJson)) as typeof contextJson;
  closed.markets[3].config.is_open = false;
  closed.markets.reverse();
  const ids = parseContext(closed).markets.map((m) => m.id);
  expect(ids).toEqual([16, 32, 48, 256, 272, 320]);
});

test.each([
  ["no object", null],
  ["no instances", { ...contextJson, instances: [] }],
  ["no markets", { ...contextJson, markets: "x" }],
  ["market without config", { ...contextJson, markets: [{ id: 1, symbol: "X", name: "X" }] }],
])("parseContext throws on %s", (_, body) => {
  expect(() => parseContext(body)).toThrow();
});

test("fetchContext times out with AbortController, not AbortSignal.timeout", async () => {
  const fetchMock = jest.fn((_url: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
  }));
  (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  jest.useFakeTimers();
  const p = fetchContext("https://x.test/api");
  const failed = p.then(() => false, () => true);
  jest.advanceTimersByTime(15_001);
  await expect(failed).resolves.toBe(true);
  expect(fetchMock.mock.calls[0][0]).toBe("https://x.test/api/v1/pub/context");
  jest.useRealTimers();
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-context.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/context.ts`**

```ts
import type { Address } from "viem";
import { CONTEXT_TIMEOUT_MS } from "./config";

export type Market = {
  id: number; symbol: string; name: string;
  priceDecimals: number; sizeDecimals: number; ttlBlocks: number;
  maxSlippageBps: number; maintenanceBps: number;
  /** initial_margin / 100: el exchange recorta el apalancamiento a este máximo (ruling 1). */
  maxLeverage: number;
  takerFeeMicros: number; isOpen: boolean;
  /** Precio de marca y precio de hace 24 h, escalados por priceDecimals. */
  mark: number; prev: number;
};
export type Instance = { exchange: Address; minAccountOpen: bigint; minDeposit: bigint; minWithdraw: bigint };
export type Context = { markets: Market[]; instance: Instance; geoBlock: string[] };

type Rec = Record<string, unknown>;
const rec = (v: unknown, what: string): Rec => {
  if (v === null || typeof v !== "object") throw new Error(`Perpl context: ${what} is not an object`);
  return v as Rec;
};
const num = (r: Rec, k: string, what: string): number => {
  const v = r[k];
  if (typeof v !== "number") throw new Error(`Perpl context: ${what}.${k} is not a number`);
  return v;
};
const str = (r: Rec, k: string, what: string): string => {
  const v = r[k];
  if (typeof v !== "string") throw new Error(`Perpl context: ${what}.${k} is not a string`);
  return v;
};
const amount = (r: Rec, k: string, what: string): bigint => {
  const v = r[k];
  if (typeof v !== "string" || !/^\d+$/.test(v)) throw new Error(`Perpl context: ${what}.${k} is not an amount`);
  return BigInt(v);
};

function parseMarket(v: unknown): Market {
  const m = rec(v, "market");
  const cfg = rec(m.config, "market.config");
  const st = rec(m.state, "market.state");
  return {
    id: num(m, "id", "market"), symbol: str(m, "symbol", "market"), name: str(m, "name", "market"),
    priceDecimals: num(cfg, "price_decimals", "config"), sizeDecimals: num(cfg, "size_decimals", "config"),
    ttlBlocks: num(m, "order_ttl_blocks", "market"), maxSlippageBps: num(m, "order_max_market_slippage_bps", "market"),
    maintenanceBps: num(cfg, "maintenance_margin", "config"), maxLeverage: num(cfg, "initial_margin", "config") / 100,
    takerFeeMicros: num(cfg, "taker_fee", "config"), isOpen: cfg.is_open === true,
    mark: num(st, "mrk", "state"), prev: num(st, "prv", "state"),
  };
}

/** Lanza si el payload no tiene la forma verificada. Mercados abiertos, ordenados por id. */
export function parseContext(body: unknown): Context {
  const c = rec(body, "context");
  if (!Array.isArray(c.instances) || c.instances.length === 0) throw new Error("Perpl context: no instances");
  if (!Array.isArray(c.markets)) throw new Error("Perpl context: no markets");
  const inst = rec(c.instances[0], "instance");
  const instance: Instance = {
    exchange: str(inst, "address", "instance") as Address,
    minAccountOpen: amount(inst, "min_account_open_amount", "instance"),
    minDeposit: amount(inst, "min_deposit_amount", "instance"),
    minWithdraw: amount(inst, "min_withdraw_amount", "instance"),
  };
  const markets = c.markets.map(parseMarket).filter((m) => m.isOpen).sort((a, b) => a.id - b.id);
  const geoBlock = Array.isArray(c.geo_block) ? c.geo_block.filter((g): g is string => typeof g === "string") : [];
  return { markets, instance, geoBlock };
}

export async function fetchContext(rest: string): Promise<Context> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONTEXT_TIMEOUT_MS);
  try {
    const res = await fetch(`${rest}/v1/pub/context`, { signal: controller.signal });
    if (!res.ok) throw new Error(`Perpl responded ${res.status}`);
    return parseContext(await res.json());
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-context.test.ts`
Expected: tsc limpio; 8 tests en verde.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/context.ts __tests__/perpl-context.test.ts
git commit -m "feat(mobile): parser y fetch del context de Perpl con fixture real"
```

---

### Task 3: `perpl/orders.ts` — tamaño, fee, liquidación, PnL, frames y copy de estados

**Files:**
- Create: `apps/mobile/src/perpl/orders.ts`
- Test: `apps/mobile/__tests__/perpl-orders.test.ts`

**Interfaces:**
- Consumes: `Market` de `perpl/context.ts`; `LEVERAGES` de `perpl/config.ts`.
- Produces:

```ts
export type Side = "long" | "short";
export type OrderType = 1 | 2 | 3 | 4;              // OpenLong, OpenShort, CloseLong, CloseShort
export type OrderIntent = { mkt: number; acc: number; t: OrderType; s: number; ms: number; lv: number; ttl: number };
export type OrderRequest = { mt: 22; sn: number; rq: number; mkt: number; acc: number; t: OrderType; p: 0; s: number; fl: 4; ms: number; lv: number; lb: number };
export type PositionLike = { mkt: number; sd: 1 | 2; s: number; ep: number; lv: number };
export function sizeFromAusd(ausd: bigint, lv: number, mark: number, pd: number, sd: number): number;
export function notionalAusd(size: number, mark: number, pd: number, sd: number): bigint;
export function takerFee(notional: bigint, takerFeeMicros: number): bigint;      // ceil
export function liquidationPrice(entry: number, lv: number, side: Side, maintenanceBps: number, maxLeverage: number): number;
export function positionPnl(p: PositionLike, mark: number, pd: number, sd: number): bigint;  // AUSD, signo incluido
export function change24h(mark: number, prev: number): number;                   // fracción, p. ej. 0.026
export function leveragesFor(market: { maxLeverage: number }): number[];
export function openIntent(market: Market, acc: number, side: Side, size: number, lv: number): OrderIntent;
export function closeIntent(market: Market, acc: number, position: PositionLike): OrderIntent;
export function orderFrame(intent: OrderIntent, seq: { sn: number; rq: number; head: number }): OrderRequest;
export type OrderStatusKind = "sent" | "filled" | "open" | "failed";
export function describeOrderStatus(st: number, sr?: number, fr?: number): { kind: OrderStatusKind; text: string };
export function formatPrice(scaled: number, pd: number): string;
export function formatSize(scaled: number, sd: number): string;
```

- [ ] **Step 1: Escribir los tests**

```ts
import contextJson from "./fixtures/perpl/context.json";
import frames from "./fixtures/perpl/ws-frames.json";
import { parseContext } from "../src/perpl/context";
import {
  change24h, closeIntent, describeOrderStatus, formatPrice, formatSize, leveragesFor, liquidationPrice,
  notionalAusd, openIntent, orderFrame, positionPnl, sizeFromAusd, takerFee,
} from "../src/perpl/orders";

const ctx = parseContext(contextJson);
const MON = ctx.markets.find((m) => m.id === 64)!;
const BTC = ctx.markets.find((m) => m.id === 16)!;

test("sizeFromAusd: 11.1 AUSD at 1x with MON at 0.02220 is 500 MON", () => {
  expect(sizeFromAusd(11_100_000n, 1, 2220, 5, 0)).toBe(500);
  expect(sizeFromAusd(11_100_000n, 3, 2220, 5, 0)).toBe(1500);
  // BTC: pd 1, sd 5; 100 AUSD at $76,255.5 → 0.00131 BTC = 131 units (floor)
  expect(sizeFromAusd(100_000_000n, 1, 762555, 1, 5)).toBe(131);
  expect(sizeFromAusd(0n, 1, 2220, 5, 0)).toBe(0);
});

test("notionalAusd inverts sizeFromAusd", () => {
  expect(notionalAusd(500, 2220, 5, 0)).toBe(11_100_000n);
  expect(notionalAusd(100, 2221, 5, 0)).toBe(2_221_000n);
});

test("takerFee rounds up like the exchange (fixture: 2.221 AUSD × 345 micros → 767)", () => {
  expect(takerFee(2_221_000n, 345)).toBe(767n);
  expect(takerFee(11_100_000n, 345)).toBe(3830n);
  expect(takerFee(0n, 345)).toBe(0n);
});

test("liquidationPrice: maintenance is mm/10000 of the initial margin (ruling 2)", () => {
  // MON: maxLeverage 3, mm 500 → 1.67 % of notional
  expect(liquidationPrice(2221, 1, "long", 500, 3)).toBe(37);        // ≈ 0.0167 × entry
  expect(liquidationPrice(2221, 3, "long", 500, 3)).toBe(1518);      // entry × (1 − 1/3 + 0.0167)
  expect(liquidationPrice(2221, 3, "short", 500, 3)).toBe(2924);     // entry × (1 + 1/3 − 0.0167)
  expect(liquidationPrice(762555, 5, "long", 2500, 15)).toBe(622753); // BTC 5x: × (0.8 + 0.0167)
});

test("positionPnl matches the realised delta of the real close (−4000)", () => {
  const opened = frames.positionOpened.d[0];
  expect(positionPnl({ mkt: 64, sd: 1, s: opened.s, ep: opened.ep, lv: opened.lv }, 2217, 5, 0)).toBe(-4000n);
  expect(positionPnl({ mkt: 64, sd: 2, s: 100, ep: 2221, lv: 100 }, 2217, 5, 0)).toBe(4000n);
  expect(positionPnl({ mkt: 64, sd: 1, s: 100, ep: 2221, lv: 100 }, 2221, 5, 0)).toBe(0n);
});

test("change24h is a signed fraction", () => {
  expect(change24h(2221, 2164)).toBeCloseTo(0.02634, 4);
  expect(change24h(2000, 2500)).toBeCloseTo(-0.2, 6);
  expect(change24h(2000, 0)).toBe(0);
});

test("leveragesFor caps the selector at the market maximum (MON 3x, BTC 15x)", () => {
  expect(leveragesFor(MON)).toEqual([1, 2, 3]);
  expect(leveragesFor(BTC)).toEqual([1, 2, 3, 5]);
  expect(leveragesFor({ maxLeverage: 1 })).toEqual([1]);
});

test("orderFrame: rq = lfr + 1, lb = head + ttl, market IOC, leverage in hundredths", () => {
  const intent = openIntent(MON, 619, "long", 100, 1);
  const frame = orderFrame(intent, { sn: 3, rq: 6, head: 63177640 });
  expect(frame).toEqual(frames.sentOpen);           // el frame real del spike
  expect(orderFrame(openIntent(MON, 619, "short", 100, 3), { sn: 4, rq: 7, head: 10 })).toMatchObject({ t: 2, lv: 300, lb: 30, p: 0, fl: 4, ms: 100 });
});

test("closeIntent closes the whole position on the opposite side", () => {
  const long = closeIntent(MON, 619, { mkt: 64, sd: 1, s: 100, ep: 2221, lv: 100 });
  expect(orderFrame(long, { sn: 4, rq: 7, head: 63177651 })).toEqual(frames.sentClose);
  expect(closeIntent(MON, 619, { mkt: 64, sd: 2, s: 250, ep: 2221, lv: 300 })).toMatchObject({ t: 4, s: 250, lv: 300 });
});

test.each([
  [7, 32, undefined, "failed", "Order id too low — retrying"],
  [7, 34, undefined, "failed", "One-click trading is off. Enable trading again"],
  [2, 35, undefined, "open", "Placed"],
  [7, 44, 8, "failed", "Not enough collateral for this size"],
  [7, 37, undefined, "failed", "Not enough collateral for this size"],
  [7, 39, undefined, "failed", "Below the market minimum"],
  [7, 40, undefined, "failed", "Price out of range"],
  [7, 42, undefined, "failed", "Size out of range"],
  [4, 43, undefined, "filled", "Filled"],
  [7, 44, undefined, "failed", "Couldn't settle — try a smaller size"],
  [7, 99, undefined, "failed", "Failed (sr 99)"],
  [5, 28, undefined, "failed", "Canceled — nothing filled"],
  [6, 6, undefined, "failed", "Expired before it could fill"],
  [1, 0, undefined, "sent", "Sent"],
])("describeOrderStatus(st %i, sr %s, fr %s)", (st, sr, fr, kind, text) => {
  expect(describeOrderStatus(st, sr, fr)).toEqual({ kind, text });
});

test("formatPrice and formatSize use the market decimals", () => {
  expect(formatPrice(2221, 5)).toBe("0.02221");
  expect(formatPrice(762555, 1)).toBe("76255.5");
  expect(formatSize(100, 0)).toBe("100");
  expect(formatSize(131, 5)).toBe("0.00131");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-orders.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/orders.ts`**

```ts
import { AUSD_DECIMALS } from "../config/chain";
import { LEVERAGES } from "./config";
import type { Market } from "./context";

export type Side = "long" | "short";
/** 1 OpenLong · 2 OpenShort · 3 CloseLong · 4 CloseShort */
export type OrderType = 1 | 2 | 3 | 4;
export type OrderIntent = { mkt: number; acc: number; t: OrderType; s: number; ms: number; lv: number; ttl: number };
export type OrderRequest = { mt: 22; sn: number; rq: number; mkt: number; acc: number; t: OrderType; p: 0; s: number; fl: 4; ms: number; lv: number; lb: number };
export type PositionLike = { mkt: number; sd: 1 | 2; s: number; ep: number; lv: number };

const AUSD_UNIT = 10n ** BigInt(AUSD_DECIMALS);
const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** floor(ausd × lv × 10^(pd+sd) / (mark × 10^6)) en unidades escaladas del activo. */
export function sizeFromAusd(ausd: bigint, lv: number, mark: number, pd: number, sd: number): number {
  if (mark <= 0) return 0;
  return Number((ausd * BigInt(lv) * pow10(pd + sd)) / (BigInt(mark) * AUSD_UNIT));
}

export function notionalAusd(size: number, mark: number, pd: number, sd: number): bigint {
  return (BigInt(size) * BigInt(mark) * AUSD_UNIT) / pow10(pd + sd);
}

/** El exchange redondea la fee hacia arriba (fixture: 766.2 → 767). */
export function takerFee(notional: bigint, takerFeeMicros: number): bigint {
  const raw = notional * BigInt(takerFeeMicros);
  return (raw + 999_999n) / 1_000_000n;
}

/**
 * Estimación. Mantenimiento = (maintenanceBps / 10000) / maxLeverage del nominal (ruling 2).
 * long: entry × (1 − 1/lv + mm) · short: entry × (1 + 1/lv − mm), en enteros escalados.
 */
export function liquidationPrice(entry: number, lv: number, side: Side, maintenanceBps: number, maxLeverage: number): number {
  const den = 10_000 * maxLeverage * lv;
  const num = side === "long"
    ? den - 10_000 * maxLeverage + maintenanceBps * lv
    : den + 10_000 * maxLeverage - maintenanceBps * lv;
  return Math.max(0, Math.round((entry * num) / den));
}

/** PnL no realizado en AUSD: (mark − entry) × size, con signo según el lado. */
export function positionPnl(p: PositionLike, mark: number, pd: number, sd: number): bigint {
  const diff = BigInt(mark - p.ep) * BigInt(p.s) * AUSD_UNIT / pow10(pd + sd);
  return p.sd === 1 ? diff : -diff;
}

export function change24h(mark: number, prev: number): number {
  return prev > 0 ? (mark - prev) / prev : 0;
}

export function leveragesFor(market: { maxLeverage: number }): number[] {
  const allowed = LEVERAGES.filter((lv) => lv <= market.maxLeverage);
  return allowed.length > 0 ? allowed : [1];
}

export function openIntent(market: Market, acc: number, side: Side, size: number, lv: number): OrderIntent {
  return { mkt: market.id, acc, t: side === "long" ? 1 : 2, s: size, ms: market.maxSlippageBps, lv: lv * 100, ttl: market.ttlBlocks };
}

export function closeIntent(market: Market, acc: number, position: PositionLike): OrderIntent {
  return { mkt: market.id, acc, t: position.sd === 1 ? 3 : 4, s: position.s, ms: market.maxSlippageBps, lv: position.lv, ttl: market.ttlBlocks };
}

/** Orden de mercado IOC. `rq` y `lb` los decide el socket (rq = max(lfr, último) + 1; lb = head + ttl). */
export function orderFrame(intent: OrderIntent, seq: { sn: number; rq: number; head: number }): OrderRequest {
  return { mt: 22, sn: seq.sn, rq: seq.rq, mkt: intent.mkt, acc: intent.acc, t: intent.t, p: 0, s: intent.s, fl: 4, ms: intent.ms, lv: intent.lv, lb: seq.head + intent.ttl };
}

export type OrderStatusKind = "sent" | "filled" | "open" | "failed";

const FAILED_COPY: Record<number, string> = {
  32: "Order id too low — retrying",
  34: "One-click trading is off. Enable trading again",
  37: "Not enough collateral for this size",
  39: "Below the market minimum",
  40: "Price out of range",
  42: "Size out of range",
  44: "Couldn't settle — try a smaller size",
};

export function describeOrderStatus(st: number, sr?: number, fr?: number): { kind: OrderStatusKind; text: string } {
  if (st === 4) return { kind: "filled", text: "Filled" };
  if (st === 2 || st === 3) return { kind: "open", text: "Placed" };
  if (st === 5) return { kind: "failed", text: "Canceled — nothing filled" };
  if (st === 6) return { kind: "failed", text: "Expired before it could fill" };
  if (st === 7) {
    if (fr === 8 || sr === 37) return { kind: "failed", text: FAILED_COPY[37] };
    return { kind: "failed", text: (sr !== undefined && FAILED_COPY[sr]) || `Failed (sr ${sr ?? 0})` };
  }
  return { kind: "sent", text: "Sent" };
}

function scaled(value: number, decimals: number): string {
  const sign = value < 0 ? "-" : "";
  const digits = Math.abs(value).toString().padStart(decimals + 1, "0");
  if (decimals === 0) return sign + digits;
  return `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}
export const formatPrice = (price: number, pd: number): string => scaled(price, pd);
export const formatSize = (size: number, sd: number): string => scaled(size, sd);
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-orders.test.ts`
Expected: tsc limpio; todos en verde. Si `liquidationPrice` difiere en ±1 por redondeo, ajustar el **test** al valor calculado a mano con la fórmula (no la fórmula).

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/orders.ts __tests__/perpl-orders.test.ts
git commit -m "feat(mobile): matemática de órdenes, frames y copy de estados de Perpl"
```

---

### Task 4: `perpl/apiKey.ts` — llave Ed25519, sign-in del WS y enroll EIP-712

**Files:**
- Create: `apps/mobile/src/perpl/apiKey.ts`
- Test: `apps/mobile/__tests__/perpl-apikey.test.ts`

**Interfaces:**
- Consumes: `Wallet` (`wallet/wallet.ts`: `address`, `account: LocalAccount` con `signTypedData`); `PERPL_CHAIN_ID`, `TRADING_KEY_LABEL`, `TRADING_KEY_SCOPE`, `ENROLL_TIMEOUT_MS`.
- Produces:

```ts
export type KeyPair = { privateKey: Uint8Array; publicKeyHex: Hex };
export function generateTradingKey(): KeyPair;
export function wsSigninCanonical(chainId: number, timestampMs: string, nonce: string): string;
export function signWsSignin(privateKey: Uint8Array, chainId: number, now?: number, nonceBytes?: Uint8Array): { timestamp: string; nonce: string; signature: string };
export function normalizeTypedData(typedData: unknown): TypedDataDefinition;
export function describeEnrollError(status: number): string;
export async function enrollTradingKey(wallet: Pick<Wallet, "address" | "account">, publicKeyHex: Hex, privateKey: Uint8Array, rest: string): Promise<string>; // api_key
```

- [ ] **Step 1: Escribir los tests**

```ts
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { hashTypedData, hexToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import payload from "./fixtures/perpl/apikey-payload.json";
import {
  describeEnrollError, enrollTradingKey, generateTradingKey, normalizeTypedData, signWsSignin, wsSigninCanonical,
} from "../src/perpl/apiKey";

const utf8 = (s: string) => new TextEncoder().encode(s);

test("wsSigninCanonical has exactly four newline-joined fields", () => {
  expect(wsSigninCanonical(10143, "1789606875716", "l2oDHV6XX4xFxKC0aMAQ8A")).toBe("10143\ntrading-ws-signin\n1789606875716\nl2oDHV6XX4xFxKC0aMAQ8A");
});

test("signWsSignin signs the canonical string with a verifiable Ed25519 key, base64url without padding", () => {
  const { privateKey, publicKeyHex } = generateTradingKey();
  expect(publicKeyHex).toMatch(/^0x[0-9a-f]{64}$/);
  const nonceBytes = new Uint8Array(16).fill(1);
  const { timestamp, nonce, signature } = signWsSignin(privateKey, 10143, 1789606875716, nonceBytes);
  expect(timestamp).toBe("1789606875716");
  expect(nonce).toBe(base64urlnopad.encode(nonceBytes));
  expect(signature).not.toMatch(/=/);
  const ok = ed25519.verify(base64urlnopad.decode(signature), utf8(wsSigninCanonical(10143, timestamp, nonce)), hexToBytes(publicKeyHex));
  expect(ok).toBe(true);
  // contra el defecto: otra cadena canónica no verifica
  expect(ed25519.verify(base64urlnopad.decode(signature), utf8(wsSigninCanonical(143, timestamp, nonce)), hexToBytes(publicKeyHex))).toBe(false);
});

test("normalizeTypedData drops EIP712Domain and turns chainId/time hex into bigint", () => {
  const td = normalizeTypedData(payload.typed_data);
  expect(td.primaryType).toBe("PerplRegisterApiKey");
  expect(Object.keys(td.types)).toEqual(["PerplRegisterApiKey"]);
  expect(td.domain).toMatchObject({ name: "perpl.xyz", version: "1", chainId: 10143n });
  expect((td.message as Record<string, unknown>).time).toBe(0x1a0ace2d7c9n);
  expect((td.message as Record<string, unknown>).label).toBe("Pickler iOS");
  expect(typeof hashTypedData(td)).toBe("string");
});

test("normalizeTypedData rejects a payload without types or message", () => {
  expect(() => normalizeTypedData({ primaryType: "X" })).toThrow();
  expect(() => normalizeTypedData(null)).toThrow();
});

test("enrollTradingKey posts payload then enroll (no Origin header) and returns the api_key", async () => {
  const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000007");
  const { privateKey, publicKeyHex } = generateTradingKey();
  const calls: { url: string; init: RequestInit }[] = [];
  (globalThis as { fetch: typeof fetch }).fetch = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/v1/api-key/payload")) return new Response(JSON.stringify(payload), { status: 200 });
    return new Response(JSON.stringify({ api_key: { api_key: "key-123" } }), { status: 200 });
  }) as unknown as typeof fetch;

  const key = await enrollTradingKey({ address: account.address, account }, publicKeyHex, privateKey, "https://x.test/api");
  expect(key).toBe("key-123");
  expect(calls[0].url).toBe("https://x.test/api/v1/api-key/payload");
  const req = JSON.parse(calls[0].init.body as string);
  expect(req).toEqual({ chain_id: 10143, address: account.address, public_key: publicKeyHex, scope_mask: 3, label: "Pickler iOS" });
  expect(Object.keys(calls[0].init.headers as Record<string, string>).map((h) => h.toLowerCase())).not.toContain("origin");
  const enroll = JSON.parse(calls[1].init.body as string);
  expect(enroll.mac).toBe(payload.mac);
  expect(enroll.typed_data).toEqual(payload.typed_data);
  // firma de la wallet y prueba de posesión Ed25519 sobre el digest EIP-712
  const digest = hashTypedData(normalizeTypedData(payload.typed_data));
  expect(await account.signTypedData(normalizeTypedData(payload.typed_data))).toBe(enroll.signature);
  expect(ed25519.verify(hexToBytes(enroll.pop_signature), hexToBytes(digest), hexToBytes(publicKeyHex))).toBe(true);
});

test.each([
  [404, "Create the trading account first."],
  [409, "This trading key already exists. Try again."],
  [423, "Too many trading keys. Revoke one at testnet.perpl.xyz/apikeys."],
  [422, "Perpl rejected the enrolment (422)."],
])("describeEnrollError(%i)", (status, text) => {
  expect(describeEnrollError(status)).toBe(text);
});

test("enrollTradingKey throws the described error on a non-200 enroll", async () => {
  const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000007");
  const { privateKey, publicKeyHex } = generateTradingKey();
  (globalThis as { fetch: typeof fetch }).fetch = jest.fn(async (url: string) =>
    url.endsWith("/payload") ? new Response(JSON.stringify(payload), { status: 200 }) : new Response("{}", { status: 404 }),
  ) as unknown as typeof fetch;
  await expect(enrollTradingKey({ address: account.address, account }, publicKeyHex, privateKey, "https://x.test/api")).rejects.toThrow("Create the trading account first.");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-apikey.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/apiKey.ts`**

```ts
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { bytesToHex, type Hex, hashTypedData, hexToBytes, type TypedDataDefinition } from "viem";
import type { Wallet } from "../wallet/wallet";
import { ENROLL_TIMEOUT_MS, PERPL_CHAIN_ID, TRADING_KEY_LABEL, TRADING_KEY_SCOPE } from "./config";

export type KeyPair = { privateKey: Uint8Array; publicKeyHex: Hex };

export function generateTradingKey(): KeyPair {
  const privateKey = ed25519.utils.randomSecretKey();
  return { privateKey, publicKeyHex: bytesToHex(ed25519.getPublicKey(privateKey)) };
}

/** Cuatro campos unidos por "\n" (api-docs/websocket.md). */
export function wsSigninCanonical(chainId: number, timestampMs: string, nonce: string): string {
  return [chainId, "trading-ws-signin", timestampMs, nonce].join("\n");
}

export function signWsSignin(privateKey: Uint8Array, chainId: number, now = Date.now(), nonceBytes = crypto.getRandomValues(new Uint8Array(16))): { timestamp: string; nonce: string; signature: string } {
  const timestamp = now.toString();
  const nonce = base64urlnopad.encode(nonceBytes);
  const signature = base64urlnopad.encode(ed25519.sign(new TextEncoder().encode(wsSigninCanonical(chainId, timestamp, nonce)), privateKey));
  return { timestamp, nonce, signature };
}

type Rec = Record<string, unknown>;

/** El payload trae `EIP712Domain` en `types` y `chainId`/`time` como hex; viem quiere lo contrario. */
export function normalizeTypedData(typedData: unknown): TypedDataDefinition {
  if (typedData === null || typeof typedData !== "object") throw new Error("Perpl sent no typed data");
  const { types, primaryType, domain, message } = typedData as Rec;
  if (types === null || typeof types !== "object" || typeof primaryType !== "string" || domain === null || typeof domain !== "object" || message === null || typeof message !== "object") {
    throw new Error("Perpl typed data is malformed");
  }
  const { EIP712Domain: _domain, ...rest } = types as Rec;
  const d = domain as Rec;
  const m = message as Rec;
  return {
    types: rest as TypedDataDefinition["types"],
    primaryType,
    domain: { ...d, chainId: BigInt(String(d.chainId)) } as TypedDataDefinition["domain"],
    message: { ...m, time: BigInt(String(m.time)) },
  } as TypedDataDefinition;
}

export function describeEnrollError(status: number): string {
  switch (status) {
    case 404: return "Create the trading account first.";
    case 409: return "This trading key already exists. Try again.";
    case 423: return "Too many trading keys. Revoke one at testnet.perpl.xyz/apikeys.";
    default: return `Perpl rejected the enrolment (${status}).`;
  }
}

async function post(url: string, body: unknown): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ENROLL_TIMEOUT_MS);
  try {
    // Sin header Origin: con uno propio Perpl responde 422 (docs/investigacion/perpl.md).
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** payload → firma EIP-712 con la wallet → PoP Ed25519 sobre el digest → enroll. Devuelve el token `api_key`. */
export async function enrollTradingKey(wallet: Pick<Wallet, "address" | "account">, publicKeyHex: Hex, privateKey: Uint8Array, rest: string): Promise<string> {
  const p = await post(`${rest}/v1/api-key/payload`, {
    chain_id: PERPL_CHAIN_ID, address: wallet.address, public_key: publicKeyHex, scope_mask: TRADING_KEY_SCOPE, label: TRADING_KEY_LABEL,
  });
  if (!p.ok) throw new Error(describeEnrollError(p.status));
  const { typed_data, mac } = (await p.json()) as { typed_data?: unknown; mac?: unknown };
  if (typeof mac !== "string") throw new Error("Perpl sent no mac");
  const td = normalizeTypedData(typed_data);
  const signature = await wallet.account.signTypedData(td);
  const popSignature = bytesToHex(ed25519.sign(hexToBytes(hashTypedData(td)), privateKey));
  const e = await post(`${rest}/v1/api-key/enroll`, {
    chain_id: PERPL_CHAIN_ID, address: wallet.address, typed_data, mac, signature, pop_signature: popSignature,
  });
  if (!e.ok) throw new Error(describeEnrollError(e.status));
  const body = (await e.json()) as { api_key?: { api_key?: unknown } };
  const key = body.api_key?.api_key;
  if (typeof key !== "string" || key === "") throw new Error("Perpl sent no api_key");
  return key;
}
```

Nota: si el entorno de Jest no expone `Response`, sustituir en el test por `{ ok: true, status: 200, json: async () => payload }` (misma forma). `wallet.account.signTypedData` existe en `LocalAccount` de viem (`toViemAccount(session)` de Mera lo implementa; el spike lo usó con `privateKeyToAccount`, misma interfaz). Si tsc se queja de que es opcional, usar `wallet.account.signTypedData!`… **no**: en su lugar comprobar `if (!wallet.account.signTypedData) throw new Error("This wallet can't sign typed data")`.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-apikey.test.ts`
Expected: tsc limpio; 9 tests en verde.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/apiKey.ts __tests__/perpl-apikey.test.ts
git commit -m "feat(mobile): llave de trading Ed25519, sign-in del WS y enroll EIP-712 de Perpl"
```

---

### Task 5: `perpl/onboarding.ts` — lecturas y tx del exchange

**Files:**
- Create: `apps/mobile/src/perpl/onboarding.ts`
- Test: `apps/mobile/__tests__/perpl-onboarding.test.ts`

**Interfaces:**
- Consumes: `publicClient`, `waitForReceipt` (`wallet/chain.ts`); `ERC20_ABI`, `AUSD_ADDRESS`, `CHAIN` (`config/chain.ts`); `EXCHANGE_ABI`, `EXCHANGE_ADDRESS`, `PRIORITY_FEE_WEI` (`perpl/config.ts`); `Wallet`.
- Produces:

```ts
export type Reader = { readContract: typeof publicClient.readContract };
export function readAccountId(address: Address, client?: Reader): Promise<bigint>;   // revert → 0n
export function readAllowance(address: Address, client?: Reader): Promise<bigint>;
export function approveCalldata(amount: bigint): Hex;
export function createAccountCalldata(amount: bigint): Hex;
export function allowForwardingCalldata(): Hex;
export function depositCalldata(amount: bigint): Hex;
export function withdrawCalldata(amount: bigint): Hex;
export function approveExchange(wallet: Wallet, amount: bigint): Promise<Hex>;
export function createExchangeAccount(wallet: Wallet, amount: bigint): Promise<Hex>;
export function enableForwarding(wallet: Wallet): Promise<Hex>;
export function depositCollateral(wallet: Wallet, amount: bigint): Promise<Hex>;
export function withdrawCollateral(wallet: Wallet, amount: bigint): Promise<Hex>;
export function isNoAccountRevert(error: unknown): boolean;
```

- [ ] **Step 1: Escribir los tests**

```ts
import { BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, encodeFunctionData, type Address } from "viem";
import { EXCHANGE_ABI, EXCHANGE_ADDRESS } from "../src/perpl/config";
import { ERC20_ABI, AUSD_ADDRESS } from "../src/config/chain";
import {
  allowForwardingCalldata, approveCalldata, createAccountCalldata, depositCalldata, isNoAccountRevert,
  readAccountId, readAllowance, withdrawCalldata,
} from "../src/perpl/onboarding";

const ME: Address = "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f";

test("calldata carries the verified selectors and arguments", () => {
  expect(approveCalldata(100_000_000n)).toBe(encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, 100_000_000n] }));
  expect(createAccountCalldata(100_000_000n).slice(0, 10)).toBe("0xcab13915");
  expect(createAccountCalldata(100_000_000n)).toContain("5f5e100"); // 100e6 en hex
  expect(allowForwardingCalldata()).toBe("0x7962f9100000000000000000000000000000000000000000000000000000000000000001");
  expect(depositCalldata(10_000_000n).slice(0, 10)).toBe("0xbad4a01f");
  expect(withdrawCalldata(5_000_000n).slice(0, 10)).toBe("0x6112fe2e");
});

function revert(): Error {
  // Forma con la que viem envuelve `execution reverted` con data 0x03a0e277…
  const cause = new ContractFunctionRevertedError({ abi: EXCHANGE_ABI, functionName: "getAccountByAddr", data: "0x03a0e277000000000000000000000000e3719a93b75cee42c5a8f3dce45e5b4b327851c1" });
  return new ContractFunctionExecutionError(cause, { abi: EXCHANGE_ABI, functionName: "getAccountByAddr", args: [ME], contractAddress: EXCHANGE_ADDRESS });
}

test("readAccountId returns the id and turns the no-account revert into 0n", async () => {
  const withAccount = { readContract: jest.fn(async () => 619n) };
  await expect(readAccountId(ME, withAccount as never)).resolves.toBe(619n);
  expect(withAccount.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: EXCHANGE_ADDRESS, functionName: "getAccountByAddr", args: [ME] }));
  const without = { readContract: jest.fn(async () => { throw revert(); }) };
  await expect(readAccountId(ME, without as never)).resolves.toBe(0n);
});

test("readAccountId rethrows network errors instead of hiding them as 0n", async () => {
  const down = { readContract: jest.fn(async () => { throw new BaseError("HTTP request failed"); }) };
  await expect(readAccountId(ME, down as never)).rejects.toThrow("HTTP request failed");
  expect(isNoAccountRevert(new Error("boom"))).toBe(false);
  expect(isNoAccountRevert(revert())).toBe(true);
});

test("readAllowance asks the AUSD contract for owner → exchange", async () => {
  const client = { readContract: jest.fn(async () => 5n) };
  await expect(readAllowance(ME, client as never)).resolves.toBe(5n);
  expect(client.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: AUSD_ADDRESS, functionName: "allowance", args: [ME, EXCHANGE_ADDRESS] }));
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-onboarding.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/onboarding.ts`**

```ts
import {
  type Address, BaseError, ContractFunctionRevertedError, createWalletClient, encodeFunctionData, type Hex, http,
} from "viem";
import { AUSD_ADDRESS, CHAIN, ERC20_ABI } from "../config/chain";
import { publicClient } from "../wallet/chain";
import type { Wallet } from "../wallet/wallet";
import { EXCHANGE_ABI, EXCHANGE_ADDRESS, PRIORITY_FEE_WEI } from "./config";

export type Reader = { readContract: typeof publicClient.readContract };

/** getAccountByAddr revierte (sin selector de error conocido) cuando la wallet no tiene cuenta. */
export function isNoAccountRevert(error: unknown): boolean {
  return error instanceof BaseError && error.walk((e) => e instanceof ContractFunctionRevertedError) !== null;
}

export async function readAccountId(address: Address, client: Reader = publicClient): Promise<bigint> {
  try {
    return await client.readContract({ address: EXCHANGE_ADDRESS, abi: EXCHANGE_ABI, functionName: "getAccountByAddr", args: [address] });
  } catch (e) {
    if (isNoAccountRevert(e)) return 0n;
    throw e;
  }
}

export function readAllowance(address: Address, client: Reader = publicClient): Promise<bigint> {
  return client.readContract({ address: AUSD_ADDRESS, abi: ERC20_ABI, functionName: "allowance", args: [address, EXCHANGE_ADDRESS] });
}

export const approveCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: ERC20_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, amount] });
export const createAccountCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "createAccount", args: [amount] });
export const allowForwardingCalldata = (): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "allowOrderForwarding", args: [true] });
export const depositCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "depositCollateral", args: [amount] });
export const withdrawCalldata = (amount: bigint): Hex => encodeFunctionData({ abi: EXCHANGE_ABI, functionName: "withdrawCollateral", args: [amount] });

/** Firma con la sesión de Mera y envía con priority fee explícita (reemplaza una tx descartada). */
async function send(wallet: Wallet, to: Address, data: Hex): Promise<Hex> {
  const walletClient = createWalletClient({ account: wallet.account, chain: CHAIN, transport: http() });
  return walletClient.sendTransaction({ account: wallet.account, chain: CHAIN, to, data, value: 0n, maxPriorityFeePerGas: PRIORITY_FEE_WEI });
}

export const approveExchange = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, AUSD_ADDRESS, approveCalldata(amount));
export const createExchangeAccount = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, createAccountCalldata(amount));
export const enableForwarding = (wallet: Wallet): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, allowForwardingCalldata());
export const depositCollateral = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, depositCalldata(amount));
export const withdrawCollateral = (wallet: Wallet, amount: bigint): Promise<Hex> => send(wallet, EXCHANGE_ADDRESS, withdrawCalldata(amount));
```

Si `maxPriorityFeePerGas` solo no basta y viem exige `maxFeePerGas` (error "maxFeePerGas … required"), añadir `maxFeePerGas: 250_000_000_000n` como en el spike y anotarlo en el commit.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-onboarding.test.ts`
Expected: tsc limpio; 4 tests en verde. Si el constructor de `ContractFunctionRevertedError` del test no acepta esos argumentos en viem 2.55, construir el revert con `new BaseError("execution reverted", { cause: new ContractFunctionRevertedError({ abi: EXCHANGE_ABI, functionName: "getAccountByAddr", data: "0x03a0e277…" }) })` — lo que importa es que `walk` lo encuentre.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/onboarding.ts __tests__/perpl-onboarding.test.ts
git commit -m "feat(mobile): lecturas y transacciones del exchange de Perpl"
```

---

### Task 6: `storage/perpl.ts` — la key en SecureStore y su borrado al cerrar sesión

**Files:**
- Create: `apps/mobile/src/storage/perpl.ts`
- Modify: `apps/mobile/src/hooks/useAccount.ts:47-50` (`signOut`)
- Test: `apps/mobile/__tests__/perpl-storage.test.ts`

**Interfaces:**
- Produces:

```ts
export type TradingKey = { address: EvmAddress; accountId: bigint; apiKey: string; privateKey: Uint8Array };
export function parseTradingKey(raw: string): TradingKey | undefined;
export function serializeTradingKey(key: TradingKey): string;
export async function loadTradingKey(): Promise<TradingKey | undefined>;   // malformada → se borra, undefined
export async function saveTradingKey(key: TradingKey): Promise<void>;
export async function clearTradingKey(): Promise<void>;
```

- [ ] **Step 1: Escribir los tests**

```ts
import { base64urlnopad } from "@scure/base";
import { parseTradingKey, serializeTradingKey } from "../src/storage/perpl";

const priv = new Uint8Array(32).fill(9);
const key = { address: "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f" as const, accountId: 619n, apiKey: "bsFg6n-abc_123", privateKey: priv };

test("round-trips a trading key (bigint as string, private key as base64url)", () => {
  const raw = serializeTradingKey(key);
  const parsed = JSON.parse(raw);
  expect(parsed.accountId).toBe("619");
  expect(parsed.privateKey).toBe(base64urlnopad.encode(priv));
  expect(parseTradingKey(raw)).toEqual(key);
});

test.each([
  ["not json", "{"],
  ["bad address", JSON.stringify({ address: "0x12", accountId: "619", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["non-numeric account", JSON.stringify({ address: key.address, accountId: "x", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["zero account", JSON.stringify({ address: key.address, accountId: "0", apiKey: "k", privateKey: base64urlnopad.encode(priv) })],
  ["empty api key", JSON.stringify({ address: key.address, accountId: "619", apiKey: "", privateKey: base64urlnopad.encode(priv) })],
  ["short private key", JSON.stringify({ address: key.address, accountId: "619", apiKey: "k", privateKey: base64urlnopad.encode(new Uint8Array(31)) })],
  ["missing fields", JSON.stringify({})],
])("rejects %s", (_, raw) => {
  expect(parseTradingKey(raw)).toBeUndefined();
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-storage.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/storage/perpl.ts`**

```ts
import type { EvmAddress } from "@category-labs/mera";
import { base64urlnopad } from "@scure/base";
import { deleteItemAsync, getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";

const KEY = "pickler.perpl.v1";
const PRIVATE_KEY_LENGTH = 32;

// Sin gate biométrico: la key solo puede operar (scope read|trade), nunca retirar. Se revisa antes de mainnet.
const ITEM_OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

export type TradingKey = { address: EvmAddress; accountId: bigint; apiKey: string; privateKey: Uint8Array };

export function serializeTradingKey(key: TradingKey): string {
  return JSON.stringify({ address: key.address, accountId: key.accountId.toString(), apiKey: key.apiKey, privateKey: base64urlnopad.encode(key.privateKey) });
}

export function parseTradingKey(raw: string): TradingKey | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object") return undefined;
  const { address, accountId, apiKey, privateKey } = value as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(address)) return undefined;
  if (typeof accountId !== "string" || !/^[1-9]\d*$/.test(accountId)) return undefined;
  if (typeof apiKey !== "string" || apiKey === "" || apiKey.length > 512) return undefined;
  if (typeof privateKey !== "string") return undefined;
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(privateKey);
  } catch {
    return undefined;
  }
  if (bytes.length !== PRIVATE_KEY_LENGTH) return undefined;
  return { address: address as EvmAddress, accountId: BigInt(accountId), apiKey, privateKey: bytes };
}

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadTradingKey(): Promise<TradingKey | undefined> {
  const raw = await getItemAsync(KEY, ITEM_OPTIONS);
  if (raw === null) return undefined;
  const key = parseTradingKey(raw);
  if (key === undefined) await deleteItemAsync(KEY);
  return key;
}

export async function saveTradingKey(key: TradingKey): Promise<void> {
  await setItemAsync(KEY, serializeTradingKey(key), ITEM_OPTIONS);
}

export async function clearTradingKey(): Promise<void> {
  await deleteItemAsync(KEY);
}
```

`src/hooks/useAccount.ts` — `signOut` borra también la key de trading:

```ts
import { clearTradingKey } from "../storage/perpl";
…
  const signOut = useCallback(async () => {
    await Promise.all([clearStoredAccount(), clearTradingKey()]);
    replace({ status: "none" });
  }, [replace]);
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-storage.test.ts`
Expected: tsc limpio; 8 tests en verde.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/storage/perpl.ts src/hooks/useAccount.ts __tests__/perpl-storage.test.ts
git commit -m "feat(mobile): key de trading de Perpl en SecureStore, borrada al cerrar sesión"
```

---

### Task 7: `perpl/ws.ts` (parte 1) — tipos, `parseFrame` y `applyFrame` con frames reales

**Files:**
- Create: `apps/mobile/src/perpl/ws.ts`
- Test: `apps/mobile/__tests__/perpl-frames.test.ts`

**Interfaces:**
- Produces:

```ts
export type Account = { id: number; frozen: boolean; fw: boolean; lfr: number; b: bigint; lb: bigint };
export type Order = { rq: number; mkt: number; oid: number; st: number; sr: number; fr?: number; t: number; os: number; fp: number; fs: number; f: bigint; lv: number; r: boolean };
export type Position = { pid: number; mkt: number; sd: 1 | 2; st: number; s: number; ep: number; c: bigint; lv: number; fee: bigint; dpnl: bigint; xp?: number };
export type TradingState = { head: number; account: Account | null; orders: Map<number, Order>; positions: Map<number, Position> };
export const EMPTY_STATE: TradingState;
export type Frame =
  | { mt: 2 }
  | { mt: 3; cid?: number; code: number; error: string }
  | { mt: 19; sn: number; account: Account | null }
  | { mt: 21; account: Account }
  | { mt: 23; orders: Order[] }
  | { mt: 24; orders: Order[] }
  | { mt: 26; positions: Position[] }
  | { mt: 27; positions: Position[] }
  | { mt: 100; sn: number; h: number };
export function parseFrame(data: unknown): Frame | null;      // string JSON; otros mt o malformado → null
export function applyFrame(state: TradingState, frame: Frame): TradingState;   // inmutable
```

- [ ] **Step 1: Escribir los tests**

```ts
import frames from "./fixtures/perpl/ws-frames.json";
import { applyFrame, EMPTY_STATE, type Frame, parseFrame } from "../src/perpl/ws";

const parse = (f: unknown): Frame => {
  const r = parseFrame(JSON.stringify(f));
  if (r === null) throw new Error("frame not parsed");
  return r;
};

test("parseFrame reads the real wallet snapshot (account 619, lfr 5, balance)", () => {
  const f = parse(frames.walletSnapshot);
  expect(f).toEqual({ mt: 19, sn: 63177628, account: { id: 619, frozen: false, fw: true, lfr: 5, b: 99_942_357n, lb: 0n } });
});

test("parseFrame reads status, heartbeat and pong", () => {
  expect(parse(frames.statusExpiredLb)).toEqual({ mt: 3, cid: 1, code: 400, error: "last exec block already expired" });
  expect(parse(frames.statusAccepted)).toEqual({ mt: 3, cid: 2, code: 0, error: "" });
  expect(parse(frames.heartbeat)).toEqual({ mt: 100, sn: 63177519, h: 63177519 });
  expect(parse(frames.pong)).toEqual({ mt: 2 });
});

test("parseFrame reads failed and filled orders", () => {
  const failed = parse(frames.orderFailedTooLow);
  expect(failed.mt).toBe(24);
  if (failed.mt !== 24) return;
  expect(failed.orders[0]).toMatchObject({ rq: 1, st: 7, sr: 32, oid: 0, r: true, fs: 0, f: 0n });
  const filled = parse(frames.orderFilledOpen);
  if (filled.mt !== 24) throw new Error();
  expect(filled.orders[0]).toMatchObject({ rq: 6, oid: 4140410077221, st: 4, sr: 43, t: 1, fp: 2221, fs: 100, os: 100, f: 767n, lv: 100, r: true });
  expect(filled.orders[0].fr).toBeUndefined();
});

test("parseFrame reads positions and the account update", () => {
  const opened = parse(frames.positionOpened);
  if (opened.mt !== 27) throw new Error();
  expect(opened.positions[0]).toMatchObject({ pid: 4140410077185, mkt: 64, sd: 1, st: 1, s: 100, ep: 2221, c: 2_223_000n, lv: 100, fee: 767n, dpnl: 0n });
  const closed = parse(frames.positionClosed);
  if (closed.mt !== 27) throw new Error();
  expect(closed.positions[0]).toMatchObject({ pid: 4140410077185, st: 2, s: 0, dpnl: -4000n, xp: 2217 });
  const acc = parse(frames.accountAfterOpen);
  expect(acc).toEqual({ mt: 21, account: { id: 619, frozen: false, fw: true, lfr: 6, b: 97_718_590n, lb: 0n } });
  const clamped = parse(frames.positionOpenedLv500Clamped);
  if (clamped.mt !== 27) throw new Error();
  expect(clamped.positions[0].lv).toBe(300);
});

test.each([
  ["not json", "nope"],
  ["no mt", "{}"],
  ["unrelated mt", JSON.stringify({ mt: 28, in: 12 })],
  ["orders without d", JSON.stringify({ mt: 24 })],
  ["order without rq", JSON.stringify({ mt: 24, d: [{ oid: 1 }] })],
  ["position with bad side", JSON.stringify({ mt: 27, d: [{ pid: 1, mkt: 64, sd: 3, st: 1, s: 1, ep: 1, c: "1", lv: 100, fee: "0", dpnl: "0" }] })],
  ["status without code", JSON.stringify({ mt: 3, status: {} })],
  ["binary payload", new ArrayBuffer(2)],
])("parseFrame returns null for %s", (_, data) => {
  expect(parseFrame(data)).toBeNull();
});

test("applyFrame builds the account, head and positions from the real sequence", () => {
  let s = applyFrame(EMPTY_STATE, parse(frames.walletSnapshot));
  expect(s.account?.id).toBe(619);
  expect(s.head).toBe(63177628);
  s = applyFrame(s, parse(frames.heartbeat));
  expect(s.head).toBe(63177519 > 63177628 ? 63177519 : 63177628); // el head nunca retrocede
  s = applyFrame(s, parse({ ...frames.heartbeat, sn: 63177700, h: 63177700 }));
  expect(s.head).toBe(63177700);
  s = applyFrame(s, parse(frames.positionsSnapshotEmpty));
  expect(s.positions.size).toBe(0);
  s = applyFrame(s, parse(frames.positionOpened));
  expect(s.positions.get(4140410077185)?.s).toBe(100);
  s = applyFrame(s, parse(frames.accountAfterOpen));
  expect(s.account).toMatchObject({ lfr: 6, b: 97_718_590n });
  s = applyFrame(s, parse(frames.positionClosed));
  expect(s.positions.size).toBe(0);
  expect(EMPTY_STATE.positions.size).toBe(0); // inmutable: el estado inicial no se tocó
});

test("applyFrame keeps only live orders (r: true removes, snapshot replaces)", () => {
  const open = { ...frames.orderFilledOpen.d[0], oid: 77, st: 2, sr: 35, r: undefined, fs: 0 };
  let s = applyFrame(EMPTY_STATE, parse({ mt: 23, d: [open] }));
  expect(s.orders.get(77)?.st).toBe(2);
  s = applyFrame(s, parse(frames.orderFilledOpen)); // r: true, oid distinto → no se añade
  expect([...s.orders.keys()]).toEqual([77]);
  s = applyFrame(s, parse({ mt: 24, d: [{ ...open, st: 4, r: true }] }));
  expect(s.orders.size).toBe(0);
  s = applyFrame(s, parse(frames.orderFailedTooLow)); // fallo con oid 0 no entra al mapa
  expect(s.orders.size).toBe(0);
  s = applyFrame(applyFrame(EMPTY_STATE, parse({ mt: 23, d: [open] })), parse(frames.ordersSnapshotEmpty));
  expect(s.orders.size).toBe(0);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-frames.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar la parte pura de `src/perpl/ws.ts`**

```ts
// Tipos y parsers del WebSocket de trading de Perpl. Puro: sin react-native.
// Formas verificadas contra frames reales (__tests__/fixtures/perpl/ws-frames.json).

export type Account = { id: number; frozen: boolean; fw: boolean; lfr: number; b: bigint; lb: bigint };
export type Order = { rq: number; mkt: number; oid: number; st: number; sr: number; fr?: number; t: number; os: number; fp: number; fs: number; f: bigint; lv: number; r: boolean };
export type Position = { pid: number; mkt: number; sd: 1 | 2; st: number; s: number; ep: number; c: bigint; lv: number; fee: bigint; dpnl: bigint; xp?: number };
export type TradingState = { head: number; account: Account | null; orders: Map<number, Order>; positions: Map<number, Position> };

export const EMPTY_STATE: TradingState = { head: 0, account: null, orders: new Map(), positions: new Map() };

export type Frame =
  | { mt: 2 }
  | { mt: 3; cid?: number; code: number; error: string }
  | { mt: 19; sn: number; account: Account | null }
  | { mt: 21; account: Account }
  | { mt: 23; orders: Order[] }
  | { mt: 24; orders: Order[] }
  | { mt: 26; positions: Position[] }
  | { mt: 27; positions: Position[] }
  | { mt: 100; sn: number; h: number };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const amount = (v: unknown): bigint | undefined => (typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : undefined);

function account(v: unknown): Account | undefined {
  if (!isRec(v)) return undefined;
  const id = num(v.id), lfr = num(v.lfr), b = amount(v.b), lb = amount(v.lb);
  if (id === undefined || lfr === undefined || b === undefined || lb === undefined) return undefined;
  return { id, frozen: v.fr === true, fw: v.fw === true, lfr, b, lb };
}

function order(v: unknown): Order | undefined {
  if (!isRec(v)) return undefined;
  const rq = num(v.rq), mkt = num(v.mkt), oid = num(v.oid), st = num(v.st), t = num(v.t), os = num(v.os), fp = num(v.fp), fs = num(v.fs), lv = num(v.lv), f = amount(v.f);
  if (rq === undefined || mkt === undefined || oid === undefined || st === undefined || t === undefined || os === undefined || fp === undefined || fs === undefined || lv === undefined || f === undefined) return undefined;
  const o: Order = { rq, mkt, oid, st, sr: num(v.sr) ?? 0, t, os, fp, fs, f, lv, r: v.r === true };
  const fr = num(v.fr);
  if (fr !== undefined) o.fr = fr;
  return o;
}

function position(v: unknown): Position | undefined {
  if (!isRec(v)) return undefined;
  const pid = num(v.pid), mkt = num(v.mkt), sd = num(v.sd), st = num(v.st), s = num(v.s), ep = num(v.ep), lv = num(v.lv), c = amount(v.c), fee = amount(v.fee), dpnl = amount(v.dpnl);
  if (pid === undefined || mkt === undefined || (sd !== 1 && sd !== 2) || st === undefined || s === undefined || ep === undefined || lv === undefined || c === undefined || fee === undefined || dpnl === undefined) return undefined;
  const p: Position = { pid, mkt, sd, st, s, ep, c, lv, fee, dpnl };
  const xp = num(v.xp);
  if (xp !== undefined) p.xp = xp;
  return p;
}

function list<T>(v: unknown, one: (x: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const x of v) {
    const item = one(x);
    if (item === undefined) return undefined;
    out.push(item);
  }
  return out;
}

/** `ev.data` del WebSocket de RN. Devuelve null para frames ajenos o malformados (se ignoran). */
export function parseFrame(data: unknown): Frame | null {
  if (typeof data !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRec(raw)) return null;
  switch (raw.mt) {
    case 2: return { mt: 2 };
    case 3: {
      if (!isRec(raw.status)) return null;
      const code = num(raw.status.code);
      if (code === undefined) return null;
      const f: Frame = { mt: 3, code, error: typeof raw.status.error === "string" ? raw.status.error : "" };
      const cid = num(raw.cid);
      return cid === undefined ? f : { ...f, cid };
    }
    case 19: {
      const sn = num(raw.sn);
      if (sn === undefined) return null;
      const first = Array.isArray(raw.as) ? raw.as[0] : undefined;
      return { mt: 19, sn, account: account(first) ?? null };
    }
    case 21: {
      const a = account(raw);
      return a === undefined ? null : { mt: 21, account: a };
    }
    case 23: case 24: {
      const orders = list(raw.d, order);
      return orders === undefined ? null : { mt: raw.mt, orders };
    }
    case 26: case 27: {
      const positions = list(raw.d, position);
      return positions === undefined ? null : { mt: raw.mt, positions };
    }
    case 100: {
      const sn = num(raw.sn), h = num(raw.h);
      return sn === undefined || h === undefined ? null : { mt: 100, sn, h };
    }
    default: return null;
  }
}

const LIVE_ORDER = new Set([1, 2, 3, 8, 9]);

/** Nuevo estado; nunca muta el anterior. Los snapshots reemplazan; los updates mezclan. */
export function applyFrame(state: TradingState, frame: Frame): TradingState {
  switch (frame.mt) {
    case 19: return { ...state, head: Math.max(state.head, frame.sn), account: frame.account };
    case 100: return { ...state, head: Math.max(state.head, frame.h) };
    case 21: return { ...state, account: frame.account };
    case 23: return { ...state, orders: new Map(frame.orders.filter((o) => !o.r && o.oid !== 0 && LIVE_ORDER.has(o.st)).map((o) => [o.oid, o])) };
    case 24: {
      const orders = new Map(state.orders);
      for (const o of frame.orders) {
        if (o.r || o.oid === 0 || !LIVE_ORDER.has(o.st)) orders.delete(o.oid);
        else orders.set(o.oid, o);
      }
      return { ...state, orders };
    }
    case 26: return { ...state, positions: new Map(frame.positions.filter((p) => p.st === 1).map((p) => [p.pid, p])) };
    case 27: {
      const positions = new Map(state.positions);
      for (const p of frame.positions) {
        if (p.st === 1) positions.set(p.pid, p);
        else positions.delete(p.pid);
      }
      return { ...state, positions };
    }
    default: return state;
  }
}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-frames.test.ts`
Expected: tsc limpio; 14 tests en verde.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/ws.ts __tests__/perpl-frames.test.ts
git commit -m "feat(mobile): parsers del WebSocket de Perpl con frames reales"
```

---

### Task 8: `perpl/ws.ts` (parte 2) — `TradingSocket`: sign-in, ping, órdenes, reintento, timeout, reconexión

**Files:**
- Modify: `apps/mobile/src/perpl/ws.ts` (añadir al final)
- Test: `apps/mobile/__tests__/perpl-socket.test.ts`

**Interfaces:**
- Consumes: `signWsSignin` (`perpl/apiKey.ts`); `orderFrame`, `describeOrderStatus`, `OrderIntent` (`perpl/orders.ts`); `PING_MS`, `ORDER_TIMEOUT_MS`, `RECONNECT_DELAYS_MS` (`perpl/config.ts`); `parseFrame`, `applyFrame` (Task 7).
- Produces:

```ts
export type SocketStatus = "connecting" | "live" | "reconnecting" | "closed";
export type OrderOutcome = { kind: "filled"; order: Order } | { kind: "open"; order: Order } | { kind: "failed"; order?: Order; text: string } | { kind: "unknown" };
export type SocketEvent = { type: "status"; status: SocketStatus } | { type: "state"; state: TradingState } | { type: "keyRejected" };
export type WebSocketLike = {
  readyState: number; send(data: string): void; close(): void;
  onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null; onerror: ((ev: unknown) => void) | null;
};
export type SocketOptions = { url: string; chainId: number; apiKey: string; privateKey: Uint8Array; onEvent: (e: SocketEvent) => void; createSocket?: (url: string) => WebSocketLike; now?: () => number };
export class TradingSocket {
  constructor(opts: SocketOptions);
  connect(): void;
  close(): void;
  get status(): SocketStatus;
  get state(): TradingState;
  placeOrder(intent: OrderIntent): Promise<OrderOutcome>;   // rechaza si no está live o si el gateway devuelve code ≠ 0
}
```

- [ ] **Step 1: Escribir los tests**

```ts
import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad } from "@scure/base";
import { hexToBytes } from "viem";
import frames from "./fixtures/perpl/ws-frames.json";
import { generateTradingKey, wsSigninCanonical } from "../src/perpl/apiKey";
import { openIntent } from "../src/perpl/orders";
import { parseContext } from "../src/perpl/context";
import contextJson from "./fixtures/perpl/context.json";
import { type SocketEvent, TradingSocket, type WebSocketLike } from "../src/perpl/ws";

class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.({}); }
  receive(f: unknown) { this.onmessage?.({ data: JSON.stringify(f) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: "" }); }
  frames(): Record<string, unknown>[] { return this.sent.map((s) => JSON.parse(s)); }
}

const MON = parseContext(contextJson).markets.find((m) => m.id === 64)!;
const HEAD = 63177640;

function boot(live = true) {
  const fakes: FakeSocket[] = [];
  const events: SocketEvent[] = [];
  const { privateKey, publicKeyHex } = generateTradingKey();
  const socket = new TradingSocket({
    url: "wss://x.test/ws", chainId: 10143, apiKey: "key-123", privateKey,
    onEvent: (e) => events.push(e), createSocket: () => { const f = new FakeSocket(); fakes.push(f); return f; }, now: () => 1789606875716,
  });
  socket.connect();
  const fake = fakes[0];
  fake.open();
  if (live) {
    fake.receive(frames.walletSnapshot);
    fake.receive(frames.ordersSnapshotEmpty);
    fake.receive(frames.positionsSnapshotEmpty);
    fake.receive({ ...frames.heartbeat, sn: HEAD, h: HEAD });
  }
  return { socket, fakes, events, fake, publicKeyHex };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test("the first frame is a verifiable mt 29 sign-in and the snapshot makes the socket live", () => {
  const { socket, fake, events, publicKeyHex } = boot();
  const signin = fake.frames()[0];
  expect(signin).toMatchObject({ mt: 29, chain_id: 10143, api_key: "key-123", timestamp: "1789606875716" });
  const canonical = wsSigninCanonical(10143, signin.timestamp as string, signin.nonce as string);
  expect(ed25519.verify(base64urlnopad.decode(signin.signature as string), new TextEncoder().encode(canonical), hexToBytes(publicKeyHex))).toBe(true);
  expect(socket.status).toBe("live");
  expect(socket.state.account?.id).toBe(619);
  expect(socket.state.head).toBe(HEAD);
  expect(events.filter((e) => e.type === "status").map((e) => e.type === "status" && e.status)).toEqual(["connecting", "live"]);
});

test("pings every 3 s while open", () => {
  const { fake } = boot();
  const before = fake.frames().filter((f) => f.mt === 1).length;
  jest.advanceTimersByTime(3000);
  expect(fake.frames().filter((f) => f.mt === 1).length).toBe(before + 1);
  jest.advanceTimersByTime(3000);
  expect(fake.frames().filter((f) => f.mt === 1).length).toBe(before + 2);
});

test("placeOrder: rq = lfr + 1, lb = head + ttl; resolves filled on the first non-failure mt 24", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  const sent = fake.frames().find((f) => f.mt === 22)!;
  expect(sent).toMatchObject({ sn: 1, rq: 6, lb: HEAD + 20, mkt: 64, acc: 619, t: 1, s: 100, p: 0, fl: 4, ms: 100, lv: 100 });
  fake.receive({ ...frames.statusAccepted, cid: 1 });
  fake.receive(frames.accountAfterOpen);
  fake.receive(frames.orderFilledOpen);
  await expect(p).resolves.toMatchObject({ kind: "filled", order: { fp: 2221, fs: 100, f: 767n } });
  expect(socket.state.account?.lfr).toBe(6);
});

test("two orders in flight get strictly increasing rq even before lfr moves", () => {
  const { socket, fake } = boot();
  void socket.placeOrder(openIntent(MON, 619, "long", 100, 1)).catch(() => {});
  void socket.placeOrder(openIntent(MON, 619, "long", 100, 1)).catch(() => {});
  const rqs = fake.frames().filter((f) => f.mt === 22).map((f) => f.rq);
  expect(rqs).toEqual([6, 7]);
  const sns = fake.frames().filter((f) => f.mt === 22).map((f) => f.sn);
  expect(sns).toEqual([1, 2]);
});

test("a gateway rejection (mt 3 code ≠ 0) rejects immediately with the gateway error", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.statusExpiredLb, cid: 1 });
  await expect(p).rejects.toThrow("last exec block already expired");
});

test("sr 32 retries exactly once with a fresh rq, then resolves with the fill", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.statusAccepted, cid: 1 });
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] });
  const sent = fake.frames().filter((f) => f.mt === 22);
  expect(sent).toHaveLength(2);
  expect(sent[1]).toMatchObject({ sn: 2, rq: 7, t: 1, s: 100 });
  fake.receive({ ...frames.statusAccepted, cid: 2 });
  fake.receive({ ...frames.orderFilledOpen, d: [{ ...frames.orderFilledOpen.d[0], rq: 7 }] });
  await expect(p).resolves.toMatchObject({ kind: "filled" });
});

test("a second sr 32 fails the order instead of retrying again", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] });
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 7 }] });
  expect(fake.frames().filter((f) => f.mt === 22)).toHaveLength(2);
  await expect(p).resolves.toMatchObject({ kind: "failed", text: "Order id too low — retrying" });
});

test("other failures resolve failed with the described reason (sr 34)", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6, sr: 34 }] });
  await expect(p).resolves.toMatchObject({ kind: "failed", text: "One-click trading is off. Enable trading again" });
});

test("late frames for an already-resolved rq are ignored", async () => {
  const { socket, fake } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.receive(frames.orderFilledOpen);
  await expect(p).resolves.toMatchObject({ kind: "filled" });
  expect(() => fake.receive({ ...frames.orderFailedTooLow, d: [{ ...frames.orderFailedTooLow.d[0], rq: 6 }] })).not.toThrow();
});

test("no mt 24 within 30 s resolves unknown", async () => {
  const { socket } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  jest.advanceTimersByTime(30_000);
  await expect(p).resolves.toEqual({ kind: "unknown" });
});

test("placeOrder rejects when the socket is not live", async () => {
  const { socket } = boot(false);
  await expect(socket.placeOrder(openIntent(MON, 619, "long", 100, 1))).rejects.toThrow("Not connected to Perpl");
});

test("a dropped socket reconnects with backoff, moves pending orders to unknown and the new snapshot replaces the state", async () => {
  const { socket, fakes, fake, events } = boot();
  const p = socket.placeOrder(openIntent(MON, 619, "long", 100, 1));
  fake.drop(1008);
  expect(socket.status).toBe("reconnecting");
  await expect(p).resolves.toEqual({ kind: "unknown" });
  expect(fakes).toHaveLength(1);
  jest.advanceTimersByTime(999);
  expect(fakes).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(fakes).toHaveLength(2);
  fakes[1].open();
  expect(fakes[1].frames()[0].mt).toBe(29);
  fakes[1].receive({ ...frames.walletSnapshot, as: [{ ...frames.walletSnapshot.as[0], lfr: 9 }] });
  expect(socket.status).toBe("live");
  expect(socket.state.account?.lfr).toBe(9);
  // el segundo drop espera 2 s (backoff) — y tras una conexión viva el contador vuelve a 1 s
  fakes[1].drop();
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(3);
  expect(events.some((e) => e.type === "keyRejected")).toBe(false);
});

test("backoff grows 1·2·4 s while the socket keeps failing before going live", () => {
  const { fakes, fake } = boot(false);
  fake.drop();
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(2);
  fakes[1].drop();
  jest.advanceTimersByTime(1999);
  expect(fakes).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(fakes).toHaveLength(3);
  fakes[2].drop();
  jest.advanceTimersByTime(4000);
  expect(fakes).toHaveLength(4);
});

test("two consecutive 3401 closes emit keyRejected and stop reconnecting", () => {
  const { socket, fakes, fake, events } = boot(false);
  fake.drop(3401);
  jest.advanceTimersByTime(1000);
  expect(fakes).toHaveLength(2);
  fakes[1].drop(3401);
  expect(events.some((e) => e.type === "keyRejected")).toBe(true);
  expect(socket.status).toBe("closed");
  jest.advanceTimersByTime(60_000);
  expect(fakes).toHaveLength(2);
});

test("close() closes the socket for good: no ping, no reconnect", () => {
  const { socket, fakes, fake } = boot();
  socket.close();
  expect(fake.closed).toBe(true);
  expect(socket.status).toBe("closed");
  const sent = fake.sent.length;
  jest.advanceTimersByTime(60_000);
  expect(fake.sent.length).toBe(sent);
  expect(fakes).toHaveLength(1);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-socket.test.ts`
Expected: FAIL — `TradingSocket` no exportado.

- [ ] **Step 3: Implementar `TradingSocket` al final de `src/perpl/ws.ts`**

```ts
import { signWsSignin } from "./apiKey";
import { ORDER_TIMEOUT_MS, PING_MS, RECONNECT_DELAYS_MS } from "./config";
import { describeOrderStatus, type OrderIntent, orderFrame } from "./orders";
// (mover estos imports al inicio del archivo)

export type SocketStatus = "connecting" | "live" | "reconnecting" | "closed";
export type OrderOutcome =
  | { kind: "filled"; order: Order }
  | { kind: "open"; order: Order }
  | { kind: "failed"; order?: Order; text: string }
  | { kind: "unknown" };
export type SocketEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "state"; state: TradingState }
  | { type: "keyRejected" };
export type WebSocketLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};
export type SocketOptions = {
  url: string; chainId: number; apiKey: string; privateKey: Uint8Array;
  onEvent: (e: SocketEvent) => void;
  createSocket?: (url: string) => WebSocketLike;
  now?: () => number;
};

type Pending = { intent: OrderIntent; sn: number; rq: number; retried: boolean; timer: ReturnType<typeof setTimeout>; resolve: (o: OrderOutcome) => void; reject: (e: Error) => void };

const OPEN = 1;
const AUTH_FAILED = 3401;

/** Un socket por sesión de la pestaña Trade. Sin React: se prueba con un WebSocket falso y timers falsos. */
export class TradingSocket {
  private ws: WebSocketLike | null = null;
  private _status: SocketStatus = "closed";
  private _state: TradingState = EMPTY_STATE;
  private sn = 0;
  private lastRq = 0;
  private attempt = 0;
  private authFailures = 0;
  private closedByUser = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private pending = new Map<number, Pending>(); // por sn
  private readonly createSocket: (url: string) => WebSocketLike;
  private readonly now: () => number;

  constructor(private readonly opts: SocketOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.now = opts.now ?? (() => Date.now());
  }

  get status(): SocketStatus { return this._status; }
  get state(): TradingState { return this._state; }

  connect(): void {
    this.closedByUser = false;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = this.createSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () => {
      // Primer frame: sign-in firmado (idle 10 s en testnet).
      const { timestamp, nonce, signature } = signWsSignin(this.opts.privateKey, this.opts.chainId, this.now());
      ws.send(JSON.stringify({ mt: 29, chain_id: this.opts.chainId, api_key: this.opts.apiKey, timestamp, nonce, signature }));
      this.stopPing();
      this.ping = setInterval(() => { if (ws.readyState === OPEN) ws.send(JSON.stringify({ mt: 1, t: this.now() })); }, PING_MS);
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => { /* onclose sigue */ };
    ws.onclose = (ev) => { if (this.ws === ws) this.handleClose(ev.code); };
  }

  close(): void {
    this.closedByUser = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.stopPing();
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.failPending();
    this.setStatus("closed");
  }

  placeOrder(intent: OrderIntent): Promise<OrderOutcome> {
    const ws = this.ws;
    if (this._status !== "live" || !ws || ws.readyState !== OPEN || !this._state.account) {
      return Promise.reject(new Error("Not connected to Perpl. Wait for the Live badge and try again."));
    }
    return new Promise<OrderOutcome>((resolve, reject) => {
      const sn = ++this.sn;
      const rq = this.nextRq();
      const timer = setTimeout(() => this.settle(sn, { kind: "unknown" }), ORDER_TIMEOUT_MS);
      this.pending.set(sn, { intent, sn, rq, retried: false, timer, resolve, reject });
      ws.send(JSON.stringify(orderFrame(intent, { sn, rq, head: this._state.head })));
    });
  }

  private nextRq(): number {
    this.lastRq = Math.max(this.lastRq, this._state.account?.lfr ?? 0) + 1;
    return this.lastRq;
  }

  private handle(data: unknown): void {
    const frame = parseFrame(data);
    if (frame === null) return;
    this._state = applyFrame(this._state, frame);
    if (frame.mt === 19) {
      this.attempt = 0;
      this.authFailures = 0;
      this.setStatus("live");
    }
    if (frame.mt === 3) {
      const p = frame.cid === undefined ? undefined : this.pending.get(frame.cid);
      if (p && frame.code !== 0) this.fail(p, new Error(frame.error || `Perpl rejected the order (${frame.code})`));
    }
    if (frame.mt === 24) {
      for (const order of frame.orders) {
        const p = [...this.pending.values()].find((x) => x.rq === order.rq);
        if (!p) continue;
        const { kind, text } = describeOrderStatus(order.st, order.sr, order.fr);
        if (kind === "failed" && order.sr === 32 && !p.retried) { this.resend(p); continue; }
        if (kind === "sent") continue; // pending/untriggered: seguimos esperando
        this.settle(p.sn, kind === "filled" ? { kind, order } : kind === "open" ? { kind, order } : { kind: "failed", order, text });
      }
    }
    if (frame.mt !== 2 && frame.mt !== 3) this.opts.onEvent({ type: "state", state: this._state });
  }

  /** sr 32: un reintento con rq nuevo y sn nuevo (el sn debe ser único por frame). */
  private resend(p: Pending): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) { this.settle(p.sn, { kind: "unknown" }); return; }
    this.pending.delete(p.sn);
    const sn = ++this.sn;
    const rq = this.nextRq();
    const next: Pending = { ...p, sn, rq, retried: true };
    this.pending.set(sn, next);
    ws.send(JSON.stringify(orderFrame(p.intent, { sn, rq, head: this._state.head })));
  }

  private settle(sn: number, outcome: OrderOutcome): void {
    const p = this.pending.get(sn);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(sn);
    p.resolve(outcome);
  }

  private fail(p: Pending, error: Error): void {
    clearTimeout(p.timer);
    this.pending.delete(p.sn);
    p.reject(error);
  }

  private failPending(): void {
    for (const sn of [...this.pending.keys()]) this.settle(sn, { kind: "unknown" });
  }

  private handleClose(code: number): void {
    this.stopPing();
    this.ws = null;
    this.failPending();
    if (this.closedByUser) return;
    if (code === AUTH_FAILED && ++this.authFailures >= 2) {
      this.setStatus("closed");
      this.opts.onEvent({ type: "keyRejected" });
      return;
    }
    this.setStatus("reconnecting");
    const delay = RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }

  private stopPing(): void {
    if (this.ping) { clearInterval(this.ping); this.ping = null; }
  }

  private setStatus(status: SocketStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.opts.onEvent({ type: "status", status });
  }
}
```

Nota sobre `connect()` tras un drop: `attempt` ya es ≥ 1, así que el estado emitido es `reconnecting` (ya lo era) y no se duplica el evento. Tras el snapshot (`mt: 19`) vuelve a 0: el siguiente drop espera 1 s de nuevo (test "a dropped socket…").

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-socket.test.ts __tests__/perpl-frames.test.ts`
Expected: tsc limpio; 15 + 14 tests en verde.

- [ ] **Step 5: Commit**

```bash
git add src/perpl/ws.ts __tests__/perpl-socket.test.ts
git commit -m "feat(mobile): TradingSocket de Perpl con sign-in, ping, reintento de rq, timeout y reconexión"
```

---

### Task 9: `perpl/enable.ts` — máquina de 4 pasos reanudable (sin repetir `createAccount`)

**Files:**
- Create: `apps/mobile/src/perpl/enable.ts`
- Test: `apps/mobile/__tests__/perpl-enable.test.ts`

**Interfaces:**
- Consumes: `TradingKey` (`storage/perpl.ts`, solo tipo).
- Produces:

```ts
export type EnableStep = 1 | 2 | 3 | 4;   // Approve AUSD · Create trading account · Allow one-click trading · Register trading key
export const ENABLE_STEPS: readonly [string, string, string, string];
export type EnableDeps = {
  readAccountId(): Promise<bigint>;
  readAllowance(): Promise<bigint>;
  approve(amount: bigint): Promise<void>;           // envía y espera recibo; lanza si revierte
  createAccount(amount: bigint): Promise<void>;
  isForwarding(): Promise<boolean | undefined>;     // undefined = no se sabe → se vuelve a enviar
  allowForwarding(): Promise<void>;
  loadKey(accountId: bigint): Promise<TradingKey | undefined>;
  enrollKey(accountId: bigint): Promise<TradingKey>; // genera, enrola y guarda
};
export class EnableError extends Error { step: EnableStep; cause: unknown }
export async function runEnable(deps: EnableDeps, amount: bigint, onStep: (step: EnableStep) => void): Promise<TradingKey>;
```

- [ ] **Step 1: Escribir los tests**

```ts
import type { TradingKey } from "../src/storage/perpl";
import { ENABLE_STEPS, EnableError, type EnableDeps, runEnable } from "../src/perpl/enable";

const KEY: TradingKey = { address: "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f", accountId: 619n, apiKey: "k", privateKey: new Uint8Array(32) };

function deps(over: Partial<EnableDeps> = {}) {
  const d = {
    readAccountId: jest.fn(async () => 0n),
    readAllowance: jest.fn(async () => 0n),
    approve: jest.fn(async () => {}),
    createAccount: jest.fn(async () => {}),
    isForwarding: jest.fn(async () => undefined as boolean | undefined),
    allowForwarding: jest.fn(async () => {}),
    loadKey: jest.fn(async () => undefined as TradingKey | undefined),
    enrollKey: jest.fn(async () => KEY),
    ...over,
  };
  return d;
}

test("fresh wallet: approve → createAccount → forwarding → enroll, reporting each step", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValueOnce(619n) });
  const steps: number[] = [];
  await expect(runEnable(d, 100_000_000n, (s) => steps.push(s))).resolves.toEqual(KEY);
  expect(steps).toEqual([1, 2, 3, 4]);
  expect(d.approve).toHaveBeenCalledWith(100_000_000n);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
  expect(d.allowForwarding).toHaveBeenCalledTimes(1);
  expect(d.enrollKey).toHaveBeenCalledWith(619n);
  expect(ENABLE_STEPS).toEqual(["Approve AUSD", "Create trading account", "Allow one-click trading", "Register trading key"]);
});

test("skips approve when the allowance already covers the amount", async () => {
  const d = deps({ readAllowance: jest.fn(async () => 100_000_000n), readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValueOnce(619n) });
  await runEnable(d, 100_000_000n, () => {});
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).toHaveBeenCalledTimes(1);
});

test("with an existing account it never calls approve or createAccount again", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n) });
  const steps: number[] = [];
  await runEnable(d, 100_000_000n, (s) => steps.push(s));
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).not.toHaveBeenCalled();
  expect(steps).toEqual([1, 3, 4]);
});

test("skips forwarding when it is known to be on, and enrolment when a key is stored", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n), isForwarding: jest.fn(async () => true), loadKey: jest.fn(async () => KEY) });
  await expect(runEnable(d, 100_000_000n, () => {})).resolves.toEqual(KEY);
  expect(d.allowForwarding).not.toHaveBeenCalled();
  expect(d.enrollKey).not.toHaveBeenCalled();
});

test("a failure carries the step so the UI can resume there", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 619n), allowForwarding: jest.fn(async () => { throw new Error("User canceled the operation."); }) });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EnableError);
  expect((err as EnableError).step).toBe(3);
  expect((err as EnableError).message).toBe("User canceled the operation.");
  expect(d.enrollKey).not.toHaveBeenCalled();
});

test("createAccount that leaves no account on-chain is a step-2 failure", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n) });
  const err = await runEnable(d, 100_000_000n, () => {}).catch((e: unknown) => e);
  expect((err as EnableError).step).toBe(2);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
});

test("retry after a step-4 failure does not create the account twice", async () => {
  const enroll = jest.fn(async () => { throw new Error("Perpl rejected the enrolment (500)."); });
  const d = deps({ readAccountId: jest.fn(async () => 0n).mockResolvedValueOnce(0n).mockResolvedValue(619n), enrollKey: enroll });
  await expect(runEnable(d, 100_000_000n, () => {})).rejects.toBeInstanceOf(EnableError);
  enroll.mockResolvedValue(KEY);
  await expect(runEnable(d, 100_000_000n, () => {})).resolves.toEqual(KEY);
  expect(d.createAccount).toHaveBeenCalledTimes(1);
  expect(d.allowForwarding).toHaveBeenCalledTimes(2); // sin getter: se reenvía (ruling 5)
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-enable.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/enable.ts`**

```ts
import type { TradingKey } from "../storage/perpl";

export type EnableStep = 1 | 2 | 3 | 4;
export const ENABLE_STEPS = ["Approve AUSD", "Create trading account", "Allow one-click trading", "Register trading key"] as const;

export type EnableDeps = {
  readAccountId(): Promise<bigint>;
  readAllowance(): Promise<bigint>;
  approve(amount: bigint): Promise<void>;
  createAccount(amount: bigint): Promise<void>;
  isForwarding(): Promise<boolean | undefined>;
  allowForwarding(): Promise<void>;
  loadKey(accountId: bigint): Promise<TradingKey | undefined>;
  enrollKey(accountId: bigint): Promise<TradingKey>;
};

export class EnableError extends Error {
  constructor(readonly step: EnableStep, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "EnableError";
  }
}

async function at<T>(step: EnableStep, onStep: (s: EnableStep) => void, run: () => Promise<T>): Promise<T> {
  onStep(step);
  try {
    return await run();
  } catch (e) {
    throw e instanceof EnableError ? e : new EnableError(step, e);
  }
}

/**
 * Reanudable: verifica antes de cada paso y nunca repite createAccount si ya hay id.
 * Paso 3 se reenvía cuando no se sabe si el forwarding está activo (no hay getter on-chain).
 */
export async function runEnable(deps: EnableDeps, amount: bigint, onStep: (step: EnableStep) => void): Promise<TradingKey> {
  let accountId = await at(1, onStep, async () => {
    const id = await deps.readAccountId();
    if (id === 0n && (await deps.readAllowance()) < amount) await deps.approve(amount);
    return id;
  });
  if (accountId === 0n) {
    accountId = await at(2, onStep, async () => {
      await deps.createAccount(amount);
      const id = await deps.readAccountId();
      if (id === 0n) throw new Error("The trading account did not appear on-chain. Try again.");
      return id;
    });
  }
  await at(3, onStep, async () => {
    if ((await deps.isForwarding()) !== true) await deps.allowForwarding();
  });
  const id = accountId;
  return at(4, onStep, async () => (await deps.loadKey(id)) ?? deps.enrollKey(id));
}
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-enable.test.ts`
Expected: tsc limpio; 7 tests en verde.

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/enable.ts __tests__/perpl-enable.test.ts
git commit -m "feat(mobile): máquina reanudable de los 4 pasos de Enable trading"
```

---

### Task 10: `store.ts` (pantallas nuevas) y `hooks/useUnlock.ts` (desbloqueo compartido)

**Files:**
- Modify: `apps/mobile/src/store.ts` (`Screen`, `StoreState`, `GATED`, `CAN_BACK`, `SHOW_TABS`, `headerFor`)
- Create: `apps/mobile/src/hooks/useUnlock.ts`
- Modify: `apps/mobile/src/hooks/useTreasury.ts:81-89` (usa `useUnlock`)
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Produces: `Screen` gana `"perps" | "perpsMarket" | "perpsFunds"`; `StoreState` gana `perpsMarketId?: number; perpsSide?: "long" | "short"; fundsMode?: "add" | "withdraw"`; `headerFor(screen, agent, post, mode, balance, perpsSymbol?: string)`; exports nuevos `CAN_BACK`, `SHOW_TABS` (ya existen como const internas: exportarlas). `useUnlock(account: AccountState, onUnlock: (w: Wallet) => void): () => Promise<Wallet>`.

- [ ] **Step 1: Escribir los tests** (añadir a `__tests__/store.test.ts`; ampliar el import con `CAN_BACK`, `GATED`, `SHOW_TABS`, `headerFor` y `AGENTS`, `POSTS` de `../src/mock/data`)

```ts
test("the three Perpl screens need an account; only the tab shows the tab bar; subscreens can go back", () => {
  for (const s of ["perps", "perpsMarket", "perpsFunds"] as const) expect(GATED).toContain(s);
  expect(SHOW_TABS).toContain("perps");
  expect(SHOW_TABS).not.toContain("perpsMarket");
  expect(SHOW_TABS).not.toContain("perpsFunds");
  expect(CAN_BACK).toContain("perpsMarket");
  expect(CAN_BACK).toContain("perpsFunds");
  expect(CAN_BACK).not.toContain("perps");
});

test("without an account the Trade tab asks for access and comes back to it", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "perps"));
  expect(s.screen).toBe("perps");
});

test("headers of the Perpl screens", () => {
  const agent = AGENTS.pkl, post = POSTS[0];
  expect(headerFor("perps", agent, post, "buy", 0)).toEqual(["Trade", "Perps on Perpl · Monad"]);
  expect(headerFor("perpsMarket", agent, post, "buy", 0, "MON")).toEqual(["MON Perp", "Market order"]);
  expect(headerFor("perpsMarket", agent, post, "buy", 0)).toEqual(["Perp", "Market order"]);
  expect(headerFor("perpsFunds", agent, post, "buy", 0)).toEqual(["Trading funds", "Between wallet and trading"]);
});

test("nav to a market keeps the chosen market and side in the state", () => {
  const s = navState(INITIAL, "perpsMarket", { perpsMarketId: 64, perpsSide: "short" });
  expect(s).toMatchObject({ screen: "perpsMarket", perpsMarketId: 64, perpsSide: "short" });
  expect(navState(INITIAL, "perpsFunds", { fundsMode: "withdraw" }).fundsMode).toBe("withdraw");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/store.test.ts`
Expected: FAIL — `"perps"` no es `Screen` (error de tipos en ts-jest/babel se manifiesta como fallo de aserción o de compilación); `CAN_BACK`/`SHOW_TABS` no exportados.

- [ ] **Step 3: Implementar en `src/store.ts`**

```ts
export type Screen =
  | "market" | "search" | "agent"
  | "trade" | "signin"
  | "activity" | "post" | "ask"
  | "portfolio" | "position" | "wallet" | "deposit" | "withdraw"
  | "perps" | "perpsMarket" | "perpsFunds";
```

En `StoreState`, tras `nextPatch?: Patch;`:

```ts
  /** Pestaña Trade (Perpl): mercado y lado elegidos, y modo de la pantalla de fondos. */
  perpsMarketId?: number;
  perpsSide?: "long" | "short";
  fundsMode?: "add" | "withdraw";
```

```ts
export const GATED: readonly Screen[] = ["wallet", "portfolio", "position", "deposit", "withdraw", "trade", "perps", "perpsMarket", "perpsFunds"];
…
export const CAN_BACK: readonly Screen[] = ["agent", "trade", "post", "ask", "position", "deposit", "withdraw", "search", "signin", "perpsMarket", "perpsFunds"];
export const SHOW_TABS: readonly Screen[] = ["market", "activity", "portfolio", "wallet", "search", "position", "perps"];

export function headerFor(screen: Screen, agent: Agent, post: Post, mode: Mode, balance: number, perpsSymbol?: string): [string, string] {
  switch (screen) {
    …
    case "perps": return ["Trade", "Perps on Perpl · Monad"];
    case "perpsMarket": return [perpsSymbol ? `${perpsSymbol} Perp` : "Perp", "Market order"];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
  }
}
```

`StoreInput` gana `perpsMarkets?: { id: number; symbol: string }[]` (default `[]`); dentro de `useAppStore`: `const perpsSymbol = (perpsMarkets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;` y `headerFor(S.screen, agent, post, S.mode, balance, perpsSymbol)`. `App.tsx` lo alimenta con `perpl.context?.markets` en Task 11.

`src/hooks/useUnlock.ts`:

```ts
import { useCallback } from "react";
import type { AccountState } from "../account";
import { unlockStoredWallet, type Wallet } from "../wallet/wallet";

/** Wallet desbloqueada: la de la cuenta, o la guardada (pide Face ID) avisando a useAccount. Compartido por tesorería y Perpl. */
export function useUnlock(account: AccountState, onUnlock: (w: Wallet) => void): () => Promise<Wallet> {
  return useCallback(async (): Promise<Wallet> => {
    if (account.status === "unlocked") return account.wallet;
    const unlocked = await unlockStoredWallet();
    if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
    onUnlock(unlocked);
    return unlocked;
  }, [account, onUnlock]);
}
```

`src/hooks/useTreasury.ts`: borrar el `openWallet` local (líneas 81–89) y su import de `unlockStoredWallet`; añadir `import { useUnlock } from "./useUnlock";` y `const openWallet = useUnlock(account, onUnlock);` en el mismo lugar. Nada más cambia.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/store.test.ts`
Expected: tsc limpio; 18 tests en verde (14 previos + 4).

- [ ] **Step 5: Commit** (el coordinador, por nombre)

```bash
git add src/store.ts src/hooks/useUnlock.ts src/hooks/useTreasury.ts __tests__/store.test.ts
git commit -m "feat(mobile): pantallas perps en el store y desbloqueo compartido useUnlock"
```

---

### Task 11: `hooks/usePerpl.ts` — orquestación, y cableado en `ctx.ts`/`App.tsx`

**Files:**
- Create: `apps/mobile/src/hooks/usePerpl.ts`
- Modify: `apps/mobile/src/ctx.ts`
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: todo lo de Tasks 2–10.
- Produces (lo que consumen las pantallas):

```ts
export type PerplState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "onboarding"; step: EnableStep; error?: string }
  | { status: "ready"; key: TradingKey };
export type Live = { status: SocketStatus; account: Account | null; positions: Position[]; head: number; keyRejected: boolean };
export type Perpl = {
  state: PerplState;
  context: Context | null;
  contextError: string;
  live: Live | null;                 // null cuando el socket no está creado
  lastBalance: bigint | null;        // último `b` visto (Wallet: "· last seen")
  enable(amount: bigint): Promise<void>;
  enableForwardingOnly(): Promise<void>;
  addFunds(amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted">;
  withdraw(amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted">;
  open(market: Market, side: Side, ausd: bigint, lv: number): Promise<OrderOutcome>;
  close(market: Market, position: Position): Promise<OrderOutcome>;
  resetKey(): Promise<void>;
  setActive(active: boolean): void;
  refreshContext(): Promise<void>;
};
export function usePerpl(account: AccountState, onUnlock: (w: Wallet) => void, treasury: Treasury): Perpl;
```

`AppCtx` gana `perpl: Perpl`.

- [ ] **Step 1: Implementar `src/hooks/usePerpl.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { Hex } from "viem";
import { accountAddress, type AccountState } from "../account";
import { PERPL_URLS } from "../config/perpl";
import { enrollTradingKey, generateTradingKey } from "../perpl/apiKey";
import { CONTEXT_POLL_MS, PERPL_CHAIN_ID, SOCKET_GRACE_MS } from "../perpl/config";
import { type Context, fetchContext, type Market } from "../perpl/context";
import { EnableError, type EnableStep, runEnable } from "../perpl/enable";
import {
  approveExchange, createExchangeAccount, depositCollateral, enableForwarding, readAccountId, readAllowance, withdrawCollateral,
} from "../perpl/onboarding";
import { closeIntent, openIntent, type OrderOutcome, type Side, sizeFromAusd } from "../perpl/orders";
import { type Account, type Position, type SocketStatus, TradingSocket, type TradingState } from "../perpl/ws";
import { clearTradingKey, loadTradingKey, saveTradingKey, type TradingKey } from "../storage/perpl";
import { readBalances, waitForReceipt } from "../wallet/chain";
import { describeError, type Wallet } from "../wallet/wallet";
import type { Treasury } from "./useTreasury";
import { useUnlock } from "./useUnlock";

export type PerplState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "onboarding"; step: EnableStep; error?: string }
  | { status: "ready"; key: TradingKey };

export type Live = { status: SocketStatus; account: Account | null; positions: Position[]; head: number; keyRejected: boolean };

export type Perpl = {
  state: PerplState;
  context: Context | null;
  contextError: string;
  live: Live | null;
  lastBalance: bigint | null;
  enable: (amount: bigint) => Promise<void>;
  enableForwardingOnly: () => Promise<void>;
  addFunds: (amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
  withdraw: (amount: bigint, onSent: (hash: Hex) => void) => Promise<"success" | "reverted">;
  open: (market: Market, side: Side, ausd: bigint, lv: number) => Promise<OrderOutcome>;
  close: (market: Market, position: Position) => Promise<OrderOutcome>;
  resetKey: () => Promise<void>;
  setActive: (active: boolean) => void;
  refreshContext: () => Promise<void>;
};

const NO_MON = "You need test MON for gas. Get some at the Monad faucet and try again.";
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

function describeTxError(e: unknown): string {
  const msg = describeError(e instanceof EnableError ? e.cause : e);
  return /rejected/i.test(msg) ? "Network refused the transaction — try again in a moment." : msg;
}

async function confirm(hash: Hex): Promise<void> {
  if ((await waitForReceipt(hash)) !== "success") throw new Error("The transaction reverted.");
}

function toLive(state: TradingState, status: SocketStatus, keyRejected: boolean): Live {
  return { status, account: state.account, positions: [...state.positions.values()], head: state.head, keyRejected };
}

export function usePerpl(account: AccountState, onUnlock: (w: Wallet) => void, treasury: Treasury): Perpl {
  const address = accountAddress(account);
  const openWallet = useUnlock(account, onUnlock);
  const [state, setState] = useState<PerplState>({ status: "loading" });
  const [context, setContext] = useState<Context | null>(null);
  const [contextError, setContextError] = useState("");
  const [live, setLive] = useState<Live | null>(null);
  const [lastBalance, setLastBalance] = useState<bigint | null>(null);
  const [active, setActiveState] = useState(false);
  const socketRef = useRef<TradingSocket | null>(null);
  const liveRef = useRef<Live | null>(null);
  const forwardedRef = useRef(false); // paso 3 ya enviado en esta sesión (no hay getter on-chain)
  const graceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  liveRef.current = live;

  // Arranque y cambio de cuenta: la key guardada vale solo para su address.
  useEffect(() => {
    let stale = false;
    forwardedRef.current = false;
    if (!address) {
      setState({ status: "none" });
      setLastBalance(null);
      return;
    }
    setState({ status: "loading" });
    loadTradingKey()
      .then((key) => { if (!stale) setState(key && same(key.address, address) ? { status: "ready", key } : { status: "none" }); })
      .catch(() => { if (!stale) setState({ status: "none" }); });
    return () => { stale = true; };
  }, [address]);

  const refreshContext = useCallback(async () => {
    try {
      setContext(await fetchContext(PERPL_URLS.rest));
      setContextError("");
    } catch (e) {
      setContextError(describeError(e) || "Couldn't load markets.");
    }
  }, []);

  // Polling de precios solo con la pestaña activa.
  useEffect(() => {
    if (!active) return;
    void refreshContext();
    const timer = setInterval(() => { void refreshContext(); }, CONTEXT_POLL_MS);
    return () => clearInterval(timer);
  }, [active, refreshContext]);

  // Socket: vive mientras la pestaña está activa y hay key.
  const key = state.status === "ready" ? state.key : null;
  useEffect(() => {
    if (!active || !key) {
      setLive(null);
      return;
    }
    let keyRejected = false;
    const socket = new TradingSocket({
      url: PERPL_URLS.ws, chainId: PERPL_CHAIN_ID, apiKey: key.apiKey, privateKey: key.privateKey,
      onEvent: (e) => {
        if (e.type === "keyRejected") keyRejected = true;
        const next = toLive(socket.state, socket.status, keyRejected);
        setLive(next);
        if (next.account) setLastBalance(next.account.b);
      },
    });
    socketRef.current = socket;
    socket.connect();
    setLive(toLive(socket.state, socket.status, false));
    return () => {
      socket.close();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [active, key]);

  const setActive = useCallback((next: boolean) => {
    if (graceRef.current) { clearTimeout(graceRef.current); graceRef.current = null; }
    if (next) setActiveState(true);
    else graceRef.current = setTimeout(() => { graceRef.current = null; setActiveState(false); }, SOCKET_GRACE_MS);
  }, []);

  const enable = useCallback(async (amount: bigint) => {
    if (!address) return;
    setState({ status: "onboarding", step: 1 });
    try {
      const fresh = await readBalances(address);
      if (fresh.mon === 0n) throw new EnableError(1, new Error(NO_MON));
      if (amount > fresh.ausd) throw new EnableError(1, new Error("That is more than the AUSD in your wallet."));
      const wallet = await openWallet();
      const result = await runEnable({
        readAccountId: () => readAccountId(address),
        readAllowance: () => readAllowance(address),
        approve: async (a) => confirm(await approveExchange(wallet, a)),
        createAccount: async (a) => confirm(await createExchangeAccount(wallet, a)),
        isForwarding: async () => (forwardedRef.current || liveRef.current?.account?.fw === true ? true : undefined),
        allowForwarding: async () => { await confirm(await enableForwarding(wallet)); forwardedRef.current = true; },
        loadKey: async (id) => {
          const stored = await loadTradingKey();
          return stored && same(stored.address, address) && stored.accountId === id ? stored : undefined;
        },
        enrollKey: async (id) => {
          const pair = generateTradingKey();
          const apiKey = await enrollTradingKey(wallet, pair.publicKeyHex, pair.privateKey, PERPL_URLS.rest);
          const stored: TradingKey = { address, accountId: id, apiKey, privateKey: pair.privateKey };
          await saveTradingKey(stored);
          return stored;
        },
      }, amount, (step) => setState({ status: "onboarding", step }));
      setState({ status: "ready", key: result });
      void treasury.refresh();
    } catch (e) {
      const msg = describeTxError(e);
      if (msg === "") { setState({ status: "none" }); return; } // Face ID cancelado: lo hecho queda on-chain
      setState({ status: "onboarding", step: e instanceof EnableError ? e.step : 1, error: msg });
    }
  }, [address, openWallet, treasury]);

  const enableForwardingOnly = useCallback(async () => {
    const wallet = await openWallet();
    await confirm(await enableForwarding(wallet));
    forwardedRef.current = true;
  }, [openWallet]);

  const move = useCallback(async (kind: "add" | "withdraw", amount: bigint, onSent: (hash: Hex) => void): Promise<"success" | "reverted"> => {
    if (!address) throw new Error("No account.");
    const fresh = await readBalances(address);
    if (fresh.mon === 0n) throw new Error(NO_MON);
    if (kind === "add" && amount > fresh.ausd) throw new Error("That is more than the AUSD in your wallet.");
    const wallet = await openWallet();
    if (kind === "add" && (await readAllowance(address)) < amount) await confirm(await approveExchange(wallet, amount));
    let hash: Hex;
    try {
      hash = kind === "add" ? await depositCollateral(wallet, amount) : await withdrawCollateral(wallet, amount);
    } catch (e) {
      throw new Error(describeTxError(e) || "Couldn't send the transaction.");
    }
    onSent(hash);
    const status = await waitForReceipt(hash);
    void treasury.refresh();
    return status;
  }, [address, openWallet, treasury]);

  const addFunds = useCallback((amount: bigint, onSent: (hash: Hex) => void) => move("add", amount, onSent), [move]);
  const withdraw = useCallback((amount: bigint, onSent: (hash: Hex) => void) => move("withdraw", amount, onSent), [move]);

  const place = useCallback(async (run: (socket: TradingSocket) => Promise<OrderOutcome>): Promise<OrderOutcome> => {
    const socket = socketRef.current;
    if (!socket) return { kind: "failed", text: "Not connected to Perpl. Open the Trade tab and wait for Live." };
    try {
      return await run(socket);
    } catch (e) {
      return { kind: "failed", text: describeError(e) || "Perpl rejected the order." };
    }
  }, []);

  const open = useCallback((market: Market, side: Side, ausd: bigint, lv: number) => place(async (socket) => {
    if (!key) throw new Error("Enable trading first.");
    const size = sizeFromAusd(ausd, lv, market.mark, market.priceDecimals, market.sizeDecimals);
    if (size <= 0) throw new Error("That amount is below one unit of this market.");
    return socket.placeOrder(openIntent(market, Number(key.accountId), side, size, lv));
  }), [key, place]);

  const close = useCallback((market: Market, position: Position) => place(async (socket) => {
    if (!key) throw new Error("Enable trading first.");
    return socket.placeOrder(closeIntent(market, Number(key.accountId), position));
  }), [key, place]);

  const resetKey = useCallback(async () => {
    if (!address || !key) return;
    const wallet = await openWallet();
    await clearTradingKey();
    const pair = generateTradingKey();
    const apiKey = await enrollTradingKey(wallet, pair.publicKeyHex, pair.privateKey, PERPL_URLS.rest);
    const stored: TradingKey = { address, accountId: key.accountId, apiKey, privateKey: pair.privateKey };
    await saveTradingKey(stored);
    setState({ status: "ready", key: stored }); // el efecto del socket lo recrea con la key nueva
  }, [address, key, openWallet]);

  return { state, context, contextError, live, lastBalance, enable, enableForwardingOnly, addFunds, withdraw, open, close, resetKey, setActive, refreshContext };
}
```

- [ ] **Step 2: Cablear `src/ctx.ts` y `App.tsx`**

`src/ctx.ts`:

```ts
import type { Perpl } from "./hooks/usePerpl";
…
export type AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury; perpl: Perpl };
```

`App.tsx` (imports nuevos: `useEffect` de react, `usePerpl`, `type Screen` de `./src/store`):

```tsx
const PERPL_SCREENS: readonly Screen[] = ["perps", "perpsMarket", "perpsFunds"];
…
  const treasury = useTreasury(account ?? NONE, onWallet);
  const perpl = usePerpl(account ?? NONE, onWallet, treasury);
  const store = useAppStore({
    hasAccount: account !== null && account.status !== "none",
    ausd: treasury.balances ? ausdToNumber(treasury.balances.ausd) : 0,
    perpsMarkets: perpl.context?.markets ?? [],
  });
  const perpsActive = PERPL_SCREENS.includes(store.S.screen);
  const { setActive } = perpl;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);
  // (los hooks van todos antes del early return)
…
  const ctx: AppCtx = { ...store, account, treasury, perpl, onWallet, lock, signOut };
```

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: tsc limpio (si `ctx.perpl` falta en algún test o pantalla, corregir el tipo, no el hook); suite completa en verde (55 previos + los de Tasks 1–10).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/usePerpl.ts src/ctx.ts App.tsx
git commit -m "feat(mobile): usePerpl — estado, socket, polling de context, onboarding, fondos y órdenes"
```

---

### Task 12: `screens/perpsMarket.tsx` — Long/Short, monto, apalancamiento, review, confirm, resultado

**Files:**
- Create: `apps/mobile/src/screens/perpsMarket.tsx`

**Interfaces:**
- Consumes: `ctx.perpl` (`context`, `live`, `open`), `ctx.S.perpsMarketId`, `ctx.S.perpsSide`, `ctx.nav`, `ctx.back`; `orders.ts` (`sizeFromAusd`, `notionalAusd`, `takerFee`, `liquidationPrice`, `leveragesFor`, `formatPrice`, `formatSize`); `formatAusd`, `parseAusd`; primitives (`T`, `Touch`, `KV`, `Segmented`); `textStyle`, `C`.
- Produces: `export function PerpsMarketScreen(ctx: AppCtx)`; `export type OrderResult = { step: "sent" } | { step: "filled"; title: string; detail: string } | { step: "failed"; text: string } | { step: "unknown" }`; `export function OrderResultCard({ result, onBack, onEdit }: { result: OrderResult; onBack: () => void; onEdit?: () => void })` (la reutiliza el cierre en Task 14).

- [ ] **Step 1: Implementar `src/screens/perpsMarket.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { formatPrice, formatSize, leveragesFor, liquidationPrice, notionalAusd, type Side, sizeFromAusd, takerFee } from "../perpl/orders";
import { KV, Segmented, T, Touch } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";

export type OrderResult =
  | { step: "sent" }
  | { step: "filled"; title: string; detail: string }
  | { step: "failed"; text: string }
  | { step: "unknown" };

const TONES = {
  sent: { title: "Order accepted — waiting for the fill", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" },
  filled: { title: "Filled", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)" },
  failed: { title: "Order failed", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)" },
  unknown: { title: "No confirmation yet", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" },
} as const;

const primaryBtn = { paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

/** Estados Sent / Filled / Failed / Unknown, compartidos por apertura y cierre. */
export function OrderResultCard({ result, onBack, onEdit }: { result: OrderResult; onBack: () => void; onEdit?: () => void }) {
  const tone = TONES[result.step];
  return (
    <View style={{ gap: 13 }}>
      <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
        <T w={700} s={14} color={tone.fg}>{result.step === "filled" ? result.title : tone.title}</T>
        {result.step === "filled" ? <T w={400} s={12.5} lh={1.4} mono color={C.dim}>{result.detail}</T> : null}
        {result.step === "failed" ? <T w={400} s={12.5} lh={1.4} color={C.dim}>{result.text}</T> : null}
        {result.step === "unknown" ? <T w={400} s={12.5} lh={1.4} color={C.dim}>Check your positions — the order may still have gone through.</T> : null}
        {result.step === "sent" ? <ActivityIndicator color={C.warn} /> : null}
      </View>
      {result.step !== "sent" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {result.step === "failed" && onEdit ? (
            <Touch onPress={onEdit} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          ) : null}
          <Touch onPress={onBack} style={{ ...primaryBtn, flex: 1 }}><T w={700} s={14.5} color={C.onLime}>Back to Trade</T></Touch>
        </View>
      ) : null}
    </View>
  );
}

type Step = { step: "edit" } | { step: "review" } | { step: "result"; result: OrderResult };

export function PerpsMarketScreen({ S, set, perpl, nav }: AppCtx) {
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId);
  const side: Side = S.perpsSide ?? "long";
  const free = perpl.live?.account ? perpl.live.account.b - perpl.live.account.lb : 0n;
  const [amount, setAmount] = useState("");
  const [lv, setLv] = useState(1);
  const [st, setSt] = useState<Step>({ step: "edit" });

  if (!market) {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <T w={400} s={13} color={C.mute}>{perpl.contextError ? `Couldn't load markets. ${perpl.contextError}` : "Loading market…"}</T>
        <Touch onPress={() => nav("perps")} style={primaryBtn}><T w={700} s={14.5} color={C.onLime}>Back to Trade</T></Touch>
      </View>
    );
  }

  const leverages = leveragesFor(market);
  const lvUsed = leverages.includes(lv) ? lv : 1;
  const units = parseAusd(amount);
  const size = units === undefined ? 0 : sizeFromAusd(units, lvUsed, market.mark, market.priceDecimals, market.sizeDecimals);
  const notional = notionalAusd(size, market.mark, market.priceDecimals, market.sizeDecimals);
  const fee = takerFee(notional, market.takerFeeMicros);
  const liq = liquidationPrice(market.mark, lvUsed, side, market.maintenanceBps, market.maxLeverage);
  const error = amount === "" ? "" : units === undefined || units === 0n ? "Enter an amount above zero." : units > free ? `That is more than the ${formatAusd(free)} AUSD free.` : size <= 0 ? "That amount is below one unit of this market." : "";
  const ok = units !== undefined && units > 0n && units <= free && size > 0;
  const live = perpl.live?.status === "live";
  const sym = market.symbol;

  const confirm = async () => {
    setSt({ step: "result", result: { step: "sent" } });
    const outcome = await perpl.open(market, side, units ?? 0n, lvUsed);
    setSt({ step: "result", result:
      outcome.kind === "filled" ? { step: "filled", title: `Filled ${formatSize(outcome.order.fs, market.sizeDecimals)} ${sym} at ${formatPrice(outcome.order.fp, market.priceDecimals)}`, detail: `Fee ${formatAusd(outcome.order.f)} AUSD · ${side.toUpperCase()} ${lvUsed}x` }
      : outcome.kind === "open" ? { step: "filled", title: "Placed — waiting in the book", detail: `${formatSize(outcome.order.os, market.sizeDecimals)} ${sym}` }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  const summary = [
    { label: "Size", value: `≈ ${formatSize(size, market.sizeDecimals)} ${sym}`, fg: C.ink },
    { label: "Est. price", value: formatPrice(market.mark, market.priceDecimals), fg: C.ink },
    { label: "Fee", value: `≈ ${formatAusd(fee)} AUSD`, fg: C.dim },
    { label: "Liquidation est.", value: formatPrice(liq, market.priceDecimals), fg: lvUsed > 1 ? C.warn : C.dim },
  ];

  if (st.step === "result") {
    return (
      <View style={{ padding: 16 }}>
        <OrderResultCard result={st.result} onBack={() => nav("perps")} onEdit={() => setSt({ step: "edit" })} />
      </View>
    );
  }

  if (st.step === "review") {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: side === "long" ? C.lime : C.down, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>{side === "long" ? "Long" : "Short"} {sym} · {lvUsed}x · market order</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(units ?? 0n)}</T>
            <T w={500} s={14} mono color={C.mute}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          {summary.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
        </View>
        {lvUsed > 1 ? <T w={400} s={12} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => setSt({ step: "edit" })} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          <Touch onPress={() => { void confirm(); }} disabled={!live} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: live ? C.lime : C.tile, alignItems: "center" }}>
            <T w={700} s={13.5} color={live ? C.onLime : C.disabled}>{live ? `Confirm ${side}` : "Connecting…"}</T>
          </Touch>
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.mute}>Market order with up to {market.maxSlippageBps / 100}% slippage. Forwarded orders pay no gas.</T>
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      <Segmented options={(["long", "short"] as const).map((k) => ({
        label: k === "long" ? "Long" : "Short", bg: side === k ? (k === "long" ? C.lime : C.down) : "transparent", fg: side === k ? C.onLime : C.dim, strong: side === k, onPress: () => set({ perpsSide: k }),
      }))} />
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>Amount in AUSD</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.mute} keyboardType="decimal-pad" style={[textStyle(800, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
          <Touch onPress={() => setAmount(formatUnits(free, AUSD_DECIMALS))} style={chipBtn}><T w={600} s={12}>Max</T></Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{formatAusd(free)} AUSD free in trading</T>
      </View>
      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>LEVERAGE</T>
        <Segmented options={leverages.map((l) => ({ label: `${l}x`, bg: lvUsed === l ? C.ink : "transparent", fg: lvUsed === l ? C.onInk : C.dim, onPress: () => setLv(l) }))} />
        {leverages.length < 4 ? <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginTop: 6 }}>{sym} allows up to {market.maxLeverage}x.</T> : null}
      </View>
      <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
        {summary.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)}
      </View>
      {lvUsed > 1 ? <T w={400} s={12} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
      {error ? <T w={400} s={12} lh={1.4} color={C.warn}>{error}</T> : null}
      <Touch onPress={() => setSt({ step: "review" })} disabled={!ok} style={{ ...primaryBtn, backgroundColor: ok ? C.lime : C.tile }}>
        <T w={700} s={14.5} color={ok ? C.onLime : C.disabled}>Review</T>
      </Touch>
    </View>
  );
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: limpio. (La pantalla se registra en `Shell.tsx` en Task 14; hasta entonces no se renderiza.)

- [ ] **Step 3: Commit** (el coordinador, por nombre)

```bash
git add src/screens/perpsMarket.tsx
git commit -m "feat(mobile): pantalla de orden de mercado en Perpl (long/short, lv, review, resultado)"
```

---

### Task 13: `perpl/funds.ts` + `screens/perpsFunds.tsx` — Add funds / Withdraw to wallet

**Files:**
- Create: `apps/mobile/src/perpl/funds.ts` (validación pura)
- Create: `apps/mobile/src/screens/perpsFunds.tsx`
- Test: `apps/mobile/__tests__/perpl-funds.test.ts`

**Interfaces:**
- Consumes: `ctx.perpl` (`context.instance`, `live.account`, `lastBalance`, `addFunds`, `withdraw`), `ctx.treasury.balances`, `ctx.S.fundsMode`, `ctx.set`, `ctx.nav`; `formatAusd`, `parseAusd`, `EXPLORER_TX_URL`; `describeError`.
- Produces: `export type FundsMode = "add" | "withdraw"`; `export function validateFunds(mode: FundsMode, text: string, wallet: bigint, free: bigint, minDeposit: bigint, minWithdraw: bigint): { ok: true; amount: bigint } | { ok: false; error: string }`; `export function PerpsFundsScreen(ctx: AppCtx)`.

- [ ] **Step 1: Escribir el test de `validateFunds`** (`__tests__/perpl-funds.test.ts`)

```ts
import { validateFunds } from "../src/perpl/funds";

test("add: minimum deposit and wallet balance", () => {
  expect(validateFunds("add", "5", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Minimum deposit is 10.00 AUSD." });
  expect(validateFunds("add", "60", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "That is more than the 50.00 AUSD in your wallet." });
  expect(validateFunds("add", "10", 50_000_000n, 0n, 10_000_000n, 10_000n)).toEqual({ ok: true, amount: 10_000_000n });
});

test("withdraw: minimum and free balance only", () => {
  expect(validateFunds("withdraw", "0.001", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Minimum withdrawal is 0.01 AUSD." });
  expect(validateFunds("withdraw", "5.01", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "That is more than the 5.00 AUSD free in trading." });
  expect(validateFunds("withdraw", "5", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: true, amount: 5_000_000n });
  expect(validateFunds("withdraw", "", 0n, 5_000_000n, 10_000_000n, 10_000n)).toEqual({ ok: false, error: "Enter an amount above zero." });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx jest __tests__/perpl-funds.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `src/perpl/funds.ts`**

```ts
import { formatAusd, parseAusd } from "../config/chain";

export type FundsMode = "add" | "withdraw";
export type FundsCheck = { ok: true; amount: bigint } | { ok: false; error: string };

/** Validación previa a Review. No toca la red. */
export function validateFunds(mode: FundsMode, text: string, wallet: bigint, free: bigint, minDeposit: bigint, minWithdraw: bigint): FundsCheck {
  const units = parseAusd(text);
  if (units === undefined || units === 0n) return { ok: false, error: "Enter an amount above zero." };
  if (mode === "add") {
    if (units < minDeposit) return { ok: false, error: `Minimum deposit is ${formatAusd(minDeposit)} AUSD.` };
    if (units > wallet) return { ok: false, error: `That is more than the ${formatAusd(wallet)} AUSD in your wallet.` };
  } else {
    if (units < minWithdraw) return { ok: false, error: `Minimum withdrawal is ${formatAusd(minWithdraw)} AUSD.` };
    if (units > free) return { ok: false, error: `That is more than the ${formatAusd(free)} AUSD free in trading.` };
  }
  return { ok: true, amount: units };
}
```

- [ ] **Step 4: Implementar `src/screens/perpsFunds.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Hex } from "viem";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { type FundsMode, validateFunds } from "../perpl/funds";
import { KV, Segmented, StatGrid, T, Touch } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";

type Step = { step: "edit" } | { step: "review"; amount: bigint } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const primaryBtn = { paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

export function PerpsFundsScreen({ S, set, perpl, treasury, nav }: AppCtx) {
  const mode: FundsMode = S.fundsMode ?? "add";
  const wallet = treasury.balances?.ausd ?? 0n;
  const acc = perpl.live?.account;
  const free = acc ? acc.b - acc.lb : 0n;
  const minDeposit = perpl.context?.instance.minDeposit ?? 10_000_000n;
  const minWithdraw = perpl.context?.instance.minWithdraw ?? 10_000n;
  const [amount, setAmount] = useState("");
  const [st, setSt] = useState<Step>({ step: "edit" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const check = validateFunds(mode, amount, wallet, free, minDeposit, minWithdraw);
  const max = mode === "add" ? wallet : free;

  const confirm = async () => {
    if (st.step !== "review") return;
    setBusy(true);
    setError("");
    try {
      const run = mode === "add" ? perpl.addFunds : perpl.withdraw;
      const status = await run(st.amount, (hash) => setSt({ step: "sent", hash }));
      setSt((s) => s.step === "sent" ? { step: status === "success" ? "done" : "failed", hash: s.hash } : s);
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
      setSt((s) => s.step === "sent" ? { step: "unknown", hash: s.hash } : s);
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <StatGrid items={[
      { label: "Wallet", value: `${formatAusd(wallet)} AUSD`, fg: C.ink },
      { label: "Trading · free", value: acc ? `${formatAusd(free)} AUSD` : perpl.lastBalance !== null ? `${formatAusd(perpl.lastBalance)} · last seen` : "—", fg: C.ink },
    ]} />
  );

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const tone = st.step === "done" ? { title: mode === "add" ? "Funds added" : "Withdrawn to wallet", fg: C.lime, bd: "rgba(200,240,58,0.45)", bg: "rgba(200,240,58,0.07)" }
      : st.step === "failed" ? { title: "Transaction reverted", fg: C.down, bd: "rgba(242,119,122,0.5)", bg: "rgba(242,119,122,0.08)" }
      : st.step === "unknown" ? { title: "Sent · confirmation not received", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" }
      : { title: "Sent · waiting for confirmation", fg: C.warn, bd: "rgba(245,195,91,0.5)", bg: "rgba(245,195,91,0.1)" };
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {header}
        <View style={{ padding: 14, borderWidth: 1, borderColor: tone.bd, backgroundColor: tone.bg, borderRadius: 14, gap: 8 }}>
          <T w={700} s={14} color={tone.fg}>{tone.title}</T>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}><T w={400} s={11.5} lh={1.4} mono color={C.dim}>{st.hash}</T></Touch>
          {st.step === "unknown" && error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        </View>
        {st.step !== "sent" ? (
          <Touch onPress={() => nav("perps")} style={primaryBtn}><T w={700} s={14.5} color={C.onLime}>Back to Trade</T></Touch>
        ) : <ActivityIndicator color={C.lime} />}
      </View>
    );
  }

  if (st.step === "review") {
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {header}
        <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
          <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>{mode === "add" ? "Add to trading" : "Withdraw to wallet"}</T>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <T w={800} s={30} lh={1} ls={-0.03}>{formatAusd(st.amount)}</T>
            <T w={500} s={14} mono color={C.mute}>AUSD</T>
          </View>
        </View>
        <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 9 }}>
          <KV label="From" value={mode === "add" ? "Wallet" : "Trading account"} />
          <KV label="To" value={mode === "add" ? "Trading account" : "Wallet"} />
          <KV label="Network" value="Monad · gas in MON" fg={C.dim} />
        </View>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Touch onPress={() => { setError(""); setSt({ step: "edit" }); }} disabled={busy} style={secondaryBtn}><T w={700} s={13.5}>Edit</T></Touch>
          <Touch onPress={() => { void confirm(); }} disabled={busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: busy ? 0.6 : 1 }}>
            {busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>{mode === "add" ? "Confirm deposit" : "Confirm withdrawal"}</T>}
          </Touch>
        </View>
        {mode === "add" ? <T w={400} s={11.5} lh={1.45} color={C.mute}>If the exchange allowance is too low, Pickler approves it first (one extra transaction).</T> : null}
      </View>
    );
  }

  return (
    <View style={{ padding: 16, gap: 13 }}>
      {header}
      <Segmented options={(["add", "withdraw"] as const).map((k) => ({
        label: k === "add" ? "Add funds" : "Withdraw", bg: mode === k ? C.ink : "transparent", fg: mode === k ? C.onInk : C.dim, onPress: () => { set({ fundsMode: k }); setAmount(""); },
      }))} />
      <View style={{ padding: 16, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.lime, borderRadius: 14, backgroundColor: C.surf2 }}>
        <T w={400} s={11.5} color={C.mute} style={{ marginBottom: 8 }}>{mode === "add" ? "Amount to add" : "Amount to withdraw"}</T>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
          <TextInput value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.mute} keyboardType="decimal-pad" style={[textStyle(800, 30, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
          <T w={500} s={14} mono color={C.mute}>AUSD</T>
          <Touch onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} style={chipBtn}><T w={600} s={12}>Max</T></Touch>
        </View>
        <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 10 }}>{mode === "add" ? `Minimum ${formatAusd(minDeposit)} AUSD` : `Minimum ${formatAusd(minWithdraw)} AUSD · only free balance`}</T>
      </View>
      {!check.ok && amount !== "" ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Touch onPress={() => { if (check.ok) setSt({ step: "review", amount: check.amount }); }} disabled={!check.ok} style={{ ...primaryBtn, backgroundColor: check.ok ? C.lime : C.tile }}>
        <T w={700} s={14.5} color={check.ok ? C.onLime : C.disabled}>Review</T>
      </Touch>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Gas is paid in MON from this wallet. Locked collateral can't be withdrawn until the position closes.</T>
    </View>
  );
}
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npx jest __tests__/perpl-funds.test.ts`
Expected: limpio; 2 tests en verde.

- [ ] **Step 6: Commit** (el coordinador, por nombre)

```bash
git add src/perpl/funds.ts src/screens/perpsFunds.tsx __tests__/perpl-funds.test.ts
git commit -m "feat(mobile): pantalla de fondos de trading (add funds / withdraw) en Perpl"
```

---

### Task 14: `screens/perps.tsx` (pestaña Trade), `Shell.tsx`, línea "in trading" en Wallet y README

**Files:**
- Create: `apps/mobile/src/screens/perps.tsx`
- Modify: `apps/mobile/src/Shell.tsx:15-30` (`SCREENS`, `BOTTOM_TABS`)
- Modify: `apps/mobile/src/screens/own.tsx:163-180` (`WalletScreen`, tarjeta "Available to spend")
- Modify: `apps/mobile/README.md`

**Interfaces:**
- Consumes: `ctx.perpl` completo; `OrderResultCard`, `OrderResult` (Task 12); `ENABLE_STEPS` (Task 9); `orders.ts` (`change24h`, `formatPrice`, `formatSize`, `positionPnl`, `liquidationPrice`); `PERPL_WEB`.
- Produces: `export function PerpsScreen(ctx: AppCtx)`.

- [ ] **Step 1: Implementar `src/screens/perps.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, MON_FAUCET_URL, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { PERPL_WEB } from "../perpl/config";
import type { Market } from "../perpl/context";
import { ENABLE_STEPS } from "../perpl/enable";
import { change24h, formatPrice, formatSize, liquidationPrice, positionPnl } from "../perpl/orders";
import type { Position } from "../perpl/ws";
import { EmptyPanel, T, Tag, Touch, TouchCard } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { OrderResultCard, type OrderResult } from "./perpsMarket";

const primaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" } as const;
const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;
const warnBox = { paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12, gap: 8 } as const;

const CONNECTION = {
  live: { label: "Live", fg: C.lime },
  connecting: { label: "Connecting…", fg: C.warn },
  reconnecting: { label: "Reconnecting…", fg: C.warn },
  closed: { label: "Offline", fg: C.mute },
} as const;

function MarketsList({ perpl, nav, readOnly }: Pick<AppCtx, "perpl" | "nav"> & { readOnly: boolean }) {
  return (
    <View>
      <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>MARKETS</T>
      {perpl.contextError ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>Couldn't load markets. {perpl.contextError}</T>
          <Touch onPress={() => { void perpl.refreshContext(); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Retry</T></Touch>
        </View>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <T w={400} s={12} lh={1.4} color={C.mute}>Loading markets…</T> : null}
      <View style={{ gap: 6 }}>
        {(perpl.context?.markets ?? []).map((m) => {
          const chg = change24h(m.mark, m.prev);
          return (
            <TouchCard key={m.id} onPress={readOnly ? undefined : () => nav("perpsMarket", { perpsMarketId: m.id, perpsSide: "long" })} style={{ opacity: readOnly ? 0.7 : 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T w={700} s={14} lh={1.2}>{m.symbol}</T>
                  <T w={400} s={11.5} lh={1.2} color={C.mute} style={{ marginTop: 3 }}>{m.name} · up to {m.maxLeverage}x</T>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <T w={500} s={13.5} lh={1.2} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
                  <T w={500} s={11.5} lh={1.2} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 3 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(2)}%</T>
                </View>
              </View>
            </TouchCard>
          );
        })}
      </View>
    </View>
  );
}

function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const liq = liquidationPrice(p.ep, lv, p.sd === 1 ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  const long = p.sd === 1;
  return (
    <View style={{ padding: 13, paddingHorizontal: 14, borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Tag label={long ? "LONG" : "SHORT"} fg={long ? C.lime : C.down} bd={long ? "rgba(200,240,58,0.45)" : "rgba(242,119,122,0.5)"} />
        <T w={600} s={13} style={{ flex: 1 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}x</T>
        <T w={600} s={13.5} mono color={pnl >= 0n ? C.up : C.down}>{pnl >= 0n ? "+" : "−"}{formatAusd(pnl < 0n ? -pnl : pnl)} AUSD</T>
      </View>
      <T w={400} s={11.5} lh={1.3} mono color={C.mute}>{formatPrice(p.ep, market.priceDecimals)} → {formatPrice(market.mark, market.priceDecimals)} · Liq. est. {formatPrice(liq, market.priceDecimals)}</T>
      <Touch onPress={onClose} style={{ ...secondaryBtn, paddingVertical: 10 }}><T w={700} s={13}>Close</T></Touch>
    </View>
  );
}

type Closing = { p: Position; market: Market; result: OrderResult | null };

export function PerpsScreen(ctx: AppCtx) {
  const { perpl, treasury, nav } = ctx;
  const minOpen = perpl.context?.instance.minAccountOpen ?? 100_000_000n;
  const walletAusd = treasury.balances?.ausd ?? 0n;
  const noMon = treasury.balances?.mon === 0n;
  const [amount, setAmount] = useState<string | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const text = amount ?? formatUnits(minOpen, AUSD_DECIMALS);
  const units = parseAusd(text);
  const enableError = units === undefined || units === 0n ? "Enter an amount." : units < minOpen ? `Minimum is ${formatAusd(minOpen)} AUSD.` : units > walletAusd ? `That is more than the ${formatAusd(walletAusd)} AUSD in your wallet.` : "";

  if (perpl.state.status === "loading") {
    return <View style={{ padding: 16 }}><ActivityIndicator color={C.lime} /></View>;
  }

  if (perpl.state.status === "none" || perpl.state.status === "onboarding") {
    const ob = perpl.state.status === "onboarding" ? perpl.state : null;
    return (
      <View style={{ padding: 16, gap: 13 }}>
        <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf, gap: 10 }}>
          <T w={800} s={17} lh={1.15} ls={-0.03}>Enable trading</T>
          <T w={400} s={12.5} lh={1.45} color={C.dim}>Moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps.</T>
          {ob === null ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingTop: 4 }}>
                <TextInput value={text} onChangeText={setAmount} keyboardType="decimal-pad" style={[textStyle(800, 26, { lh: 1, ls: -0.03, color: C.ink }), { flex: 1, paddingVertical: 0 }]} />
                <T w={500} s={14} mono color={C.mute}>AUSD</T>
              </View>
              <T w={400} s={12} lh={1.4} color={C.dim}>{formatAusd(walletAusd)} AUSD in wallet · minimum {formatAusd(minOpen)}</T>
              {enableError ? <T w={400} s={12} lh={1.4} color={C.warn}>{enableError}</T> : null}
              {noMon ? (
                <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch>
              ) : null}
              <Touch onPress={() => { if (units !== undefined && !enableError) void perpl.enable(units); }} disabled={!!enableError || noMon} style={{ ...primaryBtn, backgroundColor: enableError || noMon ? C.tile : C.lime }}>
                <T w={700} s={14} color={enableError || noMon ? C.disabled : C.onLime}>Enable trading</T>
              </Touch>
            </>
          ) : (
            <View style={{ gap: 8, paddingTop: 4 }}>
              {ENABLE_STEPS.map((label, i) => {
                const n = i + 1;
                const state = n < ob.step ? "done" : n === ob.step ? (ob.error ? "error" : "busy") : "todo";
                return (
                  <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    {state === "busy" ? <ActivityIndicator size="small" color={C.lime} /> : <T w={700} s={13} color={state === "done" ? C.up : state === "error" ? C.down : C.mute}>{state === "done" ? "✓" : state === "error" ? "×" : "·"}</T>}
                    <T w={state === "todo" ? 400 : 600} s={13} color={state === "todo" ? C.mute : C.ink}>{label}</T>
                  </View>
                );
              })}
              {ob.error ? <T w={400} s={12} lh={1.4} color={C.down}>{ob.error}</T> : null}
              {ob.error ? (
                <Touch onPress={() => { if (units !== undefined) void perpl.enable(units); }} style={{ ...secondaryBtn, marginTop: 4 }}><T w={700} s={13.5}>Retry</T></Touch>
              ) : null}
            </View>
          )}
        </View>
        <MarketsList perpl={perpl} nav={nav} readOnly />
      </View>
    );
  }

  const live = perpl.live;
  const acc = live?.account ?? null;
  const b = acc?.b ?? perpl.lastBalance ?? 0n;
  const locked = acc?.lb ?? 0n;
  const conn = CONNECTION[live?.status ?? "closed"];
  const markets = perpl.context?.markets ?? [];
  const positions = live?.positions ?? [];

  const doClose = async (c: Closing) => {
    setClosing({ ...c, result: { step: "sent" } });
    const outcome = await perpl.close(c.market, c.p);
    const pd = c.market.priceDecimals, sd = c.market.sizeDecimals;
    setClosing({ ...c, result:
      outcome.kind === "filled" ? { step: "filled", title: `Closed ${formatSize(outcome.order.fs, sd)} ${c.market.symbol} at ${formatPrice(outcome.order.fp, pd)}`, detail: `Fee ${formatAusd(outcome.order.f)} AUSD · realised PnL shows in the trading balance` }
      : outcome.kind === "open" ? { step: "filled", title: "Close order placed", detail: "Waiting in the book" }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  if (closing) {
    const pnl = positionPnl(closing.p, closing.market.mark, closing.market.priceDecimals, closing.market.sizeDecimals);
    return (
      <View style={{ padding: 16, gap: 13 }}>
        {closing.result ? (
          <OrderResultCard result={closing.result} onBack={() => setClosing(null)} />
        ) : (
          <View style={{ padding: 14, borderWidth: 1, borderColor: C.hair2, borderRadius: 14, backgroundColor: C.surf2, gap: 10 }}>
            <T w={700} s={14}>Close {formatSize(closing.p.s, closing.market.sizeDecimals)} {closing.market.symbol} {closing.p.sd === 1 ? "LONG" : "SHORT"} at market</T>
            <T w={400} s={12.5} lh={1.4} mono color={pnl >= 0n ? C.up : C.down}>Est. PnL {pnl >= 0n ? "+" : "−"}{formatAusd(pnl < 0n ? -pnl : pnl)} AUSD</T>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Touch onPress={() => setClosing(null)} style={secondaryBtn}><T w={700} s={13.5}>Keep it</T></Touch>
              <Touch onPress={() => { void doClose(closing); }} disabled={live?.status !== "live"} style={{ ...primaryBtn, backgroundColor: live?.status === "live" ? C.lime : C.tile }}>
                <T w={700} s={13.5} color={live?.status === "live" ? C.onLime : C.disabled}>Close position</T>
              </Touch>
            </View>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <T w={400} s={11.5} color={C.mute}>Trading balance</T>
          <Tag label={conn.label} fg={conn.fg} bd={conn.fg} dot />
        </View>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{formatAusd(b)} AUSD</T>
        <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 8 }}>{formatAusd(locked)} locked in positions · {formatAusd(b - locked)} free{acc ? "" : " · last seen"}</T>
      </View>

      {live?.keyRejected ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>Trading key rejected. Perpl isn't available in some regions (see testnet.perpl.xyz).</T>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Touch onPress={() => { void perpl.resetKey(); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Reset trading key</T></Touch>
            <Touch onPress={() => { void Linking.openURL(PERPL_WEB); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Open Perpl</T></Touch>
          </View>
        </View>
      ) : null}
      {acc && !acc.fw ? (
        <View style={warnBox}>
          <T w={400} s={12} lh={1.4} color={C.warn}>One-click trading is off. Orders will be rejected until it's enabled.</T>
          <Touch onPress={() => { void perpl.enableForwardingOnly(); }} style={{ alignSelf: "flex-start", ...chipBtn }}><T w={600} s={12}>Enable</T></Touch>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("perpsFunds", { fundsMode: "add" })} style={primaryBtn}><T w={700} s={13.5} color={C.onLime}>Add funds</T></Touch>
        <Touch onPress={() => nav("perpsFunds", { fundsMode: "withdraw" })} style={secondaryBtn}><T w={700} s={13.5}>Withdraw to wallet</T></Touch>
      </View>

      <MarketsList perpl={perpl} nav={nav} readOnly={false} />

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>POSITIONS</T>
        {positions.length === 0 ? (
          <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market above.</T></EmptyPanel>
        ) : (
          <View style={{ gap: 8 }}>
            {positions.map((p) => {
              const market = markets.find((m) => m.id === p.mkt);
              return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
            })}
          </View>
        )}
      </View>
    </View>
  );
}
```

- [ ] **Step 2: Registrar las pantallas y la pestaña en `src/Shell.tsx`**

```tsx
import { PerpsScreen } from "./screens/perps";
import { PerpsFundsScreen } from "./screens/perpsFunds";
import { PerpsMarketScreen } from "./screens/perpsMarket";
…
const SCREENS: Record<Screen, (ctx: AppCtx) => ReactElement> = {
  market: MarketScreen, search: SearchScreen, agent: AgentScreen,
  trade: TradeScreen, signin: SigninScreen,
  activity: ActivityScreen, post: PostScreen, ask: AskScreen,
  portfolio: PortfolioScreen, position: PositionScreen, wallet: WalletScreen,
  deposit: DepositScreen, withdraw: WithdrawScreen,
  perps: PerpsScreen, perpsMarket: PerpsMarketScreen, perpsFunds: PerpsFundsScreen,
};

type TabIcon = "storefront" | "trending-up" | "pulse" | "pie-chart" | "wallet";
const BOTTOM_TABS: readonly [Screen, string, TabIcon][] = [
  ["market", "Market", "storefront"],
  ["perps", "Trade", "trending-up"],
  ["activity", "Activity", "pulse"],
  ["portfolio", "Portfolio", "pie-chart"],
  ["wallet", "Wallet", "wallet"],
];
```

- [ ] **Step 3: Línea "in trading" en `WalletScreen` (`src/screens/own.tsx`)**

Añadir `perpl` a la desestructuración de `WalletScreen` y, dentro de la tarjeta "Available to spend", debajo de la línea `{pending}`:

```tsx
        {perpl.state.status === "ready" ? (
          <Touch onPress={() => nav("perps")}>
            <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 4 }}>
              {formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)} AUSD in trading{perpl.live?.account ? "" : perpl.lastBalance !== null ? " · last seen" : ""} · Trade tab
            </T>
          </Touch>
        ) : null}
```

Nada más cambia en Wallet.

- [ ] **Step 4: README — sección nueva**

Añadir antes de "## Subir a TestFlight":

```markdown
## Perpl (pestaña Trade)

Trading manual de perps en Perpl testnet (`https://testnet.perpl.xyz`). Sin backend: las tres tx de
onboarding (`approve`, `createAccount ≥ 100 AUSD`, `allowOrderForwarding`) y la firma EIP-712 de la
API key las hace la wallet de Mera; las órdenes van por WebSocket firmadas con una llave Ed25519 que
vive en SecureStore (`pickler.perpl.v1`, sin Face ID: solo puede operar, nunca retirar). Sign out la
borra; "Reset trading key" enrola otra (máx. 16 por cuenta; revocar en `testnet.perpl.xyz/apikeys`).

- Colateral: el mismo AUSD de la wallet. Mínimos (100 / 10 / 0.01) se leen de `pub/context`.
- Apalancamiento: 1x–5x, capado por mercado (`initial_margin / 100`; MON permite 3x).
- URLs con override para mainnet: `PICKLER_PERPL_REST` / `PICKLER_PERPL_WS` en `app.config.ts`
  (`extra` solo se refresca con `expo run:ios`).
- Perpl geobloquea US, GB, UA, RU, BY, CU, IR, KP, SY: el sign-in del WS falla con `3401`.
- Trampas medidas: `docs/investigacion/perpl.md` (`rq = lfr + 1`, `lb = head + ttl`, nonce vivo).
```

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit && npm test`
Expected: tsc limpio; suite completa en verde (contar y anotar el total en el commit).

- [ ] **Step 6: Commit**

```bash
git add src/screens/perps.tsx src/Shell.tsx src/screens/own.tsx README.md
git commit -m "feat(mobile): pestaña Trade — enable trading, saldo, mercados, posiciones y cierre en Perpl"
```

---

### Task 15: Revisión final de rama, prueba manual en el simulador y handoff

**Files:**
- Create: `docs/08-handoff-perpl.md`
- Capturas en el scratchpad de la sesión (`shots/`), no en el repo.

- [ ] **Step 1: Revisión independiente de la rama completa** (subagente revisor, con el spec como autoridad): diff `main..feat/mobile-perpl`, lógica, auth (key sin gate, scope 3), datos (bigint/number), contratos con Perpl. Corregir *Important* en una ola y re-revisar.

- [ ] **Step 2: Fondear la cuenta del simulador** desde la KAT con un script de usar-y-tirar (`src/hd/hd.ts` + viem, PRF `fill(7)`): ≥ 120 AUSD y ≥ 0.1 MON a `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1`. Verificar saldos por RPC antes de abrir la app.

- [ ] **Step 3: Build y prueba manual** en iPhone 17 Pro (`2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Face ID inscrito vía `notifyutil`, puerto 8090, taps con `idb`):
  `npx expo run:ios --device 2B2A0BAD-… --port 8090` → Trade → **Enable trading** 100 AUSD (4 pasos, Face ID) → chip Live → MON → Long 1x 10 AUSD → Review → Confirm → *Filled* (capturar `fp`, fee) → posición con PnL → **Close** → *Closed* → **Add funds** 10 → Confirmed → **Withdraw** 5 → Confirmed → Wallet muestra "in trading". Capturas de cada estado y hashes (createAccount, forwarding, deposit, withdraw; `txid` de los fills desde el frame `mt: 24`).

- [ ] **Step 4: Handoff** `docs/08-handoff-perpl.md` con el formato de `docs/07-handoff-wallet.md`: qué quedó hecho y verificado (tabla con evidencia), rulings, lo aprendido, pendientes (minors diferidos), siguiente punto de decisión (merge lo decide Jesús). Commit: `docs: handoff de trading manual en Perpl`.

- [ ] **Step 5: PARAR.** No hacer merge ni push.

---

## Self-review del plan (2026-09-16)

- **Cobertura del spec**: §1 decisiones → Tasks 1, 3 (lv capado: ruling 1), 4 (enroll sin Origin, scope 3), 6 (SecureStore sin gate), 7–8 (rq/lb/ping/backoff/3401×2), 11 (socket solo con la pestaña activa, gracia 2 s). §2 unidades → Tasks 1–11 (una por módulo). §3 pantallas → 12 (3.3), 13 (3.5), 14 (3.1, 3.2, 3.4, 3.6). §4 estado → 11 (carga en paralelo, cambio de cuenta, sign out) y 14. §5 errores → context (14 Retry), socket (8), 3401×2 (8 + 14 Reset), mt 3 (8), sr 32 (8), sr 34 (3 copy + 14 Enable), unknown 30 s (8), onboarding paso N (9 + 14 Retry; cancelar Face ID → none en 11), tx descartada (5 priority fee + 11 copy "Network refused…"), sin MON (11, 14), geo (14 copy). §6 pruebas → cada task; store en 10.
- **No decidido por el spec y resuelto aquí**: sn-gap del heartbeat **no** se implementa (no está en el spec; riesgo de reconexiones espurias con órdenes en vuelo). `OrderOutcome.failed.order` opcional (fallos del gateway no traen orden).
- **Placeholders**: ninguno; todo paso de código lleva el código.
- **Consistencia de tipos**: `Market.maxLeverage` (2) ← `leveragesFor`/`liquidationPrice` (3) ← pantallas (12, 14). `OrderIntent`/`orderFrame` (3) ← `TradingSocket.placeOrder` (8) ← `usePerpl.open/close` (11). `TradingKey` (6) ← `EnableDeps.loadKey/enrollKey` (9) ← `usePerpl` (11). `Live` (11) ← pantallas. `FundsMode` (13) ← `StoreState.fundsMode` (10) mismo literal. `OrderResultCard`/`OrderResult` (12) ← 14.
