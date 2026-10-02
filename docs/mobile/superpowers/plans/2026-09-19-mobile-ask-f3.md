# Ask — F3: Trade con order book L2, «Trade this level» y recordatorios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el pill **Trade** de `Market` cierre el puente con Ask: desde la hoja de una celda o desde la card de una read `open`, «Trade this level» pone el nivel en el store, sugiere el lado y abre Trade con una `LevelCard`; cuando la orden queda `filled` u `open`, la app llama `reminder-set` y el servidor programa dos recordatorios (15 min antes y al vencer). Además Trade muestra el **order book L2 vivo** de Perpl (5 niveles por lado, spread en bps) por el WebSocket público de market-data, con los frames reales grabados a fixture. En el simulador (cuenta #620): una sola orden de prueba de 2.00 AUSD a 1x y su cierre a mano desde Markets.

**Architecture:** Igual que Perpl F2 y Ask F2: módulos puros con test y hooks delgados que los orquestan. **D12** vive en `src/reads/level.ts` (celda/read → `TradeLevel`, lado sugerido, copy), `reads/api.ts` + `reads/types.ts` (cliente y parser de `reminder-set`), `useReads.setReminders` y la UI en `ask.tsx` (dos botones) y `market.tsx` (`LevelCard`, nota en el resultado de la orden). **D11** vive en `src/perpl/marketData.ts` (`parseBookFrame`, `applyBookFrame`, `topLevels`, `spreadBps`, `targetPosition`, clase `MarketDataSocket` calcada de `TradingSocket` pero sin firma ni pings), el hook `useMarketData(marketId, active)` montado en `App.tsx`, y `BookCard` en `src/screens/book.tsx`. El servidor no cambia: `reminder-set` y el envío de recordatorios por `resolve-reads` ya existen desde F1.

**Tech Stack:** Expo SDK 57 / React Native 0.86 (`WebSocket` global de RN, sin paquete nuevo), `expo-notifications` (ya instalado; fallback local D10), jest-expo 57, TypeScript 6. Script de captura en Node 22 (`WebSocket` global, sin `ws`). Servidor: `https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1/reminder-set` (F1). Perpl: `wss://testnet.perpl.xyz/ws/v1/market-data` (doc `PerplFoundation/api-docs` `websocket.md` + `README.md#rate-limits`, último commit 2026-09-02, verificada y sondeada en vivo el 2026-09-21).

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` — **D11** (order book) y **D12** («Trade this level», recordatorios) son el contrato; D13 ya declaró `TradeLevel`/`tradeLevel` y `signedOutState` lo limpia; D14 dejó los dos botones sin renderizar (P9 de F2). Léelo antes de empezar, junto con `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` §4–§6 (estado de cuentas, residuales 12 y 13) y la sección «Navegación» de `apps/mobile/README.md` (la navegación cambió con `mobile-nav`: Market es una ruta de react-navigation; `ctx.nav`/`switchTab`, nunca `navigate` a pelo).

## Global Constraints

- Worktree `.claude/worktrees/mobile-ask-f3`, rama `feat/mobile-ask-f3` desde `main` (`b3378de`). Primer comando dentro: `cd apps/mobile && npm ci`. Todo lo de la app se corre desde `apps/mobile` **del worktree**; los checks de docs desde la raíz del worktree; `node scripts/query.mjs` desde `services/reads` del worktree (`env.mjs` encuentra `.env.pickler` del checkout principal vía `git-common-dir`). Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `chore(mobile): …` / `test(mobile): …` / `docs(mobile-ask): …` con trailer `Co-Authored-By: <modelo que escribe> <noreply@anthropic.com>` y `Claude-Session: <URL de la sesión que ejecuta>`. **Sin push, merge ni TestFlight** en la sesión de ejecución salvo autorización explícita de Jesús en esa sesión.
- **Metro desde el worktree nuevo** (`npx expo start --port 8081` en `apps/mobile` del worktree). El simulador `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0` ya tiene el dev build de `mobile-nav` con sesión iniciada; F3 **no añade módulos nativos**, así que no hace falta `run:ios` (que borraría la cuenta local). Sólo si se quisiera probar el override `PICKLER_PERPL_MARKET_DATA_WS` haría falta `run:ios` (el dev client ignora el env de Metro; lección de `mobile-loading`); este plan no lo necesita: el default es testnet.
- Simulador **siempre por UDID**, nunca `booted`. Capturas con `xcrun simctl io <UDID> screenshot <scratch>/f3-shots/NN-nombre.png` y **mirar cada captura** antes de afirmar nada. `simctl recordVideo` es ~4 fps: sirve para ver que el book cambia entre frames, no para medir animaciones.
- **Cuenta #620 del simulador (`0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1`): una sola orden de prueba** — `Long` o `Short` según el lado sugerido del nivel, **2.00 AUSD a 1x en BTC (`market_id 16`)** — y **su cierre a mano desde Markets** (Task 8). Nada más: ninguna otra orden, ningún Enable/Reconnect/Reset, ningún depósito ni retiro. Saldos AUSD/MON re-medidos por RPC antes y después (receta en Task 8 Step 0) y en el audit.
- **Prerequisito de Jesús (residual 12 del audit F2, riesgo §4 del spec)**: revocar las dos trading keys sobrantes de #620 en `testnet.perpl.xyz/apikeys`. El ejecutor lo **pregunta** al arrancar Task 8 y anota la respuesta en el audit; no bloquea F3 (la key del simulador sigue enrolada y funciona) y ninguna task toca `apikeys`.
- **Backend F1, prohibiciones vigentes** (README de `services/reads`): nunca `supabase db push/reset`, nunca Drizzle, nunca DDL fuera de `mobile`, nunca el MCP de Supabase de la sesión, nunca imprimir secretos ni tokens APNs. Esta fase **no despliega ni migra nada**; sólo `select` sobre `mobile.reminders`/`mobile.devices` y un `update … set fire_at = now() where id = '<id>'` para forzar el envío (Task 8), siempre en dos pasos (capturar `id`, luego `update … where id = …`).
- **Secretos `APNS_*` siguen ausentes** (pendiente 1 del audit F2). `resolve-reads` marca el recordatorio `sent` sólo si APNs responde 200; sin secretos `providerJwt()` lanza «APNS secrets missing» y la fila queda **`failed`** (`resolve-reads/index.ts:100-103`). La verificación de F3 es: dos filas `scheduled` creadas por la app, y tras forzar `fire_at` el cron las **procesa** (`sent_at` puesto, `status` ∈ {sent, failed}, `remindersSent` en `net._http_response`). Ver llegar el push real depende de la key y queda como residual heredado, no de F3.
- `npm test` y `npx tsc --noEmit` en `apps/mobile` en verde al cierre de cada task a partir de la que los toca. Ninguna prueba unitaria abre sockets ni llama al servicio: `WebSocket` se sustituye por `FakeSocket` (como `perpl-socket.test.ts`) y `fetch` por un doble (como `reads-api.test.ts`). El único acceso real a Perpl fuera del simulador es el script de captura (Task 5), público y sin cuenta.
- Copy de la app en inglés; código y comentarios en español donde el archivo vecino los tenga en español; tests en inglés (`test("…")`).
- Límites de market-data (README de Perpl, verificado): **10 requests/min y 16 suscripciones por conexión**; `1008` cierra el socket al pasarse de requests. Este plan gasta **1 request por conexión** (el `mt: 5`) y reconecta con `RECONNECT_DELAYS_MS` (1 s → 30 s): en el peor caso 6 conexiones en el primer minuto. **Nada de `mt: 1`** en market-data (la doc lo dice explícitamente: 20 % del presupuesto para nada).

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | **Orden de ejecución: D12 antes que D11.** Tasks 1–4 dejan «Trade this level» + `LevelCard` + recordatorios completos y probables; Tasks 5–7 añaden captura, socket y `BookCard`. Si en el checkpoint tras Task 4 el tiempo aprieta, F3 se cierra ahí (versión reducida del riesgo §4) sin rehacer nada. | Fijado en el brainstorm del 2026-09-21: el puente Ask → Trade es lo que ve el jurado; el book es lo «vivo» de Trade pero es cortable. |
| P2 | El target del nivel **no se resalta por fila** en el book: `BookCard` muestra una línea mono «Target 85,600.0 · above / inside / below the book» calculada por `targetPosition(book, target)` contra los mejores precios. | El target de la matriz casi nunca coincide con un nivel exacto del L2 (fijado en el brainstorm). |
| P3 | La captura de frames es un **script commiteado** `apps/mobile/scripts/perpl-market-data-capture.mjs` (Node 22, `WebSocket` global, sin `ws`), que graba **todos los frames crudos** de `order-book@16` durante N segundos en `__tests__/fixtures/perpl/market-data-frames.json` (`{ _source, url, stream, capturedAt, frames: [...] }`, un frame por línea). El fixture de trading (`ws-frames.json`) se capturó a mano en Perpl F1 sin dejar script; aquí sí queda. | Reproducible y sin cuenta ni gas (stream público). Los tests del parser prueban lo que Perpl manda de verdad, no lo que creemos que manda. |
| P4 | **`mt: 16` es un delta por nivel de precio**: cada `{ p, s, o }` reemplaza el nivel con ese `p`; `o: 0` (y `s: 0`) lo borra; `mt: 15` reemplaza el libro entero. Tras aplicar, los mejores niveles se obtienen ordenando (`bids` desc, `asks` asc); el libro se guarda en `Map<number, BookLevel>` por lado. Un frame `mt: 15/16` con `sid` distinto al de la suscripción se ignora. | Doc (`websocket.md`: «Update (mt: 16): Same structure. Price levels with `o: 0` should be removed») **y sonda en vivo del 2026-09-21**: el snapshot trae cientos de niveles (mejor primero, incluidos restos lejanos como `p 600000`) y los updates traen sólo los niveles cambiados, con `s: 0, o: 0` para borrar, uno por bloque (~1 s). |
| P5 | **Ciclo de vida del socket**: `useMarketData(marketId, active)` con `active = scr === "market" && S.marketTab === "trade" && perpl.state.status === "ready"` (calculado en `App.tsx` como `perpsActive`/`readsActive`). Cambiar de pill, salir de Market o cambiar de mercado cierra el socket; volver lo reabre (nueva conexión = 1 request). Sin gracia de 2 s (a diferencia de `usePerpl.setActive`): el socket público no tiene sign-in que amortizar. Sin key (gate de Trade) no hay socket: el book viviría detrás de un gate que no lo muestra. | D11 literal («se abre al montar TradeTab, se cierra al desmontar o al cambiar de pill»). |
| P6 | El socket **no reconecta** cuando `mt: 6` responde `code ≠ 0` para nuestro stream (404 `unknown stream`, 429 `too many subscriptions`): pasa a `closed`, emite `{ type: "rejected" }` y `BookCard` muestra `OFFLINE`. Cierre `1001` (servidor se va) reconecta sin espera la primera vez; el resto con `RECONNECT_DELAYS_MS`. | Reintentar un stream rechazado sólo gasta el presupuesto de 10/min. `1001` sin espera es lo que pide la doc. |
| P7 | **Los recordatorios se programan sólo si hay nivel vivo para ese mercado** (`S.tradeLevel.marketId === market.id` y `expiresAt > now`) **y la orden termina `filled` u `open`**. `TradeTab` muestra primero el resultado de la orden y después añade una nota (`note`) a la card `filled`: «Reminders set: 15 min before and at expiry.» / «Reminder set at expiry.» / «Couldn't set reminders — {motivo}». Si se programaron, el nivel se **consume** (`set({ tradeLevel: undefined })`): ya vive en el servidor. `failed`/`unknown` no programan nada. | D12: «El recordatorio se programa sólo si hubo orden». Mostrar la orden primero evita que `reminder-set` (hasta 15 s) retrase el «Filled». |
| P8 | `reminder-set` es firmado: `useReads.setReminders` llama `ensureSession()` (reutiliza la sesión de Ask; con la wallet abierta firma en silencio; si la wallet está bloqueada abriría Face ID) y, con `PUSH_MODE === "apns"`, `ensurePermission()` para mandar `pushToken`/`pushEnv` (misma política de P6 de F2: el permiso se pide la primera vez que algo lo necesita). Si la sesión no queda lista → `{ ok: false, text: "Unlock Ask to set reminders." }`. Con `PUSH_MODE === "local"` (fallback D10) se programan además dos notificaciones locales (`reminder-pre-…`, `reminder-expiry-…`) con copy sin mark. | En la práctica el nivel viene de Ask, que ya exigió sesión (`SessionGate`), así que no habrá prompt; el camino sin sesión existe por si cayó por 401. |
| P9 | `patchForPush` para `kind = "reminder"` **no cambia**: `{ perpsMarketId, marketTab: "trade" }`. El push de recordatorio (`copy.ts` de F1) sólo trae `reminderId`, `marketId`, `readId`; no trae target ni vencimiento, así que no se puede reconstruir un `TradeLevel`. Se corrige el comentario `// F3 añadirá tradeLevel` de `push.ts:34`. | No inventar un nivel a partir de un push que no lo lleva. |
| P10 | `TradeLevel` conserva `levelBps: number` (D13) y `AskCell` también; `levelFromCell` usa `targetFor(market.mark, bps)` y `expiresAtFor(new Date(), horizonMin)` (vista previa con el mark de la app, como la hoja); `levelFromRead` usa `read.target`/`read.expiresAt` del servidor (D2). El lado sugerido es `sideFor(bps) = bps > 0 ? "long" : "short"`. | D12 literal. |
| P11 | `useNow` sale de `ask.tsx` a `src/hooks/useNow.ts` (mismo código) para que `TradeTab` lo use en «Resolves 14:05 · in 3 h 58 m» y en `levelIsLive`. | Un tick de 30 s por pantalla; no duplicar el hook. |
| P12 | `BookCard` va en `src/screens/book.tsx` y `LevelCard` en `market.tsx`; `OrderResult` gana `note?: string` en la variante `filled` (compatible con `markets.tsx`, que también usa `OrderResultCard`). Sin `@testing-library/react-native` (P12 de F2): las pantallas se verifican con `tsc` y en el simulador. | `market.tsx` tiene 205 líneas; el book es un componente con lógica de presentación propia. |
| P13 | Orden en `TradeTab` (paso `edit`): `LevelCard` (si hay nivel vivo) → `Segmented` Long/Short → `BookCard` → margen → apalancamiento → resumen → botón. En `review` se añade la fila `LEVEL` al `KVList` si hay nivel. | El book informa el lado y el precio antes de escribir el margen. |
| P14 | La orden de prueba se hace **con el nivel puesto desde Ask** (para que dispare `reminder-set`) y **con un nivel `open` real** — la read pedida en Task 8 (cuesta 1 crédito simulado) o una celda sin read: `readId` es opcional en `reminder-set`. Se prefiere la celda (sin gastar crédito) salvo que Jesús quiera ver la ruta desde la card. | Verifica D12 completo sin depender del modelo. |
| P15 | **F4 del manifest** («TestFlight build 0.1.0 (6)», ya superado por los builds 6–9): se **retitula** a «TestFlight con F3 (siguiente build tras el merge)» y sigue `pending`, con el mismo entregable (build con Ask + Trade completos, probado en el iPhone de Jesús: una lectura hasta el push y un nivel con recordatorio) y prerequisitos «F3; autorización explícita de Jesús». Se hace en la rama de F3 (Task 9), no en `main`. | Fijado en el brainstorm: el trabajo sigue pendiente; `cancelled` sería falso y dejarla dice «build 6» en cada retomar. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/src/reads/level.ts`, `src/hooks/useNow.ts`, `src/screens/ask.tsx` (sólo mover `useNow`), `__tests__/reads-level.test.ts` | 1 | Celda/read → `TradeLevel`, lado sugerido, vigencia, copy de recordatorios (D12, P10, P11) |
| `apps/mobile/src/reads/types.ts`, `src/reads/api.ts`, `src/reads/push.ts`, `__tests__/reads-types.test.ts`, `__tests__/reads-api.test.ts`, `__tests__/reads-push.test.ts` | 2 | Parser y cliente de `reminder-set`, copy de errores, contenido local del fallback (P8, P9) |
| `apps/mobile/src/hooks/useNotifications.ts`, `src/hooks/useReads.ts` | 3 | `scheduleLocalReminders`, `setReminders` (P7, P8) |
| `apps/mobile/src/screens/ask.tsx`, `src/screens/market.tsx` | 4 | Botones «Trade this level» (hoja y card), `LevelCard`, nota de recordatorios en el resultado (D12, D14, P7, P13) |
| `apps/mobile/scripts/perpl-market-data-capture.mjs`, `__tests__/fixtures/perpl/market-data-frames.json` | 5 | Captura reproducible de frames reales (P3) |
| `apps/mobile/src/perpl/config.ts`, `src/config/perpl.ts`, `app.config.ts`, `src/perpl/marketData.ts`, `__tests__/perpl-config.test.ts`, `__tests__/perpl-market-data.test.ts` | 6 | URL de market-data con override, parser/aplicación del book, `MarketDataSocket` (D11, P4, P6) |
| `apps/mobile/src/hooks/useMarketData.ts`, `src/screens/book.tsx`, `src/ctx.ts`, `App.tsx`, `src/screens/market.tsx` | 7 | Hook del socket, `BookCard`, montaje y línea del target (D11, P2, P5, P13) |
| — (simulador, SQL de lectura, una orden) | 8 | Recorrido completo con capturas, orden de 2.00 AUSD, recordatorios en `mobile.reminders`, cron forzado |
| `apps/mobile/README.md`, `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-19-mobile-ask-f3-rulings.md`, HTML generados | 9 | Docs de cierre, F4 retitulada, audit F3, revisión independiente |

---

### Task 1: `src/reads/level.ts` — del nivel de Ask al `TradeLevel` de Trade

**Files:**
- Create: `apps/mobile/src/reads/level.ts`, `apps/mobile/src/hooks/useNow.ts`, `apps/mobile/__tests__/reads-level.test.ts`
- Modify: `apps/mobile/src/screens/ask.tsx:17-23` (borrar `useNow` local e importarlo)

**Interfaces:**
- Consumes: `TradeLevel`, `AskCell` (`src/store.ts:11-13`); `targetFor`, `expiresAtFor`, `cellLabel`, `formatRemaining` (`src/reads/matrix.ts`); `Read` (`src/reads/types.ts`); `Side` (`src/perpl/orders.ts:5`).
- Produces: `REMINDER_PRE_MS`, `levelFromCell(market, cell, now)`, `levelFromRead(read)`, `sideFor(levelBps)`, `levelIsLive(level, nowMs)`, `resolvesLabel(level, nowMs)`, `levelTitle(symbol, level)`, `reminderKinds(level, nowMs)`, `remindersCopy(kinds)`; `useNow(everyMs)` en `src/hooks/useNow.ts`. Los usan Tasks 3, 4 y 7.

- [ ] **Step 1: Línea base en el worktree**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f3/apps/mobile
git status --short
git log --oneline -1
npm test 2>&1 | tail -4
npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio; HEAD = `b3378de`; `Tests: 244 passed` en 33 suites (el README lo dice; anotar el número real); `TSC-OK`.

- [ ] **Step 2: Mover `useNow` a `src/hooks/useNow.ts`**

Crear `apps/mobile/src/hooks/useNow.ts`:

```ts
import { useEffect, useState } from "react";

