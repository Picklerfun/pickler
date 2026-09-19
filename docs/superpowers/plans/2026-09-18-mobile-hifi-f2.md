# Rediseño hi-fi — F2: Markets, Market y Funds re-maquetados + fixes del build 5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Las tres pantallas de Perpl (Markets, Market con pills Ask · Trade · Agents, Trading funds) quedan con el look del hi-fi sobre la lógica real; entran los tres fixes del build 5 (desfase de reloj vía header `Date`, fees a 4 decimales, *Reconnect trading* con `existingAccountId`) y los minors del audit del pulido; se cierran los pendientes de la revisión final de F1; todo se verifica en el simulador con la cuenta #620 y termina en el build 0.1.0 (5) de TestFlight registrado con `pickler-dev-new`.

**Architecture:** Primero se amplía la capa pura (`config/chain.ts`, `perpl/context.ts`, `perpl/clock.ts`, `perpl/enable.ts`, `perpl/orders.ts`, `store.ts`) con tests, después el hook `usePerpl` expone `clockSkewMs` y `existingAccountId`, y al final las tres pantallas se re-escriben con las primitivas de F1 (`Card`, `Tag`, `Chip`, `Btn`, `Segmented`, `PillTabs`, `KV`, `StatusCard`, `Warn`) consumiendo esos campos. La lógica de cuenta, tesorería, socket y órdenes (`hooks/useTreasury`, `wallet/`, `perpl/ws.ts`, `perpl/onboarding.ts`) no cambia.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript 6 / Jest 29 (`jest-expo`). Nueva dependencia: `expo-system-ui` (módulo nativo: exige `prebuild --clean`). Maestro para los flujos del simulador.

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` (decisiones D13–D15, D19–D22; D2, D5, D12 y D17 como contexto). Requisitos adicionales: sección "Pendientes" y "Correcciones tras la revisión final" de `docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md`, y "Pendientes" de `docs/superpowers/audits/2026-09-18-mobile-polish-f1-rulings.md`. El plan argumenta desde ahí; léelos antes de empezar.

## Global Constraints

- Worktree `.claude/worktrees/mobile-hifi-f2`, rama `feat/mobile-hifi-f2` (base `main` = `5289aa8`, merge de F1). Todo se corre desde `apps/mobile` dentro del worktree; `npm install` y `npx expo prebuild --platform ios --clean` ya se corrieron ahí (exit 0). Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `fix(mobile): …` / `chore(mobile): …` / `docs(mobile-hifi): …` con trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Sin push, sin merge a `main`, sin subida a TestFlight y sin tocar `buildNumber`** hasta que Jesús lo autorice en esa sesión (Task 10 tiene el checkpoint). Delegar no autoriza nada de eso.
- `npx tsc --noEmit` y `npm test` deben quedar en verde **al cierre de cada task** (a diferencia de F1, aquí no hay reescritura de cimientos que lo justifique). Base al arrancar: 23 suites, 169/169.
- Simulador **siempre por UDID** `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0` (`expo run:ios --device`, `simctl io … screenshot`, `maestro --udid`); nunca `booted` (hay dos simuladores arrancados). Maestro: envolver cada flujo en `timeout 180`, `pkill -f maestro` si se cuelga; `hideKeyboard` no funciona (tocar fuera); tras `launchApp` esperar antes del primer `tapOn` (carrera del boot, ruling 6 de F1).
- Cuentas: la wallet del simulador `0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1` (29.00 AUSD · 0.0718 MON al cierre de F1) **no tiene key de Perpl** y es dueña de la cuenta Perpl **#620** (~104.87 AUSD, último valor conocido). *Reconnect trading* se prueba ahí. **Re-medir saldos por RPC antes de afirmar cualquier número** (receta en Task 9). No pedir faucet, no retirar a direcciones externas; la única posición que se abre es pequeña (≤ 5 AUSD de margen, 1x) y se cierra en la misma sesión.
- Copy en inglés, tal cual el spec (D13, D14, D19, D21). Nombres de primitivas y tokens como `ui/primitives.tsx` y `ui/theme.ts` de F1 (`Tag` = línea mono; `Chip` = píldora; `pill(on)` = lima al activo).
- Cifra `display` dentro de un `TextInput`: **siempre** `lh: 1.3` y `paddingVertical: 4` (lección 2 del audit de F1: con `lh: 1` / `paddingVertical: 0` Chakra Petch se recorta por arriba).
- `accessibilityLabel` en todo lo que Maestro tenga que tocar: tabs (`tab-*`, ya existe), pills de Market (`pill-*`), filas de mercado (`market-<SYMBOL>`), chips de apalancamiento (`lv-<n>`), botones primarios (nombres fijados en cada task). Maestro no ve el texto dentro de `Touch`/`TouchCard`.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | La primitiva `Screen` de `ui/primitives.tsx` pasa a llamarse **`Page`** (misma firma). El tipo `Screen` de `store.ts` (D5) no cambia. | Pendiente de la revisión final de F1: dos exports llamados `Screen` (tipo del store y primitiva) se sombreaban en cualquier pantalla que importara ambos. El tipo aparece en el spec y en ocho archivos; la primitiva sólo en `wallet.tsx` y `signin.tsx`. D12 pedía nombres del diseño para un diff legible contra `ui.js`; se acepta esta única divergencia y se anota en el spec (Task 9). |
| P2 | `isComingSoonTab(screen): screen is ComingSoonTab` vive en `store.ts` y reemplaza tanto la aserción `(COMING_SOON as readonly Screen[]).includes(…)` de `useAppStore` como el `isTab` local de `comingSoon.tsx`. | Pendiente de la revisión final: una aserción de tipo esconde el chequeo; un type guard exportado lo hace explícito y reutilizable. |
| P3 | `PillTabs` etiqueta cada pill como `pill-<key>` (hoy `tab-<key>`). | Pendiente de la revisión final: `tab-markets` ya es la tab bar; el pill Trade de Market colisionaría con un futuro `tab-trade`. |
| P4 | `Perpl.clockSkewMs` se mide en `refreshContext` con el `Date.now()` inmediatamente posterior al `await fetchContext`, y un override de desarrollo `setClockSkewOverride(ms \| null)` (sólo lo usa `DevControls` bajo `__DEV__`) permite forzar el `Warn` en el simulador. | El simulador comparte el reloj del Mac; no hay forma de desfasarlo sin tocar el reloj del host. El spec §3 pide "skew forzado (reloj del simulador ±2 min)"; el override cumple esa verificación sin cambiar el reloj de nadie. |
| P5 | `runEnable` con `amount === 0n` y `readAccountId() === 0n` falla en el paso 1 con `"Enter an amount."` sin llamar `createAccount`. | Riesgo del spec §4 ("`enable(0n)` con `existingAccountId` desfasado"): sin este guard `createAccount(0n)` mandaría una tx inútil. |
| P6 | `formatPnl(raw)` (nueva, en `perpl/orders.ts`) devuelve `"+0.00"` cuando `\|raw\| < 10_000n` (un centavo mostrado: `formatAusd` trunca, así que todo lo menor a 0.01 imprime "0.00") y `±X.XX` en el resto; la usan la fila de posición, la línea de PnL no realizado y la confirmación de cierre. | D22: cierra el "−0.00 unrealised PnL" del audit del pulido con una sola función testeada. |
| P7 | Al tocar una fila de Markets se navega con `{ perpsMarketId, perpsSide: "long", marketTab: "trade" }`. | D14 fija `trade` como pill por defecto; sin el patch, volver a un mercado tras haber mirado Ask lo abriría en Ask. |
| P8 | El botón "Review …" del ticket es `Btn` `outline` con `arrow` (como `Btn label={M.perpCta} arrow` del diseño) y el de confirmación es `lime`. | D14 lo describe así; el énfasis lima queda para la acción que mueve dinero. |

## Mapa de archivos

| Archivo | Task | Cambio |
|---|---|---|
| `apps/mobile/package.json`, `ios/` (regenerado) | 0 | `expo-system-ui` |
| `apps/mobile/src/config/chain.ts` + `__tests__/chain.test.ts` | 1 | `formatAusd(raw, decimals = 2)` |
| `apps/mobile/src/perpl/orders.ts` + `__tests__/perpl-orders.test.ts` | 1 | `formatPnl`; `any` → `matched` |
| `apps/mobile/src/perpl/context.ts` + `__tests__/perpl-context.test.ts` | 2 | `Context.serverTime`, `parseServerTime` |
| `apps/mobile/src/perpl/clock.ts` (nuevo) + `__tests__/perpl-clock.test.ts` (nuevo) | 2 | `CLOCK_SKEW_MAX_MS`, `clockSkewMs`, `describeClockSkew`, `KEY_REJECTED_COPY` |
| `apps/mobile/src/perpl/enable.ts` + `__tests__/perpl-enable.test.ts` | 3 | guard `amount 0n` sin cuenta |
| `apps/mobile/src/hooks/usePerpl.ts` | 3 | `clockSkewMs`, `existingAccountId`, `setClockSkewOverride` |
| `apps/mobile/src/store.ts` + `__tests__/store.test.ts` | 4 | `isComingSoonTab` |
| `apps/mobile/src/ui/primitives.tsx` | 4 | `Screen` → `Page`; `PillTabs` `pill-*` |
| `apps/mobile/src/screens/comingSoon.tsx`, `wallet.tsx`, `signin.tsx` | 4 | consumen P1/P2 |
| `apps/mobile/src/screens/market.tsx` | 5 | ticket re-maquetado (D14, D20) |
| `apps/mobile/src/screens/markets.tsx` | 6 | raíz re-maquetada (D13, D19, D21, D22) |
| `apps/mobile/src/screens/perpsFunds.tsx` | 7 | Funds re-vestido (D15) |
| `apps/mobile/src/DevControls.tsx` | 7 | chip "Clock +2 min" |
| `apps/mobile/README.md`, `docs/overview/2026-09-18-mobile-hifi.html`, `docs/overview/data/manifest.js`, spec, audit F2 | 9 | docs de cierre |
| `apps/mobile/app.config.ts` (`buildNumber` "5"), `docs/overview/dev/<fecha>-testflight-build5.html`, manifest | 10 | build 5 (con autorización) |

---

### Task 0: `expo-system-ui` y rebuild nativo

**Files:**
- Modify: `apps/mobile/package.json`
- Regenerate: `apps/mobile/ios/` (gitignored)

**Interfaces:**
- Consumes: `app.config.ts` ya declara `backgroundColor: "#05061A"` y `ios.backgroundColor: "#05061A"` (D10, F1).
- Produces: el aviso `» ios: ios.backgroundColor: Install expo-system-ui to enable this feature` desaparece del prebuild; nada más cambia de API.

- [ ] **Step 1: Confirmar el estado de partida**

Run (desde `apps/mobile` del worktree):
```bash
git status --short && git log --oneline -1 && npx tsc --noEmit && npm test 2>&1 | tail -4
```
Expected: árbol limpio, HEAD `5289aa8`, `tsc` sin salida (exit 0), `Tests: 169 passed, 169 total`, `Test Suites: 23 passed`.

- [ ] **Step 2: Instalar `expo-system-ui` con pin exacto**

Run:
```bash
npx expo install expo-system-ui
node -e "const p=require('./package.json');console.log(p.dependencies['expo-system-ui'])"
```
Expected: imprime una versión `57.x.y` posiblemente con prefijo `~`. Si trae `~` o `^`, quítalo para dejar el pin exacto como el resto del `package.json`:
```bash
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['expo-system-ui']=p.dependencies['expo-system-ui'].replace(/^[~^]/,'');fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
npm install
```
Expected: `package.json` con `"expo-system-ui": "57.x.y"` (sin prefijo) y `package-lock.json` actualizado.

- [ ] **Step 3: Prebuild limpio y comprobar que el aviso desapareció**

Run:
```bash
npx expo prebuild --platform ios --clean 2>&1 | tee /tmp/prebuild-f2.log | tail -6
grep -c 'expo-system-ui' /tmp/prebuild-f2.log || echo NO_WARNING
```
Expected: `✔ Finished prebuild`, `✔ Installed CocoaPods`, y `NO_WARNING` (o `0`).

- [ ] **Step 4: Tests y tipos siguen en verde; commit**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4`
Expected: exit 0 y 169/169.
```bash
git add package.json package-lock.json
git commit -m "chore(mobile): expo-system-ui para que ios.backgroundColor llegue al nativo (D10)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `formatAusd(raw, decimals)` y `formatPnl` (D20, D22)

**Files:**
- Modify: `apps/mobile/src/config/chain.ts:36-38`
- Modify: `apps/mobile/src/perpl/orders.ts:44-60`
- Test: `apps/mobile/__tests__/chain.test.ts`, `apps/mobile/__tests__/perpl-orders.test.ts`

**Interfaces:**
- Consumes: `truncate(value, places)` y `AUSD_DECIMALS` de `config/chain.ts`; `formatAusd` de `config/chain.ts` desde `orders.ts`.
- Produces: `formatAusd(raw: bigint, decimals = 2): string`; `formatPnl(raw: bigint): string` (`"+0.00"` si `|raw| < 10_000n`, si no `"+1.23"` / `"−1.23"` con el signo menos tipográfico `−` U+2212, como ya usan las pantallas). Las Tasks 5 y 6 dependen de los dos.

- [ ] **Step 1: Tests que fallan**

Añade al final de `__tests__/chain.test.ts`:
```ts
test("formatAusd takes an optional number of decimals for fees", () => {
  expect(formatAusd(500n, 4)).toBe("0.0005");
  expect(formatAusd(500n)).toBe("0.00");
  expect(formatAusd(1_234_567n, 4)).toBe("1.2345");
  expect(formatAusd(1_234_567n, 6)).toBe("1.234567");
});
```
Añade `formatPnl` al import de `__tests__/perpl-orders.test.ts` y al final del archivo:
```ts
test("formatPnl rounds anything under half a cent to +0.00 and keeps the sign otherwise", () => {
  expect(formatPnl(0n)).toBe("+0.00");
  expect(formatPnl(-9_999n)).toBe("+0.00");
  expect(formatPnl(9_999n)).toBe("+0.00");
  expect(formatPnl(10_000n)).toBe("+0.01");
  expect(formatPnl(-10_000n)).toBe("−0.01");
  expect(formatPnl(-1_500_000n)).toBe("−1.50");
  expect(formatPnl(123_456_789n)).toBe("+123.45");
});
```
(El umbral es un centavo mostrado, no medio: `formatAusd` trunca, y un umbral de 0.005 dejaría «−0.00» entre −0.005 y −0.0099. Ruling de ejecución.)

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/chain.test.ts __tests__/perpl-orders.test.ts 2>&1 | tail -15`
Expected: FAIL — `formatAusd(500n, 4)` devuelve `"0.00"`; `formatPnl is not a function`.