/** Tick de `everyMs` para las cuentas regresivas de toda una pantalla (P14 de Ask F2; lo usan Ask y Trade). */
export function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}
```

En `src/screens/ask.tsx` borrar las líneas 17–23 (el comentario `/** Tick de 30 s … */` y la función `useNow`), añadir `import { useNow } from "../hooks/useNow";` junto a los otros imports de hooks, y quitar `useEffect` del import de `react` si ya no se usa en el archivo (`grep -n useEffect src/screens/ask.tsx`).

Run: `npx tsc --noEmit && echo TSC-OK` → `TSC-OK`.

- [ ] **Step 3: Escribir el test que falla**

`apps/mobile/__tests__/reads-level.test.ts`:

```ts
import readJson from "./fixtures/reads/read.json";
import { levelFromCell, levelFromRead, levelIsLive, levelTitle, REMINDER_PRE_MS, reminderKinds, remindersCopy, resolvesLabel, sideFor } from "../src/reads/level";
import { parseRead } from "../src/reads/types";

const NOW = Date.parse("2026-09-22T18:00:00.000Z");
const BTC = { id: 16, mark: 762555 }; // pd 1 (fixture context.json); mismos números que P10 de F2

test("levelFromCell previews target and expiry from the app mark (D2, P10)", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 240 }, new Date(NOW));
  expect(l).toEqual({ marketId: 16, levelBps: 50, horizonMin: 240, target: 766368, expiresAt: "2026-09-22T22:00:00.000Z" });
  expect(l.readId).toBeUndefined();
});

test("levelFromRead takes the server values and the read id", () => {
  const read = parseRead(readJson);
  const l = levelFromRead(read);
  expect(l).toEqual({ marketId: read.marketId, levelBps: read.levelBps, horizonMin: read.horizonMin, target: read.target, expiresAt: read.expiresAt, readId: read.id });
});

test("sideFor suggests long above the mark and short below (D12)", () => {
  expect(sideFor(250)).toBe("long");
  expect(sideFor(50)).toBe("long");
  expect(sideFor(-50)).toBe("short");
  expect(sideFor(-100)).toBe("short");
});

test("levelIsLive is strict on expiry", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 60 }, new Date(NOW));
  expect(levelIsLive(l, NOW)).toBe(true);
  expect(levelIsLive(l, NOW + 60 * 60_000 - 1)).toBe(true);
  expect(levelIsLive(l, NOW + 60 * 60_000)).toBe(false);
});

test("resolvesLabel shows local time and the remaining time", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 240 }, new Date(NOW));
  const d = new Date(l.expiresAt);
  const hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
  expect(resolvesLabel(l, NOW + 2 * 60_000)).toBe(`Resolves ${hh}:${mm} · in 3 h 58 m`);
  expect(resolvesLabel(l, NOW + 240 * 60_000)).toBe(`Resolves ${hh}:${mm} · now`);
});

test("levelTitle is symbol + cell label", () => {
  expect(levelTitle("BTC", levelFromCell(BTC, { levelBps: 100, horizonMin: 240 }, new Date(NOW)))).toBe("BTC +1.0% · 4H");
});

test("reminderKinds mirrors reminder-set: pre only if more than 15 min remain", () => {
  const l = levelFromCell(BTC, { levelBps: 50, horizonMin: 60 }, new Date(NOW));
  expect(REMINDER_PRE_MS).toBe(15 * 60_000);
  expect(reminderKinds(l, NOW)).toEqual(["pre", "expiry"]);
  expect(reminderKinds(l, NOW + 45 * 60_000 - 1)).toEqual(["pre", "expiry"]);
  expect(reminderKinds(l, NOW + 45 * 60_000)).toEqual(["expiry"]);
  expect(remindersCopy(["pre", "expiry"])).toBe("Reminders set: 15 min before and at expiry.");
  expect(remindersCopy(["expiry"])).toBe("Reminder set at expiry.");
});
```

(`reminder-set/index.ts:52`: `if (expiresAt.getTime() - PRE_MS > now) kinds.push({ kind: "pre" … })` — estricto, igual que aquí.)

- [ ] **Step 4: Correr el test para verlo fallar**

Run: `npx jest __tests__/reads-level.test.ts 2>&1 | tail -8`
Expected: FAIL — `Cannot find module '../src/reads/level'`.

- [ ] **Step 5: Implementar `src/reads/level.ts`**

```ts
// «Trade this level» (D12): del nivel de Ask (celda o read) al TradeLevel del store, y lo que Trade muestra de él. Puro.
import type { Side } from "../perpl/orders";
import type { AskCell, TradeLevel } from "../store";
import { cellLabel, expiresAtFor, formatRemaining, targetFor } from "./matrix";
import type { Read } from "./types";

/** Igual que PRE_MS de reminder-set: el recordatorio `pre` sólo existe si faltan más de 15 min. */
export const REMINDER_PRE_MS = 15 * 60_000;

/** Desde la hoja: vista previa con el mark de la app y vencimiento desde `now` (sin read no hay valores del servidor). */
export function levelFromCell(market: { id: number; mark: number }, cell: AskCell, now: Date): TradeLevel {
  return {
    marketId: market.id, levelBps: cell.levelBps, horizonMin: cell.horizonMin,
    target: targetFor(market.mark, cell.levelBps), expiresAt: expiresAtFor(now, cell.horizonMin).toISOString(),
  };
}

/** Desde una read: los valores que decidió el servidor (D2) y el id para ligar los recordatorios. */
export function levelFromRead(read: Read): TradeLevel {
  return { marketId: read.marketId, levelBps: read.levelBps, horizonMin: read.horizonMin, target: read.target, expiresAt: read.expiresAt, readId: read.id };
}

/** Lado sugerido (D12): nivel por encima del mark → long; por debajo → short. */
export const sideFor = (levelBps: number): Side => (levelBps > 0 ? "long" : "short");

export const levelIsLive = (level: TradeLevel, nowMs: number): boolean => Date.parse(level.expiresAt) > nowMs;

/** «Resolves 14:05 · in 3 h 58 m» (hora local, 24 h); vencido: «Resolves 14:05 · now». */
export function resolvesLabel(level: TradeLevel, nowMs: number): string {
  const d = new Date(level.expiresAt);
  const p = (n: number) => String(n).padStart(2, "0");
  const left = d.getTime() - nowMs;
  return `Resolves ${p(d.getHours())}:${p(d.getMinutes())} · ${left <= 0 ? "now" : `in ${formatRemaining(left)}`}`;
}

export const levelTitle = (symbol: string, level: TradeLevel): string => `${symbol} ${cellLabel(level)}`;

export type ReminderKind = "pre" | "expiry";

/** Qué programará reminder-set para este nivel (misma regla que el servidor). */
export const reminderKinds = (level: TradeLevel, nowMs: number): ReminderKind[] =>
  Date.parse(level.expiresAt) - REMINDER_PRE_MS > nowMs ? ["pre", "expiry"] : ["expiry"];

export const remindersCopy = (kinds: readonly ReminderKind[]): string =>
  kinds.length === 2 ? "Reminders set: 15 min before and at expiry." : "Reminder set at expiry.";
```

- [ ] **Step 6: Correr el test y la suite completa**

Run: `npx jest __tests__/reads-level.test.ts 2>&1 | tail -6 && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK`
Expected: 7 tests PASS; suite completa en verde (+1 suite); `TSC-OK`.

- [ ] **Step 7: Commit**

```bash
git add src/reads/level.ts src/hooks/useNow.ts src/screens/ask.tsx __tests__/reads-level.test.ts
git commit -m "feat(mobile): nivel de Ask → TradeLevel (level.ts puro) y useNow compartido"
```

---

### Task 2: cliente de `reminder-set`, parser y contenido local del fallback

**Files:**
- Modify: `apps/mobile/src/reads/types.ts` (final), `apps/mobile/src/reads/api.ts` (`COPY` y una función nueva), `apps/mobile/src/reads/push.ts:31-35` y final
- Test: `apps/mobile/__tests__/reads-types.test.ts`, `__tests__/reads-api.test.ts`, `__tests__/reads-push.test.ts`

**Interfaces:**
- Consumes: `call`, `signedHeaders`, `READS_TIMEOUT_MS` (`api.ts`); `rec`, `str`, `iso`, `fail` (`types.ts`); `TradeLevel`, `cellLabel`; `ReminderKind` (Task 1).
- Produces: `Reminder = { id: string; kind: ReminderKind; fireAt: string }`, `parseRemindersResponse(body): Reminder[]`; `ReminderRequest`, `postReminders(base, session, body, doFetch?): Promise<Reminder[]>`; `localReminderContent(symbol, level, kind)`. Los usa Task 3.

- [ ] **Step 1: Tests que fallan**

Añadir al final de `__tests__/reads-types.test.ts`:

```ts
import { parseRemindersResponse } from "../src/reads/types";

test("parseRemindersResponse accepts the reminder-set shape and rejects unknown kinds", () => {
  const body = { reminders: [
    { id: "0b4b6d1e-4b6d-4c1e-9f2a-6f1c2d3e4f5a", kind: "pre", fireAt: "2026-09-22T21:45:00.000Z" },
    { id: "1c5c7e2f-5c7e-4d2f-8a3b-7a2d3e4f5a6b", kind: "expiry", fireAt: "2026-09-22T22:00:00.000Z" },
  ] };
  expect(parseRemindersResponse(body)).toEqual(body.reminders);
  expect(() => parseRemindersResponse({ reminders: [{ id: "x", kind: "later", fireAt: "2026-09-22T22:00:00.000Z" }] })).toThrow("reminder.kind later is unknown");
  expect(() => parseRemindersResponse({ reminders: [{ id: "x", kind: "pre", fireAt: "yesterday" }] })).toThrow("reminder.fireAt is not a date");
  expect(() => parseRemindersResponse({})).toThrow("response.reminders is not an array");
});
```

(Si el archivo ya importa de `../src/reads/types`, añadir `parseRemindersResponse` a ese import en vez de duplicarlo.)

Añadir al final de `__tests__/reads-api.test.ts` (reutiliza `BASE`, `SESSION`, `fetchOnce`, `ok`, `fail` del archivo):

```ts
import { postReminders } from "../src/reads/api";

const LEVEL_BODY = { marketId: 16, levelBps: 100, horizonMin: 240, target: 766368, expiresAt: "2026-09-22T22:00:00.000Z", side: "long" as const, readId: "1fde46c6-97da-4435-8184-59b5218a771d" };

test("postReminders is a signed POST to reminder-set with the level body (D12)", async () => {
  const rows = [{ id: "0b4b6d1e-4b6d-4c1e-9f2a-6f1c2d3e4f5a", kind: "pre", fireAt: "2026-09-22T21:45:00.000Z" }];
  const { f, calls } = fetchOnce(ok({ reminders: rows }));
  expect(await postReminders(BASE, SESSION, { ...LEVEL_BODY, pushToken: "ab".repeat(32), pushEnv: "sandbox" }, f)).toEqual(rows);
  expect(calls[0].url).toBe(`${BASE}/reminder-set`);
  expect(calls[0].init?.method).toBe("POST");
  const headers = calls[0].init?.headers as Record<string, string>;
  expect(headers["x-pickler-address"]).toBe(SESSION.address);
  expect(headers["content-type"]).toBe("application/json");
  expect(JSON.parse(calls[0].init?.body as string)).toEqual({ ...LEVEL_BODY, pushToken: "ab".repeat(32), pushEnv: "sandbox" });
});

test("reminder-set errors have copy", async () => {
  const { f } = fetchOnce(fail(422, "expired"));
  await expect(postReminders(BASE, SESSION, LEVEL_BODY, f)).rejects.toMatchObject({ status: 422, code: "expired" });
  expect(describeReadsError(new ReadsError(422, "expired"))).toBe("That level already expired.");
  expect(describeReadsError(new ReadsError(404, "read_not_found"))).toBe("That read isn't yours anymore.");
});
```

(`signedHeaders` manda `x-pickler-address`, `x-pickler-ts`, `x-pickler-sig` — `src/reads/session.ts:29-31`.)

Añadir al final de `__tests__/reads-push.test.ts`:

```ts
import { localReminderContent } from "../src/reads/push";

test("localReminderContent (fallback D10) names the level and never claims a mark", () => {
  const level = { marketId: 16, levelBps: 100, horizonMin: 240, target: 766368, expiresAt: "2026-09-22T22:00:00.000Z", readId: "1fde46c6-97da-4435-8184-59b5218a771d" };
  const pre = localReminderContent("BTC", level, "pre");
  expect(pre.title).toBe("BTC +1.0% · 4H");
  expect(pre.body).toBe("Your level resolves in 15 min — check your position on Perpl.");
  expect(pre.data).toEqual({ pickler: { kind: "reminder", reminderId: "local-pre-2026-09-22T22:00:00.000Z", marketId: 16, readId: level.readId } });
  const expiry = localReminderContent("BTC", { ...level, readId: undefined }, "expiry");
  expect(expiry.body).toBe("Your level resolves now — check your position on Perpl.");
  expect(expiry.data).toEqual({ pickler: { kind: "reminder", reminderId: "local-expiry-2026-09-22T22:00:00.000Z", marketId: 16, readId: null } });
  expect(pushTargetOf(pre.data)).toEqual({ kind: "reminder", reminderId: "local-pre-2026-09-22T22:00:00.000Z", marketId: 16, readId: level.readId });
});