- [ ] **Step 3: Implementar**

En `src/config/chain.ts` reemplaza `formatAusd`:
```ts
/** AUSD con `decimals` decimales truncados (2 para saldos y montos; 4 para fees, D20). */
export function formatAusd(raw: bigint, decimals = 2): string {
  return truncate(formatUnits(raw, AUSD_DECIMALS), decimals);
}
```
En `src/perpl/orders.ts`, cambia el import de la cabecera a `import { AUSD_DECIMALS, formatAusd } from "../config/chain";`, renombra en `unrealisedPnl` la variable `any` → `matched` (las tres apariciones) y añade después de `unrealisedPnl`:
```ts
const ONE_CENT = 10_000n; // 0.01 AUSD en unidades de 6 decimales: lo mínimo que formatAusd (truncado) muestra distinto de 0.00

/** PnL con signo para la UI: por debajo de un centavo es "+0.00" (D22), nunca "−0.00". */
export function formatPnl(raw: bigint): string {
  const abs = raw < 0n ? -raw : raw;
  if (abs < ONE_CENT) return "+0.00";
  return `${raw < 0n ? "−" : "+"}${formatAusd(abs)}`;
}
```

- [ ] **Step 4: Verificar que pasan, `tsc`, commit**

Run: `npx jest __tests__/chain.test.ts __tests__/perpl-orders.test.ts 2>&1 | tail -6 && npx tsc --noEmit`
Expected: ambas suites PASS; `tsc` exit 0.
```bash
git add src/config/chain.ts src/perpl/orders.ts __tests__/chain.test.ts __tests__/perpl-orders.test.ts
git commit -m "feat(mobile): formatAusd con decimales y formatPnl sin −0.00 (D20, D22)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `serverTime` en `fetchContext` y módulo `perpl/clock.ts` (D19)

**Files:**
- Modify: `apps/mobile/src/perpl/context.ts:15,55-79`
- Create: `apps/mobile/src/perpl/clock.ts`
- Test: `apps/mobile/__tests__/perpl-context.test.ts`, `apps/mobile/__tests__/perpl-clock.test.ts` (nuevo)

**Interfaces:**
- Consumes: `parseContext`, `fetchContext`, `CONTEXT_TIMEOUT_MS` (sin cambios de firma).
- Produces:
  - `Context.serverTime: number | null` (ms desde epoch). `parseContext` lo deja en `null`; `fetchContext` lo completa con `parseServerTime(res.headers.get("date"))`.
  - `parseServerTime(header: string | null): number | null` (exportada de `context.ts`).
  - En `clock.ts`: `CLOCK_SKEW_MAX_MS = 20_000`; `clockSkewMs(serverTime: number | null, now: number): number | null`; `describeClockSkew(skewMs: number | null): { title: string; body: string } | null`; `KEY_REJECTED_COPY: string`. La Task 3 (hook) y la Task 6 (Markets) las consumen.

- [ ] **Step 1: Tests que fallan**

En `__tests__/perpl-context.test.ts` cambia el import a `import { fetchContext, parseContext, parseServerTime } from "../src/perpl/context";` y añade al final:
```ts
test("parseContext leaves serverTime null; parseServerTime reads an RFC 1123 Date header", () => {
  expect(parseContext(contextJson).serverTime).toBeNull();
  expect(parseServerTime("Thu, 18 Sep 2026 22:35:00 GMT")).toBe(Date.UTC(2026, 8, 18, 22, 35, 0));
  expect(parseServerTime(null)).toBeNull();
  expect(parseServerTime("not a date")).toBeNull();
});

// Sin `new Response`: el entorno de jest-expo no garantiza los globals de fetch de Node.
function fakeFetch(headers: Record<string, string>) {
  const res = { ok: true, status: 200, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null }, json: async () => contextJson };
  return jest.fn(async () => res) as unknown as typeof fetch;
}

test("fetchContext fills serverTime from the Date header, and null without it", async () => {
  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch({ date: "Thu, 18 Sep 2026 22:35:00 GMT" });
  const withHeader = await fetchContext("https://x.test/api");
  expect(withHeader.serverTime).toBe(Date.UTC(2026, 8, 18, 22, 35, 0));
  expect(withHeader.markets.map((m) => m.id)).toEqual([16, 32, 48, 64, 256, 272, 320]);
  (globalThis as { fetch: typeof fetch }).fetch = fakeFetch({});
  expect((await fetchContext("https://x.test/api")).serverTime).toBeNull();
});
```
Crea `__tests__/perpl-clock.test.ts`:
```ts
import { CLOCK_SKEW_MAX_MS, clockSkewMs, describeClockSkew, KEY_REJECTED_COPY } from "../src/perpl/clock";

test("clockSkewMs is server minus phone, or null without a server time", () => {
  expect(clockSkewMs(1_000_000, 1_000_000)).toBe(0);
  expect(clockSkewMs(1_030_000, 1_000_000)).toBe(30_000);
  expect(clockSkewMs(1_000_000, 1_030_000)).toBe(-30_000);
  expect(clockSkewMs(null, 1_000_000)).toBeNull();
});

test("describeClockSkew warns beyond 20 s in either direction, with whole seconds in the copy", () => {
  expect(CLOCK_SKEW_MAX_MS).toBe(20_000);
  expect(describeClockSkew(null)).toBeNull();
  expect(describeClockSkew(20_000)).toBeNull();
  expect(describeClockSkew(-20_000)).toBeNull();
  expect(describeClockSkew(20_001)).toEqual({
    title: "Your phone's clock is off by 20 s.",
    body: "Perpl rejects signatures more than 30 s off — turn on Set automatically in Settings › General › Date & Time.",
  });
  expect(describeClockSkew(-125_400)?.title).toBe("Your phone's clock is off by 125 s.");
});

test("the key-rejected copy points at the clock first", () => {
  expect(KEY_REJECTED_COPY).toBe("Trading key rejected. Check the phone clock first; if it is right, Perpl may not be available in your region.");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `npx jest __tests__/perpl-context.test.ts __tests__/perpl-clock.test.ts 2>&1 | tail -15`
Expected: FAIL — `parseServerTime` no existe; `Cannot find module '../src/perpl/clock'`.

- [ ] **Step 3: Implementar**

En `src/perpl/context.ts`:
```ts
export type Context = { markets: Market[]; instance: Instance; geoBlock: string[]; serverTime: number | null };
```
En `parseContext`, el `return` pasa a `return { markets, instance, geoBlock, serverTime: null };`. Añade antes de `fetchContext`:
```ts
/** Header `Date` (RFC 1123) → ms desde epoch; null si falta o no parsea (un CDN puede quitarlo). */
export function parseServerTime(header: string | null): number | null {
  if (!header) return null;
  const ms = Date.parse(header);
  return Number.isNaN(ms) ? null : ms;
}
```
y en `fetchContext` sustituye `return parseContext(await res.json());` por:
```ts
    const serverTime = parseServerTime(res.headers.get("date"));
    return { ...parseContext(await res.json()), serverTime };
```
Crea `src/perpl/clock.ts`:
```ts
/**
 * Desfase entre el reloj del teléfono y el de Perpl (D19). Perpl rechaza firmas fuera de ±30 s;
 * los dos `3401` del iPhone de Jesús (audit mobile-polish) eran esto, no geobloqueo.
 */
export const CLOCK_SKEW_MAX_MS = 20_000; // margen bajo los ±30 s del servidor

/** serverTime − now; null si el servidor no mandó `Date`. */
export function clockSkewMs(serverTime: number | null, now: number): number | null {
  return serverTime === null ? null : serverTime - now;
}

export function describeClockSkew(skewMs: number | null): { title: string; body: string } | null {
  if (skewMs === null || Math.abs(skewMs) <= CLOCK_SKEW_MAX_MS) return null;
  return {
    title: `Your phone's clock is off by ${Math.floor(Math.abs(skewMs) / 1000)} s.`,
    body: "Perpl rejects signatures more than 30 s off — turn on Set automatically in Settings › General › Date & Time.",
  };
}