test("a reminder push still opens Trade without a level (P9 of F3: the push carries no target)", () => {
  expect(patchForPush({ kind: "reminder", reminderId: "m1", marketId: 16, readId: null })).toEqual({ perpsMarketId: 16, marketTab: "trade" });
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx jest __tests__/reads-types.test.ts __tests__/reads-api.test.ts __tests__/reads-push.test.ts 2>&1 | grep -E "✕|✓|Tests:" | tail -12`
Expected: los nuevos fallan por símbolo inexistente (`parseRemindersResponse`, `postReminders`, `localReminderContent`); los viejos pasan.

- [ ] **Step 3: `types.ts` — `Reminder` y `parseRemindersResponse`**

Añadir al final de `src/reads/types.ts`:

```ts
export type Reminder = { id: string; kind: "pre" | "expiry"; fireAt: string };

/** `{ reminders: [{ id, kind, fireAt }] }` de reminder-set (F1 dto.ts `toReminderDto`). */
export function parseRemindersResponse(body: unknown): Reminder[] {
  const b = rec(body, "response");
  if (!Array.isArray(b.reminders)) fail("response.reminders is not an array");
  return (b.reminders as unknown[]).map((v) => {
    const r = rec(v, "reminder");
    const kind = str(r, "kind", "reminder");
    if (kind !== "pre" && kind !== "expiry") fail(`reminder.kind ${kind} is unknown`);
    return { id: str(r, "id", "reminder"), kind: kind as "pre" | "expiry", fireAt: iso(r, "fireAt", "reminder") };
  });
}
```

- [ ] **Step 4: `api.ts` — `postReminders` y copy**

En `COPY` de `src/reads/api.ts` añadir dos entradas (antes de `timeout`):

```ts
  expired: "That level already expired.",
  read_not_found: "That read isn't yours anymore.",
```

Cambiar el import de tipos: `import { type Agent, parseAgentsList, parseRead, parseReadResponse, parseReadsList, parseRemindersResponse, type Read, type Reminder } from "./types";` y añadir `import type { Side } from "../perpl/orders";`. Al final del archivo:

```ts
export type ReminderRequest = {
  marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; side: Side;
  readId?: string; pushToken?: string; pushEnv?: "sandbox" | "production";
};

/** POST reminder-set (D12): el servidor crea `pre` (si faltan > 15 min) y `expiry` en mobile.reminders. */
export function postReminders(base: string, session: ReadsSession, body: ReminderRequest, doFetch: DoFetch = fetch): Promise<Reminder[]> {
  return call(`${base}/reminder-set`, {
    method: "POST", headers: { ...signedHeaders(session), "content-type": "application/json" }, body: JSON.stringify(body),
  }, READS_TIMEOUT_MS, doFetch).then(parseRemindersResponse);
}
```

- [ ] **Step 5: `push.ts` — comentario de P9 y `localReminderContent`**

En `src/reads/push.ts` cambiar la línea 34:

```ts
    : { perpsMarketId: t.marketId, marketTab: "trade" }; // el push de recordatorio no trae target ni vencimiento: Trade se abre sin LevelCard (F3, P9)
```

Añadir `import type { Patch, TradeLevel } from "../store";` (sustituyendo el import de `Patch`) y al final:

```ts
/** Fallback D10 para recordatorios (PUSH_MODE === "local"): sin mark (la app no lo sabe al programarla). */
export function localReminderContent(symbol: string, level: TradeLevel, kind: "pre" | "expiry"): { title: string; body: string; data: Record<string, unknown> } {
  return {
    title: `${symbol} ${cellLabel(level)}`,
    body: kind === "pre" ? "Your level resolves in 15 min — check your position on Perpl." : "Your level resolves now — check your position on Perpl.",
    data: { pickler: { kind: "reminder", reminderId: `local-${kind}-${level.expiresAt}`, marketId: level.marketId, readId: level.readId ?? null } },
  };
}
```

- [ ] **Step 6: Verde**

Run: `npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK`
Expected: todo en verde; `TSC-OK`.

- [ ] **Step 7: Commit**

```bash
git add src/reads/types.ts src/reads/api.ts src/reads/push.ts __tests__/reads-types.test.ts __tests__/reads-api.test.ts __tests__/reads-push.test.ts
git commit -m "feat(mobile): cliente de reminder-set, parser de recordatorios y contenido local del fallback"
```

---

### Task 3: `useNotifications.scheduleLocalReminders` y `useReads.setReminders`

**Files:**
- Modify: `apps/mobile/src/hooks/useNotifications.ts` (tipo `Notifications`, una función), `apps/mobile/src/hooks/useReads.ts` (tipo `Reads`, una función)

**Interfaces:**
- Consumes: `postReminders`, `Reminder` (Task 2); `reminderKinds`, `REMINDER_PRE_MS`, `ReminderKind` (Task 1); `localReminderContent` (Task 2); `PUSH_MODE`, `ensureSession`, `ensurePermission`, `dropSession`, `isSessionError`, `describeReadsError` (ya en `useReads`).
- Produces: `Notifications.scheduleLocalReminders(symbol, level)`; `Reads.setReminders(symbol, level, side): Promise<RemindersOutcome>` con `RemindersOutcome = { ok: true; kinds: ReminderKind[] } | { ok: false; text: string }`. Lo usa Task 4.

- [ ] **Step 1: `useNotifications.ts`**

En el tipo `Notifications` añadir tras `scheduleLocal`:

```ts
  /** Fallback D10 para «Trade this level» (PUSH_MODE === "local"): `pre` (si faltan > 15 min) y `expiry`, sin mark. */
  scheduleLocalReminders: (symbol: string, level: TradeLevel) => Promise<void>;
```

Imports: `import type { TradeLevel } from "../store";`, `import { REMINDER_PRE_MS, reminderKinds } from "../reads/level";` y `localReminderContent` junto a `localResolutionContent` en el import de `../reads/push`. Debajo de `scheduleLocal`:

```ts
  const scheduleLocalReminders = useCallback(async (symbol: string, level: TradeLevel) => {
    const now = Date.now();
    const expiry = Date.parse(level.expiresAt);
    for (const kind of reminderKinds(level, now)) {
      const date = new Date(kind === "pre" ? expiry - REMINDER_PRE_MS : expiry);
      if (date.getTime() <= now) continue;
      await Notif.scheduleNotificationAsync({
        identifier: `reminder-${kind}-${level.marketId}-${level.expiresAt}`,
        content: localReminderContent(symbol, level, kind),
        trigger: { type: Notif.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }, []);
```

y devolverla: `return { device, permission, ensurePermission, scheduleLocal, scheduleLocalReminders };`.

- [ ] **Step 2: `useReads.ts`**

Imports nuevos: `import { postReminders } from "../reads/api";` (añadir a la línea existente de `../reads/api`), `import type { ReminderKind } from "../reads/level";`, `import type { Side } from "../perpl/orders";`, `import type { AskCell, TradeLevel } from "../store";`.

Tipo, después de `RequestState`:

```ts
export type RemindersOutcome = { ok: true; kinds: ReminderKind[] } | { ok: false; text: string };
```

En `Reads`, tras `resetRequest`:

```ts
  /** «Trade this level» tras una orden filled/open (D12, P7–P8): reminder-set con el nivel y el lado; local además con PUSH_MODE local. */
  setReminders: (symbol: string, level: TradeLevel, side: Side) => Promise<RemindersOutcome>;
```

Destructurar también `scheduleLocalReminders` de `notifications` (línea `const { ensurePermission, scheduleLocal } = notifications;`). Después de `resetRequest`:

```ts
  const setReminders = useCallback(async (symbol: string, level: TradeLevel, side: Side): Promise<RemindersOutcome> => {
    if (!(await ensureSession())) return { ok: false, text: "Unlock Ask to set reminders." };
    const s = sessionRef.current!;
    const device = PUSH_MODE === "apns" ? await ensurePermission() : null; // misma política que ask(): el permiso se pide cuando algo lo necesita (P6 de F2)
    try {
      const rows = await postReminders(READS_URL, s, {
        marketId: level.marketId, levelBps: level.levelBps, horizonMin: level.horizonMin, target: level.target, expiresAt: level.expiresAt, side,
        ...(level.readId ? { readId: level.readId } : {}),
        ...(device ? { pushToken: device.token, pushEnv: device.env } : {}),
      });
      if (PUSH_MODE === "local") void scheduleLocalReminders(symbol, level);
      return { ok: true, kinds: rows.map((r) => r.kind) };
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      return { ok: false, text: describeReadsError(e) };
    }
  }, [ensureSession, ensurePermission, scheduleLocalReminders, dropSession]);
```

Añadir `setReminders` al objeto devuelto.

- [ ] **Step 3: Verde**

Run: `npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4`
Expected: `TSC-OK`; tests sin cambios (los hooks no tienen test; su lógica con reglas está en `level.ts`/`api.ts`, P12 de F2).

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useNotifications.ts src/hooks/useReads.ts
git commit -m "feat(mobile): useReads.setReminders (reminder-set) y recordatorios locales del fallback"
```

---

### Task 4: «Trade this level» en Ask, `LevelCard` y nota de recordatorios en Trade

**Files:**
- Modify: `apps/mobile/src/screens/ask.tsx` (`AskSheet` props y botón; footers de las dos `ReadCard`; `AskTab`), `apps/mobile/src/screens/market.tsx` (`OrderResult`, `OrderResultCard`, `LevelCard`, `TradeTab`)

**Interfaces:**
- Consumes: `levelFromCell`, `levelFromRead`, `sideFor`, `levelIsLive`, `resolvesLabel`, `levelTitle`, `reminderKinds`, `remindersCopy` (Task 1); `useNow` (Task 1); `reads.setReminders` (Task 3); `TradeLevel`, `set`, `S.tradeLevel`, `S.askCell` (store).
- Produces: en `market.tsx`, `OrderResult` filled con `note?: string`; `LevelCard({ symbol, level, pd, now, onRemove })` (privado). Task 7 vuelve a tocar `TradeTab` para insertar `BookCard`.

- [ ] **Step 1: `ask.tsx` — hoja y cards**

Imports: `import { levelFromCell, levelFromRead, sideFor } from "../reads/level";` y `import type { AskCell, TradeLevel } from "../store";` (ampliando el existente).

`AskSheet`: añadir la prop `onTrade: () => void` a la firma y al tipo; debajo del `View` con «Ask … · 1 credit» / «Clear» (antes del texto «Nothing charged yet.») insertar:

```tsx
      <Btn label="Trade this level" onPress={onTrade} variant="outline" fg={C.lime} bd={C.limeBd} py={11} accessibilityLabel="trade-level" />
```

`AskTab`: después de `const focused = …` añadir

```tsx
  // D12: el nivel al store, lado sugerido y pill Trade. El resultado/lista de Ask se conservan (volver atrás no pierde nada).
  const tradeLevel = (level: TradeLevel) => set({ tradeLevel: level, perpsSide: sideFor(level.levelBps), marketTab: "trade" });
```

y un helper para el footer de las cards (sólo con la read `open`: una read resuelta no tiene futuro que operar):

```tsx
  const cardFooter = (read: Read, ghost: ReactNode) => (
    <View style={{ flexDirection: "row", gap: 7 }}>
      {read.status === "open" ? <Btn label="Trade this level" onPress={() => tradeLevel(levelFromRead(read))} variant="outline" fg={C.lime} bd={C.limeBd} flex={1} py={11} accessibilityLabel="trade-level" /> : null}
      {ghost}
    </View>
  );
```

Usar `cardFooter` en las dos `ReadCard`:
- `request.step === "done"`: `footer={cardFooter(request.read, <Btn label="Ask another" onPress={() => { reads.resetRequest(); set({ askCell: undefined }); }} variant="ghost" py={11} accessibilityLabel="ask-another" />)}`
- `focused` en My reads: `footer={cardFooter(focused, <Btn label="Back to list" onPress={() => set({ askFocusReadId: undefined })} variant="ghost" py={11} accessibilityLabel="read-back" />)}`

Y en el `<AskSheet …>` añadir `onTrade={() => tradeLevel(levelFromCell(market, S.askCell!, new Date()))}`.

- [ ] **Step 2: `market.tsx` — `OrderResult.note`, `LevelCard`, `TradeTab`**

`OrderResult`: `| { step: "filled"; title: string; detail: string; note?: string }`. En `OrderResultCard`, dentro del `StatusCard`, tras el spinner:

```tsx
        {result.step === "filled" && result.note ? <T w={400} s={11.5} lh={1.4} color={C.dim} accessibilityLabel="order-note">{result.note}</T> : null}
```

Imports nuevos: `import { useNow } from "../hooks/useNow";`, `import { levelIsLive, levelTitle, reminderKinds, remindersCopy, resolvesLabel, sideFor } from "../reads/level";`, `import { cellLabel } from "../reads/matrix";`, `import type { TradeLevel } from "../store";`.

`LevelCard`, antes de `TradeTab`:

```tsx
const LEVEL: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

/** Nivel elegido en Ask (D12): target, vencimiento, lado sugerido y qué pasará tras la orden. Nada cierra la posición. */
function LevelCard({ symbol, level, pd, now, onRemove }: { symbol: string; level: TradeLevel; pd: number; now: number; onRemove: () => void }) {
  const side = sideFor(level.levelBps);
  const two = reminderKinds(level, now).length === 2;
  return (
    <Card bd={LEVEL.bd} bg={LEVEL.bg} gap={8}>
      <Tag color={LEVEL.fg}>TRADE THIS LEVEL · FROM ASK</Tag>
      <T w={700} s={16} lh={1.2} ls={-0.01} display accessibilityLabel="level-title">{levelTitle(symbol, level)} → {formatPrice(level.target, pd)}</T>
      <KVList rows={[
        { label: "TARGET", value: formatPrice(level.target, pd) },
        { label: "RESOLVES", value: resolvesLabel(level, now) },
        { label: "SUGGESTED", value: side.toUpperCase(), fg: side === "long" ? C.lime : C.down },
      ]} top />
      <T w={400} s={11} lh={1.45} color={C.dim}>{`Once your order fills: a reminder ${two ? "15 min before and one at expiry" : "at expiry"}. Nothing closes the position for you — close it from Markets.`}</T>
      <Btn label="Remove level" onPress={onRemove} variant="ghost" py={8} accessibilityLabel="level-remove" />
    </Card>
  );
}
```

`TradeTab`: firma `function TradeTab({ S, set, perpl, reads, nav }: AppCtx)`. Tras `const [st, setSt] = …`:

```tsx
  const now = useNow(30_000);
  // Sólo el nivel de este mercado y todavía vivo; uno de otro mercado se conserva en el store pero no se pinta ni programa nada.
  const level = S.tradeLevel && S.tradeLevel.marketId === market.id && levelIsLive(S.tradeLevel, now) ? S.tradeLevel : undefined;
```

(Los hooks van antes del `if (perpl.state.status !== "ready") return <TradeGate …/>` — `useNow` debe ir junto a los `useState`, no después del `return` condicional.)

`confirm` pasa a:

```tsx
  const confirm = async () => {
    setSt({ step: "result", result: { step: "sent" } });
    const outcome = await perpl.open(market, side, units ?? 0n, lvUsed);
    const result: OrderResult =
      outcome.kind === "filled" ? { step: "filled", title: `Filled ${formatSize(outcome.order.fs, market.sizeDecimals)} ${sym} at ${formatPrice(outcome.order.fp, market.priceDecimals)}`, detail: `Fee ${formatAusd(outcome.order.f, 4)} AUSD · ${side.toUpperCase()} ${lvUsed}x` }
      : outcome.kind === "open" ? { step: "filled", title: "Placed — waiting in the book", detail: `${formatSize(outcome.order.os, market.sizeDecimals)} ${sym}` }
      : outcome.kind === "failed" ? { step: "failed", text: outcome.text }
      : { step: "unknown" };
    setSt({ step: "result", result });
    // D12 / P7: con nivel vivo y orden filled u open, recordatorios; primero se muestra la orden, la nota llega después.
    if (result.step === "filled" && level) {
      const r = await reads.setReminders(sym, level, side);
      setSt({ step: "result", result: { ...result, note: r.ok ? remindersCopy(r.kinds) : `Couldn't set reminders — ${r.text}` } });
      if (r.ok) set({ tradeLevel: undefined }); // el nivel se consumió: vive en mobile.reminders
    }
  };
```

En `review`, la fila del nivel: `const rows: KVRow[] = [ …existentes…, ...(level ? [{ label: "LEVEL", value: `${cellLabel(level)} → ${formatPrice(level.target, market.priceDecimals)}`, fg: C.lime }] : []) ];` (añadir al array `rows` existente, que también usa el paso `edit`).

En el `return` del paso `edit`, antes del `<Segmented …>`:

```tsx
      {level ? <LevelCard symbol={sym} level={level} pd={market.priceDecimals} now={now} onRemove={() => set({ tradeLevel: undefined })} /> : null}
```

- [ ] **Step 3: Verde y humo rápido en el simulador**

Run: `npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4`
Expected: `TSC-OK`; tests en verde.

Metro desde el worktree (`npx expo start --port 8081`, en segundo plano, log a `<scratch>/metro.log`); `xcrun simctl launch 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 fun.pickler.app`. Markets → BTC → Ask → tocar una celda → «Trade this level» (`trade-level`): Trade se abre con la `LevelCard` y el `Segmented` en el lado sugerido. Captura `<scratch>/f3-shots/04-levelcard.png` y mirarla. «Remove level» la quita. **No confirmar ninguna orden en esta task.**

- [ ] **Step 4: Commit**

```bash
git add src/screens/ask.tsx src/screens/market.tsx
git commit -m "feat(mobile): «Trade this level» desde la hoja y la card, LevelCard en Trade y recordatorios tras la orden (D12)"
```

**Checkpoint D12** (P1): aquí F3 ya es entregable en su versión reducida. El ejecutor lo anota en el handoff y **continúa con Task 5** salvo que Jesús haya dicho otra cosa en la sesión.

---

### Task 5: script de captura y fixture `market-data-frames.json`

**Files:**
- Create: `apps/mobile/scripts/perpl-market-data-capture.mjs`, `apps/mobile/__tests__/fixtures/perpl/market-data-frames.json`

**Interfaces:**
- Produces: fixture `{ _source: string; url: string; stream: string; capturedAt: string; frames: unknown[] }` con al menos un `mt: 6`, un `mt: 15` y varios `mt: 16`. Lo consume Task 6.

- [ ] **Step 1: Escribir el script**

`apps/mobile/scripts/perpl-market-data-capture.mjs`:

```js
#!/usr/bin/env node
// Graba frames crudos de `order-book@<market>` del WebSocket público de market-data de Perpl (spec D11, plan F3 P3).
// Uso: node scripts/perpl-market-data-capture.mjs [--market 16] [--seconds 20] [--url wss://testnet.perpl.xyz/ws/v1/market-data] [--out __tests__/fixtures/perpl/market-data-frames.json]
// Node ≥ 22 (WebSocket global). Sin cuenta, sin firma, sin gas: datos públicos. Gasta 1 de los 10 requests/min de la conexión.
import { writeFileSync } from "node:fs";

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : process.argv[i + 1]; };
const market = Number(arg("market", "16"));
const seconds = Number(arg("seconds", "20"));
const url = arg("url", "wss://testnet.perpl.xyz/ws/v1/market-data");
const out = arg("out", "__tests__/fixtures/perpl/market-data-frames.json");
const stream = `order-book@${market}`;
if (typeof WebSocket === "undefined") { console.error("Node 22+ required (global WebSocket)"); process.exit(1); }

const frames = [];
const ws = new WebSocket(url);
ws.onopen = () => ws.send(JSON.stringify({ mt: 5, subs: [{ stream, subscribe: true }] }));
ws.onmessage = (ev) => { try { frames.push(JSON.parse(String(ev.data))); } catch { console.error("non-JSON frame ignored"); } };
ws.onclose = (ev) => { if (ev.code !== 1000 && ev.code !== 1005) console.error(`closed ${ev.code} ${ev.reason}`); };
ws.onerror = () => {};

setTimeout(() => {
  ws.close();
  const counts = {};
  for (const f of frames) counts[f.mt] = (counts[f.mt] ?? 0) + 1;
  const capturedAt = new Date().toISOString();
  const head = { _source: `Capturado contra ${url} (${stream}) el ${capturedAt} durante ${seconds} s con scripts/perpl-market-data-capture.mjs. Datos públicos, sin cuenta.`, url, stream, capturedAt };
  const body = frames.map((f) => "    " + JSON.stringify(f)).join(",\n");
  writeFileSync(out, JSON.stringify(head, null, 2).replace(/\n}$/, ",\n  \"frames\": [\n" + body + "\n  ]\n}\n"));
  console.log(`${frames.length} frames → ${out}`, counts);
  if (!counts[15] || !counts[16]) { console.error("missing snapshot (mt 15) or update (mt 16): run longer (--seconds 60)"); process.exit(2); }
}, seconds * 1000);
```

- [ ] **Step 2: Correrlo**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f3/apps/mobile
node --version   # v22.x
node scripts/perpl-market-data-capture.mjs --market 16 --seconds 20
node -e "const f=require('./__tests__/fixtures/perpl/market-data-frames.json');const c={};for(const x of f.frames)c[x.mt]=(c[x.mt]??0)+1;console.log(c, f.frames.find(x=>x.mt===6));const s=f.frames.find(x=>x.mt===15);console.log('snapshot', s.sid, s.bid.length, s.ask.length, s.bid[0], s.ask[0]);const u=f.frames.filter(x=>x.mt===16);console.log('updates', u.length, 'deletes', u.flatMap(x=>[...(x.bid||[]),...(x.ask||[])]).filter(l=>l.o===0).length)"
ls -la __tests__/fixtures/perpl/market-data-frames.json
```
Expected: `{ '6': 1, '15': 1, '16': N }` con N ≥ 3 (la sonda del 2026-09-21 dio 2 updates en 15 s en horario tranquilo; si sale `exit 2`, repetir con `--seconds 60`); `mt: 6` con `status.code 0` y `sid` (fue `1000016`); snapshot con `bid[0].p > bid[1].p` y `ask[0].p < ask[1].p`; **al menos un nivel con `o: 0` en los updates** (si en 60 s no aparece ninguno, repetir una vez más; anotar en el audit si no se consiguió — el test de borrado tiene además un caso sintético). Tamaño razonable (< 200 KB); si el snapshot trae miles de niveles y pasa de eso, se acepta igual: es la verdad del testnet.

- [ ] **Step 3: Commit**

```bash
git add scripts/perpl-market-data-capture.mjs __tests__/fixtures/perpl/market-data-frames.json
git commit -m "test(mobile): script de captura y frames reales de order-book@16 (market-data, Perpl testnet)"
```

---

### Task 6: `src/perpl/marketData.ts` — parser, libro y `MarketDataSocket`

**Files:**
- Modify: `apps/mobile/src/perpl/config.ts:6` (tras `PERPL_WS`), `apps/mobile/src/config/perpl.ts`, `apps/mobile/app.config.ts:8` y `extra`
- Create: `apps/mobile/src/perpl/marketData.ts`, `apps/mobile/__tests__/perpl-market-data.test.ts`
- Test: `apps/mobile/__tests__/perpl-config.test.ts`

**Interfaces:**
- Consumes: `RECONNECT_DELAYS_MS` (`config.ts`), `SocketStatus`, `WebSocketLike` (`ws.ts`), fixture de Task 5.
- Produces: `PERPL_MARKET_DATA_WS`, `BOOK_DEPTH = 5`; `PERPL_URLS.marketData`; `BookLevel`, `Book`, `EMPTY_BOOK`, `BookFrame`, `parseBookFrame(data)`, `applyBookFrame(book, frame)`, `topLevels(book, side, n?)`, `bestPrices(book)`, `spreadBps(book)`, `TargetPosition`, `targetPosition(book, target)`, `subscribeFrame(marketId)`, `MarketDataEvent`, `MarketDataOptions`, clase `MarketDataSocket` (`connect()`, `close()`, `status`, `book`). Los usa Task 7.

- [ ] **Step 1: Config y test de config**

`src/perpl/config.ts`, después de `PERPL_WS`:

```ts
export const PERPL_MARKET_DATA_WS = "wss://testnet.perpl.xyz/ws/v1/market-data"; // público, sin firma ni pings (D11)
```

y junto a `LEVERAGES`:

```ts
/** Niveles por lado que muestra BookCard (D11). */
export const BOOK_DEPTH = 5;
```

`src/config/perpl.ts`:

```ts
import Constants from "expo-constants";
import { PERPL_MARKET_DATA_WS, PERPL_REST, PERPL_WS } from "../perpl/config";

const extra = Constants.expoConfig?.extra ?? {};
const rest = typeof extra.perplRest === "string" && extra.perplRest !== "" ? extra.perplRest : PERPL_REST;
const ws = typeof extra.perplWs === "string" && extra.perplWs !== "" ? extra.perplWs : PERPL_WS;
const marketData = typeof extra.perplMarketDataWs === "string" && extra.perplMarketDataWs !== "" ? extra.perplMarketDataWs : PERPL_MARKET_DATA_WS;

/** URLs de Perpl con override desde app.config.ts (mainnet después). */
export const PERPL_URLS = { rest, ws, marketData } as const;
```

`app.config.ts`: tras `const perplWs = …` añadir `const perplMarketDataWs = process.env.PICKLER_PERPL_MARKET_DATA_WS ?? "";` y en `extra`: `{ rpId, monadscanKey, perplRest, perplWs, perplMarketDataWs, readsUrl }`.

En `__tests__/perpl-config.test.ts` añadir `PERPL_MARKET_DATA_WS` y `BOOK_DEPTH` al import y:

```ts
test("market-data is the public socket next to trading, five levels per side", () => {
  expect(PERPL_MARKET_DATA_WS).toBe("wss://testnet.perpl.xyz/ws/v1/market-data");
  expect(BOOK_DEPTH).toBe(5);
});
```

Run: `npx jest __tests__/perpl-config.test.ts 2>&1 | tail -4` → PASS tras el cambio (antes: `undefined`).

- [ ] **Step 2: Escribir el test del módulo (falla)**

`apps/mobile/__tests__/perpl-market-data.test.ts`:

```ts
import fixture from "./fixtures/perpl/market-data-frames.json";
import { RECONNECT_DELAYS_MS } from "../src/perpl/config";
import {
  applyBookFrame, bestPrices, type Book, type BookFrame, EMPTY_BOOK, MarketDataSocket, type MarketDataEvent, parseBookFrame, spreadBps, subscribeFrame, targetPosition, topLevels,
} from "../src/perpl/marketData";
import type { WebSocketLike } from "../src/perpl/ws";

const raw = fixture.frames as Record<string, unknown>[];
const json = (f: unknown) => JSON.stringify(f);
const SUB = raw.find((f) => f.mt === 6)!;
const SNAP = raw.find((f) => f.mt === 15)!;
const UPDATES = raw.filter((f) => f.mt === 16);
const SID = (SUB.subs as { sid: number }[])[0].sid;

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
  receive(f: unknown) { this.onmessage?.({ data: json(f) }); }
  drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: "" }); }
}

function boot(marketId = 16) {
  const fakes: FakeSocket[] = [];
  const events: MarketDataEvent[] = [];
  const socket = new MarketDataSocket({ url: "wss://x.test/md", marketId, onEvent: (e) => events.push(e), createSocket: () => { const f = new FakeSocket(); fakes.push(f); return f; } });
  socket.connect();
  fakes[0].open();
  return { socket, fakes, events, fake: fakes[0] };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

// --- parser -----------------------------------------------------------------

test("the fixture has the three shapes D11 relies on", () => {
  expect(fixture.stream).toBe("order-book@16");
  expect(UPDATES.length).toBeGreaterThanOrEqual(1);
  expect((SUB.subs as { status: { code: number } }[])[0].status.code).toBe(0);
});

test("parseBookFrame reads mt 6, 15 and 16 from the real frames and ignores the rest", () => {
  const sub = parseBookFrame(json(SUB));
  expect(sub).toEqual({ mt: 6, subs: [{ stream: "order-book@16", sid: SID, code: 0 }] });
  const snap = parseBookFrame(json(SNAP)) as Extract<BookFrame, { mt: 15 }>;
  expect(snap.mt).toBe(15);
  expect(snap.sid).toBe(SID);
  expect(snap.at).toBe((SNAP.at as { t: number }).t);
  expect(snap.bid.length).toBe((SNAP.bid as unknown[]).length);
  expect(snap.ask[0]).toEqual((SNAP.ask as unknown[])[0]);
  const upd = parseBookFrame(json(UPDATES[0])) as Extract<BookFrame, { mt: 16 }>;
  expect(upd.mt).toBe(16);
  expect(upd.sid).toBe(SID);
  expect(parseBookFrame(json({ mt: 2 }))).toBeNull();
  expect(parseBookFrame(json({ mt: 15, sid: 1, bid: [{ p: "x" }], ask: [] }))).toBeNull();
  expect(parseBookFrame(json({ mt: 16, sid: 1, bid: [{ p: 1, s: 2, o: 1 }] }))).toEqual({ mt: 16, sid: 1, at: null, bid: [{ p: 1, s: 2, o: 1 }], ask: [] });
  expect(parseBookFrame("nope")).toBeNull();
  expect(parseBookFrame(42)).toBeNull();
});

test("parseBookFrame keeps per-subscription failures (404/429) with their error", () => {
  expect(parseBookFrame(json({ mt: 6, subs: [{ stream: "order-book@999", status: { code: 404, error: "unknown stream" } }] })))
    .toEqual({ mt: 6, subs: [{ stream: "order-book@999", code: 404, error: "unknown stream" }] });
});

// --- libro ------------------------------------------------------------------

const snapFrame = parseBookFrame(json(SNAP))!;

test("a snapshot replaces the book and keeps best prices first after sorting", () => {
  const book = applyBookFrame(EMPTY_BOOK, snapFrame);
  expect(book).not.toBe(EMPTY_BOOK);
  expect(EMPTY_BOOK.bids.size).toBe(0);
  expect(book.bids.size).toBe(new Set((SNAP.bid as { p: number }[]).map((l) => l.p)).size);
  expect(topLevels(book, "bid", 1)[0].p).toBe((SNAP.bid as { p: number }[])[0].p);
  expect(topLevels(book, "ask", 1)[0].p).toBe((SNAP.ask as { p: number }[])[0].p);
  const bids = topLevels(book, "bid");
  expect(bids.length).toBeLessThanOrEqual(5);
  for (let i = 1; i < bids.length; i++) expect(bids[i].p).toBeLessThan(bids[i - 1].p);
  const asks = topLevels(book, "ask");
  for (let i = 1; i < asks.length; i++) expect(asks[i].p).toBeGreaterThan(asks[i - 1].p);
});

test("updates are deltas per price level: o 0 removes, anything else upserts (P4, real frames)", () => {
  let book = applyBookFrame(EMPTY_BOOK, snapFrame);
  for (const u of UPDATES) book = applyBookFrame(book, parseBookFrame(json(u))!);
  const last = parseBookFrame(json(UPDATES[UPDATES.length - 1])) as Extract<BookFrame, { mt: 16 }>;
  for (const l of last.bid) expect(book.bids.get(l.p)).toEqual(l.o === 0 ? undefined : l);
  for (const l of last.ask) expect(book.asks.get(l.p)).toEqual(l.o === 0 ? undefined : l);
  expect(book.at).toBe(last.at ?? book.at);
});

test("updates are deltas per price level (synthetic: remove, replace, add, unchanged side)", () => {
  const base = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: 100, bid: [{ p: 1000, s: 5, o: 1 }, { p: 990, s: 7, o: 2 }], ask: [{ p: 1010, s: 3, o: 1 }] });
  const next = applyBookFrame(base, { mt: 16, sid: 1, at: 101, bid: [{ p: 1000, s: 0, o: 0 }, { p: 995, s: 4, o: 1 }], ask: [{ p: 1010, s: 9, o: 3 }] });
  expect([...next.bids.keys()].sort()).toEqual([990, 995]);
  expect(next.asks.get(1010)).toEqual({ p: 1010, s: 9, o: 3 });
  expect(next.at).toBe(101);
  expect(base.bids.get(1000)).toEqual({ p: 1000, s: 5, o: 1 }); // el anterior no se muta
  expect(applyBookFrame(next, { mt: 6, subs: [] })).toBe(next);
});

test("bestPrices, spreadBps and targetPosition", () => {
  const book: Book = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: null, bid: [{ p: 100_000, s: 1, o: 1 }, { p: 99_990, s: 1, o: 1 }], ask: [{ p: 100_010, s: 1, o: 1 }, { p: 100_020, s: 1, o: 1 }] });
  expect(bestPrices(book)).toEqual({ bid: 100_000, ask: 100_010 });
  expect(spreadBps(book)).toBeCloseTo(0.99995, 4);
  expect(targetPosition(book, 100_500)).toBe("above");
  expect(targetPosition(book, 99_000)).toBe("below");
  expect(targetPosition(book, 100_005)).toBe("inside");
  expect(targetPosition(book, 100_000)).toBe("inside");
  expect(targetPosition(book, 100_010)).toBe("inside");
  expect(bestPrices(EMPTY_BOOK)).toEqual({ bid: null, ask: null });
  expect(spreadBps(EMPTY_BOOK)).toBeNull();
  expect(targetPosition(EMPTY_BOOK, 1)).toBeNull();
  const crossed = applyBookFrame(EMPTY_BOOK, { mt: 15, sid: 1, at: null, bid: [{ p: 101, s: 1, o: 1 }], ask: [{ p: 100, s: 1, o: 1 }] });
  expect(spreadBps(crossed)).toBeLessThan(0); // testnet cruza a veces: se muestra tal cual
});

// --- socket -----------------------------------------------------------------

test("the first (and only) frame is the subscription; the snapshot makes it live; no pings ever", () => {
  const { socket, fake, events } = boot();
  expect(fake.sent).toEqual([subscribeFrame(16)]);
  expect(JSON.parse(subscribeFrame(16))).toEqual({ mt: 5, subs: [{ stream: "order-book@16", subscribe: true }] });
  fake.receive(SUB);
  expect(socket.status).toBe("connecting");
  fake.receive(SNAP);
  expect(socket.status).toBe("live");
  expect(topLevels(socket.book, "bid", 1)[0].p).toBe((SNAP.bid as { p: number }[])[0].p);
  jest.advanceTimersByTime(60_000);
  expect(fake.sent.length).toBe(1);
  expect(events.filter((e) => e.type === "status").map((e) => (e as { status: string }).status)).toEqual(["connecting", "live"]);
  expect(events.filter((e) => e.type === "book").length).toBe(1);
});

test("frames from another subscription id are ignored", () => {
  const { socket, fake } = boot();
  fake.receive(SUB);
  fake.receive({ ...SNAP, sid: SID + 1 });
  expect(socket.status).toBe("connecting");
  expect(socket.book.bids.size).toBe(0);
});

test("a rejected stream closes without reconnecting (P6)", () => {
  const { socket, fake, fakes, events } = boot(999);
  fake.receive({ mt: 6, subs: [{ stream: "order-book@999", status: { code: 404, error: "unknown stream" } }] });
  expect(socket.status).toBe("closed");
  expect(fake.closed).toBe(true);
  expect(events).toContainEqual({ type: "rejected", code: 404, error: "unknown stream" });
  jest.advanceTimersByTime(120_000);
  expect(fakes.length).toBe(1);
});

test("a dropped socket reconnects with backoff and resubscribes; the old book stays until the new snapshot", () => {
  const { socket, fake, fakes } = boot();
  fake.receive(SUB);
  fake.receive(SNAP);
  fake.drop();
  expect(socket.status).toBe("reconnecting");
  expect(socket.book.bids.size).toBeGreaterThan(0);
  jest.advanceTimersByTime(RECONNECT_DELAYS_MS[0] - 1);
  expect(fakes.length).toBe(1);
  jest.advanceTimersByTime(1);
  expect(fakes.length).toBe(2);
  fakes[1].open();
  expect(fakes[1].sent).toEqual([subscribeFrame(16)]);
  fakes[1].drop();
  jest.advanceTimersByTime(RECONNECT_DELAYS_MS[1]);
  expect(fakes.length).toBe(3);
  fakes[2].open();
  fakes[2].receive(SUB);
  fakes[2].receive(SNAP);
  expect(socket.status).toBe("live");
});

test("1001 (server going away) reconnects immediately the first time", () => {
  const { fake, fakes } = boot();
  fake.drop(1001);
  expect(fakes.length).toBe(1); // la reconexión sigue pasando por el timer (delay 0), nunca inline en onclose
  jest.advanceTimersByTime(1);
  expect(fakes.length).toBe(2);
});

test("close() by the user never reconnects", () => {
  const { socket, fake, fakes } = boot();
  socket.close();
  expect(fake.closed).toBe(true);
  expect(socket.status).toBe("closed");
  jest.advanceTimersByTime(120_000);
  expect(fakes.length).toBe(1);
});
```

Run: `npx jest __tests__/perpl-market-data.test.ts 2>&1 | tail -5` → FAIL `Cannot find module '../src/perpl/marketData'`.

- [ ] **Step 3: Implementar `src/perpl/marketData.ts`**

```ts
// Order book L2 del WebSocket público de market-data de Perpl (D11). Puro: sin react-native.
// Formas verificadas contra la doc (PerplFoundation/api-docs websocket.md, commit 2026-09-02) y frames reales
// (__tests__/fixtures/perpl/market-data-frames.json): mt 15 reemplaza el libro; mt 16 es un delta por nivel de
// precio y `o: 0` borra el nivel (P4 del plan F3). Sin pings: el servidor mantiene vivo el socket por bloque.
import { BOOK_DEPTH, RECONNECT_DELAYS_MS } from "./config";
import type { SocketStatus, WebSocketLike } from "./ws";

export type BookLevel = { p: number; s: number; o: number };
/** Niveles por precio y lado; `at` = timestamp de bloque (ms) del último frame aplicado. */
export type Book = { at: number | null; bids: Map<number, BookLevel>; asks: Map<number, BookLevel> };
export const EMPTY_BOOK: Book = { at: null, bids: new Map(), asks: new Map() };

export type BookFrame =
  | { mt: 6; subs: { stream: string; sid?: number; code: number; error?: string }[] }
  | { mt: 15; sid: number; at: number | null; bid: BookLevel[]; ask: BookLevel[] }
  | { mt: 16; sid: number; at: number | null; bid: BookLevel[]; ask: BookLevel[] };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === "object";
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function level(v: unknown): BookLevel | undefined {
  if (!isRec(v)) return undefined;
  const p = num(v.p), s = num(v.s), o = num(v.o);
  return p === undefined || s === undefined || o === undefined ? undefined : { p, s, o };
}

/** Lado ausente = sin cambios en ese lado. */
function levels(v: unknown): BookLevel[] | undefined {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return undefined;
  const out: BookLevel[] = [];
  for (const x of v) {
    const l = level(x);
    if (l === undefined) return undefined;
    out.push(l);
  }
  return out;
}

/** `ev.data` del WebSocket. null para frames ajenos o malformados (se ignoran). */
export function parseBookFrame(data: unknown): BookFrame | null {
  if (typeof data !== "string") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRec(raw)) return null;
  switch (raw.mt) {
    case 6: {
      if (!Array.isArray(raw.subs)) return null;
      const subs: { stream: string; sid?: number; code: number; error?: string }[] = [];
      for (const s of raw.subs) {
        if (!isRec(s) || typeof s.stream !== "string") return null;
        const status = isRec(s.status) ? s.status : {};
        const sid = num(s.sid);
        subs.push({ stream: s.stream, code: num(status.code) ?? 0, ...(sid === undefined ? {} : { sid }), ...(typeof status.error === "string" ? { error: status.error } : {}) });
      }
      return { mt: 6, subs };
    }
    case 15: case 16: {
      const sid = num(raw.sid);
      const bid = levels(raw.bid), ask = levels(raw.ask);
      if (sid === undefined || bid === undefined || ask === undefined) return null;
      const at = isRec(raw.at) ? (num(raw.at.t) ?? null) : null;
      return { mt: raw.mt, sid, at, bid, ask };
    }
    default: return null;
  }
}

function merge(side: Map<number, BookLevel>, changes: BookLevel[], replace: boolean): Map<number, BookLevel> {
  const next = replace ? new Map<number, BookLevel>() : new Map(side);
  for (const l of changes) {
    if (l.o === 0 || l.s === 0) next.delete(l.p);
    else next.set(l.p, l);
  }
  return next;
}

/** Nuevo libro; nunca muta el anterior. 15 reemplaza; 16 mezcla por precio y borra con `o: 0`; 6 no lo toca. */
export function applyBookFrame(book: Book, frame: BookFrame): Book {
  if (frame.mt === 6) return book;
  const replace = frame.mt === 15;
  return { at: frame.at ?? book.at, bids: merge(book.bids, frame.bid, replace), asks: merge(book.asks, frame.ask, replace) };
}

/** Mejores `n` niveles: bids de mayor a menor precio, asks de menor a mayor. */
export function topLevels(book: Book, side: "bid" | "ask", n = BOOK_DEPTH): BookLevel[] {
  const all = [...(side === "bid" ? book.bids : book.asks).values()];
  all.sort((a, b) => (side === "bid" ? b.p - a.p : a.p - b.p));
  return all.slice(0, n);
}

export function bestPrices(book: Book): { bid: number | null; ask: number | null } {
  return { bid: topLevels(book, "bid", 1)[0]?.p ?? null, ask: topLevels(book, "ask", 1)[0]?.p ?? null };
}

/** Spread en bps sobre el mid; null sin uno de los lados. Negativo si el libro está cruzado (pasa en testnet: se muestra tal cual). */
export function spreadBps(book: Book): number | null {
  const { bid, ask } = bestPrices(book);
  if (bid === null || ask === null) return null;
  return ((ask - bid) / ((ask + bid) / 2)) * 10_000;
}

export type TargetPosition = "above" | "inside" | "below";

/** Dónde cae el target de «Trade this level» respecto a los mejores precios (P2: una línea de texto, no resaltado por nivel). */
export function targetPosition(book: Book, target: number): TargetPosition | null {
  const { bid, ask } = bestPrices(book);
  if (bid === null || ask === null) return null;
  return target > ask ? "above" : target < bid ? "below" : "inside";
}

/** Un `mt: 5` con una sola suscripción: 1 request de los 10/min de la conexión. */
export const subscribeFrame = (marketId: number): string => JSON.stringify({ mt: 5, subs: [{ stream: `order-book@${marketId}`, subscribe: true }] });

export type MarketDataEvent =
  | { type: "status"; status: SocketStatus }
  | { type: "book"; book: Book }
  | { type: "rejected"; code: number; error: string };
export type MarketDataOptions = { url: string; marketId: number; onEvent: (e: MarketDataEvent) => void; createSocket?: (url: string) => WebSocketLike };

const GOING_AWAY = 1001;

/** Un socket por ticket visible con una sola suscripción (D11). Sin React: se prueba con un WebSocket falso y timers falsos. */
export class MarketDataSocket {
  private ws: WebSocketLike | null = null;
  private _status: SocketStatus = "closed";
  private _book: Book = EMPTY_BOOK;
  private sid: number | null = null;
  private attempt = 0;
  private closedByUser = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly createSocket: (url: string) => WebSocketLike;

  constructor(private readonly opts: MarketDataOptions) {
    this.createSocket = opts.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
  }

  get status(): SocketStatus { return this._status; }
  get book(): Book { return this._book; }

  connect(): void {
    this.closedByUser = false;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    if (this.ws) {
      const old = this.ws;
      this.ws = null; // primero: que su onclose no dispare otra reconexión
      old.close();
    }
    this.sid = null;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    const ws = this.createSocket(this.opts.url);
    this.ws = ws;
    ws.onopen = () => { ws.send(subscribeFrame(this.opts.marketId)); };
    ws.onmessage = (ev) => { if (this.ws === ws) this.handle(ev.data); };
    ws.onerror = () => { /* onclose sigue */ };
    ws.onclose = (ev) => { if (this.ws === ws) this.handleClose(ev.code); };
  }

  close(): void {
    this.closedByUser = true;
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus("closed");
  }

  private handle(data: unknown): void {
    const frame = parseBookFrame(data);
    if (frame === null) return;
    if (frame.mt === 6) {
      const sub = frame.subs.find((s) => s.stream === `order-book@${this.opts.marketId}`);
      if (!sub) return;
      if (sub.code !== 0 || sub.sid === undefined) {
        // 404 unknown stream / 429 too many subscriptions: reintentar sólo gastaría el presupuesto (P6).
        this.closedByUser = true;
        const ws = this.ws;
        this.ws = null;
        ws?.close();
        this.setStatus("closed");
        this.opts.onEvent({ type: "rejected", code: sub.code, error: sub.error ?? "" });
        return;
      }
      this.sid = sub.sid;
      return;
    }
    if (this.sid !== null && frame.sid !== this.sid) return; // otra suscripción: no debería haber, se ignora
    this._book = applyBookFrame(this._book, frame);
    if (frame.mt === 15) {
      this.attempt = 0;
      this.setStatus("live");
    }
    this.opts.onEvent({ type: "book", book: this._book });
  }

  private handleClose(code: number): void {
    this.ws = null;
    if (this.closedByUser) return;
    this.setStatus("reconnecting");
    // 1001 = el servidor se va: la doc pide reconectar sin espera (sólo la primera vez, por si insiste).
    const delay = code === GOING_AWAY && this.attempt === 0 ? 0 : RECONNECT_DELAYS_MS[Math.min(this.attempt, RECONNECT_DELAYS_MS.length - 1)];
    this.attempt += 1;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }

  private setStatus(status: SocketStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.opts.onEvent({ type: "status", status });
  }
}
```

- [ ] **Step 4: Verde**

Run: `npx jest __tests__/perpl-market-data.test.ts 2>&1 | tail -6 && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK`
Expected: 13 tests PASS; suite completa en verde; `TSC-OK`. Si el test «updates are deltas … (real frames)» encuentra un `at` `null` en algún update real, es dato del testnet: el test ya lo cubre con `last.at ?? book.at`.

- [ ] **Step 5: Commit**

```bash
git add src/perpl/config.ts src/config/perpl.ts app.config.ts src/perpl/marketData.ts __tests__/perpl-config.test.ts __tests__/perpl-market-data.test.ts
git commit -m "feat(mobile): MarketDataSocket y libro L2 puro (parseBookFrame/applyBookFrame) contra frames reales (D11)"
```

---

### Task 7: `useMarketData`, `BookCard` y montaje en Trade

**Files:**
- Create: `apps/mobile/src/hooks/useMarketData.ts`, `apps/mobile/src/screens/book.tsx`
- Modify: `apps/mobile/src/ctx.ts`, `apps/mobile/App.tsx:40-75`, `apps/mobile/src/screens/market.tsx` (`TradeTab`)

**Interfaces:**
- Consumes: `MarketDataSocket`, `Book`, `topLevels`, `spreadBps`, `targetPosition`, `BOOK_DEPTH` (Task 6); `PERPL_URLS.marketData`; `formatPrice`, `formatSize`; `Bar`, `Card`, `Skeleton`, `T`, `Tag`; `level` de `TradeTab` (Task 4).
- Produces: `MarketData = { status: SocketStatus | "idle"; book: Book | null; rejected: boolean }`, `useMarketData(marketId, active)`; `BookCard({ market, data, target? })`; `AppCtx.marketData`.

- [ ] **Step 1: Hook**

`src/hooks/useMarketData.ts`:

```ts
import { useEffect, useState } from "react";
import { PERPL_URLS } from "../config/perpl";
import { type Book, MarketDataSocket } from "../perpl/marketData";
import type { SocketStatus } from "../perpl/ws";

export type MarketData = {
  /** `idle` = sin socket (Trade no visible o sin key); el resto es el estado del socket. */
  status: SocketStatus | "idle";
  /** null hasta el primer snapshot; tras una caída conserva el último libro hasta el snapshot nuevo. */
  book: Book | null;
  /** El stream fue rechazado (404/429): no se reintenta (P6). */
  rejected: boolean;
};

const IDLE: MarketData = { status: "idle", book: null, rejected: false };

/** Order book del mercado visible en Trade (D11, P5): un socket por ticket, abierto sólo con `active`; cambiar de mercado lo recrea. */
export function useMarketData(marketId: number | undefined, active: boolean): MarketData {
  const [data, setData] = useState<MarketData>(IDLE);
  useEffect(() => {
    if (!active || marketId === undefined) { setData(IDLE); return; }
    const socket = new MarketDataSocket({
      url: PERPL_URLS.marketData, marketId,
      onEvent: (e) => setData((d) => e.type === "status" ? { ...d, status: e.status } : e.type === "book" ? { ...d, book: e.book } : { ...d, rejected: true }),
    });
    setData({ status: "connecting", book: null, rejected: false });
    socket.connect();
    return () => { socket.close(); };
  }, [marketId, active]);
  return data;
}
```

- [ ] **Step 2: `BookCard`**

`src/screens/book.tsx`:

```tsx
import { View } from "react-native";
import type { MarketData } from "../hooks/useMarketData";
import { BOOK_DEPTH } from "../perpl/config";
import type { Market } from "../perpl/context";
import { type BookLevel, spreadBps, targetPosition, topLevels } from "../perpl/marketData";
import { formatPrice, formatSize } from "../perpl/orders";
import { Bar, Card, Skeleton, T, Tag } from "../ui/primitives";
import { C } from "../ui/theme";

const STATUS_LABEL: Record<MarketData["status"], string> = { idle: "", connecting: "CONNECTING", live: "LIVE", reconnecting: "RECONNECTING", closed: "OFFLINE" };
const POSITION_COPY = { above: "above the book", inside: "inside the book", below: "below the book" } as const;

function Row({ level, max, side, pd, sd }: { level: BookLevel; max: number; side: "bid" | "ask"; pd: number; sd: number }) {
  const fg = side === "bid" ? C.lime : C.down;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }} accessibilityLabel={`${side}-${level.p}`}>
      <T w={500} s={11} lh={1.2} mono color={fg} style={{ width: 84 }}>{formatPrice(level.p, pd)}</T>
      <Bar pct={max > 0 ? level.s / max : 0} h={4} color={side === "bid" ? C.limeBd : C.downBd} />
      <T w={400} s={10.5} lh={1.2} mono color={C.dim} style={{ width: 76, textAlign: "right" }}>{formatSize(level.s, sd)}</T>
    </View>
  );
}

/** Order book L2 (D11): 5 asks (el mejor pegado al spread), spread en bps, 5 bids; línea del target si hay nivel (P2). */
export function BookCard({ market, data, target }: { market: Market; data: MarketData; target?: number }) {
  const { book } = data;
  const pd = market.priceDecimals, sd = market.sizeDecimals;
  const asks = book ? topLevels(book, "ask").reverse() : [];
  const bids = book ? topLevels(book, "bid") : [];
  const max = Math.max(0, ...asks.map((l) => l.s), ...bids.map((l) => l.s));
  const spread = book ? spreadBps(book) : null;
  const pos = book && target !== undefined ? targetPosition(book, target) : null;
  const live = data.status === "live";
  return (
    <Card bd={C.hair14} bg={C.card} gap={7}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Tag>ORDER BOOK · L2 · {BOOK_DEPTH} PER SIDE</Tag>
        <Tag color={live ? C.lime : data.rejected || data.status === "closed" ? C.faint : C.warn}>{STATUS_LABEL[data.status]}</Tag>
      </View>
      {book === null ? (
        <View style={{ gap: 6 }}>{Array.from({ length: 4 }, (_, i) => <Skeleton.Line key={i} s={11} w="100%" />)}</View>
      ) : (
        <View style={{ gap: 4 }} accessibilityLabel="book">
          {asks.map((l) => <Row key={`a${l.p}`} level={l} max={max} side="ask" pd={pd} sd={sd} />)}
          <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.hair12 }}>
            <T w={500} s={10} lh={1.2} mono color={C.faint}>SPREAD</T>
            <T w={500} s={10} lh={1.2} mono color={C.dim} accessibilityLabel="spread">{spread === null ? "—" : `${spread.toFixed(1)} bps`}</T>
          </View>
          {bids.map((l) => <Row key={`b${l.p}`} level={l} max={max} side="bid" pd={pd} sd={sd} />)}
        </View>
      )}
      {target !== undefined ? (
        <T w={500} s={10.5} lh={1.4} mono color={C.faint} accessibilityLabel="book-target">Target {formatPrice(target, pd)} · {pos === null ? "book not loaded" : POSITION_COPY[pos]}</T>
      ) : null}
      {data.rejected ? <T w={400} s={11} lh={1.4} color={C.faint}>Perpl doesn't publish a book for this market right now.</T> : null}
    </Card>
  );
}
```

- [ ] **Step 3: `ctx.ts` y `App.tsx`**

`src/ctx.ts`: importar `import type { MarketData } from "./hooks/useMarketData";` y añadir `marketData: MarketData;` al tipo `AppCtx` (tras `perpl`).

`App.tsx`: `import { useMarketData } from "./src/hooks/useMarketData";`. Tras `const readsActive = …` (línea 72):

```ts
  // Order book (D11, P5): sólo con Trade visible y trading key (sin key, el gate no muestra el book).
  const bookActive = scr === "market" && store.S.marketTab === "trade" && perpl.state.status === "ready";
  const marketData = useMarketData(store.S.perpsMarketId, bookActive);
```

y en `ctx`: `{ ...store, account, treasury, perpl, marketData, reads, notifications, onWallet, lock, signOut, seal, setControls }`.

(`useMarketData` es un hook: debe llamarse **antes** del `if (!ready …) return null;`, como los demás.)

- [ ] **Step 4: `TradeTab` monta `BookCard`**

`market.tsx`: `import { BookCard } from "./book";`; firma `function TradeTab({ S, set, perpl, reads, marketData, nav }: AppCtx)`. En el paso `edit`, justo después del `<Segmented …/>` de Long/Short:

```tsx
      <BookCard market={market} data={marketData} target={level?.target} />
```

- [ ] **Step 5: Verde y simulador**

Run: `npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4`
Expected: `TSC-OK`; tests en verde.

Simulador (Metro del worktree vivo): Markets → BTC → Trade. Capturas y comprobaciones, mirando cada una:
1. `07-book-live.png`: `BookCard` con `LIVE`, 5 asks arriba (rojo/rosa, precio menor abajo), `SPREAD n.n bps`, 5 bids abajo (lima, precio mayor arriba). Anotar el spread y el mejor bid/ask.
2. Esperar 10 s, `07b-book-later.png`: al menos un tamaño o precio cambió (frames por bloque). Si nada cambió en 30 s, anotar (testnet tranquilo) y comprobar en el log de Metro que llegan eventos (añadir temporalmente `console.log` no: usar `recordVideo` de 20 s y comparar dos frames).
3. Pill Ask → Trade: en `metro.log` no debe haber errores; en la app el book vuelve a `CONNECTING` → `LIVE` (nuevo socket). Captura `07c-book-reopened.png`.
4. Con un nivel puesto desde Ask (`trade-level`): línea `Target … · above the book` (nivel +) o `below the book` (nivel −). Captura `07d-book-target.png`.
5. Sin key no se puede probar el gate aquí (la key está); se verifica por código que `bookActive` exige `ready`.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useMarketData.ts src/screens/book.tsx src/ctx.ts App.tsx src/screens/market.tsx
git commit -m "feat(mobile): BookCard con el order book L2 vivo en Trade (useMarketData, un socket por ticket)"
```

---

### Task 8: Recorrido en el simulador — nivel, orden de 2.00 AUSD, recordatorios y cron

**Files:** ninguno del repo (capturas en `<scratch>/f3-shots/`, notas para el audit). SQL sólo con `node scripts/query.mjs` desde `services/reads` del worktree.

**Interfaces:**
- Consumes: todo lo anterior; cuenta #620; `mobile.reminders`, `mobile.devices`, `net._http_response`.
- Produces: evidencia para el audit (Task 9): ids de recordatorios, tick del cron, saldos antes/después, capturas.

- [ ] **Step 0: Preguntar por las keys, medir saldos, estado inicial**

Preguntar a Jesús: «¿Revocaste las dos trading keys sobrantes de #620 en `testnet.perpl.xyz/apikeys`?» y anotar la respuesta literal (no bloquea).

Saldos por RPC (viem ya instalado en `apps/mobile`):

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f3/apps/mobile
node -e '
const { createPublicClient, http, parseAbi, formatUnits } = require("viem");
const c = createPublicClient({ transport: http("https://testnet-rpc.monad.xyz") });
const A = "0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1";
(async () => {
  const ausd = await c.readContract({ address: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC", abi: parseAbi(["function balanceOf(address) view returns (uint256)"]), functionName: "balanceOf", args: [A] });
  const mon = await c.getBalance({ address: A });
  console.log("RPC", new Date().toISOString(), "AUSD", formatUnits(ausd, 6), "MON", formatUnits(mon, 18));
})();'
```
Expected: ~`AUSD 29.00` (audit nav F2) y `MON 0.0551`; anotar los reales. Además en la app, Wallet → «AUSD in trading» (saldo de la cuenta Perpl) → captura `08a-wallet-before.png`.

Recordatorios existentes:

```bash
cd ../../services/reads
node scripts/query.mjs "select count(*) as reminders, count(*) filter (where status = 'scheduled') as scheduled from mobile.reminders where address = '0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1'"
node scripts/query.mjs "select length(token) as token_len, env, updated_at from mobile.devices where address = '0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1'"
```
Expected: `0 · 0` (F2 no creó recordatorios); un device `sandbox` con `token_len 160`. **No imprimir el token.**

- [ ] **Step 1: Nivel desde Ask (celda, sin gastar crédito) y lado sugerido**

Markets → BTC → Ask → tocar la celda **+0.5 % · 1H** (`levelBps 50`, `horizonMin 60`: vence en 1 h, así el recordatorio `pre` cae a 45 min y el `expiry` a 60 — los dos se fuerzan por SQL, no se esperan). Captura `08b-sheet.png` (hoja con «Trade this level»). Tocar `trade-level` → Trade con `LevelCard` («BTC +0.5% · 1H → <target>», «Resolves HH:MM · in 59 m», «SUGGESTED LONG»), `Segmented` en **Long**, `BookCard` con «Target … · above the book». Captura `08c-trade-level.png`.

(Si Jesús prefiere la ruta desde una read real, pedir una lectura en esa celda —1 crédito— y usar «Trade this level» de la `ReadCard`: el `readId` viajará a `reminder-set`. Anotar cuál se usó.)

- [ ] **Step 2: La orden (única autorizada)**

Margen `2.00` AUSD, apalancamiento `1x` (chip `lv-1`), `Review` → captura `08d-review.png` (fila `LEVEL` visible, `YOU OPEN · LONG BTC · 1X · MARKET`, fee estimada). **`Confirm long`** una sola vez. Esperar el resultado:
- `Filled … BTC at …` + `Fee … AUSD · LONG 1x` → y a los pocos segundos la nota `order-note`: **«Reminders set: 15 min before and at expiry.»** Captura `08e-filled-note.png`.
- Si la nota dice «Couldn't set reminders — …», anotar el texto y seguir (la orden ya existe; el diagnóstico va al audit).
- Si el resultado es `failed`/`unknown`, **no reintentar**: anotar y pasar a Step 4.

Volver a Trade (pill Trade): la `LevelCard` **ya no está** (nivel consumido). Captura `08f-level-consumed.png`.

- [ ] **Step 3: Recordatorios en la base y cron forzado**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f3/services/reads
node scripts/query.mjs "select id, kind, side, level_bps, horizon_min, target, fire_at, status, read_id from mobile.reminders where address = '0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1' order by fire_at"
```
Expected: **dos filas** `scheduled`, `kind pre` con `fire_at = expiry − 15 min` y `kind expiry`, `side long`, `level_bps 50`, `horizon_min 60`, `market_id 16`, `read_id null` (o el id de la read si se usó la card). Anotar los dos `id`.

Forzar **sólo el `pre`** primero, en dos pasos (id ya capturado):

```bash
node scripts/query.mjs "update mobile.reminders set fire_at = now() where id = '<id-pre>' and status = 'scheduled'"
sleep 75
node scripts/query.mjs "select id, kind, status, sent_at from mobile.reminders where id in ('<id-pre>', '<id-expiry>')"
node scripts/query.mjs "select id, status_code, content::text from net._http_response order by id desc limit 3"
```
Expected: el `pre` con `sent_at` puesto y `status` **`failed`** (sin secretos APNs: `providerJwt()` lanza) o **`sent`** (si Jesús ya cargó la key); el `expiry` sigue `scheduled`; el tick más reciente del cron con `{"refunded":0,"resolved":0,"voided":0,"remindersSent":N,"pushSent":0}` donde `N = 1` sólo si hubo `sent`. Si `sent`: mirar el simulador — debe llegar el push «BTC +0.5% · 1H … mark …» y tocarlo abre Market → Trade (`patchForPush`, P9); captura `08g-push.png`. Repetir con `<id-expiry>` y anotar. **No dejar filas `scheduled` con `fire_at` forzado sin procesar.**

- [ ] **Step 4: Cerrar la posición desde Markets y re-medir**

Markets → fila de BTC → posición → **Close** → `Closed`. Captura `08h-closed.png`. Wallet: «AUSD in trading» después. Repetir el `node -e` de saldos por RPC del Step 0 y la consulta de `mobile.reminders` (estado final de las dos filas). Anotar: AUSD/MON antes y después, fee pagada, `fp` del fill.

- [ ] **Step 5: Regresión rápida de lo que F3 tocó**

- Sign out → Sign in (passkey «pickler» de Apple Passwords): Ask abre en New read sin nivel ni celda (`signedOutState`), Trade sin `LevelCard`.
- Push de recordatorio sintético (sin APNs): archivo `<scratch>/reminder.apns` = `{ "aps": { "alert": { "title": "BTC +0.5% · 1H", "body": "resolves in 15 min" } }, "pickler": { "kind": "reminder", "reminderId": "<id-pre>", "marketId": 16, "readId": null } }`; `xcrun simctl push 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 fun.pickler.app <scratch>/reminder.apns` con la app en Wallet → tocar el banner abre BTC Perp en **Trade** (con el book). Captura `08i-reminder-tap.png`.
- `metro.log`: `grep -c -E "ERROR|Require cycle" <scratch>/metro.log` → 0 nuevos respecto al arranque (anotar los 3 `WARN` preexistentes de `@noble/hashes`).

---

### Task 9: Docs de cierre, F4 retitulada, audit F3 y revisión independiente

**Files:**
- Modify: `apps/mobile/README.md` (secciones «Perpl (tab MARKETS)», «Ask y Agents (pills de Market)», «Tests»), `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D11, D12, D14, §3 F3, §4), `docs/overview/2026-09-19-mobile-ask.html` (phase-cards F3 y F4, status board, progreso), `docs/overview/data/manifest.js` (F3 `completed`; F4 sigue `pending`)
- Create: `docs/superpowers/audits/2026-09-19-mobile-ask-f3-rulings.md`
- Generate: `docs/superpowers/plans/2026-09-19-mobile-ask-f3.html`, `docs/superpowers/specs/2026-09-19-mobile-ask-design.html` (con `node scripts/docs-md-to-html.mjs`)

- [ ] **Step 1: README de la app**

En «Perpl (tab MARKETS)» añadir un bullet:

```md
- Order book L2 en Trade: `wss://testnet.perpl.xyz/ws/v1/market-data` (override `PICKLER_PERPL_MARKET_DATA_WS`,
  mismas reglas de `run:ios` que las otras URLs), un socket por ticket visible con una sola suscripción
  `order-book@<id>`, sin pings (10 requests/min por conexión; el `mt: 5` es el único). `mt: 15` reemplaza el
  libro, `mt: 16` es un delta por nivel (`o: 0` borra). `src/perpl/marketData.ts` es puro; los frames reales se
  graban con `node scripts/perpl-market-data-capture.mjs --market 16 --seconds 20` (Node 22, sin cuenta) en
  `__tests__/fixtures/perpl/market-data-frames.json`.