export const KEY_REJECTED_COPY = "Trading key rejected. Check the phone clock first; if it is right, Perpl may not be available in your region.";
```

- [ ] **Step 4: Verificar que pasan, `tsc`, suite completa, commit**

Run: `npx jest __tests__/perpl-context.test.ts __tests__/perpl-clock.test.ts 2>&1 | tail -6 && npx tsc --noEmit && npm test 2>&1 | tail -4`
Expected: PASS; `tsc` exit 0 (si algún test o fixture construye un `Context` literal sin `serverTime`, añádele `serverTime: null`); `Tests: 178 passed` aprox. (169 + 2 + 3 + 2 + 2) en 24 suites.
```bash
git add src/perpl/context.ts src/perpl/clock.ts __tests__/perpl-context.test.ts __tests__/perpl-clock.test.ts
git commit -m "feat(mobile): serverTime del header Date y aviso de reloj desfasado (D19)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `runEnable` con cuenta existente y `usePerpl` expone `clockSkewMs`, `existingAccountId` (D19, D21)

**Files:**
- Modify: `apps/mobile/src/perpl/enable.ts:40-48`
- Modify: `apps/mobile/src/hooks/usePerpl.ts`
- Test: `apps/mobile/__tests__/perpl-enable.test.ts`

**Interfaces:**
- Consumes: `readAccountId(address)` de `perpl/onboarding.ts`; `clockSkewMs` de `perpl/clock.ts` (Task 2); `Context.serverTime` (Task 2).
- Produces en `Perpl` (tipo exportado de `usePerpl.ts`, consumido por Tasks 6 y 7):
  - `clockSkewMs: number | null` — medido en cada `refreshContext`; si hay override, el override.
  - `existingAccountId: bigint | null` — `readAccountId(address)` sondeado cuando `state.status === "none"`; `null` mientras no se sabe, `0n` si la wallet no tiene cuenta, `> 0n` si la tiene. Se vuelve a sondear con cada `context` nuevo (cada `refreshContext`).
  - `setClockSkewOverride: (ms: number | null) => void` — sólo para DevControls (P4).
  - `enable(0n)` reconecta: `runEnable` con id existente salta approve/create (ya lo hacía) y con id `0n` + `amount 0n` falla en el paso 1 con `"Enter an amount."` (P5).

- [ ] **Step 1: Tests que fallan (`runEnable`)**

Añade al final de `__tests__/perpl-enable.test.ts`:
```ts
test("reconnect: amount 0 with an existing account only re-checks forwarding and the key (D21)", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 620n) });
  const steps: number[] = [];
  await expect(runEnable(d, 0n, (s) => steps.push(s))).resolves.toEqual(KEY);
  expect(steps).toEqual([1, 3, 4]);
  expect(d.walletAusd).not.toHaveBeenCalled();
  expect(d.approve).not.toHaveBeenCalled();
  expect(d.createAccount).not.toHaveBeenCalled();
  expect(d.isForwarding).toHaveBeenCalledTimes(1);
  expect(d.loadKey).toHaveBeenCalledWith(620n);
});

test("reconnect with amount 0 but no account on-chain fails at step 1 and never creates an account", async () => {
  const d = deps({ readAccountId: jest.fn(async () => 0n) });
  const err = await runEnable(d, 0n, () => {}).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EnableError);
  expect((err as EnableError).step).toBe(1);
  expect((err as EnableError).message).toBe("Enter an amount.");
  expect(d.walletAusd).not.toHaveBeenCalled();
  expect(d.createAccount).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verificar que falla el segundo**

Run: `npx jest __tests__/perpl-enable.test.ts 2>&1 | tail -12`
Expected: el primero ya pasa (el guard `if (id === 0n)` existía); el segundo FAIL con `step` 2 (hoy llama `createAccount(0n)`).

- [ ] **Step 3: Guard en `runEnable`**

En `src/perpl/enable.ts`, dentro del paso 1, justo después de `const id = await deps.readAccountId();`:
```ts
    if (id === 0n && amount === 0n) throw new Error("Enter an amount."); // reconnect sin cuenta: el gate vuelve a Enable (spec §4)
```

- [ ] **Step 4: Verificar que pasan**

Run: `npx jest __tests__/perpl-enable.test.ts 2>&1 | tail -6`
Expected: PASS (10 tests).

- [ ] **Step 5: `usePerpl` — estado nuevo**

En `src/hooks/usePerpl.ts`:

1. Imports: añade `import { clockSkewMs as measureSkew } from "../perpl/clock";`.
2. Tipo `Perpl`: añade después de `lastBalance: bigint | null;`
```ts
  /** serverTime − Date.now() del último pub/context; null sin header `Date` (D19). Con override de dev, el override. */
  clockSkewMs: number | null;
  /** Cuenta de Perpl de esta wallet mientras no hay key (D21): null = sin sondear, 0n = no existe, >0n = existe. */
  existingAccountId: bigint | null;
  /** Sólo DevControls (__DEV__): fuerza un desfase para ver el aviso en el simulador. */
  setClockSkewOverride: (ms: number | null) => void;
```
3. Estado, después de `const [lastBalance, …]`:
```ts
  const [measuredSkew, setMeasuredSkew] = useState<number | null>(null);
  const [skewOverride, setSkewOverride] = useState<number | null>(null);
  const [existingAccountId, setExistingAccountId] = useState<bigint | null>(null);
```
4. `refreshContext` pasa a medir el skew con el `Date.now()` inmediatamente posterior al fetch:
```ts
  const refreshContext = useCallback(async () => {
    try {
      const ctx = await fetchContext(PERPL_URLS.rest);
      setMeasuredSkew(measureSkew(ctx.serverTime, Date.now()));
      setContext(ctx);
      setContextError("");
    } catch (e) {
      setContextError(describeError(e) || "Couldn't load markets.");
    }
  }, []);
```
5. Sondeo de la cuenta existente, después del efecto de polling de precios. `context` está en las deps a propósito: cada `refreshContext` produce un objeto nuevo y re-sondea (D21 pide "una vez y en cada refreshContext"); fuera del estado `none` el valor vuelve a `null` sin llamar al RPC.
```ts
  // Reconnect trading (D21): sin key, ¿esta wallet ya tiene cuenta en el exchange?
  useEffect(() => {
    if (state.status !== "none" || !address) { setExistingAccountId(null); return; }
    let stale = false;
    readAccountId(address)
      .then((id) => { if (!stale) setExistingAccountId(id); })
      .catch(() => { if (!stale) setExistingAccountId(null); });
    return () => { stale = true; };
  }, [state.status, address, context]);
```
6. `setClockSkewOverride`: `const setClockSkewOverride = useCallback((ms: number | null) => setSkewOverride(ms), []);`
7. El `return` añade `clockSkewMs: skewOverride ?? measuredSkew, existingAccountId, setClockSkewOverride`.

`enable` no cambia: `enable(0n)` ya llega a `runEnable` con `amount = 0n`; el chequeo de MON (`fresh.mon === 0n`) sigue aplicando porque el paso 3 puede mandar `allowOrderForwarding`.

- [ ] **Step 6: `tsc`, suite completa, commit**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4`
Expected: exit 0; 24 suites, +2 tests respecto a la Task 2.
```bash
git add src/perpl/enable.ts src/hooks/usePerpl.ts __tests__/perpl-enable.test.ts
git commit -m "feat(mobile): usePerpl expone clockSkewMs y existingAccountId; enable(0n) reconecta (D19, D21)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `isComingSoonTab`, `Screen` → `Page`, `PillTabs` con `pill-*` (P1, P2, P3)

**Files:**
- Modify: `apps/mobile/src/store.ts:40,151-158`
- Modify: `apps/mobile/src/ui/primitives.tsx:203-219,246-248`
- Modify: `apps/mobile/src/screens/comingSoon.tsx:1-16`, `apps/mobile/src/screens/wallet.tsx:8`, `apps/mobile/src/screens/signin.tsx:4`
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `COMING_SOON`, `ComingSoonTab` (store / comingSoonCopy).
- Produces: `isComingSoonTab(screen: Screen): screen is ComingSoonTab` (export de `store.ts`); primitiva `Page` (misma firma que la `Screen` actual: `{ children, style, gap = 11, top = 14 }`); `PillTabs` etiqueta `pill-<key>`. Tasks 5–7 usan `Page` y `PillTabs`.

- [ ] **Step 1: Test que falla**

Añade `isComingSoonTab` al import de `__tests__/store.test.ts` y al final:
```ts
test("isComingSoonTab is the type guard behind comingSoon, exactly the COMING_SOON set", () => {
  for (const s of COMING_SOON) expect(isComingSoonTab(s)).toBe(true);
  for (const s of ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "signin"] as const) expect(isComingSoonTab(s)).toBe(false);
});
```
Run: `npx jest __tests__/store.test.ts 2>&1 | tail -8` → Expected: FAIL, `isComingSoonTab is not a function`.

- [ ] **Step 2: Implementar**

`src/store.ts`, debajo de `COMING_SOON`:
```ts
export function isComingSoonTab(screen: Screen): screen is ComingSoonTab {
  return (COMING_SOON as readonly Screen[]).includes(screen);
}
```
y en `useAppStore`: `comingSoon: isComingSoonTab(S.screen),`.

`src/screens/comingSoon.tsx`: borra la función local `isTab`, importa `import { isComingSoonTab, type Screen } from "../store";` y usa `if (!isComingSoonTab(screen)) throw new Error(…)`.

`src/ui/primitives.tsx`: renombra `export function Screen(` → `export function Page(` (mismo cuerpo). En `PillTabs`, `accessibilityLabel={`pill-${k}`}`.

`src/screens/wallet.tsx` y `src/screens/signin.tsx`: `Screen` → `Page` en el import y en el JSX (`<Page gap={11}>`, `</Page>`, `<Page top={18} gap={12}>`).

Run: `grep -rn 'Screen' src/ui/primitives.tsx; grep -rn '<Screen\|</Screen' src/screens || echo NO_SCREEN_PRIMITIVE_LEFT`
Expected: ninguna línea de `primitives.tsx`; `NO_SCREEN_PRIMITIVE_LEFT`.

- [ ] **Step 3: Verificar, commit**

Run: `npx jest __tests__/store.test.ts 2>&1 | tail -6 && npx tsc --noEmit && npm test 2>&1 | tail -4`
Expected: PASS; exit 0; +1 test.
```bash
git add src/store.ts src/ui/primitives.tsx src/screens/comingSoon.tsx src/screens/wallet.tsx src/screens/signin.tsx __tests__/store.test.ts
git commit -m "refactor(mobile): isComingSoonTab, primitiva Page y pills pill-* (diferidos de la revisión de F1)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `screens/market.tsx` — pills Ask · Trade · Agents y el ticket del hi-fi (D14, D20, P7, P8)

**Files:**
- Modify: `apps/mobile/src/screens/market.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `Page`, `PillTabs`, `Segmented`, `Card`, `Tag`, `Chip`, `Btn`, `KV`, `KVList`, `StatusCard`, `T`, `Touch`, `type Tone` (primitivas F1/Task 4); `ComingSoonCard` (`screens/comingSoon.tsx`); `formatAusd(raw, decimals)` (Task 1); `S.marketTab`, `set({ marketTab })` (store); `perpl.open`, `perpl.live`, `leveragesFor`, `sizeFromAusd`, `notionalAusd`, `takerFee`, `liquidationPrice`, `formatPrice`, `formatSize` (sin cambios); `pill(on)` y `textStyle` (`ui/theme.ts`).
- Produces: `MarketScreen(ctx: AppCtx)`; `OrderResultCard({ result, onBack, onEdit? })` y `type OrderResult` con **la misma firma que hoy** (la Task 6 los importa desde aquí). Etiquetas de accesibilidad: `pill-ask` / `pill-trade` / `pill-agents` (PillTabs), `segment-long` / `segment-short` (Segmented), `margin-input`, `max`, `lv-1` … `lv-5`, `review`, `confirm`, `change-amount`, `back-to-markets`, `edit-order`.

- [ ] **Step 1: Reescribir `market.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { formatPrice, formatSize, leveragesFor, liquidationPrice, notionalAusd, type Side, sizeFromAusd, takerFee } from "../perpl/orders";
import { Btn, Card, Chip, KVList, type KVRow, Page, PillTabs, Segmented, StatusCard, T, Tag, type Tone } from "../ui/primitives";
import { C, pill, textStyle } from "../ui/theme";
import { ComingSoonCard } from "./comingSoon";

export type OrderResult =
  | { step: "sent" }
  | { step: "filled"; title: string; detail: string }
  | { step: "failed"; text: string }
  | { step: "unknown" };

/** Tonos de D14: sent = hair2/slab, filled = lima, failed = down, unknown = warn. */
const TONES = {
  sent: { tag: "SENT", title: "Order accepted — waiting for the fill", tone: { bd: C.hair2, bg: C.slab, fg: C.dim } },
  filled: { tag: "FILLED", title: "Filled", tone: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime } },
  failed: { tag: "FAILED", title: "Order failed", tone: { bd: C.downBd, bg: C.downBg, fg: C.down } },
  unknown: { tag: "NO CONFIRMATION", title: "No confirmation yet", tone: { bd: C.warnBd, bg: C.warnBg, fg: C.warn } },
} as const satisfies Record<OrderResult["step"], { tag: string; title: string; tone: Tone }>;

/** Estados Sent / Filled / Failed / Unknown, compartidos por apertura (aquí) y cierre (markets.tsx). */
export function OrderResultCard({ result, onBack, onEdit }: { result: OrderResult; onBack: () => void; onEdit?: () => void }) {
  const t = TONES[result.step];
  const body = result.step === "filled" ? result.detail
    : result.step === "failed" ? result.text
    : result.step === "unknown" ? "Check your positions — the order may still have gone through."
    : undefined;
  return (
    <View style={{ gap: 11 }}>
      <StatusCard tag={t.tag} title={result.step === "filled" ? result.title : t.title} body={body} tone={t.tone}>
        {result.step === "sent" ? <ActivityIndicator color={C.dim} style={{ alignSelf: "flex-start" }} /> : null}
      </StatusCard>
      {result.step !== "sent" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {result.step === "failed" && onEdit ? <Btn label="Edit" onPress={onEdit} variant="outline" flex={1} accessibilityLabel="edit-order" /> : null}
          <Btn label="Back to Markets" onPress={onBack} variant="lime" flex={1} accessibilityLabel="back-to-markets" />
        </View>
      ) : null}
    </View>
  );
}

type Step = { step: "edit" } | { step: "review" } | { step: "result"; result: OrderResult };