```

En «Ask y Agents (pills de Market)» añadir al final:

```md
«Trade this level» (hoja de la celda y card de una read `open`) pone `S.tradeLevel`, sugiere el lado (nivel + → long)
y abre Trade con la `LevelCard`; cuando la orden queda `filled` u `open` la app llama `reminder-set` (firmado, misma
sesión de Ask) y el servidor programa `pre` (15 min antes, si faltan más de 15) y `expiry`; `resolve-reads` los manda
con el mark del momento. Nada cierra la posición. `src/reads/level.ts` es puro y tiene test.
```

En «Tests» actualizar el número esperado (`npm test` de Task 7) y el de suites.

- [ ] **Step 2: Spec — anotaciones (F3)**

En `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, sin reescribir las decisiones, añadir al final de cada celda «Valor»:
- **D11**: `**(F3)** \`mt: 16\` es delta por nivel de precio (\`o: 0\` borra), verificado contra frames reales grabados con \`scripts/perpl-market-data-capture.mjs\` (P3–P4 del plan F3). Archivos reales: \`src/perpl/marketData.ts\`, \`src/hooks/useMarketData.ts\`, \`src/screens/book.tsx\`; \`PERPL_MARKET_DATA_WS\` en \`perpl/config.ts\`, \`PERPL_URLS.marketData\`, override \`perplMarketDataWs\`. El socket sólo vive con Trade visible **y** trading key (P5). El target del nivel se indica con una línea «above / inside / below the book», no resaltando una fila (P2). Un stream rechazado (404/429) no se reintenta (P6).`
- **D12**: `**(F3)** Archivos reales: \`src/reads/level.ts\` (puro), \`postReminders\` en \`reads/api.ts\`, \`parseRemindersResponse\` en \`reads/types.ts\`, \`useReads.setReminders\`, \`LevelCard\` en \`market.tsx\`. Los recordatorios se programan tras mostrar el resultado de la orden y el nivel se consume si se programaron (P7); \`reminder-set\` reutiliza la sesión firmada de Ask y pide el permiso de push si aún no se pidió (P8). El push de recordatorio abre Trade sin \`LevelCard\` (P9). Con \`PUSH_MODE = "local"\` se programan además dos notificaciones locales.`
- **D14**: `**(F3)** «Trade this level» se renderiza en la hoja (outline lima, bajo Ask/Clear) y en la card sólo con la read \`open\`.`
- §3 «F3»: sustituir el párrafo por lo verificado (con referencia al audit) y anotar que el push real sigue dependiendo de la key APNs.
- §4: en la fila «Cuenta #620 con dos keys…» anotar la respuesta de Jesús.