function TradeTab({ S, set, perpl, nav }: AppCtx) {
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const side: Side = S.perpsSide ?? "long";
  const free = perpl.live?.account ? perpl.live.account.b - perpl.live.account.lb : 0n;
  const [amount, setAmount] = useState("");
  const [lv, setLv] = useState(1);
  const [st, setSt] = useState<Step>({ step: "edit" });

  const leverages = leveragesFor(market);
  const lvUsed = leverages.includes(lv) ? lv : 1;
  const units = parseAusd(amount);
  const size = units === undefined ? 0 : sizeFromAusd(units, lvUsed, market.mark, market.priceDecimals, market.sizeDecimals);
  const notional = notionalAusd(size, market.mark, market.priceDecimals, market.sizeDecimals);
  const fee = takerFee(notional, market.takerFeeMicros);
  const liq = liquidationPrice(market.mark, lvUsed, side, market.maintenanceBps, market.maxLeverage);
  // El exchange cobra la fee además del margen: units + fee debe caber en el saldo libre.
  const error = amount === "" ? "" : units === undefined || units === 0n ? "Enter an amount above zero." : units > free ? `That is more than the ${formatAusd(free)} AUSD free.` : size <= 0 ? "That amount is below one unit of this market." : units + fee > free ? `That leaves no room for the ${formatAusd(fee, 4)} AUSD fee.` : "";
  const ok = units !== undefined && units > 0n && units + fee <= free && size > 0;
  // Max deja sitio a la fee: fee(free × lv) acota la fee real (nominal ≤ Max × lv < free × lv), así que Max pasa la validación.
  const maxFee = takerFee(free * BigInt(lvUsed), market.takerFeeMicros);
  const max = free > maxFee ? free - maxFee : 0n;
  const live = perpl.live?.status === "live";
  const sym = market.symbol;

  const confirm = async () => {
    setSt({ step: "result", result: { step: "sent" } });
    const outcome = await perpl.open(market, side, units ?? 0n, lvUsed);
    setSt({ step: "result", result:
      outcome.kind === "filled" ? { step: "filled", title: `Filled ${formatSize(outcome.order.fs, market.sizeDecimals)} ${sym} at ${formatPrice(outcome.order.fp, market.priceDecimals)}`, detail: `Fee ${formatAusd(outcome.order.f, 4)} AUSD · ${side.toUpperCase()} ${lvUsed}x` }
      : outcome.kind === "open" ? { step: "filled", title: "Placed — waiting in the book", detail: `${formatSize(outcome.order.os, market.sizeDecimals)} ${sym}` }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  const rows: KVRow[] = [
    { label: "NOTIONAL", value: `≈ ${formatAusd(notional)} AUSD · ${formatSize(size, market.sizeDecimals)} ${sym}` },
    { label: "EST. PRICE", value: formatPrice(market.mark, market.priceDecimals) },
    { label: "FEE · TAKER", value: `≈ ${formatAusd(fee, 4)} AUSD`, fg: C.dim },
    { label: "LIQUIDATION ≈", value: formatPrice(liq, market.priceDecimals), fg: lvUsed > 1 ? C.down : C.dim },
  ];

  if (st.step === "result") {
    return <Page top={13}><OrderResultCard result={st.result} onBack={() => nav("markets")} onEdit={() => setSt({ step: "edit" })} /></Page>;
  }

  if (st.step === "review") {
    return (
      <Page top={13} gap={11}>
        <Card bd={side === "long" ? C.limeBd : C.downBd} bg={side === "long" ? C.limeBg06 : C.downBg} gap={8}>
          <Tag color={side === "long" ? C.lime : C.down}>YOU OPEN · {side.toUpperCase()} {sym} · {lvUsed}X · MARKET</Tag>
          <T w={700} s={22} lh={1.1} ls={-0.02} display>{formatAusd(units ?? 0n)} AUSD</T>
          <KVList rows={rows} top />
        </Card>
        {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
        <Btn label={live ? `Confirm ${side}` : "Connecting…"} onPress={() => { void confirm(); }} variant="lime" py={14} disabled={!live} accessibilityLabel="confirm" />
        <Btn label="Change amount" onPress={() => setSt({ step: "edit" })} variant="ghost" accessibilityLabel="change-amount" />
        <T w={400} s={11} lh={1.45} color={C.faint}>Market order with up to {market.maxSlippageBps / 100}% slippage. Forwarded orders pay no gas.</T>
      </Page>
    );
  }

  return (
    <Page top={13} gap={11}>
      <Segmented
        options={[["long", "Long"], ["short", "Short"]] as const}
        value={side}
        onChange={(k) => set({ perpsSide: k })}
        tone={(k) => ({ bg: k === "long" ? C.lime : C.down, fg: C.onLime })}
      />
      <Card bd={C.hair2} bg={C.deep} gap={6}>
        <Tag>MARGIN · AUSD</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" accessibilityLabel="margin-input"
            style={[textStyle(700, 32, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]}
          />
          <Chip label="Max" onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} bd={C.hair22} fg={C.ink} accessibilityLabel="max" />
        </View>
        <T w={400} s={11.5} lh={1.4} color={C.dim}>{formatAusd(free)} AUSD free in trading</T>
      </Card>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {leverages.map((l) => {
          const p = pill(l === lvUsed);
          return <Chip key={l} label={`${l}x`} mono s={10} py={8} px={0} style={{ flex: 1 }} fg={p.fg} bd={p.bd} bg={p.bg} onPress={() => setLv(l)} accessibilityLabel={`lv-${l}`} />;
        })}
      </View>
      {leverages.length < 4 ? <T w={400} s={11} lh={1.4} color={C.faint}>{sym} allows up to {market.maxLeverage}x.</T> : null}
      <Card><KVList rows={rows} /></Card>
      {lvUsed > 1 ? <T w={400} s={11.5} lh={1.4} color={C.warn}>Higher leverage means a closer liquidation price.</T> : null}
      {error ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{error}</T> : null}
      <Btn label={ok ? `Review ${side} · ${formatAusd(units ?? 0n)} AUSD` : "Enter a margin"} onPress={() => setSt({ step: "review" })} arrow disabled={!ok} py={14} accessibilityLabel="review" />
      <T w={400} s={10.5} lh={1.4} color={C.faint}>Nothing sent yet. Fills from the book; PnL and liquidation on mark.</T>
    </Page>
  );
}

export function MarketScreen(ctx: AppCtx) {
  const { S, set, perpl, nav } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId);

  if (!market) {
    return (
      <Page gap={11}>
        <T w={400} s={13} color={C.faint}>{perpl.contextError ? `Couldn't load markets. ${perpl.contextError}` : "Loading market…"}</T>
        <Btn label="Back to Markets" onPress={() => nav("markets")} variant="lime" accessibilityLabel="back-to-markets" />
      </Page>
    );
  }

  return (
    <View>
      <View style={{ paddingTop: 11, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair12 }}>
        <PillTabs options={[["ask", "Ask"], ["trade", "Trade"], ["agents", "Agents"]] as const} value={S.marketTab} onChange={(k) => set({ marketTab: k })} />
      </View>
      {S.marketTab === "trade" ? <TradeTab {...ctx} /> : <Page top={13}><ComingSoonCard which={S.marketTab} /></Page>}
    </View>
  );
}
```
Nota para el implementador: el `!` de `TradeTab` es deliberado: sólo se monta cuando `MarketScreen` ya encontró el mercado; si prefieres, pasa `market` como prop (`TradeTab({ market, ...ctx })`) — cualquiera de las dos vale, pero no dupliques el `return` de "Loading market…".

- [ ] **Step 2: `tsc`, tests, residuos**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4 && grep -n 'primaryBtn\|secondaryBtn\|chipBtn\|w={800}' src/screens/market.tsx || echo NO_LEGACY_STYLES`
Expected: exit 0; tests igual que la Task 4; `NO_LEGACY_STYLES`.

- [ ] **Step 3: Commit**

```bash
git add src/screens/market.tsx
git commit -m "feat(mobile): Market con pills Ask · Trade · Agents y el ticket del hi-fi; fees a 4 decimales (D14, D20)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `screens/markets.tsx` — raíz de Perpl re-maquetada, gate Reconnect y aviso de reloj (D13, D19, D21, D22)

**Files:**
- Modify: `apps/mobile/src/screens/markets.tsx` (reescritura completa)

**Interfaces:**
- Consumes: `Page`, `Card`, `TouchCard`, `Tag`, `Chip`, `Btn`, `KV`, `Warn`, `EmptyPanel`, `StatusCard`, `T`, `Touch` (primitivas); `OrderResultCard`, `type OrderResult` (Task 5); `formatAusd(raw, decimals)`, `formatPnl` (Task 1); `describeClockSkew`, `KEY_REJECTED_COPY` (Task 2); `perpl.clockSkewMs`, `perpl.existingAccountId`, `perpl.enable(0n)` (Task 3); `ENABLE_STEPS`, `change24h`, `formatPrice`, `formatSize`, `liquidationPrice`, `lockedCollateral`, `positionPnl`, `unrealisedPnl` (sin cambios).
- Produces: `MarketsScreen(ctx: AppCtx)`. Etiquetas: `market-<SYMBOL>` (fila), `add-funds`, `withdraw-to-wallet`, `enable-input`, `enable-trading`, `reconnect`, `retry-enable`, `reset-trading-key`, `open-perpl`, `enable-forwarding`, `retry-markets`, `close-<pid>`, `keep-position`, `close-position`.

- [ ] **Step 1: Reescribir `markets.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits } from "viem";
import { AUSD_DECIMALS, formatAusd, MON_FAUCET_URL, parseAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { describeClockSkew, KEY_REJECTED_COPY } from "../perpl/clock";
import { PERPL_WEB } from "../perpl/config";
import type { Market } from "../perpl/context";
import { ENABLE_STEPS } from "../perpl/enable";
import { change24h, formatPnl, formatPrice, formatSize, liquidationPrice, lockedCollateral, positionPnl, unrealisedPnl } from "../perpl/orders";
import type { Position } from "../perpl/ws";
import { Btn, Card, Chip, EmptyPanel, KV, Page, T, Tag, Touch, TouchCard, Warn } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";
import { OrderResultCard, type OrderResult } from "./market";

const CONNECTION = {
  live: { label: "LIVE", fg: C.lime, bd: C.limeBd },
  connecting: { label: "CONNECTING", fg: C.warn, bd: C.warnBd },
  reconnecting: { label: "RECONNECTING", fg: C.warn, bd: C.warnBd },
  closed: { label: "OFFLINE", fg: C.faint, bd: C.hair18 },
} as const;

function MarketsList({ perpl, nav, readOnly }: Pick<AppCtx, "perpl" | "nav"> & { readOnly: boolean }) {
  return (
    <View style={{ gap: 7 }}>
      <Tag s={10}>MARKETS</Tag>
      {perpl.contextError ? (
        <Warn title="Couldn't load markets" body={perpl.contextError}>
          <Chip label="Retry" onPress={() => { void perpl.refreshContext(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-markets" />
        </Warn>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading markets…</T> : null}
      {(perpl.context?.markets ?? []).map((m) => {
        const chg = change24h(m.mark, m.prev);
        return (
          <TouchCard
            key={m.id} pad={13} accessibilityLabel={`market-${m.symbol}`}
            onPress={readOnly ? undefined : () => nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: "trade" })}
            style={{ flexDirection: "row", alignItems: "center", gap: 11, opacity: readOnly ? 0.7 : 1 }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <T w={700} s={14} lh={1.2}>{m.symbol}</T>
              <T w={400} s={11} lh={1.2} color={C.faint} style={{ marginTop: 3 }}>{m.name} · up to {m.maxLeverage}x</T>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <T w={700} s={13} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
              <T w={500} s={10.5} lh={1} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 4 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(2)}%</T>
            </View>
          </TouchCard>
        );
      })}
    </View>
  );
}

function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const long = p.sd === 1;
  const liq = liquidationPrice(p.ep, lv, long ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  return (
    <Card gap={8}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Chip label={long ? "LONG" : "SHORT"} mono s={9.5} py={4} px={8} fg={long ? C.lime : C.down} bd={long ? C.limeBd : C.downBd} />
        <T w={600} s={13} style={{ flex: 1 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}x</T>
        <T w={700} s={13} mono color={pnl <= -10_000n ? C.down : C.up}>{formatPnl(pnl)} AUSD</T>
      </View>
      <T w={500} s={10} lh={1.4} mono color={C.faint}>{formatPrice(p.ep, market.priceDecimals)} → {formatPrice(market.mark, market.priceDecimals)} · LIQ. EST. {formatPrice(liq, market.priceDecimals)}</T>
      <Btn label="Close" onPress={onClose} variant="outline" py={10} accessibilityLabel={`close-${p.pid}`} />
    </Card>
  );
}

type Closing = { p: Position; market: Market; result: OrderResult | null };

function Gate({ perpl, treasury, nav }: AppCtx) {
  const minOpen = perpl.context?.instance.minAccountOpen ?? 100_000_000n;
  const walletAusd = treasury.balances?.ausd ?? 0n;
  const noMon = treasury.balances?.mon === 0n;
  const [amount, setAmount] = useState<string | null>(null);
  const text = amount ?? formatUnits(minOpen, AUSD_DECIMALS);
  const units = parseAusd(text);
  const enableError = units === undefined || units === 0n ? "Enter an amount." : units < minOpen ? `Minimum is ${formatAusd(minOpen)} AUSD.` : units > walletAusd ? `That is more than the ${formatAusd(walletAusd)} AUSD in your wallet.` : "";
  const ob = perpl.state.status === "onboarding" ? perpl.state : null;
  const existing = perpl.existingAccountId;
  const reconnect = existing !== null && existing > 0n;
  // Retry tras un error: reconectar vuelve a pedir 0n; enable normal repite el monto escrito.
  const retryAmount = reconnect ? 0n : units;

  return (
    <Page gap={11}>
      <Card pad={15} gap={8}>
        <T w={700} s={17} lh={1.15} ls={-0.02} display>{reconnect ? "Reconnect trading" : "Enable trading"}</T>
        {ob === null ? (
          reconnect ? (
            <>
              <T w={400} s={12.5} lh={1.45} color={C.dim}>This wallet already has Perpl account #{String(existing)}. Reconnect registers a trading key on this phone; no AUSD moves.</T>
              {noMon ? <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch> : null}
              <Btn label="Reconnect" onPress={() => { void perpl.enable(0n); }} variant="lime" py={14} disabled={noMon} accessibilityLabel="reconnect" />
            </>
          ) : (
            <>
              <T w={400} s={12.5} lh={1.45} color={C.dim}>Moves AUSD from your wallet into a Perpl trading account. One Face ID, four steps.</T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 2 }}>
                <TextInput value={text} onChangeText={setAmount} keyboardType="decimal-pad" accessibilityLabel="enable-input" style={[textStyle(700, 26, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]} />
                <T w={500} s={12} mono color={C.faint}>AUSD</T>
              </View>
              <T w={400} s={11.5} lh={1.4} color={C.dim}>{formatAusd(walletAusd)} AUSD in wallet · minimum {formatAusd(minOpen)}</T>
              {enableError ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{enableError}</T> : null}
              {noMon ? <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }}><T w={400} s={12} lh={1.4} color={C.warn}>You need test MON for gas. Get some at the Monad faucet.</T></Touch> : null}
              <Btn label="Enable trading" onPress={() => { if (units !== undefined && !enableError) void perpl.enable(units); }} variant="lime" py={14} disabled={!!enableError || noMon} accessibilityLabel="enable-trading" />
            </>
          )
        ) : (
          <View style={{ gap: 8, paddingTop: 2 }}>
            {ENABLE_STEPS.map((label, i) => {
              const n = i + 1;
              const state = n < ob.step ? "done" : n === ob.step ? (ob.error ? "error" : "busy") : "todo";
              return (
                <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {state === "busy" ? <ActivityIndicator size="small" color={C.lime} /> : <T w={700} s={13} mono color={state === "done" ? C.up : state === "error" ? C.down : C.faint}>{state === "done" ? "✓" : state === "error" ? "×" : "·"}</T>}
                  <T w={state === "todo" ? 400 : 600} s={13} color={state === "todo" ? C.faint : C.ink}>{label}</T>
                </View>
              );
            })}
            {ob.error ? <T w={400} s={12} lh={1.4} color={C.down}>{ob.error}</T> : null}
            {ob.error ? <Btn label="Retry" onPress={() => { if (retryAmount !== undefined) void perpl.enable(retryAmount); }} variant="outline" style={{ marginTop: 4 }} accessibilityLabel="retry-enable" /> : null}
          </View>
        )}
      </Card>
      <MarketsList perpl={perpl} nav={nav} readOnly />
    </Page>
  );
}

export function MarketsScreen(ctx: AppCtx) {
  const { perpl, nav } = ctx;
  const [closing, setClosing] = useState<Closing | null>(null);
  const [actionError, setActionError] = useState("");
  // Reset key / Enable forwarding: sin catch la promesa rechazada se perdía. "" = Face ID cancelado (sin aviso).
  const runAction = async (action: () => Promise<void>) => {
    setActionError("");
    try { await action(); } catch (e) { setActionError(describeError(e)); }
  };

  if (perpl.state.status === "loading") return <Page><ActivityIndicator color={C.lime} /></Page>;
  if (perpl.state.status === "none" || perpl.state.status === "onboarding") return <Gate {...ctx} />;

  const live = perpl.live;
  const acc = live?.account ?? null;
  const b = acc?.b ?? perpl.lastBalance ?? 0n;
  const positions = live?.positions ?? [];
  const markets = perpl.context?.markets ?? [];
  const locked = lockedCollateral(positions);
  const upnl = unrealisedPnl(positions, markets);
  const conn = CONNECTION[live?.status ?? "closed"];
  const skew = describeClockSkew(perpl.clockSkewMs);

  const doClose = async (c: Closing) => {
    setClosing({ ...c, result: { step: "sent" } });
    const outcome = await perpl.close(c.market, c.p);
    const pd = c.market.priceDecimals, sd = c.market.sizeDecimals;
    setClosing({ ...c, result:
      outcome.kind === "filled" ? { step: "filled", title: `Closed ${formatSize(outcome.order.fs, sd)} ${c.market.symbol} at ${formatPrice(outcome.order.fp, pd)}`, detail: `Fee ${formatAusd(outcome.order.f, 4)} AUSD · realised PnL shows in the trading balance` }
      : outcome.kind === "open" ? { step: "filled", title: "Close order placed", detail: "Waiting in the book" }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" } });
  };

  if (closing) {
    const pnl = positionPnl(closing.p, closing.market.mark, closing.market.priceDecimals, closing.market.sizeDecimals);
    const isLive = live?.status === "live";
    return (
      <Page gap={11}>
        {closing.result ? (
          <OrderResultCard result={closing.result} onBack={() => setClosing(null)} />
        ) : (
          <Card bd={C.hair2} bg={C.deep} gap={9}>
            <Tag>YOU CLOSE · AT MARKET</Tag>
            <T w={700} s={14} lh={1.3}>{formatSize(closing.p.s, closing.market.sizeDecimals)} {closing.market.symbol} {closing.p.sd === 1 ? "LONG" : "SHORT"}</T>
            <KV k="EST. PNL" v={`${formatPnl(pnl)} AUSD`} vFg={pnl <= -10_000n ? C.down : C.up} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Btn label="Keep it" onPress={() => setClosing(null)} variant="outline" flex={1} accessibilityLabel="keep-position" />
              <Btn label={isLive ? "Close position" : "Connecting…"} onPress={() => { void doClose(closing); }} variant="lime" flex={1} disabled={!isLive} accessibilityLabel="close-position" />
            </View>
          </Card>
        )}
      </Page>
    );
  }

  return (
    <Page gap={11}>
      <Card pad={15}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Tag>TRADING · AUSD</Tag>
          <Chip label={conn.label} mono s={9.5} py={4} px={8} fg={conn.fg} bd={conn.bd} />
        </View>
        <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{formatAusd(b)}</T>
        <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 8 }}>{formatAusd(locked)} in positions · {formatAusd(b)} free{acc ? "" : " · last seen"}</T>
        {upnl !== null ? <T w={500} s={10.5} lh={1.4} mono color={upnl <= -10_000n ? C.down : C.up} style={{ marginTop: 3 }}>{formatPnl(upnl)} unrealised PnL</T> : null}
      </Card>

      {skew ? <Warn title={skew.title} body={skew.body} /> : null}
      {live?.keyRejected ? (
        <Warn title="Trading key rejected" body={KEY_REJECTED_COPY}>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Chip label="Reset trading key" onPress={() => { void runAction(perpl.resetKey); }} bd={C.hair22} fg={C.ink} accessibilityLabel="reset-trading-key" />
            <Chip label="Open Perpl" onPress={() => { void Linking.openURL(PERPL_WEB); }} bd={C.hair22} fg={C.ink} accessibilityLabel="open-perpl" />
          </View>
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </Warn>
      ) : null}
      {acc && !acc.fw ? (
        <Warn title="One-click trading is off" body="Orders will be rejected until it's enabled.">
          <Chip label="Enable" onPress={() => { void runAction(perpl.enableForwardingOnly); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="enable-forwarding" />
          {actionError ? <T w={400} s={12} lh={1.4} color={C.down}>{actionError}</T> : null}
        </Warn>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Add funds" onPress={() => nav("perpsFunds", { fundsMode: "add" })} variant="lime" flex={1} accessibilityLabel="add-funds" />
        <Btn label="Withdraw to wallet" onPress={() => nav("perpsFunds", { fundsMode: "withdraw" })} variant="outline2" flex={1} accessibilityLabel="withdraw-to-wallet" />
      </View>

      <MarketsList perpl={perpl} nav={nav} readOnly={false} />

      <View style={{ gap: 7 }}>
        <Tag s={10}>POSITIONS</Tag>
        {positions.length === 0 ? (
          <EmptyPanel><T w={400} s={12.5} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market above.</T></EmptyPanel>
        ) : positions.map((p) => {
          const market = markets.find((m) => m.id === p.mkt);
          return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
        })}
      </View>
    </Page>
  );
}
```
Nota: el umbral `-10_000n` en los colores es el mismo centavo de `formatPnl` (P6): un PnL de −0.009 se pinta en lima junto a su "+0.00".

- [ ] **Step 2: `tsc`, tests, residuos**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4 && grep -n 'primaryBtn\|secondaryBtn\|chipBtn\|warnBox\|w={800}\|isn.t available in some regions' src/screens/markets.tsx || echo NO_LEGACY`
Expected: exit 0; tests sin cambio; `NO_LEGACY`.

- [ ] **Step 3: Commit**

```bash
git add src/screens/markets.tsx
git commit -m "feat(mobile): Markets re-maquetado con Reconnect trading, aviso de reloj y PnL sin −0.00 (D13, D19, D21, D22)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `screens/perpsFunds.tsx` re-vestido y chip de reloj en DevControls (D15, P4)

**Files:**
- Modify: `apps/mobile/src/screens/perpsFunds.tsx` (reescritura completa)
- Modify: `apps/mobile/src/DevControls.tsx:39-60`

**Interfaces:**
- Consumes: `Page`, `StatGrid`, `Segmented`, `Card`, `Tag`, `Chip`, `Btn`, `KVList`, `StatusCard`, `T`, `Touch`, `type Tone`; `validateFunds` (`perpl/funds.ts`, sin cambios); `perpl.addFunds` / `perpl.withdraw`; `perpl.setClockSkewOverride`, `perpl.clockSkewMs` (Task 3).
- Produces: `PerpsFundsScreen(ctx: AppCtx)`. Etiquetas: `segment-add` / `segment-withdraw` (Segmented), `funds-input`, `max`, `review`, `edit-funds`, `confirm`, `back-to-markets`, `tx-hash`. DevControls: chip `dev-clock-2-min` que alterna `setClockSkewOverride(120_000)` / `null`.

- [ ] **Step 1: Reescribir `perpsFunds.tsx`**

```tsx
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Hex } from "viem";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { type FundsMode, validateFunds } from "../perpl/funds";
import { Btn, Card, Chip, KVList, Page, Segmented, StatGrid, StatusCard, T, Tag, Touch, type Tone } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import { describeError } from "../wallet/wallet";

type Step = { step: "edit" } | { step: "review"; amount: bigint } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const TONES = {
  sent: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  unknown: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

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
      { label: "Wallet", value: `${formatAusd(wallet)} AUSD` },
      { label: "Trading · free", value: acc ? `${formatAusd(free)} AUSD` : perpl.lastBalance !== null ? `${formatAusd(perpl.lastBalance)} · last seen` : "—" },
    ]} />
  );

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const title = st.step === "done" ? (mode === "add" ? "Funds added" : "Withdrawn to wallet")
      : st.step === "failed" ? "Transaction reverted"
      : st.step === "unknown" ? "Sent · confirmation not received"
      : "Sent · waiting for confirmation";
    return (
      <Page gap={11}>
        {header}
        <StatusCard tag={st.step.toUpperCase()} title={title} body={st.step === "unknown" && error ? error : undefined} tone={TONES[st.step]}>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }} accessibilityLabel="tx-hash">
            <T w={400} s={10.5} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
          {st.step === "sent" ? <ActivityIndicator color={C.warn} style={{ alignSelf: "flex-start" }} /> : null}
        </StatusCard>
        {st.step !== "sent" ? <Btn label="Back to Markets" onPress={() => nav("markets")} variant="lime" py={14} accessibilityLabel="back-to-markets" /> : null}
      </Page>
    );
  }

  if (st.step === "review") {
    return (
      <Page gap={11}>
        {header}
        <Card bd={C.hair2} bg={C.deep} gap={8}>
          <Tag>{mode === "add" ? "YOU ADD TO TRADING · AUSD" : "YOU WITHDRAW TO WALLET · AUSD"}</Tag>
          <T w={700} s={30} lh={1} ls={-0.02} display>{formatAusd(st.amount)}</T>
          <KVList top rows={[
            { label: "FROM", value: mode === "add" ? "Wallet" : "Trading account" },
            { label: "TO", value: mode === "add" ? "Trading account" : "Wallet" },
            { label: "NETWORK", value: "Monad · gas in MON", fg: C.dim },
          ]} />
        </Card>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Edit" onPress={() => { setError(""); setSt({ step: "edit" }); }} variant="outline" flex={1} disabled={busy} accessibilityLabel="edit-funds" />
          <Btn label={busy ? "Sending…" : mode === "add" ? "Confirm deposit" : "Confirm withdrawal"} onPress={() => { void confirm(); }} variant="lime" flex={1} busy={busy} accessibilityLabel="confirm" />
        </View>
        {mode === "add" ? <T w={400} s={11} lh={1.45} color={C.faint}>If the exchange allowance is too low, Pickler approves it first (one extra transaction).</T> : null}
      </Page>
    );
  }

  return (
    <Page gap={11}>
      {header}
      <Segmented options={[["add", "Add funds"], ["withdraw", "Withdraw"]] as const} value={mode} onChange={(k) => { set({ fundsMode: k }); setAmount(""); }} />
      <Card bd={C.hair2} bg={C.deep} gap={6}>
        <Tag>{mode === "add" ? "AMOUNT TO ADD · AUSD" : "AMOUNT TO WITHDRAW · AUSD"}</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount} onChangeText={setAmount} placeholder="0.00" placeholderTextColor={C.faint} keyboardType="decimal-pad" accessibilityLabel="funds-input"
            style={[textStyle(700, 30, { lh: 1.3, ls: -0.02, display: true, color: C.ink }), { flex: 1, minWidth: 0, paddingVertical: 4 }]}
          />
          <Chip label="Max" onPress={() => setAmount(formatUnits(max, AUSD_DECIMALS))} bd={C.hair22} fg={C.ink} accessibilityLabel="max" />
        </View>
        <T w={400} s={11.5} lh={1.4} color={C.dim}>{mode === "add" ? `Minimum ${formatAusd(minDeposit)} AUSD` : `Minimum ${formatAusd(minWithdraw)} AUSD · only free balance`}</T>
      </Card>
      {!check.ok && amount !== "" ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Btn label="Review" onPress={() => { if (check.ok) setSt({ step: "review", amount: check.amount }); }} arrow py={14} disabled={!check.ok} accessibilityLabel="review" />
      <T w={400} s={11} lh={1.45} color={C.faint}>Gas is paid in MON from this wallet. Locked collateral can't be withdrawn until the position closes.</T>
    </Page>
  );
}
```

- [ ] **Step 2: DevControls — chip "Clock +2 min"**

En `src/DevControls.tsx`, en la fila de SESSION (junto a Lock / Sign out) añade:
```tsx
              <PChip label="Clock +2 min" on={perpl.clockSkewMs !== null && perpl.clockSkewMs >= 120_000} onPress={() => perpl.setClockSkewOverride(perpl.clockSkewMs !== null && perpl.clockSkewMs >= 120_000 ? null : 120_000)} />
```
y en la línea de estado mono (`screen: … · perpl: …`) añade ` · skew: {perpl.clockSkewMs === null ? "—" : `${Math.round(perpl.clockSkewMs / 1000)}s`}` (así la captura del audit muestra el desfase medido de verdad cuando el override está apagado). `PChip` ya genera `accessibilityLabel="dev-clock-2-min"`.

- [ ] **Step 3: `tsc`, tests, residuos, commit**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4 && grep -rn 'primaryBtn\|secondaryBtn\|chipBtn\|w={800}' src/screens || echo NO_LEGACY_IN_SCREENS`
Expected: exit 0; tests sin cambio; `NO_LEGACY_IN_SCREENS`.
```bash
git add src/screens/perpsFunds.tsx src/DevControls.tsx
git commit -m "feat(mobile): Trading funds re-vestido; chip de reloj forzado en DevControls (D15)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rebuild nativo y recorrido completo en el simulador con la cuenta #620

**Files:**
- Verify: `apps/mobile/` completo en el simulador `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`.
- Scratchpad de la sesión: `f2-shots/` (capturas), `f2-flows/` (YAML de Maestro), `rpc-before.txt` / `rpc-after.txt`. **No se versionan.**

**Interfaces:**
- Consumes: todo lo anterior. La app se instala con `npx expo run:ios --device <UDID>`.
- Produces: la evidencia que la Task 9 pega en el audit: capturas numeradas, saldos por RPC antes/después, y la lista de defectos encontrados (cada uno se corrige con su commit `fix(mobile): …` antes de seguir).

Orden obligatorio: RPC → build → gate/Reconnect → ticket → cerrar posición → Funds (sólo pantallas, sin mover) → reloj forzado → held card → RPC de cierre. **Sin faucet, sin retiros externos, sin `enable` con monto.**

- [ ] **Step 1: Saldos por RPC antes de tocar nada**

Script temporal `rpc.mjs` en el scratchpad con el código del proyecto (receta de la lección 7 del audit de F1: `node --experimental-strip-types` + hook de `resolve` que prueba `.ts` / `.tsx` / `/index.ts`):
```js
// rpc.mjs — corre desde apps/mobile del worktree: node --experimental-strip-types --import ./hook.mjs rpc.mjs
import { readBalances } from "./src/wallet/chain";
import { readAccountId } from "./src/perpl/onboarding";
import { formatAusd, formatMon } from "./src/config/chain";
const addr = "0xe3719a93b75Cee42C5a8f3dCe45e5b4B327851C1";
const b = await readBalances(addr);
console.log("RPC", new Date().toISOString());
console.log("addr      ", addr);
console.log("AUSD raw  ", b.ausd, "=> formatAusd", formatAusd(b.ausd));
console.log("MON  raw  ", b.mon, "=> formatMon ", formatMon(b.mon));
console.log("perpl id  ", await readAccountId(addr));
```
```js
// hook.mjs
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (!spec.startsWith(".") || !ctx.parentURL) throw e;
    const base = fileURLToPath(new URL(spec, ctx.parentURL));
    for (const s of [".ts", ".tsx", "/index.ts"]) if (existsSync(base + s)) return next(pathToFileURL(base + s).href, ctx);
    throw e;
  }
}
```
Run: `node --experimental-strip-types --import <scratch>/hook.mjs <scratch>/rpc.mjs | tee <scratch>/rpc-before.txt`
Expected: `perpl id 620`; AUSD y MON impresos. **Anota los tres valores**; si difieren de 29.00 / 0.0718 dilo en el audit. El saldo de trading de #620 no sale por RPC (vive en la API de Perpl): se lee en pantalla tras Reconnect.

- [ ] **Step 2: Build e instalación en el simulador**

Run: `npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 2>&1 | tail -8`
Expected: `› Build Succeeded`, `› Installing on iPhone 17 Pro`, `iOS Bundled …`. Deja Metro corriendo. Si Face ID no está inscrito (se pierde al reiniciar el simulador):
```bash
xcrun simctl spawn 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 notifyutil -p com.apple.BiometricKit.enrollmentChanged
```
Presentar la cara cuando la app la pida: `xcrun simctl spawn 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`.

Captura siempre con `xcrun simctl io 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 screenshot <scratch>/f2-shots/NN-nombre.png` y **mira cada captura** antes de pasar a la siguiente.

- [ ] **Step 3: Gate Reconnect trading (D21)**

Tab MARKETS (`tapOn: id "tab-markets"` o punto 11 %,93 %). Expected: card **Reconnect trading** con "This wallet already has Perpl account #620. Reconnect registers a trading key on this phone; no AUSD moves.", botón lima **Reconnect** y la lista de mercados al 70 %. → `01-reconnect-gate.png`.
Toca `reconnect` → Face ID (`fingerTouch.match`) → pasos: "Allow one-click trading" puede mandar una tx (gas en MON) y "Register trading key" pide la firma. → `02-reconnect-steps.png` durante los pasos. Expected final: Markets real con `TRADING · AUSD`, chip `LIVE`, saldo ≈ 104.87 (anota el valor exacto), "0.00 in positions · X free", fila Add funds / Withdraw to wallet, MARKETS, POSITIONS vacío. → `03-markets-live.png`. Si `Reconnect` falla en el paso 1 con "Enter an amount.", la cuenta no existe on-chain: **para** y repórtalo (P5) — no habilites con monto.

- [ ] **Step 4: Market — pills y ticket (D14, D20)**

Toca `market-MON` (el mercado más barato: 3x máximo, unidad entera). Expected: header "MON Perp / Perpl · isolated margin · market order", pills Ask · **Trade** · Agents con Trade en lima, Long/Short, card `MARGIN · AUSD`, chips `1x 2x 3x` con **1x en lima** (`pill(on)`; cierra el pendiente "pill blanco" de F1), KV NOTIONAL / EST. PRICE / FEE · TAKER / LIQUIDATION ≈, botón "Enter a margin" deshabilitado. → `04-market-trade-empty.png`.
Toca `pill-ask` → `ComingSoonCard` "Ask an agent for a read on this market" → `05-market-ask.png`. `pill-agents` → `06-market-agents.png`. Vuelve a `pill-trade`.
Escribe `2` en `margin-input` (toca fuera para cerrar el teclado; `hideKeyboard` no sirve). Expected: KV con `FEE · TAKER ≈ 0.00XX AUSD` **a 4 decimales** y ≠ "0.0000", botón "Review long · 2.00 AUSD" con flecha. → `07-ticket-filled.png`. Toca `lv-3` → 3x en lima, LIQUIDATION ≈ en `down`, aviso de apalancamiento → `08-ticket-3x.png`; vuelve a `lv-1`.
Toca `review` → card `YOU OPEN · LONG MON · 1X · MARKET`, cifra display "2.00 AUSD", KV, botón lima "Confirm long" (o "Connecting…" deshabilitado si el socket no está live: espera). → `09-review.png`.
Toca `confirm` → `StatusCard` SENT con spinner → `10-sent.png` (si alcanzas); después FILLED con "Filled N MON at P" y detalle "Fee 0.00XX AUSD · LONG 1x" → `11-filled.png`. Anota la fee exacta.
Toca `back-to-markets`. Expected: POSITIONS con la fila LONG, "N MON · 1x", PnL `±0.0X AUSD` (o `+0.00` si es menor que medio centavo), línea `ep → mark · LIQ. EST.`, "X in positions · Y free". → `12-position.png`.

- [ ] **Step 5: Cerrar la posición (D13, P6)**

Toca `close-<pid>` → card `YOU CLOSE · AT MARKET` con `EST. PNL` → `13-close-confirm.png`. Toca `close-position` → FILLED "Closed N MON at P" con "Fee 0.00XX AUSD · realised PnL shows in the trading balance" → `14-closed.png`. `back-to-markets` → POSITIONS vacío y saldo nuevo (anótalo: debe ser el de `03` menos las dos fees ± PnL). → `15-markets-flat.png`.

- [ ] **Step 6: Trading funds (D15) — sólo pantallas**

Toca `add-funds` → StatGrid Wallet / Trading · free, Segmented Add funds | Withdraw, card `AMOUNT TO ADD · AUSD`, Review deshabilitado → `16-funds-add.png`. Escribe `5`, toca fuera, `review` → card `YOU ADD TO TRADING · AUSD` con "5.00", KV FROM/TO/NETWORK, Edit / Confirm deposit → `17-funds-review.png`. **Toca `edit-funds`, no Confirm.** `segment-withdraw` → `18-funds-withdraw.png`. `←` a Markets.

- [ ] **Step 7: Reloj forzado (D19, P4) y copy de key rechazada**

Abre ⚙ (`dev-controls`) → toca `dev-clock-2-min` → cierra. Expected en Markets: `Warn` "Your phone's clock is off by 120 s." con el body de Settings. → `19-clock-warn.png`. Abre ⚙ y mira la línea `skew: 120s`; captura `20-devcontrols-skew.png`; toca el chip otra vez → aviso desaparece y la línea muestra el skew medido real (normalmente entre −2s y 2s). Anota ese valor en el audit: es la primera medición real del desfase del simulador contra Perpl.
El copy nuevo de `keyRejected` no se puede provocar sin una key inválida; queda cubierto por `perpl-clock.test.ts` (`KEY_REJECTED_COPY`) y por lectura del JSX. Dilo así en el audit.

- [ ] **Step 8: Tarjeta "We kept what you were about to do" (pendiente de F1, D18)**

⚙ → `dev-sign-out` (borra cuenta local **y la key de Perpl recién enrolada**; la cuenta #620 y su saldo no se tocan). La app aterriza en Wallet access sin tarjeta. Abre ⚙ → `dev-markets` (requireAccount sin cuenta → signin con `next: markets`). Expected: tarjeta violeta "We kept what you were about to do" + "Trading on Perpl. You come straight back after this step." → `21-signin-held.png`.
Toca `sign-in` ("I already have one") → passkey: elige la **primera** "pickler" de la lista (es `0xe371…51C1`; hay dos) → `fingerTouch.match`. Expected: aterriza en **Markets** (el `next` retenido) con el gate **Reconnect trading** otra vez (la key se borró con el Sign out; #620 sigue existiendo) → `22-after-signin-markets.png`. Vuelve a tocar `reconnect` + Face ID para dejar el simulador con key (así el build 5 se prueba desde un estado útil) → `23-reconnected-again.png`.
Si el passkey no aparece o devuelve otra dirección, **para**: no crees una cuenta nueva. Reporta la lista de passkeys que mostró el sheet.

- [ ] **Step 9: Saldos de cierre y defectos**

Run: el `rpc.mjs` de nuevo → `rpc-after.txt`. Expected: `perpl id 620`; AUSD igual que antes (no se movió AUSD de la wallet); MON menor si `allowOrderForwarding` mandó tx (dos veces si reconectaste dos veces). Compara con `rpc-before.txt` y anota la diferencia.
Lista los defectos vistos en las 23 capturas (textos cortados, colores fuera de spec, botones sin `accessibilityLabel` que tuviste que tocar por punto). Cada uno se corrige ahora con `fix(mobile): …` y su captura de reemplazo; `tsc` + `npm test` en verde antes de la Task 9.

---

### Task 9: README, spec, overview, manifest y audit de F2

**Files:**
- Modify: `apps/mobile/README.md` (párrafo Tests y sección Perpl)
- Modify: `docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` (línea **Estado** y nota P1 en D12)
- Modify: `docs/overview/2026-09-18-mobile-hifi.html` (phase-card F2 → `completed`, tasks marcadas, followups)
- Modify: `docs/overview/data/manifest.js` (fase 2 → `completed`; `status` global sigue `active` hasta el build 5)
- Create: `docs/superpowers/audits/2026-09-18-mobile-hifi-f2-rulings.md`
- Generate: `docs/superpowers/plans/2026-09-18-mobile-hifi-f2.html`, `docs/superpowers/specs/2026-09-18-mobile-hifi-design.html` (`npm run docs:html`)

**Interfaces:**
- Consumes: evidencia de la Task 8 (capturas, `rpc-before/after.txt`, fee exacta, saldo de #620), salida de `npm test` / `tsc`.
- Produces: audit con el formato de `2026-09-18-mobile-hifi-f1-rulings.md` (Qué quedó hecho y verificado · Saldos re-medidos por RPC · Rulings · Correcciones tras la revisión · Lo aprendido · Estado de las cuentas de testnet al cierre · Pendientes · Siguiente punto de decisión).

- [ ] **Step 1: README**

En `apps/mobile/README.md`: sección Tests → el número real (`npm test 2>&1 | tail -4`: suites y tests). Sección "Perpl (pestaña Trade)" → renómbrala "Perpl (tab MARKETS)" y añade tres viñetas: "*Reconnect trading*: sin key pero con cuenta on-chain (`readAccountId > 0`), el gate reconecta con `enable(0n)` — sólo forwarding + key, sin mover AUSD."; "Desfase de reloj: `pub/context` trae el header `Date`; con más de 20 s de diferencia Markets avisa (Perpl rechaza firmas a ±30 s; fue la causa real de los `3401` del iPhone)."; "Fees se muestran con 4 decimales; saldos y montos con 2.". Añade a "Correr en simulador": "Face ID del simulador se pierde al reiniciarlo: `notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 && notifyutil -p com.apple.BiometricKit.enrollmentChanged`; presentar cara con `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`."

- [ ] **Step 2: Spec**

Línea **Estado** → "F1 y F2 ejecutadas (planes `…-f1.md`, `…-f2.md`; audits `…-f1-rulings.md`, `…-f2-rulings.md`); pendiente el build 5 de TestFlight (Task 10 del plan de F2)". En D12, tras "`StatusCard`, `Screen`," añade "(`Screen` se llama **`Page`** en el código desde F2, para no sombrear el tipo `Screen` de D5)". No toques nada más del spec: las decisiones no cambiaron.

- [ ] **Step 3: Overview y manifest**

En `docs/overview/2026-09-18-mobile-hifi.html`, phase-card `data-phase="2"`: `data-status="completed"`, `<option value="completed" selected>`, los 10 `<input type="checkbox" checked>` de las Tasks 0–9 (la Task 10 **no** se marca hasta que el build esté subido), y un `<details class="followups">` con los pendientes reales de la Task 8. En `manifest.js`: `{ num: 2, status: 'completed' }`; `status: 'active'` se queda hasta que el build 5 esté `shipped`.
Run: `npm run docs:html && npm run docs:check && npm run agents:check && node scripts/agent-infra/render-check.mjs <scratch>/render 2026-09-18-mobile-hifi`
Expected: `processed=N skipped=0 errors=0`; `"errors": []`; mira la captura de 390 px (`<scratch>/render/2026-09-18-mobile-hifi-390.png`): status board con F2 en `completed`, sin desbordes.

- [ ] **Step 4: Audit**

Escribe `docs/superpowers/audits/2026-09-18-mobile-hifi-f2-rulings.md` con las secciones del audit de F1. Rulings mínimos a documentar: P1–P8 tal como se aplicaron, cualquier desviación, la lista de passkeys del sheet, si `allowOrderForwarding` mandó tx (MON antes/después). "Estado de las cuentas": simulador con AUSD/MON de `rpc-after.txt`, #620 con el saldo leído en `23-reconnected-again.png`, key de Perpl **presente** (reconectada), KAT e iPhone sin tocar. Pendientes: lo que la Task 8 dejó abierto + "iPhone de Jesús: mismo recorrido con su cuenta real vía TestFlight build 5 (lo hace Jesús)".

- [ ] **Step 5: Revisión independiente y commit**

Pide a un subagente revisor la revisión de la rama completa (`git diff main...HEAD`, el spec, este plan y el audit) antes de commitear las docs; corrige lo que salga (cada fix con su commit). Después:
```bash
git add apps/mobile/README.md docs/superpowers/specs/2026-09-18-mobile-hifi-design.md docs/superpowers/specs/2026-09-18-mobile-hifi-design.html docs/superpowers/plans/2026-09-18-mobile-hifi-f2.md docs/superpowers/plans/2026-09-18-mobile-hifi-f2.html docs/overview/2026-09-18-mobile-hifi.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-18-mobile-hifi-f2-rulings.md
git commit -m "docs(mobile-hifi): F2 completada — README, spec, overview y audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Checkpoint.** Aquí termina el trabajo de código de F2: sin merge, sin push, sin TestFlight. Jesús decide (1) merge a `main` local, (2) push, (3) autorizar el build 5. La Task 10 no empieza sin esa autorización explícita en la sesión.