- [ ] **Step 3: Overview, manifest y HTML**

`docs/overview/2026-09-19-mobile-ask.html`: phase-card F3 → `data-status="completed"` con tasks marcadas y evidencia (capturas clave, ids de recordatorios, saldos); phase-card F4 → título «TestFlight con F3 (siguiente build tras el merge)», descripción sin «build 6» ni «buildNumber 6» (dejar «buildNumber siguiente»), entregable y prerequisitos como en P15; status board y progreso coherentes (`grep -c '^ *<article class="phase-card"'` → 4). `manifest.js`: fase 3 `completed`; fase 4 `pending`; `status` global sigue `active`.

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f3
node scripts/docs-md-to-html.mjs docs/superpowers/plans/2026-09-19-mobile-ask-f3.md
node scripts/docs-md-to-html.mjs docs/superpowers/specs/2026-09-19-mobile-ask-design.md
npm run docs:check && npm run agents:check
```
Expected: ambos checks en verde. Abrir `docs/overview/2026-09-19-mobile-ask.html` y `docs/overview/index.html` en el navegador (Playwright o `open`) y **mirar** F3/F4 renderizadas, también a 390 px de ancho.

- [ ] **Step 4: Audit `2026-09-19-mobile-ask-f3-rulings.md`**

Mismo formato que el de F2: §1 qué quedó hecho y verificado (tabla por task con evidencia), §2 rulings de la ejecución (con los P del plan que se ajustaron), §3 correcciones a afirmaciones previas (incluida la del spec D11 sobre la semántica de `mt: 16`, ahora fijada), §4 **Estado de las cuentas y del servicio al cierre** (saldos RPC antes/después, fee, ids de recordatorios y su `status` final, `mobile.devices` sin token, cuenta #620: la orden y su cierre, respuesta sobre las keys; secretos APNs presentes/ausentes por nombre), §5 pendientes/residuales (heredados: APNs key, capability Push, persona del agente; nuevos), §6 siguiente punto de decisión (merge/push de F3, F4 retitulada, key APNs). Sin tokens, sin secretos, sin direcciones completas fuera de `$SIM_ADDR`.

- [ ] **Step 5: Revisión independiente de la rama**

Subagente revisor con: este plan, el spec (D11–D14), el diff completo `git diff b3378de..HEAD` y el audit. Debe cotejar línea a línea `marketData.ts` contra la doc y el fixture, `level.ts` contra `reminder-set/index.ts`, `useReads.setReminders` contra `auth.ts`/`reminder-set`, y buscar: fugas del socket (efectos sin cleanup, `active` que no cierra), presupuesto de requests, `tradeLevel` que sobreviva a Sign out o a un cambio de mercado, doble llamada a `reminder-set`, copy en español en la app, secretos en docs. Los hallazgos se resuelven (fix + test) o se rechazan con razón en el audit §2; ninguno queda «para después» sin figurar en §5.

- [ ] **Step 6: Commits de docs**

```bash
git add apps/mobile/README.md docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-19-mobile-ask-f3.md docs/superpowers/plans/2026-09-19-mobile-ask-f3.html docs/overview/2026-09-19-mobile-ask.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-19-mobile-ask-f3-rulings.md
git commit -m "docs(mobile-ask): F3 completed (book L2, Trade this level, recordatorios), F4 retitulada, audit F3"
```

**Cierre de sesión**: handoff con qué quedó hecho, qué falta (merge/push a decisión de Jesús; F4; key APNs) y evidencia. Sin merge ni push.

---

## Self-review

**Cobertura del spec.** D11: URL con override (T6), suscripción `mt: 5` y `mt: 6` (T6), `mt: 15/16` escalados por `priceDecimals`/`sizeDecimals` en la UI (`formatPrice`/`formatSize`, T7), sin pings (T6 test «no pings ever»), un socket por ticket visible abierto/cerrado con el pill (T7 P5), `RECONNECT_DELAYS_MS` (T6), clase pura con `parseBookFrame`/`applyBookFrame` probada con frames grabados (T5–T6), `BookCard` con 5 niveles por lado y spread en bps (T7), target «above/below book» como texto (P2). D12: botón en hoja y card (T4), `S.tradeLevel` + `perpsSide` + `marketTab: "trade"` (T4), `LevelCard` con target/horizonte/resolves at/lado sugerido/Remove level (T4), `reminder-set` tras `filled`/`open` con las dos filas `pre`/`expiry` (T3, T8), nada cierra la posición (copy de `LevelCard`). §3 F3: book vivo que cambia, cambio de pill cierra/reabre, nivel desde celda, orden de 2.00 AUSD a 1x, recordatorios por SQL, cron con `fire_at` forzado, cierre desde Markets, frames a fixture, saldos por RPC (T8). Residuales 12 (keys) y 13 (minors diferidos) del audit F2: el 12 como prerequisito preguntado; el 13 no se toca (sin efecto observable), queda heredado en §5 del audit.

**Placeholders.** Ninguna task dice «similar a», «TBD» o «añadir validación» sin código; los pasos de simulador nombran capturas y valores esperados.

**Consistencia de nombres.** `postReminders` (api) ≠ `setReminders` (hook) ≠ `scheduleLocalReminders` (notifications); `ReminderKind` viene de `level.ts` y `Reminder.kind` de `types.ts` usa el mismo literal; `levelFromCell(market, cell, now: Date)` y `levelIsLive(level, nowMs: number)` — la fecha entra como `Date` sólo donde se construye el vencimiento; `MarketData.status` incluye `"idle"` y `STATUS_LABEL` lo cubre; `BookCard` recibe `target?: number` y `TradeTab` pasa `level?.target`; `OrderResult` filled con `note?` es la única variante con nota y `OrderResultCard` sólo la lee ahí.