---

### Task 10: Build 0.1.0 (5) de TestFlight y su tracker (`pickler-dev-new`) — **sólo con autorización explícita de Jesús**

**Files:**
- Modify: `apps/mobile/app.config.ts:26` (`buildNumber: "5"`)
- Create: `docs/overview/dev/<YYYY-MM-DD>-testflight-build5.html` (vía la skill `pickler-dev-new`)
- Modify: `docs/overview/data/manifest.js` (entrada nueva al principio; `status` según evidencia), `docs/overview/2026-09-18-mobile-hifi.html` (marca la Task 10; si Jesús cierra el proyecto, `status` global `completed`)
- Requiere: `apps/mobile/.env.asc` (gitignored) con `ASC_KEY_ID` / `ASC_ISSUER_ID`, `.p8` en `~/.appstoreconnect/private_keys/`, identidad Apple Distribution en el llavero (los tres existen desde el build 4).

**Interfaces:**
- Consumes: rama en el estado que Jesús autorizó (mergeada o no; el archive se hace desde el checkout que él indique). Scripts `npm run ios:archive` y `npm run ios:upload` (sin cambios).
- Produces: `.ipa` 0.1.0 (5), `UPLOAD SUCCEEDED` con Delivery UUID, estado en App Store Connect, tracker `testflight-build5` en el catálogo.

- [ ] **Step 1: Autorización**

Pregunta a Jesús, con la evidencia de la Task 9 a la vista, si autoriza **archive + upload del build 5** y desde qué checkout. Sin un "sí" en esta sesión, la task termina aquí.

- [ ] **Step 2: `buildNumber` y archive**

`app.config.ts`: `buildNumber: "5"`. Run (desde `apps/mobile`): `npm run ios:archive 2>&1 | tail -5`
Expected: `✓ …/build/export/Pickler.ipa`. Comprueba la versión: `unzip -p build/export/Pickler.ipa 'Payload/Pickler.app/Info.plist' | plutil -p - | grep -E 'CFBundleVersion|CFBundleShortVersionString|MinimumOSVersion'` → `"5"`, `"0.1.0"`, `"18.0"`.

- [ ] **Step 3: Upload**

Run: `npm run ios:upload 2>&1 | tail -8`
Expected: `UPLOAD SUCCEEDED` con `Delivery UUID`, y `✓ subida aceptada`. Guarda la salida completa en el scratchpad.

- [ ] **Step 4: Estado en App Store Connect**

Con el helper JWT ES256 de sesiones anteriores (`asc.sh` en el scratchpad; si no existe, recréalo con `openssl` a partir del `.p8`), consulta el id de la app con `GET /v1/apps?filter[bundleId]=fun.pickler.app` y después `GET /v1/builds?filter[app]=<id>&filter[version]=5` y `betaBuildLocalizations`/grupos. Expected: `processingState: VALID` y el grupo interno "Equipo" (`hasAccessToAllBuilds`). Si sigue `PROCESSING`, espera y reintenta; no lo declares `VALID` sin la respuesta.

- [ ] **Step 5: Tracker con `pickler-dev-new`**

Invoca la skill `pickler-dev-new` con: "registra el build 5 de TestFlight" — slug `testflight-build5`, `types: ['feature']`, tags `['mobile','testflight','ios','perpl']`, lede con lo que trae el build (Markets/Market/Funds re-maquetados, Reconnect trading, aviso de reloj, fees a 4 decimales), "Qué cambió" desde el audit de F2, "Archivos tocados" con `git diff --stat main...HEAD`, "Validación" con tests reales, Delivery UUID, estado ASC y grupo. `status`: `shipped` sólo con `VALID` + grupo asignado; si no, `in_progress`. Renderiza y mira la captura de 390 px.

- [ ] **Step 6: Commit y cierre**

```bash
git add apps/mobile/app.config.ts docs/overview/dev/<YYYY-MM-DD>-testflight-build5.html docs/overview/data/manifest.js docs/overview/2026-09-18-mobile-hifi.html
git commit -m "chore(mobile): TestFlight build 0.1.0 (5); tracker testflight-build5

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Añade al audit de F2 una sección "Build 5" con la evidencia (ipa, UUID, estado ASC) y commítala aparte (`docs(mobile-hifi): evidencia del build 5`). Handoff a Jesús: probar en su iPhone el recorrido Reconnect → ticket → cerrar, y mirar si aparece el aviso de reloj.
