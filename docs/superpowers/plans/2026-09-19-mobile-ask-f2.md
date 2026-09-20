# Ask — F2: app (sesión firmada, matriz, AskSheet, ReadCard, My reads, Agents, push de resolución) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los pills **Ask** y **Agents** de `Market` dejen de ser *coming soon*: en el simulador (cuenta #620) el usuario firma una vez con Face ID, ve sus 20 créditos y la matriz 5×4 sobre el mark vivo, pide una lectura a un agente, la ve llegar (< 60 s) como `ReadCard`, la encuentra en **My reads** como OPEN, ve el récord real de los tres agentes en **Agents**, y cuando el cron la resuelve recibe el push (o la notificación local del fallback) que abre la app en esa read. Sin mover AUSD ni MON.

**Architecture:** Misma arquitectura que Perpl: módulos puros con tests (`src/reads/{matrix,types,session,api,push}.ts`), un almacén SecureStore sin gate biométrico (`src/storage/reads.ts`, `pickler.reads.v1`) y dos hooks que los orquestan (`useReads`, `useNotifications`) montados en `App.tsx` junto a `usePerpl`. La identidad app → servicio es la firma `personal_sign` de `pickler-reads:<address>:<ts>` (D6), válida 24 h, creada con `openWallet()` (Face ID) sólo cuando Ask la necesita y borrada en Sign out. Las pantallas (`src/screens/ask.tsx`, `src/screens/agents.tsx`) usan exclusivamente las primitivas de `mobile-hifi` (`Segmented`, `Card`, `StatusCard`, `Chip`, `Tag`, `Btn`, `TouchCard`, `Avatar`) más `MatrixGrid`, el único componente nuevo. El servidor es el de F1 tal cual: no cambia ningún contrato.

**Tech Stack:** Expo SDK 57 (`expo-notifications` a la versión que resuelva `npx expo install`; hoy `57.0.20` según `npm view`), React Native 0.86, `expo-secure-store`, `viem` 2.55 (`account.signMessage`), jest-expo 57 (`__tests__/*.test.ts`), TypeScript 6 (`npx tsc --noEmit`). Servidor: `https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1` (F1, contratos en el spec §2.2).

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` — D6, D13, D14, D15, D16 y el push de resolución de D10 son el contrato de esta fase; D1/D2 (qué es una read, la matriz) se replican en `matrix.ts` para la vista previa; D11/D12 (order book, «Trade this level», `LevelCard`, recordatorios) son **F3 y quedan fuera** aunque D14 los mencione en la hoja y en la card. Léelo antes de empezar. Lo que F1 dejó en el servidor está en `docs/superpowers/audits/2026-09-19-mobile-ask-f1-rulings.md` §5–§6 (léelo también: wallets de prueba, secretos ausentes, contratos reales).

## Global Constraints

- Worktree `.claude/worktrees/mobile-ask-f2`, rama `feat/mobile-ask-f2` (base `main` = `e0101d9`). Todo lo de la app se corre desde `apps/mobile` **dentro del worktree** (`npm install` ya hecho ahí); los checks de docs desde la raíz del worktree; `node scripts/query.mjs` desde `services/reads` del worktree (`env.mjs` encuentra `.env.pickler` del checkout principal vía `git-common-dir`; `smoke.mjs` necesita además `npm install` en `services/reads`). Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `chore(mobile): …` / `docs(mobile-ask): …` con trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. **No commitear ni pushear sin que Jesús lo pida**: los pasos "Commit" se ejecutan sólo si él ya autorizó commits en la sesión; si no, árbol listo y nota en el handoff. Sin merge ni TestFlight (F4).
- `apps/mobile` es **npm** (no pnpm) y se instala/ejecuta dentro de su carpeta. Paquetes de Expo siempre con `npx expo install <pkg>` (fija la versión del SDK 57). Docs: `https://docs.expo.dev/versions/v57.0.0/` (regla del `AGENTS.md` de la app). `expo-notifications` es módulo nativo: tras instalarlo, `npx expo prebuild --platform ios --clean` y `npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`; **`run:ios` reinstala la app y borra la cuenta local** (audit hifi F2, ruling 7): hay que volver a hacer Sign in con el passkey del simulador (Apple Passwords) y re-inscribir Face ID (`xcrun simctl spawn <UDID> notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` + `notifyutil -p com.apple.BiometricKit.enrollmentChanged`; presentar cara con `notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`).
- Simulador **siempre por UDID `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`**, nunca `booted` (hay dos arrancados). Capturas con `xcrun simctl io <UDID> screenshot <scratch>/f2-shots/NN-nombre.png` y **mirar cada captura** antes de afirmar nada. La Mac es `arm64`: el simulador registra tokens APNs reales (entorno sandbox) y puede recibir pushes reales; `xcrun simctl push <UDID> fun.pickler.app <archivo.apns>` entrega un payload sin pasar por APNs (sirve para probar el tap aunque falten los secretos).
- **Cuenta #620 del simulador: no mover AUSD ni MON.** Ninguna task abre órdenes, deposita ni retira. Los créditos son simulados.
- **Backend F1, prohibiciones vigentes** (README de `services/reads`): nunca `supabase db push/reset`, nunca Drizzle, nunca DDL fuera de `mobile`, siempre `npx supabase` desde `services/reads`, nunca el MCP de Supabase de la sesión (apunta a Proflores). Esta fase **no despliega ni migra nada**; sólo consultas y `update`/`delete` sobre tablas de `mobile` para forzar estados de prueba (Task 9), con `node scripts/query.mjs`. Pruebas forzadas en **dos pasos** (capturar `id`, luego `update … where id = '<id>'`), nunca un CTE sobre `request_read` (incidente 2 del audit F1), y nunca dejar una `pending` forzada viva más de un tick del cron.
- **Secretos `APNS_*` ausentes al escribir este plan** (audit F1, pendiente 1; `.env.pickler` sólo tiene `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `CRON_SECRET`). El push **real** de resolución sólo se puede ver llegar cuando Jesús cree la key y se cierren Task 5 Step 3 / Task 6 Step 7 de F1. Este plan no depende de eso para cerrar: el tap del push se prueba con `simctl push` (Task 9 Step 7) y el fallback de D10 queda implementado detrás de `PUSH_MODE` (P5). Ninguna task escribe secretos en archivos del repo.
- Capability **Push Notifications** en el App ID `fun.pickler.app` (developer.apple.com → Identifiers): insumo de Jesús, igual que Associated Domains. El simulador no la necesita (no valida el perfil); el iPhone y TestFlight (F4) sí. Se anota en el handoff, no bloquea F2.
- `npm test` y `npx tsc --noEmit` en `apps/mobile` en verde al cierre de cada task a partir de la que los toca. Ninguna prueba unitaria llama al servicio ni a Perpl: `fetch` se sustituye por un doble como en `perpl-context.test.ts`. Lo real se prueba en el simulador (Task 9).
- Copy de la app en inglés (como el resto de `mobile-hifi`); código y comentarios en español donde el archivo vecino los tenga en español. Tests en inglés (`test("…")`) como los existentes.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | La sesión firmada se parte en dos módulos: `src/reads/session.ts` (**puro**: mensaje canónico, serialización, vigencia, headers) y `src/storage/reads.ts` (SecureStore `pickler.reads.v1`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, sin gate biométrico), calcado de `perpl/apiKey.ts` + `storage/perpl.ts`. | Lo puro se prueba con jest sin mocks; el patrón ya existe en el repo y `useAccount.signOut` ya borra `storage/perpl` igual. |
| P2 | Una sesión se **renueva cuando le queda menos de 1 h** (`SESSION_TTL_MS − SESSION_RENEW_BEFORE_MS = 23 h` desde `ts`) y se **descarta** si el servidor responde `401` (`signature_expired` \| `bad_signature` \| `missing_signature`): se borra de SecureStore y Ask vuelve a mostrar el gate. Nunca se reintenta la firma sin que el usuario toque el botón. | El servidor acepta `[now − 24 h, now + 5 min]` (`auth.ts` F1); renovar con 1 h de margen evita que la sesión caduque a mitad de una lectura. Reintentar Face ID solo sería un prompt sorpresa. |
| P3 | Si la wallet ya está `unlocked` (Face ID reciente), `useReads` firma la sesión **en silencio** al activar Ask; si está `locked`, Ask muestra `SessionGate` («Unlock to ask») y la firma se pide **al tocar el botón**. Ver créditos exige sesión: `reads-list` es firmada. | D6 dice «la primera vez que Ask lo necesita»; un prompt de Face ID al abrir un tab sin que el usuario haya tocado nada es una mala sorpresa. Con la wallet ya abierta no hay prompt, así que se firma solo. |
| P4 | `read-request` es una sola llamada síncrona (P9 de F1): la app muestra `pending` mientras la promesa vive y pinta la `read` de la respuesta. Timeout de **65 s** con `AbortController` + `setTimeout` (`AbortSignal.timeout` no existe en RN). Si el timeout salta, se re-lee `reads-list`: la read puede haber quedado `open` (el servidor terminó tarde) o `failed` (cron la reembolsó). | Es lo que el servidor ofrece; el reembolso a los 60 s lo garantiza el cron aunque la función muera (D7). |
| P5 | `src/config/reads.ts` exporta `PUSH_MODE: "apns" \| "local"` = `"apns"`. Con `"apns"` la app manda `pushToken`/`pushEnv` en `read-request` y no programa nada; con `"local"` (fallback D10) programa una notificación local en `expiresAt` («Your BTC +1.0% · 4H read has resolved — open Pickler», sin mark) al recibir cada read `open`. El cambio de modo es una constante, sin rediseño. | El smoke de APNs de F1 no ha corrido (faltan secretos): la decisión del fallback sigue abierta. Implementar los dos caminos cuesta un `scheduleNotificationAsync`. |
| P6 | El permiso de notificaciones se pide **la primera vez que se confirma una lectura** (dentro de `ask()`, antes del `POST`), no al abrir Ask. Si el usuario lo niega, la app lo dice en la `ReadCard` («Push is off — check My reads to see the result») y sigue. `pushEnv` = `"sandbox"` con `__DEV__`, `"production"` si no. | D10 literal. |
| P7 | El tap del push navega con `requireAccount("market", patch)` (no `nav`): `{ perpsMarketId, marketTab: "ask", askView: "mine", askFocusReadId }` para `kind = "read"` y `{ perpsMarketId, marketTab: "trade" }` para `kind = "reminder"` (F3 añadirá `tradeLevel`). El payload se lee de `content.data.pickler ?? content.data` y, si falta, de `trigger.payload.pickler` (iOS entrega el `userInfo` completo ahí). En frío se consulta `getLastNotificationResponseAsync()` una sola vez. | `requireAccount` respeta el gate (app sin cuenta → Sign in y luego aterriza). Leer las dos rutas cubre la diferencia entre `data` y `userInfo` sin depender de cómo serializa cada versión de `expo-notifications`. |
| P8 | **My reads** es store-driven: tocar un `ReadRow` hace `set({ askFocusReadId })`, «Back to list» hace `set({ askFocusReadId: undefined })`. El push usa el mismo campo. La `ReadCard` de **New read** (resultado de la lectura recién pedida) vive en el estado local del hook (`request.step === "done"`), no en el store. | Un solo mecanismo para «abrir una read» desde la lista y desde el push (D13); el resultado recién pedido no tiene que sobrevivir a la navegación. |
| P9 | **«Trade this level»** (hoja y card) **no se renderiza en F2**; F3 añade los dos botones con `LevelCard` y `reminder-set`. El tipo `TradeLevel` y el campo `tradeLevel?` del store sí se declaran ahora (D13) para que F3 no toque `store.ts` otra vez. | Alcance fijado por Jesús: Trade this level y el book son F3. Un botón que no hace nada sería peor que ninguno. |
| P10 | El **mark de la matriz** es `perpl.context.markets[i].mark` (poll de 5 s de `usePerpl`, ya activo en `market`); `targetFor` y `questionFor` se replican en `src/reads/matrix.ts` con la misma aritmética que `_shared/matrix.ts` del servidor y se prueban con los mismos números (BTC `762555` pd 1 → `+50 bps` = `766368`). Una vez creada la read, la card pinta **sólo** los valores del servidor (`markAtRequest`, `target`, `question`). | D2: la app previsualiza, el servidor decide. Probar con los mismos números que el servidor evita que las dos matrices diverjan sin que nadie lo note. |
| P11 | `useReads` recibe `marketId` (= `S.perpsMarketId`) y `active` (= `screen === "market" && marketTab ∈ {ask, agents}`) desde `App.tsx`, igual que `perpl.setActive`; con `active` y sesión lista hace `reads-list?marketId=` al activar, **cada 15 s** y al volver al foreground (`AppState`). `agents-list` (pública) se carga al activar y en pull-to-refresh; `Shell.refreshable` gana `market` y su `onRefresh` hace `Promise.allSettled([perpl.refreshContext(), reads.refresh()])`. | D16 y D15 literal; un solo lugar decide qué está activo. |
| P12 | Ninguna task añade `@testing-library/react-native`: los hooks se mantienen delgados y **toda la lógica con reglas va a módulos puros con test** (`matrix`, `types`, `session`, `api`, `push`, `store`). Los hooks y pantallas se verifican con `tsc` y en el simulador (Task 9). | Es la regla del repo desde `mobile-fase1`; añadir infraestructura de tests de UI no cabe en 23 días. |
| P13 | Antes del recorrido en el simulador (Task 9 Step 0) se **borran las cuatro wallets de prueba de F1** (`0xf73f…1b4f`, `0x6b4e…768e`, `0x1449…1408`, `0xdea4…6616`) con el bloque «Limpieza de wallets de prueba» del README, para que `agent_records` muestre récords limpios («No resolved reads yet» en los tres). | Pendiente 4 del audit F1: «limpiar antes de que la app de F2 muestre récords». Son tablas nuestras en `mobile`. |
| P14 | La cuenta regresiva («Resolves in 3 h 58 m») se calcula con `formatRemaining(expiresAt − now)` (puro) y un `useNow(30_000)` local en `ask.tsx`; no hay `setInterval` por card. | Una card no necesita precisión de segundos; un tick de 30 s para toda la pantalla basta. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/package.json`, `package-lock.json`, `app.config.ts`, `src/config/reads.ts`, `src/reads/constants.ts`, `__tests__/reads-config.test.ts` | 0 | `expo-notifications` + plugin, `extra.readsUrl`, `READS_URL`, `PUSH_MODE`, timeouts; rebuild nativo |
| `apps/mobile/src/reads/matrix.ts`, `__tests__/reads-matrix.test.ts` | 1 | Matriz, target, pregunta, call/outcome, etiquetas, cuenta regresiva, récord |
| `apps/mobile/src/reads/types.ts`, `__tests__/reads-types.test.ts`, `__tests__/fixtures/reads/read.json` | 2 | Tipos `Read`/`Agent` y parseo estricto de los DTOs de §2.2 |
| `apps/mobile/src/reads/session.ts`, `src/storage/reads.ts`, `src/hooks/useAccount.ts`, `__tests__/reads-session.test.ts` | 3 | Sesión firmada (D6): mensaje, vigencia, SecureStore, borrado en Sign out |
| `apps/mobile/src/reads/api.ts`, `__tests__/reads-api.test.ts` | 4 | Cliente HTTP: headers firmados, timeouts, errores `{ error }` → `ReadsError`, copy |
| `apps/mobile/src/store.ts`, `__tests__/store.test.ts` | 5 | `askView`, `askCell`, `askAgentId`, `askFocusReadId`, `tradeLevel`, `headerFor` por pill (D13) |
| `apps/mobile/src/reads/push.ts`, `src/hooks/useNotifications.ts`, `__tests__/reads-push.test.ts` | 6 | Permiso, token APNs, tap → patch del store, fallback local (D10, P5–P7) |
| `apps/mobile/src/hooks/useReads.ts` | 7 | Sesión, créditos, lista por mercado, agentes, `ask()`, polling, foreground (D16, P2–P4, P11) |
| `apps/mobile/src/screens/ask.tsx` | 8 | `AskTab`, `SessionGate`, `MatrixGrid`, `AskSheet`, `ReadCard`, `ReadRow` (D14) |
| `apps/mobile/src/screens/agents.tsx`, `src/screens/market.tsx`, `src/screens/comingSoon.tsx`, `src/screens/comingSoonCopy.ts`, `__tests__/comingSoon.test.ts`, `src/ctx.ts`, `App.tsx`, `src/Shell.tsx` | 9 | `AgentsTab` (D15), enrutado de pills, hooks montados, pull-to-refresh; **recorrido en el simulador** con capturas |
| `apps/mobile/README.md`, `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/2026-09-19-mobile-ask.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` | 10 | Docs de cierre, audit F2, revisión independiente |

---

### Task 0: `expo-notifications`, `readsUrl` en `app.config.ts`, `src/config/reads.ts` y rebuild nativo

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json` (vía `npx expo install`), `apps/mobile/app.config.ts`
- Create: `apps/mobile/src/config/reads.ts`, `apps/mobile/src/reads/constants.ts`, `apps/mobile/__tests__/reads-config.test.ts`

**Interfaces:**
- Produces: `READS_URL: string`, `PUSH_MODE: "apns" | "local"` en `src/config/reads.ts` (importa `expo-constants`: no lo cargan los tests); `READS_URL_DEFAULT`, `READ_REQUEST_TIMEOUT_MS`, `READS_TIMEOUT_MS`, `READS_POLL_MS` en `src/reads/constants.ts` (puro). Los usan Tasks 4, 6 y 7.

- [ ] **Step 1: Línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/apps/mobile
git status --short
npm test 2>&1 | tail -4
npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio; `Tests: <N> passed` (el README dice 179/24 suites; anotar el número real); `TSC-OK`.

- [ ] **Step 2: Instalar `expo-notifications` con la versión del SDK**

```bash
npx expo install expo-notifications
grep -n '"expo-notifications"' package.json
```
Expected: una línea `"expo-notifications": "57.x.y"` en `dependencies` (misma familia `57.0.*` que el resto). Si `expo install` propone otra major, parar y anotar.

- [ ] **Step 3: Plugin y `extra.readsUrl` en `app.config.ts`**

Sustituir en `apps/mobile/app.config.ts`:
```ts
const perplWs = process.env.PICKLER_PERPL_WS ?? "";
```
por:
```ts
const perplWs = process.env.PICKLER_PERPL_WS ?? "";
// Servicio de reads (services/reads, Supabase pickler). Vacío = el de producción (src/config/reads.ts).
const readsUrl = process.env.PICKLER_READS_URL ?? "";
```
En `plugins`, después del bloque de `expo-build-properties`:
```ts
    ["expo-notifications", { enableBackgroundRemoteNotifications: false }],
```
Y `extra`:
```ts
  extra: { rpId, monadscanKey, perplRest, perplWs, readsUrl },
```

- [ ] **Step 4: Test de la config (RED)**

`apps/mobile/__tests__/reads-config.test.ts`:
```ts
import { READS_URL_DEFAULT } from "../src/reads/constants";

test("the reads service lives in the pickler Supabase project (F1)", () => {
  expect(READS_URL_DEFAULT).toBe("https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1");
});
```
Run: `npx jest __tests__/reads-config.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/constants'`.

- [ ] **Step 5: `src/reads/constants.ts` y `src/config/reads.ts` (GREEN)**

`apps/mobile/src/reads/constants.ts` (puro; lo importan los tests sin cargar `expo-constants`):
```ts
// Servicio de reads (F1): edge functions del Supabase pickler, esquema mobile. Verificado 2026-09-20 (audit F1 §5).
export const READS_URL_DEFAULT = "https://yvdipvcrpbqvofayteqf.supabase.co/functions/v1";
export const READ_REQUEST_TIMEOUT_MS = 65_000; // read-request: el modelo tarda hasta 50 s + reembolso a los 60 s (D7, P4)
export const READS_TIMEOUT_MS = 15_000; // el resto
export const READS_POLL_MS = 15_000; // My reads mientras Ask está visible (D16)
```
`apps/mobile/src/config/reads.ts`:
```ts
import Constants from "expo-constants";
import { READS_URL_DEFAULT } from "../reads/constants";

const extra = Constants.expoConfig?.extra ?? {};

/** URL del servicio de reads con override desde app.config.ts (`PICKLER_READS_URL`). */
export const READS_URL: string = typeof extra.readsUrl === "string" && extra.readsUrl !== "" ? extra.readsUrl : READS_URL_DEFAULT;

/** D10: "apns" = el servidor manda el push de resolución; "local" = fallback, la app programa una notificación local al vencer (P5). */
export const PUSH_MODE: "apns" | "local" = "apns";
```
Run: `npx jest __tests__/reads-config.test.ts`
Expected: PASS.

- [ ] **Step 6: Rebuild nativo e instalación en el simulador**

```bash
npx expo prebuild --platform ios --clean 2>&1 | tail -3
npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 2>&1 | tee "$SCRATCH/build.log" | tail -8
grep -n "aps-environment" ios/Pickler/Pickler.entitlements
```
Expected: `› Build Succeeded`, `› Installing on iPhone 17 Pro`, bundle de Metro; el `.entitlements` generado contiene `<key>aps-environment</key><string>development</string>`. Si el build falla por firma (`aps-environment` requiere la capability), en el simulador no debe pasar; si pasa, anotar y seguir con `--device` de nuevo tras `prebuild --clean`. Captura `00-boot.png` de la app arrancada (pantalla Wallet o Sign in).

- [ ] **Step 7: Verificación y commit**

```bash
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add package.json package-lock.json app.config.ts src/config/reads.ts src/reads/constants.ts __tests__/reads-config.test.ts
git commit -m "chore(mobile): expo-notifications, readsUrl y config del servicio de reads"
```
Expected: todos los tests en verde (+1), `TSC-OK`. `ios/` sigue ignorado (`git status` no lo lista).

---

### Task 1: `src/reads/matrix.ts` — matriz, target, pregunta, etiquetas, cuenta regresiva

**Files:**
- Create: `apps/mobile/src/reads/matrix.ts`, `apps/mobile/__tests__/reads-matrix.test.ts`

**Interfaces:**
- Consumes: `formatPrice(price, pd)` de `src/perpl/orders.ts`.
- Produces: `LEVELS_BPS`, `HORIZONS_MIN`, `LevelBps`, `HorizonMin`, `Cell = { levelBps: LevelBps; horizonMin: HorizonMin }`, `isLevel(n)`, `isHorizon(n)`, `targetFor(mark, bps): number`, `expiresAtFor(createdAt: Date, horizonMin): Date`, `questionFor(symbol, bps, target, pd, expiresAt: Date): string`, `levelLabel(bps): string`, `horizonLabel(min): string`, `cellLabel(cell): string` (`"+1.0% · 4H"`), `callOf(p): boolean`, `outcomeOf(bps, target, mark): boolean`, `formatRemaining(ms): string`, `formatProbability(p): string` (`"62 %"`), `recordLabel(record): string`. Los usan Tasks 6, 7, 8, 9.

- [ ] **Step 1: Test (RED)**

`apps/mobile/__tests__/reads-matrix.test.ts`:
```ts
import {
  callOf, cellLabel, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, isHorizon, isLevel, LEVELS_BPS,
  levelLabel, outcomeOf, questionFor, recordLabel, targetFor,
} from "../src/reads/matrix";

test("the matrix is 5 levels × 4 horizons, in the spec order (D2)", () => {
  expect(LEVELS_BPS).toEqual([250, 100, 50, -50, -100]);
  expect(HORIZONS_MIN).toEqual([60, 240, 720, 1440]);
  expect(isLevel(50)).toBe(true);
  expect(isLevel(75)).toBe(false);
  expect(isHorizon(1440)).toBe(true);
  expect(isHorizon(30)).toBe(false);
});

// Mismos números que el servidor (_shared/matrix.ts, audit F1 Task 6): BTC mark 762555 (pd 1) → +0.5 % = 766368.
test.each([
  [762555, 50, 766368],
  [762555, 100, 770181],
  [762555, 250, 781619],
  [762555, -50, 758742],
  [762555, -100, 754929],
  [2221, 250, 2277], // MON pd 5: 2221 × 1.025 = 2276.525 → 2277
])("targetFor(%i, %i) = %i (rounded, scaled like the mark)", (mark, bps, target) => {
  expect(targetFor(mark, bps)).toBe(target);
});

test("expiresAt is createdAt + horizon", () => {
  const t0 = new Date("2026-09-20T06:35:06.000Z");
  expect(expiresAtFor(t0, 60).toISOString()).toBe("2026-09-20T07:35:06.000Z");
  expect(expiresAtFor(t0, 1440).toISOString()).toBe("2026-09-21T06:35:06.000Z");
});

test("the question reads like the server's (D1)", () => {
  const exp = new Date("2026-09-20T07:35:06.000Z");
  expect(questionFor("BTC", 100, 812469, 1, exp)).toBe("Will the BTC mark be at or above 81246.9 at 2026-09-20 07:35 UTC?");
  expect(questionFor("MON", -50, 2210, 5, exp)).toBe("Will the MON mark be at or below 0.02210 at 2026-09-20 07:35 UTC?");
});

test("labels match the push copy of the server", () => {
  expect(levelLabel(250)).toBe("+2.5%");
  expect(levelLabel(-50)).toBe("−0.5%");
  expect(horizonLabel(60)).toBe("1H");
  expect(horizonLabel(1440)).toBe("24H");
  expect(cellLabel({ levelBps: 100, horizonMin: 240 })).toBe("+1.0% · 4H");
});

test("call and outcome follow D1/D3", () => {
  expect(callOf(0.5)).toBe(true);
  expect(callOf(0.49)).toBe(false);
  expect(outcomeOf(100, 770181, 770181)).toBe(true);
  expect(outcomeOf(100, 770181, 770180)).toBe(false);
  expect(outcomeOf(-50, 758742, 758742)).toBe(true);
  expect(outcomeOf(-50, 758742, 758743)).toBe(false);
});

test("formatRemaining rounds down to hours and minutes", () => {
  expect(formatRemaining(3 * 3_600_000 + 58 * 60_000 + 20_000)).toBe("3 h 58 m");
  expect(formatRemaining(12 * 60_000)).toBe("12 m");
  expect(formatRemaining(59_000)).toBe("< 1 m");
  expect(formatRemaining(0)).toBe("now");
  expect(formatRemaining(-5_000)).toBe("now");
});

test("probability and record labels", () => {
  expect(formatProbability(0.62)).toBe("62 %");
  expect(formatProbability(0.075)).toBe("8 %");
  expect(recordLabel({ reads: 0, resolved: 0, right: 0, brierAvg: null })).toBe("No resolved reads yet");
  expect(recordLabel({ reads: 12, resolved: 10, right: 7, brierAvg: 0.2144 })).toBe("7/10 right · Brier 0.21");
});
```
Run: `npx jest __tests__/reads-matrix.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/matrix'`.

- [ ] **Step 2: Implementación (GREEN)**

`apps/mobile/src/reads/matrix.ts`:
```ts
// Matriz nivel × horizonte (D1, D2). Puro y con la misma aritmética que services/reads/_shared/matrix.ts (P10).
import { formatPrice } from "../perpl/orders";

export const LEVELS_BPS = [250, 100, 50, -50, -100] as const;
export const HORIZONS_MIN = [60, 240, 720, 1440] as const;
export type LevelBps = (typeof LEVELS_BPS)[number];
export type HorizonMin = (typeof HORIZONS_MIN)[number];
export type Cell = { levelBps: LevelBps; horizonMin: HorizonMin };

export const isLevel = (v: number): v is LevelBps => (LEVELS_BPS as readonly number[]).includes(v);
export const isHorizon = (v: number): v is HorizonMin => (HORIZONS_MIN as readonly number[]).includes(v);

/** Target en las mismas unidades escaladas que el mark (priceDecimals). */
export function targetFor(mark: number, levelBps: number): number {
  return Math.round((mark * (10000 + levelBps)) / 10000);
}

export function expiresAtFor(createdAt: Date, horizonMin: number): Date {
  return new Date(createdAt.getTime() + horizonMin * 60_000);
}

export function questionFor(symbol: string, levelBps: number, target: number, pd: number, expiresAt: Date): string {
  const dir = levelBps > 0 ? "at or above" : "at or below";
  const when = expiresAt.toISOString().slice(0, 16).replace("T", " ");
  return `Will the ${symbol} mark be ${dir} ${formatPrice(target, pd)} at ${when} UTC?`;
}

const HORIZON_LABELS: Record<number, string> = { 60: "1H", 240: "4H", 720: "12H", 1440: "24H" };
export const horizonLabel = (min: number): string => HORIZON_LABELS[min] ?? `${min}m`;
export const levelLabel = (bps: number): string => `${bps > 0 ? "+" : "−"}${(Math.abs(bps) / 100).toFixed(1)}%`;
export const cellLabel = (c: { levelBps: number; horizonMin: number }): string => `${levelLabel(c.levelBps)} · ${horizonLabel(c.horizonMin)}`;

export const callOf = (probability: number): boolean => probability >= 0.5;

export function outcomeOf(levelBps: number, target: number, mark: number): boolean {
  return levelBps > 0 ? mark >= target : mark <= target;
}

/** "3 h 58 m" | "12 m" | "< 1 m" | "now". Redondea hacia abajo. */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  if (m === 0) return "< 1 m";
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} h ${m % 60} m` : `${m} m`;
}

export const formatProbability = (p: number): string => `${Math.round(p * 100)} %`;

export function recordLabel(r: { resolved: number; right: number; brierAvg: number | null }): string {
  if (r.resolved === 0 || r.brierAvg === null) return "No resolved reads yet";
  return `${r.right}/${r.resolved} right · Brier ${r.brierAvg.toFixed(2)}`;
}
```
Run: `npx jest __tests__/reads-matrix.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Commit**

```bash
git add src/reads/matrix.ts __tests__/reads-matrix.test.ts
git commit -m "feat(mobile): matriz de reads (target, pregunta, etiquetas, cuenta regresiva)"
```

---

### Task 2: `src/reads/types.ts` — tipos y parseo estricto de los DTOs

**Files:**
- Create: `apps/mobile/src/reads/types.ts`, `apps/mobile/__tests__/reads-types.test.ts`, `apps/mobile/__tests__/fixtures/reads/read.json`

**Interfaces:**
- Produces: `ReadStatus`, `Read`, `AgentRecord`, `Agent`, `parseRead(v): Read`, `parseReadResponse(body): { read: Read; credits: number }`, `parseReadsList(body): { reads: Read[]; credits: number }`, `parseAgentsList(body): Agent[]`. Los usan Tasks 4, 6, 7, 8, 9.

- [ ] **Step 1: Fixture con la forma real del DTO de F1**

`apps/mobile/__tests__/fixtures/reads/read.json` (los valores son los de la read del smoke de F1, audit §1 Task 4, con el `id` de la de Task 6):
```json
{
  "id": "1fde46c6-97da-4435-8184-59b5218a771d",
  "agentId": "jesus",
  "marketId": 16,
  "symbol": "BTC",
  "priceDecimals": 1,
  "levelBps": 100,
  "horizonMin": 60,
  "markAtRequest": 804425,
  "target": 812469,
  "question": "Will the BTC mark be at or above 81246.9 at 2026-09-20 07:35 UTC?",
  "status": "open",
  "probability": 0.07,
  "reasons": [
    "A 1% move in one hour is rare for BTC outside of news.",
    "The 24h trend is mildly positive but not accelerating.",
    "Sports betting adds uncertainty in short windows."
  ],
  "limits": "A macro headline or a liquidation cascade in the next hour would invalidate this read.",
  "creditsCharged": 1,
  "error": null,
  "createdAt": "2026-09-20T06:35:06.712Z",
  "expiresAt": "2026-09-20T07:35:06.712Z",
  "resolvedAt": null,
  "markAtResolution": null,
  "outcome": null,
  "brier": null
}
```

- [ ] **Step 2: Test (RED)**

`apps/mobile/__tests__/reads-types.test.ts`:
```ts
import readJson from "./fixtures/reads/read.json";
import { parseAgentsList, parseRead, parseReadResponse, parseReadsList } from "../src/reads/types";

test("parseRead reads the DTO of F1 verbatim", () => {
  const r = parseRead(readJson);
  expect(r).toMatchObject({ id: "1fde46c6-97da-4435-8184-59b5218a771d", agentId: "jesus", marketId: 16, symbol: "BTC", priceDecimals: 1, levelBps: 100, horizonMin: 60, markAtRequest: 804425, target: 812469, status: "open", probability: 0.07, creditsCharged: 1, error: null, resolvedAt: null, markAtResolution: null, outcome: null, brier: null });
  expect(r.reasons).toHaveLength(3);
  expect(r.limits).toMatch(/invalidate/);
  expect(r.expiresAt).toBe("2026-09-20T07:35:06.712Z");
});

test("parseRead accepts a resolved and a failed read", () => {
  const right = parseRead({ ...readJson, status: "right", resolvedAt: "2026-09-20T07:36:00.000Z", markAtResolution: 812470, outcome: true, brier: 0.8649 });
  expect(right).toMatchObject({ status: "right", markAtResolution: 812470, outcome: true, brier: 0.8649 });
  const failed = parseRead({ ...readJson, status: "failed", probability: null, reasons: null, limits: null, error: "timeout" });
  expect(failed).toMatchObject({ status: "failed", probability: null, reasons: null, error: "timeout" });
});

test.each([
  ["not an object", null],
  ["unknown status", { ...readJson, status: "maybe" }],
  ["level outside the matrix", { ...readJson, levelBps: 75 }],
  ["probability out of range", { ...readJson, probability: 1.2 }],
  ["reasons not strings", { ...readJson, reasons: [1, 2, 3] }],
  ["missing expiresAt", { ...readJson, expiresAt: undefined }],
  ["expiresAt not ISO", { ...readJson, expiresAt: "tomorrow" }],
])("parseRead throws on %s", (_, body) => {
  expect(() => parseRead(body)).toThrow(/Reads API/);
});

test("parseReadResponse and parseReadsList carry the credits", () => {
  expect(parseReadResponse({ read: readJson, credits: 19 })).toMatchObject({ credits: 19, read: { id: readJson.id } });
  const list = parseReadsList({ reads: [readJson, readJson], credits: 18 });
  expect(list.reads).toHaveLength(2);
  expect(list.credits).toBe(18);
  expect(() => parseReadsList({ reads: "x", credits: 1 })).toThrow(/Reads API/);
  expect(() => parseReadResponse({ read: readJson, credits: "19" })).toThrow(/Reads API/);
});

test("parseAgentsList reads the record and keeps the server order", () => {
  const agents = parseAgentsList({ agents: [
    { id: "jesus", handle: "jesus", name: "Jesús's agent", owner: "Jesús", priceCredits: 1, record: { reads: 1, resolved: 0, right: 0, brierAvg: null } },
    { id: "drift", handle: "drift", name: "Drift", owner: "Pickler", priceCredits: 1, record: { reads: 2, resolved: 1, right: 1, brierAvg: 0.0144 } },
  ] });
  expect(agents.map((a) => a.id)).toEqual(["jesus", "drift"]);
  expect(agents[1].record).toEqual({ reads: 2, resolved: 1, right: 1, brierAvg: 0.0144 });
  expect(() => parseAgentsList({ agents: [{ id: "x" }] })).toThrow(/Reads API/);
});
```
Run: `npx jest __tests__/reads-types.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/types'`.

- [ ] **Step 3: Implementación (GREEN)**

`apps/mobile/src/reads/types.ts`:
```ts
// DTOs del servicio de reads (spec §2.2, F1 dto.ts). Parseo estricto como perpl/context.ts: lanza si la forma no es la verificada.
import { isHorizon, isLevel } from "./matrix";

export type ReadStatus = "pending" | "open" | "right" | "wrong" | "void" | "failed";
const STATUSES: readonly ReadStatus[] = ["pending", "open", "right", "wrong", "void", "failed"];

export type Read = {
  id: string; agentId: string; marketId: number; symbol: string; priceDecimals: number;
  levelBps: number; horizonMin: number; markAtRequest: number; target: number; question: string;
  status: ReadStatus; probability: number | null; reasons: string[] | null; limits: string | null;
  creditsCharged: number; error: string | null;
  /** ISO UTC, como los manda el servidor. */
  createdAt: string; expiresAt: string; resolvedAt: string | null;
  markAtResolution: number | null; outcome: boolean | null; brier: number | null;
};

export type AgentRecord = { reads: number; resolved: number; right: number; brierAvg: number | null };
export type Agent = { id: string; handle: string; name: string; owner: string; priceCredits: number; record: AgentRecord };

type Rec = Record<string, unknown>;
const fail = (what: string): never => { throw new Error(`Reads API: ${what}`); };
const rec = (v: unknown, what: string): Rec => (v === null || typeof v !== "object" ? fail(`${what} is not an object`) : (v as Rec));
const num = (r: Rec, k: string, what: string): number => (typeof r[k] === "number" && Number.isFinite(r[k]) ? (r[k] as number) : fail(`${what}.${k} is not a number`));
const str = (r: Rec, k: string, what: string): string => (typeof r[k] === "string" ? (r[k] as string) : fail(`${what}.${k} is not a string`));
const numOrNull = (r: Rec, k: string, what: string): number | null => (r[k] === null || r[k] === undefined ? null : num(r, k, what));
const strOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null || r[k] === undefined ? null : str(r, k, what));
const iso = (r: Rec, k: string, what: string): string => {
  const s = str(r, k, what);
  return Number.isNaN(Date.parse(s)) ? fail(`${what}.${k} is not a date`) : s;
};
const isoOrNull = (r: Rec, k: string, what: string): string | null => (r[k] === null || r[k] === undefined ? null : iso(r, k, what));

export function parseRead(v: unknown): Read {
  const r = rec(v, "read");
  const status = str(r, "status", "read");
  if (!(STATUSES as readonly string[]).includes(status)) fail(`read.status ${status} is unknown`);
  const levelBps = num(r, "levelBps", "read"), horizonMin = num(r, "horizonMin", "read");
  if (!isLevel(levelBps) || !isHorizon(horizonMin)) fail("read cell is outside the matrix");
  const probability = numOrNull(r, "probability", "read");
  if (probability !== null && (probability < 0 || probability > 1)) fail("read.probability out of range");
  const reasons = r.reasons === null || r.reasons === undefined ? null
    : Array.isArray(r.reasons) && r.reasons.every((x) => typeof x === "string") ? (r.reasons as string[]) : fail("read.reasons is not a string array");
  const outcome = r.outcome === null || r.outcome === undefined ? null : typeof r.outcome === "boolean" ? r.outcome : fail("read.outcome is not a boolean");
  return {
    id: str(r, "id", "read"), agentId: str(r, "agentId", "read"), marketId: num(r, "marketId", "read"), symbol: str(r, "symbol", "read"),
    priceDecimals: num(r, "priceDecimals", "read"), levelBps, horizonMin, markAtRequest: num(r, "markAtRequest", "read"),
    target: num(r, "target", "read"), question: str(r, "question", "read"), status: status as ReadStatus, probability, reasons,
    limits: strOrNull(r, "limits", "read"), creditsCharged: num(r, "creditsCharged", "read"), error: strOrNull(r, "error", "read"),
    createdAt: iso(r, "createdAt", "read"), expiresAt: iso(r, "expiresAt", "read"), resolvedAt: isoOrNull(r, "resolvedAt", "read"),
    markAtResolution: numOrNull(r, "markAtResolution", "read"), outcome, brier: numOrNull(r, "brier", "read"),
  };
}

export function parseReadResponse(body: unknown): { read: Read; credits: number } {
  const b = rec(body, "response");
  return { read: parseRead(b.read), credits: num(b, "credits", "response") };
}

export function parseReadsList(body: unknown): { reads: Read[]; credits: number } {
  const b = rec(body, "response");
  if (!Array.isArray(b.reads)) fail("response.reads is not an array");
  return { reads: b.reads.map(parseRead), credits: num(b, "credits", "response") };
}

function parseAgent(v: unknown): Agent {
  const a = rec(v, "agent");
  const rc = rec(a.record, "agent.record");
  return {
    id: str(a, "id", "agent"), handle: str(a, "handle", "agent"), name: str(a, "name", "agent"), owner: str(a, "owner", "agent"),
    priceCredits: num(a, "priceCredits", "agent"),
    record: { reads: num(rc, "reads", "record"), resolved: num(rc, "resolved", "record"), right: num(rc, "right", "record"), brierAvg: numOrNull(rc, "brierAvg", "record") },
  };
}

export function parseAgentsList(body: unknown): Agent[] {
  const b = rec(body, "response");
  if (!Array.isArray(b.agents)) fail("response.agents is not an array");
  return b.agents.map(parseAgent);
}
```
Run: `npx jest __tests__/reads-types.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/reads/types.ts __tests__/reads-types.test.ts __tests__/fixtures/reads/read.json
git commit -m "feat(mobile): tipos y parseo estricto de los DTOs del servicio de reads"
```

---

### Task 3: Sesión firmada — `src/reads/session.ts`, `src/storage/reads.ts`, borrado en Sign out

**Files:**
- Create: `apps/mobile/src/reads/session.ts`, `apps/mobile/src/storage/reads.ts`, `apps/mobile/__tests__/reads-session.test.ts`
- Modify: `apps/mobile/src/hooks/useAccount.ts` (`signOut`)

**Interfaces:**
- Consumes: `Wallet.account.signMessage({ message })` (viem `LocalAccount`, `src/wallet/wallet.ts`).
- Produces: `ReadsSession = { address: string; ts: number; sig: Hex }`, `SESSION_TTL_MS`, `SESSION_RENEW_BEFORE_MS`, `canonicalMessage(address, ts)`, `serializeSession(s)`, `parseSession(raw): ReadsSession | undefined`, `isUsable(s, now?)`, `sessionFor(s, address, now?)`, `signedHeaders(s): Record<string, string>`, `createSession(sign, address, now?)`; `loadReadsSession()`, `saveReadsSession(s)`, `clearReadsSession()`. Los usan Tasks 4 y 7.

- [ ] **Step 1: Test (RED)**

`apps/mobile/__tests__/reads-session.test.ts`:
```ts
import { privateKeyToAccount } from "viem/accounts";
import {
  canonicalMessage, createSession, isUsable, parseSession, SESSION_RENEW_BEFORE_MS, SESSION_TTL_MS, serializeSession, sessionFor, signedHeaders,
} from "../src/reads/session";

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const ADDRESS = account.address; // checksummed: la sesión lo guarda en minúsculas
const NOW = 1_789_600_000_000;
const SIG = `0x${"ab".repeat(65)}` as const;

test("the canonical message is pickler-reads:<lowercase address>:<ts> (D6)", () => {
  expect(canonicalMessage(ADDRESS, NOW)).toBe(`pickler-reads:${ADDRESS.toLowerCase()}:${NOW}`);
});

test("createSession signs the canonical message with the wallet account", async () => {
  const s = await createSession((m) => account.signMessage({ message: m }), ADDRESS, NOW);
  expect(s.address).toBe(ADDRESS.toLowerCase());
  expect(s.ts).toBe(NOW);
  expect(s.sig).toMatch(/^0x[0-9a-f]{130}$/);
  expect(s.sig).toBe(await account.signMessage({ message: canonicalMessage(ADDRESS, NOW) }));
});

test("a session is usable for 23 h and belongs to one address", () => {
  const s = { address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG };
  expect(isUsable(s, NOW)).toBe(true);
  expect(isUsable(s, NOW + SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS - 1)).toBe(true);
  expect(isUsable(s, NOW + SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS)).toBe(false); // renueva con 1 h de margen (P2)
  expect(isUsable(s, NOW - 6 * 60_000)).toBe(false); // reloj atrasado más de 5 min: el servidor la rechazaría
  expect(sessionFor(s, ADDRESS, NOW)).toEqual(s); // compara en minúsculas
  expect(sessionFor(s, "0x2222222222222222222222222222222222222222", NOW)).toBeUndefined();
  expect(sessionFor(undefined, ADDRESS, NOW)).toBeUndefined();
});

test("serialize/parse round-trips and rejects malformed entries", () => {
  const s = { address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG };
  expect(parseSession(serializeSession(s))).toEqual(s);
  for (const raw of [
    "{",
    JSON.stringify({ address: ADDRESS, ts: NOW, sig: SIG }), // no minúsculas
    JSON.stringify({ address: ADDRESS.toLowerCase(), ts: "x", sig: SIG }),
    JSON.stringify({ address: ADDRESS.toLowerCase(), ts: NOW, sig: "0x12" }),
    JSON.stringify({}),
  ]) expect(parseSession(raw)).toBeUndefined();
});

test("signedHeaders are the three x-pickler-* headers", () => {
  expect(signedHeaders({ address: ADDRESS.toLowerCase(), ts: NOW, sig: SIG })).toEqual({
    "x-pickler-address": ADDRESS.toLowerCase(), "x-pickler-ts": String(NOW), "x-pickler-sig": SIG,
  });
});
```
Run: `npx jest __tests__/reads-session.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/session'`.

- [ ] **Step 2: `src/reads/session.ts` (GREEN)**

```ts
// Sesión firmada app → servicio de reads (D6): personal_sign de `pickler-reads:<address>:<ts>`, 24 h. Puro (P1).
import type { Hex } from "viem";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const SESSION_RENEW_BEFORE_MS = 60 * 60 * 1000; // se renueva cuando queda menos de 1 h (P2)
const FUTURE_MS = 5 * 60 * 1000; // el servidor acepta ts hasta 5 min en el futuro

export type ReadsSession = { address: string; ts: number; sig: Hex };

export function canonicalMessage(address: string, ts: number): string {
  return `pickler-reads:${address.toLowerCase()}:${ts}`;
}

/** Firma con la cuenta de la wallet (viem LocalAccount.signMessage). `now` en ms. */
export async function createSession(sign: (message: string) => Promise<Hex>, address: string, now = Date.now()): Promise<ReadsSession> {
  const lower = address.toLowerCase();
  return { address: lower, ts: now, sig: await sign(canonicalMessage(lower, now)) };
}

export function isUsable(s: ReadsSession, now = Date.now()): boolean {
  return now - s.ts < SESSION_TTL_MS - SESSION_RENEW_BEFORE_MS && s.ts <= now + FUTURE_MS;
}

/** La sesión guardada sólo vale para su dirección y mientras sea usable. */
export function sessionFor(s: ReadsSession | undefined, address: string, now = Date.now()): ReadsSession | undefined {
  return s && s.address === address.toLowerCase() && isUsable(s, now) ? s : undefined;
}

export function signedHeaders(s: ReadsSession): Record<string, string> {
  return { "x-pickler-address": s.address, "x-pickler-ts": String(s.ts), "x-pickler-sig": s.sig };
}

export function serializeSession(s: ReadsSession): string {
  return JSON.stringify(s);
}

export function parseSession(raw: string): ReadsSession | undefined {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return undefined; }
  if (value === null || typeof value !== "object") return undefined;
  const { address, ts, sig } = value as Record<string, unknown>;
  if (typeof address !== "string" || !/^0x[0-9a-f]{40}$/.test(address)) return undefined;
  if (typeof ts !== "number" || !Number.isInteger(ts) || ts <= 0) return undefined;
  if (typeof sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(sig)) return undefined;
  return { address, ts, sig: sig as Hex };
}
```
Run: `npx jest __tests__/reads-session.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: `src/storage/reads.ts` y `signOut`**

`apps/mobile/src/storage/reads.ts`:
```ts
import { deleteItemAsync, getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";
import { parseSession, type ReadsSession, serializeSession } from "../reads/session";

const KEY = "pickler.reads.v1";
// Sin gate biométrico (D6): la firma sólo autoriza créditos simulados y lecturas.
const ITEM_OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

/** Una entrada malformada se borra y se lee como ausente. */
export async function loadReadsSession(): Promise<ReadsSession | undefined> {
  const raw = await getItemAsync(KEY, ITEM_OPTIONS);
  if (raw === null) return undefined;
  const s = parseSession(raw);
  if (s === undefined) await deleteItemAsync(KEY);
  return s;
}

export async function saveReadsSession(s: ReadsSession): Promise<void> {
  await setItemAsync(KEY, serializeSession(s), ITEM_OPTIONS);
}

export async function clearReadsSession(): Promise<void> {
  await deleteItemAsync(KEY);
}
```
En `apps/mobile/src/hooks/useAccount.ts`: añadir `import { clearReadsSession } from "../storage/reads";` y cambiar `signOut`:
```ts
  const signOut = useCallback(async () => {
    await Promise.all([clearStoredAccount(), clearTradingKey(), clearReadsSession()]); // D6: la sesión de reads muere con la cuenta
    replace({ status: "none" });
  }, [replace]);
```

- [ ] **Step 4: Verificación y commit**

```bash
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/reads/session.ts src/storage/reads.ts src/hooks/useAccount.ts __tests__/reads-session.test.ts
git commit -m "feat(mobile): sesión firmada de reads en SecureStore, borrada en Sign out"
```

---

### Task 4: `src/reads/api.ts` — cliente HTTP del servicio

**Files:**
- Create: `apps/mobile/src/reads/api.ts`, `apps/mobile/__tests__/reads-api.test.ts`

**Interfaces:**
- Consumes: `signedHeaders`, `ReadsSession` (Task 3); `parseAgentsList`, `parseReadResponse`, `parseReadsList`, `parseRead` (Task 2); `READ_REQUEST_TIMEOUT_MS`, `READS_TIMEOUT_MS` (Task 0).
- Produces: `class ReadsError extends Error { status: number; code: string }`, `describeReadsError(e): string`, `ReadRequest = { marketId; levelBps; horizonMin; agentId; pushToken?; pushEnv? }`, `fetchAgents(base, doFetch?)`, `fetchReads(base, session, marketId?, doFetch?)`, `fetchRead(base, session, id, doFetch?)`, `requestRead(base, session, body, doFetch?)`. Los usa Task 7.

- [ ] **Step 1: Test (RED)**

`apps/mobile/__tests__/reads-api.test.ts`:
```ts
import readJson from "./fixtures/reads/read.json";
import { describeReadsError, type DoFetch, fetchAgents, fetchRead, fetchReads, ReadsError, requestRead } from "../src/reads/api";
import { READ_REQUEST_TIMEOUT_MS, READS_TIMEOUT_MS } from "../src/reads/constants";

const BASE = "https://reads.test/functions/v1";
const SESSION = { address: "0x1111111111111111111111111111111111111111", ts: 1_789_600_000_000, sig: `0x${"ab".repeat(65)}` as const };
type Call = { url: string; init?: RequestInit };
// Sin `new Response`: el entorno de jest-expo no garantiza los globals de fetch de Node (perpl-context.test.ts).
type FakeRes = { ok: boolean; status: number; json: () => Promise<unknown> };
const ok = (body: unknown): FakeRes => ({ ok: true, status: 200, json: async () => body });
const fail = (status: number, error: string): FakeRes => ({ ok: false, status, json: async () => ({ error }) });
const html = (status: number): FakeRes => ({ ok: false, status, json: async () => { throw new SyntaxError("not json"); } });
function fetchOnce(res: FakeRes, calls: Call[] = []) {
  const f = jest.fn((url: string, init?: RequestInit) => { calls.push({ url, init }); return Promise.resolve(res); }) as unknown as DoFetch;
  return { f, calls };
}

test("fetchAgents is a public GET", async () => {
  const { f, calls } = fetchOnce(ok({ agents: [] }));
  expect(await fetchAgents(BASE, f)).toEqual([]);
  expect(calls[0].url).toBe(`${BASE}/agents-list`);
  expect((calls[0].init?.headers as Record<string, string>)["x-pickler-address"]).toBeUndefined();
});

test("fetchReads signs the request and passes marketId", async () => {
  const { f, calls } = fetchOnce(ok({ reads: [readJson], credits: 19 }));
  const r = await fetchReads(BASE, SESSION, 16, f);
  expect(r.credits).toBe(19);
  expect(r.reads[0].id).toBe(readJson.id);
  expect(calls[0].url).toBe(`${BASE}/reads-list?marketId=16`);
  expect(calls[0].init?.headers).toMatchObject({ "x-pickler-address": SESSION.address, "x-pickler-ts": String(SESSION.ts), "x-pickler-sig": SESSION.sig });
});

test("fetchRead gets one read by id", async () => {
  const { f, calls } = fetchOnce(ok({ read: readJson }));
  expect((await fetchRead(BASE, SESSION, readJson.id, f)).id).toBe(readJson.id);
  expect(calls[0].url).toBe(`${BASE}/read-get?id=${readJson.id}`);
});

test("requestRead posts the cell, the agent and the push token", async () => {
  const { f, calls } = fetchOnce(ok({ read: readJson, credits: 19 }));
  const r = await requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus", pushToken: "ab".repeat(32), pushEnv: "sandbox" }, f);
  expect(r.credits).toBe(19);
  expect(calls[0].url).toBe(`${BASE}/read-request`);
  expect(calls[0].init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus", pushToken: "ab".repeat(32), pushEnv: "sandbox" });
  expect((calls[0].init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
});

test.each([
  [402, "no_credits"], [401, "signature_expired"], [409, "market_closed"], [422, "unknown_agent"], [429, "rate_limited"], [503, "busy"], [503, "perpl_unavailable"],
])("a %i %s becomes a ReadsError with the server code", async (status, code) => {
  const { f } = fetchOnce(fail(status, code));
  await expect(requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus" }, f)).rejects.toMatchObject({ status, code });
});

test("a non-JSON 5xx becomes bad_response and a malformed 200 throws the parser error", async () => {
  await expect(fetchAgents(BASE, fetchOnce(html(502)).f)).rejects.toMatchObject({ status: 502, code: "bad_response" });
  await expect(fetchAgents(BASE, fetchOnce(ok({ agents: "x" })).f)).rejects.toThrow(/Reads API/);
});

test("timeouts use AbortController: 65 s for read-request, 15 s for the rest", async () => {
  jest.useFakeTimers();
  const hang = jest.fn((_url: string, init?: RequestInit) => new Promise<FakeRes>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" })));
  })) as unknown as DoFetch;
  // Los handlers se cuelgan al crear las promesas: una rejection sin handler haría ruido en jest.
  const p1 = requestRead(BASE, SESSION, { marketId: 16, levelBps: 100, horizonMin: 60, agentId: "jesus" }, hang).then(() => "resolved", (e: ReadsError) => e.code);
  jest.advanceTimersByTime(READ_REQUEST_TIMEOUT_MS - 1);
  const p2 = fetchAgents(BASE, hang).then(() => "resolved", (e: ReadsError) => e.code);
  jest.advanceTimersByTime(READS_TIMEOUT_MS); // p2 vence; p1 lleva 65 s − 1 + 15 s > 65 s: también
  await expect(p2).resolves.toBe("timeout");
  await expect(p1).resolves.toBe("timeout");
  jest.useRealTimers();
});

test("network failures become network and the copy is human", async () => {
  const f = jest.fn(() => Promise.reject(new TypeError("Network request failed"))) as unknown as DoFetch;
  await expect(fetchAgents(BASE, f)).rejects.toMatchObject({ code: "network" });
  expect(describeReadsError(new ReadsError(402, "no_credits"))).toBe("No credits left. Credits are simulated for the testnet.");
  expect(describeReadsError(new ReadsError(401, "signature_expired"))).toBe("Your Ask session expired. Unlock again.");
  expect(describeReadsError(new ReadsError(0, "timeout"))).toMatch(/took too long/);
  expect(describeReadsError(new ReadsError(500, "weird"))).toBe("The reads service responded 500.");
  expect(describeReadsError(new Error("Reads API: read.id is not a string"))).toBe("Reads API: read.id is not a string");
});
```
Run: `npx jest __tests__/reads-api.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/api'`.

- [ ] **Step 2: Implementación (GREEN)**

`apps/mobile/src/reads/api.ts`:
```ts
// Cliente del servicio de reads (D16). fetch con AbortController + setTimeout: AbortSignal.timeout no existe en RN (P4).
import { READ_REQUEST_TIMEOUT_MS, READS_TIMEOUT_MS } from "./constants";
import { type ReadsSession, signedHeaders } from "./session";
import { type Agent, parseAgentsList, parseRead, parseReadResponse, parseReadsList, type Read } from "./types";

export type DoFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Error del servicio: `status` HTTP (0 si no hubo respuesta) y `code` = `{ error }` del servidor o `timeout` | `network` | `bad_response`. */
export class ReadsError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`reads ${status} ${code}`);
    this.name = "ReadsError";
  }
}

const COPY: Record<string, string> = {
  no_credits: "No credits left. Credits are simulated for the testnet.",
  market_closed: "This market is closed on Perpl right now.",
  rate_limited: "Too many reads in a row — wait a few minutes.",
  busy: "The agents are busy. Try again in a minute.",
  perpl_unavailable: "Perpl didn't answer. Try again in a moment.",
  unknown_agent: "That agent is no longer available.",
  bad_body: "That cell isn't on the matrix.",
  missing_signature: "Your Ask session expired. Unlock again.",
  signature_expired: "Your Ask session expired. Unlock again.",
  bad_signature: "Your Ask session expired. Unlock again.",
  timeout: "The agent took too long. Check My reads — your credit comes back if it failed.",
  network: "Couldn't reach the reads service.",
  bad_response: "The reads service sent something unexpected.",
};

export function describeReadsError(e: unknown): string {
  if (e instanceof ReadsError) return COPY[e.code] ?? `The reads service responded ${e.status}.`;
  return e instanceof Error ? e.message : String(e);
}

export const isSessionError = (e: unknown): boolean => e instanceof ReadsError && e.status === 401;

async function call(url: string, init: RequestInit, timeoutMs: number, doFetch: DoFetch): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    throw new ReadsError(0, controller.signal.aborted || (e instanceof Error && e.name === "AbortError") ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const code = body !== null && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : "bad_response";
    throw new ReadsError(res.status, code);
  }
  return body;
}

export function fetchAgents(base: string, doFetch: DoFetch = fetch): Promise<Agent[]> {
  return call(`${base}/agents-list`, { method: "GET" }, READS_TIMEOUT_MS, doFetch).then(parseAgentsList);
}

export function fetchReads(base: string, session: ReadsSession, marketId?: number, doFetch: DoFetch = fetch): Promise<{ reads: Read[]; credits: number }> {
  const q = marketId === undefined ? "" : `?marketId=${marketId}`;
  return call(`${base}/reads-list${q}`, { method: "GET", headers: signedHeaders(session) }, READS_TIMEOUT_MS, doFetch).then(parseReadsList);
}

export function fetchRead(base: string, session: ReadsSession, id: string, doFetch: DoFetch = fetch): Promise<Read> {
  return call(`${base}/read-get?id=${encodeURIComponent(id)}`, { method: "GET", headers: signedHeaders(session) }, READS_TIMEOUT_MS, doFetch)
    .then((b) => parseRead((b as { read?: unknown } | null)?.read));
}

export type ReadRequest = { marketId: number; levelBps: number; horizonMin: number; agentId: string; pushToken?: string; pushEnv?: "sandbox" | "production" };

export function requestRead(base: string, session: ReadsSession, body: ReadRequest, doFetch: DoFetch = fetch): Promise<{ read: Read; credits: number }> {
  return call(`${base}/read-request`, {
    method: "POST", headers: { ...signedHeaders(session), "content-type": "application/json" }, body: JSON.stringify(body),
  }, READ_REQUEST_TIMEOUT_MS, doFetch).then(parseReadResponse);
}
```
Run: `npx jest __tests__/reads-api.test.ts`
Expected: PASS (8 tests). Si el test de timeouts se queda colgado, revisar que `jest.useFakeTimers()` va antes de crear las promesas y que el `finally` limpia el timer.

- [ ] **Step 3: Verificación y commit**

```bash
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/reads/api.ts __tests__/reads-api.test.ts
git commit -m "feat(mobile): cliente HTTP del servicio de reads con timeouts y errores tipados"
```

---

### Task 5: Store — `askView`, `askCell`, `askAgentId`, `askFocusReadId`, `tradeLevel`, `headerFor` por pill (D13)

**Files:**
- Modify: `apps/mobile/src/store.ts`, `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Produces: `AskView = "new" | "mine"`, `AskCell = { levelBps: number; horizonMin: number }`, `TradeLevel = { marketId; levelBps; horizonMin; target; expiresAt: string; readId?: string }`; `StoreState` gana `askView: AskView` (default `"new"`), `askCell?`, `askAgentId?`, `askFocusReadId?`, `tradeLevel?`; `headerFor(screen, perpsSymbol?, marketTab?)`. Los usan Tasks 6–9.

- [ ] **Step 1: Tests (RED)** — añadir al final de `apps/mobile/__tests__/store.test.ts`:

```ts
test("Ask state: New read by default, a cell, an agent and a focused read travel in the patch (D13)", () => {
  expect(INITIAL.askView).toBe("new");
  expect(INITIAL.askCell).toBeUndefined();
  const s = navState(INITIAL, "market", { perpsMarketId: 16, marketTab: "ask", askView: "mine", askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } });
  expect(s).toMatchObject({ marketTab: "ask", askView: "mine", askFocusReadId: "r1", askAgentId: "drift", askCell: { levelBps: 100, horizonMin: 240 } });
  expect(navState(INITIAL, "market", { tradeLevel: { marketId: 16, levelBps: 100, horizonMin: 240, target: 770181, expiresAt: "2026-09-20T07:35:06.712Z" } }).tradeLevel?.target).toBe(770181);
});

test("the Market header subtitle follows the pill (D13)", () => {
  expect(headerFor("market", "BTC", "trade")).toEqual(["BTC Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("market", "BTC", "ask")).toEqual(["BTC Perp", "Ask an agent · simulated credits"]);
  expect(headerFor("market", "BTC", "agents")).toEqual(["BTC Perp", "Who reads this market"]);
  expect(headerFor("market", undefined)).toEqual(["Perp", "Perpl · isolated margin · market order"]);
});

test("sign out keeps the store reset contract and lands on Sign in (unchanged by Ask)", () => {
  const s = signedOutState(navState(INITIAL, "market", { askView: "mine", askFocusReadId: "r1" }));
  expect(s.screen).toBe("signin");
  expect(s.stack).toEqual([]);
  expect(s.next).toBe("wallet");
});
```
Run: `npx jest __tests__/store.test.ts`
Expected: FAIL — `askView` no existe en `INITIAL` (TypeScript/`toBe("new")` recibe `undefined`) y `headerFor` ignora el tercer argumento.

- [ ] **Step 2: Implementación (GREEN)** — en `apps/mobile/src/store.ts`:

Tras `export type MarketTab = …`:
```ts
export type AskView = "new" | "mine";
export type AskCell = { levelBps: number; horizonMin: number };
/** Nivel elegido para «Trade this level» (D12; lo usa F3). */
export type TradeLevel = { marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; readId?: string };
```
En `StoreState`, después de `fundsMode?: "add" | "withdraw";`:
```ts
  /** Ask (D13): segmentado New read | My reads, celda armada, agente elegido, read abierta desde la lista o desde un push. */
  askView: AskView;
  askCell?: AskCell;
  askAgentId?: string;
  askFocusReadId?: string;
  tradeLevel?: TradeLevel;
```
`INITIAL`:
```ts
export const INITIAL: StoreState = { screen: "wallet", stack: [], marketTab: "trade", askView: "new" };
```
`headerFor`:
```ts
const MARKET_SUBTITLES: Record<MarketTab, string> = {
  trade: "Perpl · isolated margin · market order",
  ask: "Ask an agent · simulated credits",
  agents: "Who reads this market",
};

export function headerFor(screen: Screen, perpsSymbol?: string, marketTab: MarketTab = "trade"): [string, string] {
  switch (screen) {
    case "markets": return ["Markets", "Perps on Perpl · Monad"];
    case "market": return [perpsSymbol ? `${perpsSymbol} Perp` : "Perp", MARKET_SUBTITLES[marketTab]];
    …(resto sin cambio)
```
En `useAppStore`: `const [headerTitle, headerSub] = headerFor(S.screen, perpsSymbol, S.marketTab);`

Run: `npx jest __tests__/store.test.ts`
Expected: PASS (todos, incluidos los tres nuevos). `npx tsc --noEmit` limpio: `INITIAL` es el único literal de `StoreState`; si `tsc` señala otro (p. ej. en tests), añadir `askView: "new"` ahí.

- [ ] **Step 3: Commit**

```bash
git add src/store.ts __tests__/store.test.ts
git commit -m "feat(mobile): estado de Ask en el store y subtítulo de Market por pill"
```

---

### Task 6: `src/reads/push.ts` + `src/hooks/useNotifications.ts` — permiso, token, tap y fallback local (D10)

**Files:**
- Create: `apps/mobile/src/reads/push.ts`, `apps/mobile/src/hooks/useNotifications.ts`, `apps/mobile/__tests__/reads-push.test.ts`

**Interfaces:**
- Consumes: `Patch` (store), `Read` (Task 2), `cellLabel` (Task 1), `PUSH_MODE` (Task 0).
- Produces: `PushTarget`, `pushTargetOf(...sources: unknown[]): PushTarget | null`, `patchForPush(t): Patch`, `pushEnvFor(dev: boolean)`, `localResolutionContent(read)`; `PushDevice = { token: string; env: "sandbox" | "production" }`, `PushPermission = "unknown" | "granted" | "denied" | "unavailable"`, `Notifications = { device; permission; ensurePermission(): Promise<PushDevice | null>; scheduleLocal(read: Read): Promise<void> }`, `useNotifications(onTarget: (t: PushTarget) => void): Notifications`. Los usan Tasks 7, 8, 9.

- [ ] **Step 1: Test (RED)**

`apps/mobile/__tests__/reads-push.test.ts`:
```ts
import readJson from "./fixtures/reads/read.json";
import { localResolutionContent, patchForPush, pushEnvFor, pushTargetOf } from "../src/reads/push";
import { parseRead } from "../src/reads/types";

const READ = { kind: "read", readId: "1fde46c6-97da-4435-8184-59b5218a771d", marketId: 16 };

test("the target comes from data.pickler, from data itself, or from the raw iOS payload (P7)", () => {
  expect(pushTargetOf({ pickler: READ })).toEqual(READ);
  expect(pushTargetOf(READ)).toEqual(READ);
  expect(pushTargetOf({}, { aps: { alert: {} }, pickler: READ })).toEqual(READ);
  expect(pushTargetOf(undefined, null, { aps: {} })).toBeNull();
  expect(pushTargetOf({ pickler: { kind: "read", readId: 5, marketId: 16 } })).toBeNull();
  expect(pushTargetOf({ pickler: { kind: "reminder", reminderId: "m1", marketId: 16, readId: null } })).toEqual({ kind: "reminder", reminderId: "m1", marketId: 16, readId: null });
});

test("a read push opens My reads on that read; a reminder opens Trade (P7)", () => {
  expect(patchForPush({ kind: "read", readId: "r1", marketId: 16 })).toEqual({ perpsMarketId: 16, marketTab: "ask", askView: "mine", askFocusReadId: "r1" });
  expect(patchForPush({ kind: "reminder", reminderId: "m1", marketId: 64, readId: null })).toEqual({ perpsMarketId: 64, marketTab: "trade" });
});

test("sandbox in __DEV__, production otherwise (D10)", () => {
  expect(pushEnvFor(true)).toBe("sandbox");
  expect(pushEnvFor(false)).toBe("production");
});

test("the local fallback names the cell and carries the same data as the server push (P5)", () => {
  const c = localResolutionContent(parseRead(readJson));
  expect(c.title).toBe("BTC +1.0% · 1H");
  expect(c.body).toBe("Your read has resolved — open Pickler to see if the agent was right.");
  expect(c.data).toEqual({ pickler: READ });
});
```
Run: `npx jest __tests__/reads-push.test.ts`
Expected: FAIL — `Cannot find module '../src/reads/push'`.

- [ ] **Step 2: `src/reads/push.ts` (GREEN)**

```ts
// Payload de los pushes de resolve-reads (F1 copy.ts: `pickler: { kind, readId, marketId }`) → navegación (D10, P7). Puro.
import type { Patch } from "../store";
import { cellLabel } from "./matrix";
import type { Read } from "./types";

export type PushTarget =
  | { kind: "read"; readId: string; marketId: number }
  | { kind: "reminder"; reminderId: string; marketId: number; readId: string | null };

function targetOf(v: unknown): PushTarget | null {
  if (v === null || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (typeof r.marketId !== "number") return null;
  if (r.kind === "read" && typeof r.readId === "string") return { kind: "read", readId: r.readId, marketId: r.marketId };
  if (r.kind === "reminder" && typeof r.reminderId === "string") {
    return { kind: "reminder", reminderId: r.reminderId, marketId: r.marketId, readId: typeof r.readId === "string" ? r.readId : null };
  }
  return null;
}

/** Busca `pickler` (o el objeto mismo) en cada fuente: content.data, trigger.payload (userInfo de iOS). */
export function pushTargetOf(...sources: unknown[]): PushTarget | null {
  for (const s of sources) {
    if (s === null || typeof s !== "object") continue;
    const t = targetOf((s as Record<string, unknown>).pickler) ?? targetOf(s);
    if (t) return t;
  }
  return null;
}

export function patchForPush(t: PushTarget): Patch {
  return t.kind === "read"
    ? { perpsMarketId: t.marketId, marketTab: "ask", askView: "mine", askFocusReadId: t.readId }
    : { perpsMarketId: t.marketId, marketTab: "trade" }; // F3 añadirá tradeLevel
}

export const pushEnvFor = (dev: boolean): "sandbox" | "production" => (dev ? "sandbox" : "production");

/** Fallback D10: notificación local al vencer la read, sin mark (la app no lo sabe). */
export function localResolutionContent(read: Read): { title: string; body: string; data: Record<string, unknown> } {
  return {
    title: `${read.symbol} ${cellLabel(read)}`,
    body: "Your read has resolved — open Pickler to see if the agent was right.",
    data: { pickler: { kind: "read", readId: read.id, marketId: read.marketId } },
  };
}
```
Run: `npx jest __tests__/reads-push.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: `src/hooks/useNotifications.ts`**

```ts
import * as Notif from "expo-notifications";
import { useCallback, useEffect, useRef, useState } from "react";
import { localResolutionContent, pushEnvFor, type PushTarget, pushTargetOf } from "../reads/push";
import type { Read } from "../reads/types";

export type PushDevice = { token: string; env: "sandbox" | "production" };
export type PushPermission = "unknown" | "granted" | "denied" | "unavailable";

export type Notifications = {
  /** Token APNs del dispositivo, si hay permiso y el registro funcionó. */
  device: PushDevice | null;
  permission: PushPermission;
  /** Pide permiso (la primera vez que se confirma una lectura, D10/P6) y registra el token. */
  ensurePermission: () => Promise<PushDevice | null>;
  /** Fallback D10 (PUSH_MODE === "local"): notificación local al vencer la read. */
  scheduleLocal: (read: Read) => Promise<void>;
};

// Con la app en primer plano el push se muestra igual (banner + lista): así se ve llegar en el simulador.
Notif.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

const targetOfResponse = (r: Notif.NotificationResponse): PushTarget | null =>
  pushTargetOf(r.notification.request.content.data, (r.notification.request.trigger as { payload?: unknown } | null)?.payload);

export function useNotifications(onTarget: (t: PushTarget) => void): Notifications {
  const [device, setDevice] = useState<PushDevice | null>(null);
  const [permission, setPermission] = useState<PushPermission>("unknown");
  const onTargetRef = useRef(onTarget);
  onTargetRef.current = onTarget;
  const handled = useRef<string | null>(null); // identifier de la última respuesta ya navegada

  const register = useCallback(async (): Promise<PushDevice | null> => {
    try {
      const t = await Notif.getDevicePushTokenAsync();
      if (t.type !== "ios" || typeof t.data !== "string") { setPermission("unavailable"); return null; }
      const d = { token: t.data, env: pushEnvFor(__DEV__) };
      setDevice(d);
      return d;
    } catch (e) {
      console.warn(`push token: ${e instanceof Error ? e.message : e}`); // simulador sin soporte, sin entitlement…
      setPermission("unavailable");
      return null;
    }
  }, []);

  // Arranque: si ya hay permiso, registra el token sin preguntar nada.
  useEffect(() => {
    let stale = false;
    Notif.getPermissionsAsync()
      .then((p) => { if (stale) return; if (p.granted) { setPermission("granted"); void register(); } else if (p.status === "denied") setPermission("denied"); })
      .catch(() => { if (!stale) setPermission("unavailable"); });
    return () => { stale = true; };
  }, [register]);

  // Tap en un push: en caliente (listener) y en frío (última respuesta), una sola vez por respuesta.
  useEffect(() => {
    const handle = (r: Notif.NotificationResponse | null) => {
      if (!r || handled.current === r.notification.request.identifier) return;
      handled.current = r.notification.request.identifier;
      const t = targetOfResponse(r);
      if (t) onTargetRef.current(t);
    };
    const sub = Notif.addNotificationResponseReceivedListener(handle);
    Notif.getLastNotificationResponseAsync().then(handle).catch(() => {});
    return () => sub.remove();
  }, []);

  const ensurePermission = useCallback(async (): Promise<PushDevice | null> => {
    if (device) return device;
    if (permission === "denied" || permission === "unavailable") return null;
    try {
      const p = await Notif.requestPermissionsAsync();
      if (!p.granted) { setPermission("denied"); return null; }
      setPermission("granted");
      return await register();
    } catch {
      setPermission("unavailable");
      return null;
    }
  }, [device, permission, register]);

  const scheduleLocal = useCallback(async (read: Read) => {
    const date = new Date(read.expiresAt);
    if (date.getTime() <= Date.now()) return;
    await Notif.scheduleNotificationAsync({ identifier: `read-${read.id}`, content: localResolutionContent(read), trigger: { type: Notif.SchedulableTriggerInputTypes.DATE, date } });
  }, []);

  return { device, permission, ensurePermission, scheduleLocal };
}
```

- [ ] **Step 4: Verificación y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/reads/push.ts src/hooks/useNotifications.ts __tests__/reads-push.test.ts
git commit -m "feat(mobile): useNotifications — permiso, token APNs, tap del push y fallback local"
```
Expected: `TSC-OK` (si `SchedulableTriggerInputTypes` o `shouldShowBanner` no existen en la versión instalada, consultar `node_modules/expo-notifications/build/Notifications.types.d.ts` y usar el nombre real; anotar la diferencia en el audit) y tests en verde.

---

### Task 7: `src/hooks/useReads.ts` — sesión, créditos, lista, agentes, `ask()`, polling

**Files:**
- Create: `apps/mobile/src/hooks/useReads.ts`

**Interfaces:**
- Consumes: `useUnlock` (`src/hooks/useUnlock.ts`), `accountAddress`, `AccountState`; Tasks 0–6.
- Produces:
```ts
export type ReadsSessionStatus = "none" | "signing" | "ready";
export type RequestState = { step: "idle" } | { step: "pending"; cell: AskCell; agentId: string } | { step: "done"; read: Read } | { step: "failed"; text: string };
export type Reads = {
  session: ReadsSessionStatus; sessionError: string;
  credits: number | null; reads: Read[]; listError: string;
  agents: Agent[] | null; agentsError: string;
  request: RequestState;
  ensureSession: () => Promise<boolean>;
  refresh: () => Promise<void>;
  ask: (cell: AskCell, agentId: string) => Promise<void>;
  resetRequest: () => void;
  setActive: (active: boolean) => void;
};
export function useReads(account: AccountState, onUnlock: (w: Wallet) => void, notifications: Notifications, marketId: number | undefined): Reads
```
Los usan Tasks 8 y 9.

- [ ] **Step 1: Implementación**

`apps/mobile/src/hooks/useReads.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { accountAddress, type AccountState } from "../account";
import { PUSH_MODE, READS_URL } from "../config/reads";
import { describeReadsError, fetchAgents, fetchReads, isSessionError, requestRead } from "../reads/api";
import { READS_POLL_MS } from "../reads/constants";
import { createSession, type ReadsSession, sessionFor } from "../reads/session";
import type { Agent, Read } from "../reads/types";
import { clearReadsSession, loadReadsSession, saveReadsSession } from "../storage/reads";
import type { AskCell } from "../store";
import { describeError, type Wallet } from "../wallet/wallet";
import type { Notifications } from "./useNotifications";
import { useUnlock } from "./useUnlock";

export type ReadsSessionStatus = "none" | "signing" | "ready";
export type RequestState =
  | { step: "idle" }
  | { step: "pending"; cell: AskCell; agentId: string }
  | { step: "done"; read: Read }
  | { step: "failed"; text: string };

export type Reads = {
  session: ReadsSessionStatus;
  sessionError: string;
  credits: number | null;
  /** Reads del mercado activo, más recientes primero (máx. 50, D16). */
  reads: Read[];
  listError: string;
  agents: Agent[] | null;
  agentsError: string;
  request: RequestState;
  /** Firma la sesión si hace falta (Face ID si la wallet está bloqueada). true si quedó lista. */
  ensureSession: () => Promise<boolean>;
  /** agents-list + reads-list del mercado activo (pull-to-refresh). */
  refresh: () => Promise<void>;
  ask: (cell: AskCell, agentId: string) => Promise<void>;
  resetRequest: () => void;
  setActive: (active: boolean) => void;
};

const upsert = (list: Read[], read: Read): Read[] => [read, ...list.filter((r) => r.id !== read.id)];

export function useReads(account: AccountState, onUnlock: (w: Wallet) => void, notifications: Notifications, marketId: number | undefined): Reads {
  const address = accountAddress(account);
  const openWallet = useUnlock(account, onUnlock);
  const [status, setStatus] = useState<ReadsSessionStatus>("none");
  const [sessionError, setSessionError] = useState("");
  const [credits, setCredits] = useState<number | null>(null);
  const [reads, setReads] = useState<Read[]>([]);
  const [listError, setListError] = useState("");
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [request, setRequest] = useState<RequestState>({ step: "idle" });
  const [active, setActive] = useState(false);
  const sessionRef = useRef<ReadsSession | null>(null);
  const { ensurePermission, scheduleLocal } = notifications; // el objeto cambia por render; las funciones son estables

  const dropSession = useCallback(async () => {
    sessionRef.current = null;
    setStatus("none");
    setCredits(null);
    setReads([]);
    await clearReadsSession().catch(() => {});
  }, []);

  // Arranque y cambio de cuenta: la sesión guardada vale sólo para su dirección y mientras sea usable (P2).
  useEffect(() => {
    let stale = false;
    sessionRef.current = null;
    setStatus("none");
    setCredits(null);
    setReads([]);
    setRequest({ step: "idle" });
    if (!address) return;
    loadReadsSession()
      .then((s) => {
        if (stale) return;
        const usable = sessionFor(s, address);
        if (usable) { sessionRef.current = usable; setStatus("ready"); }
      })
      .catch(() => {});
    return () => { stale = true; };
  }, [address]);

  const ensureSession = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    if (sessionRef.current && sessionFor(sessionRef.current, address)) return true;
    setStatus("signing");
    setSessionError("");
    try {
      const wallet = await openWallet();
      const s = await createSession((m) => wallet.account.signMessage({ message: m }), wallet.address);
      await saveReadsSession(s);
      sessionRef.current = s;
      setStatus("ready");
      return true;
    } catch (e) {
      setStatus("none");
      setSessionError(describeError(e)); // "" si canceló Face ID
      return false;
    }
  }, [address, openWallet]);

  // Con la wallet ya abierta no hay prompt: se firma sola al activar Ask (P3).
  useEffect(() => {
    if (active && status === "none" && account.status === "unlocked") void ensureSession();
  }, [active, status, account.status, ensureSession]);

  const loadAgents = useCallback(async () => {
    try { setAgents(await fetchAgents(READS_URL)); setAgentsError(""); }
    catch (e) { setAgentsError(describeReadsError(e)); }
  }, []);

  const loadReads = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const r = await fetchReads(READS_URL, s, marketId);
      setReads(r.reads);
      setCredits(r.credits);
      setListError("");
    } catch (e) {
      if (isSessionError(e)) { await dropSession(); return; }
      setListError(describeReadsError(e));
    }
  }, [marketId, dropSession]);

  const refresh = useCallback(async () => { await Promise.allSettled([loadAgents(), loadReads()]); }, [loadAgents, loadReads]);

  // Polling de 15 s mientras Ask/Agents está visible, y refetch al volver al foreground (D16, P11).
  useEffect(() => {
    if (!active) return;
    void loadAgents();
    if (status !== "ready") return;
    void loadReads();
    const timer = setInterval(() => { void loadReads(); }, READS_POLL_MS);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void loadReads(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [active, status, loadAgents, loadReads]);

  const ask = useCallback(async (cell: AskCell, agentId: string) => {
    if (marketId === undefined) return;
    if (!(await ensureSession())) return;
    const s = sessionRef.current!;
    const device = PUSH_MODE === "apns" ? await ensurePermission() : null; // primera confirmación → permiso (P6)
    setRequest({ step: "pending", cell, agentId });
    try {
      const { read, credits: left } = await requestRead(READS_URL, s, {
        marketId, levelBps: cell.levelBps, horizonMin: cell.horizonMin, agentId,
        ...(device ? { pushToken: device.token, pushEnv: device.env } : {}),
      });
      setCredits(left);
      setReads((list) => upsert(list, read));
      if (read.status === "failed") { setRequest({ step: "failed", text: "The agent couldn't answer. Refunded 1 credit." }); return; }
      setRequest({ step: "done", read });
      if (PUSH_MODE === "local") void scheduleLocal(read);
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      setRequest({ step: "failed", text: describeReadsError(e) });
      void loadReads(); // la read puede haber quedado open o failed aunque el POST no volviera (P4)
    }
  }, [marketId, ensureSession, ensurePermission, scheduleLocal, dropSession, loadReads]);

  const resetRequest = useCallback(() => setRequest({ step: "idle" }), []);

  return { session: status, sessionError, credits, reads, listError, agents, agentsError, request, ensureSession, refresh, ask, resetRequest, setActive };
}
```

- [ ] **Step 2: Verificación y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/hooks/useReads.ts
git commit -m "feat(mobile): useReads — sesión firmada, créditos, lista por mercado, agentes y ask()"
```
Expected: `TSC-OK`; tests sin cambio.

---

### Task 8: `src/screens/ask.tsx` — `AskTab`, `SessionGate`, `MatrixGrid`, `AskSheet`, `ReadCard`, `ReadRow` (D14)

**Files:**
- Create: `apps/mobile/src/screens/ask.tsx`

**Interfaces:**
- Consumes: `AppCtx` con `reads: Reads`, `notifications: Notifications` (los añade Task 9 a `ctx.ts`; para que `tsc` pase en esta task, `ask.tsx` tipa sus props como `AppCtx & { reads: Reads; notifications: Notifications }`), `perpl.context.markets`, `S.perpsMarketId`, `S.askView`, `S.askCell`, `S.askAgentId`, `S.askFocusReadId`, `set`; `matrix.ts`, `types.ts`.
- Produces: `AskTab(ctx)`, `ReadCard({ read, agentName, now, footer })` (exportada para F3). Las usa Task 9.

- [ ] **Step 1: Implementación**

`apps/mobile/src/screens/ask.tsx`:
```tsx
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import type { Notifications } from "../hooks/useNotifications";
import type { Reads } from "../hooks/useReads";
import type { Market } from "../perpl/context";
import { formatPrice } from "../perpl/orders";
import {
  callOf, type Cell, cellLabel, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, LEVELS_BPS, levelLabel, questionFor, targetFor,
} from "../reads/matrix";
import type { Agent, Read, ReadStatus } from "../reads/types";
import type { AskCell } from "../store";
import { Btn, Card, Chip, Segmented, StatusCard, T, Tag, type Tone, Touch, TouchCard, Warn } from "../ui/primitives";
import { C, pill } from "../ui/theme";

type Ctx = AppCtx & { reads: Reads; notifications: Notifications };

/** Tick de 30 s para las cuentas regresivas de toda la pantalla (P14). */
function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

/** Tonos de D14: OPEN warn · RIGHT up · WRONG down · VOID/FAILED/PENDING faint. */
const STATUS: Record<ReadStatus, { label: string; fg: string; bd: string }> = {
  pending: { label: "READING", fg: C.faint, bd: C.hair18 },
  open: { label: "OPEN", fg: C.warn, bd: C.warnBd },
  right: { label: "RIGHT", fg: C.up, bd: C.limeBd },
  wrong: { label: "WRONG", fg: C.down, bd: C.downBd },
  void: { label: "VOID", fg: C.faint, bd: C.hair18 },
  failed: { label: "FAILED", fg: C.faint, bd: C.hair18 },
};
const READING: Tone = { bd: C.warnBd, bg: C.warnBg, fg: C.warn };
const FAILED: Tone = { bd: C.downBd, bg: C.downBg, fg: C.down };
const ASK: Tone = { bd: C.limeBd, bg: C.limeBg06, fg: C.lime };

const agentName = (agents: Agent[] | null, id: string): string => agents?.find((a) => a.id === id)?.name ?? id;

/** Línea de estado bajo la card: cuenta regresiva o resultado. */
function resolutionLine(read: Read, now: number): { text: string; fg: string } {
  const pd = read.priceDecimals;
  switch (read.status) {
    case "open": return { text: `Resolves in ${formatRemaining(Date.parse(read.expiresAt) - now)}`, fg: C.dim };
    case "right": return { text: `Right · resolved at ${formatPrice(read.markAtResolution ?? 0, pd)}`, fg: C.up };
    case "wrong": return { text: `Wrong · resolved at ${formatPrice(read.markAtResolution ?? 0, pd)}`, fg: C.down };
    case "void": return { text: "Voided — Perpl was unavailable at expiry. Credit refunded.", fg: C.faint };
    case "failed": return { text: "Failed — credit refunded.", fg: C.faint };
    case "pending": return { text: "Still reading…", fg: C.faint };
  }
}

export function ReadCard({ read, agentName: name, now, pushOff, footer }: { read: Read; agentName: string; now: number; pushOff?: boolean; footer?: ReactNode }) {
  const p = read.probability;
  const yes = p !== null && callOf(p);
  const line = resolutionLine(read, now);
  return (
    <Card bd={C.hair2} bg={C.deep} gap={9}>
      <Tag color={C.faint}>{read.symbol} {cellLabel(read)} · {name.toUpperCase()}</Tag>
      <T w={400} s={12} lh={1.4} color={C.dim}>{read.question}</T>
      {p !== null ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <T w={700} s={30} lh={1.1} ls={-0.02} display>{formatProbability(p)}</T>
          <Chip label={yes ? "YES" : "NO"} mono s={10} fg={yes ? C.lime : C.down} bd={yes ? C.limeBd : C.downBd} accessibilityLabel={`call-${yes ? "yes" : "no"}`} />
          <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>probability of yes · mark {formatPrice(read.markAtRequest, read.priceDecimals)} at request</T>
        </View>
      ) : null}
      {read.reasons ? (
        <View style={{ gap: 4 }}>
          <Tag>REASONS</Tag>
          {read.reasons.map((r, i) => <T key={i} w={400} s={12} lh={1.45} color={C.ink}>· {r}</T>)}
        </View>
      ) : null}
      {read.limits ? (
        <View style={{ gap: 4 }}>
          <Tag>WHAT WOULD BREAK IT</Tag>
          <T w={400} s={12} lh={1.45} color={C.dim}>{read.limits}</T>
        </View>
      ) : null}
      <T w={500} s={11} lh={1.3} mono color={line.fg}>{line.text}</T>
      {pushOff && read.status === "open" ? <T w={400} s={11} lh={1.4} color={C.faint}>Push is off — check My reads to see the result.</T> : null}
      {footer}
    </Card>
  );
}

function SessionGate({ reads }: { reads: Reads }) {
  const signing = reads.session === "signing";
  return (
    <StatusCard tag="ASK" title="Unlock to ask" body="Your wallet signs once a day to use its simulated credits. No transaction, no gas." tone={ASK}>
      <Btn label={signing ? "Unlocking…" : "Unlock with Face ID"} onPress={() => { void reads.ensureSession(); }} variant="lime" busy={signing} accessibilityLabel="ask-unlock" />
      {reads.sessionError ? <T w={400} s={11.5} lh={1.4} color={C.warn}>{reads.sessionError}</T> : null}
    </StatusCard>
  );
}

function CreditsRow({ credits }: { credits: number | null }) {
  return (
    <Card bd={C.hair14} bg={C.card} pad={11} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Tag>CREDITS</Tag>
      <T w={700} s={16} lh={1} mono accessibilityLabel="credits">{credits === null ? "—" : String(credits)}</T>
      <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>1 credit per read · simulated for the testnet</T>
    </Card>
  );
}

function MatrixGrid({ market, selected, onSelect }: { market: Market; selected?: AskCell; onSelect: (c: Cell) => void }) {
  return (
    <Card bd={C.hair14} bg={C.card} pad={10} gap={5}>
      <T w={400} s={11} lh={1.3} color={C.faint}>Mark {formatPrice(market.mark, market.priceDecimals)} · updates every 5 s</T>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <View style={{ width: 46 }} />
        {HORIZONS_MIN.map((h) => <Tag key={h} style={{ flex: 1, textAlign: "center" }}>{horizonLabel(h)}</Tag>)}
      </View>
      {LEVELS_BPS.map((bps) => (
        <View key={bps} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <T w={500} s={10} lh={1} mono color={bps > 0 ? C.up : C.down} style={{ width: 46 }}>{levelLabel(bps)}</T>
          {HORIZONS_MIN.map((h) => {
            const on = selected?.levelBps === bps && selected?.horizonMin === h;
            const p = pill(on);
            return (
              <Touch key={h} onPress={() => onSelect({ levelBps: bps, horizonMin: h })} accessibilityLabel={`cell-${bps}-${h}`}
                style={{ flex: 1, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, alignItems: "center" }}>
                <T w={500} s={9.5} lh={1} mono color={p.fg}>{formatPrice(targetFor(market.mark, bps), market.priceDecimals)}</T>
              </Touch>
            );
          })}
        </View>
      ))}
    </Card>
  );
}

function AskSheet({ market, cell, reads, agentId, onAgent, onAsk }: { market: Market; cell: AskCell; reads: Reads; agentId: string | undefined; onAgent: (id: string) => void; onAsk: () => void }) {
  const target = targetFor(market.mark, cell.levelBps);
  const question = questionFor(market.symbol, cell.levelBps, target, market.priceDecimals, expiresAtFor(new Date(), cell.horizonMin));
  const agent = reads.agents?.find((a) => a.id === agentId) ?? reads.agents?.[0];
  const noCredits = reads.credits !== null && reads.credits <= 0;
  return (
    <Card bd={C.limeBd} bg={C.limeBg06} gap={9}>
      <Tag color={C.lime}>{market.symbol} {cellLabel(cell)} · TARGET {formatPrice(target, market.priceDecimals)}</Tag>
      <T w={700} s={16} lh={1.25} ls={-0.01} display>{question}</T>
      {reads.agents === null ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError || "Loading agents…"}</T> : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {reads.agents.map((a) => {
            const on = a.id === agent?.id;
            const p = pill(on);
            return <Chip key={a.id} label={`${a.name} · by ${a.owner} · ${a.priceCredits} credit`} onPress={() => onAgent(a.id)} fg={p.fg} bd={p.bd} bg={p.bg} s={10.5} accessibilityLabel={`agent-${a.id}`} />;
          })}
        </View>
      )}
      <Btn label={noCredits ? "No credits left" : agent ? `Ask ${agent.name} · ${agent.priceCredits} credit` : "Ask"} onPress={onAsk} variant="lime" py={14} disabled={noCredits || !agent} accessibilityLabel="ask" />
      {noCredits ? <T w={400} s={11} lh={1.4} color={C.faint}>Credits are simulated for the testnet.</T> : null}
    </Card>
  );
}

function ReadRow({ read, name, now, onPress }: { read: Read; name: string; now: number; onPress: () => void }) {
  const st = STATUS[read.status];
  const line = resolutionLine(read, now);
  return (
    <TouchCard onPress={onPress} accessibilityLabel={`read-${read.id}`} style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T w={700} s={12.5} lh={1} mono style={{ flex: 1 }}>{cellLabel(read)}</T>
        {read.probability !== null ? <T w={500} s={12} lh={1} mono color={C.dim}>{formatProbability(read.probability)}</T> : null}
        <Chip label={st.label} mono s={9.5} py={5} px={8} fg={st.fg} bd={st.bd} />
      </View>
      <T w={400} s={11} lh={1.3} color={C.faint}>{name} · {line.text}</T>
    </TouchCard>
  );
}

export function AskTab(ctx: Ctx) {
  const { S, set, perpl, reads, notifications } = ctx;
  const market = perpl.context?.markets.find((m) => m.id === S.perpsMarketId)!; // MarketScreen ya comprobó que existe
  const now = useNow(30_000);
  const pushOff = notifications.permission === "denied" || notifications.permission === "unavailable";
  const focused = useMemo(() => (S.askFocusReadId ? reads.reads.find((r) => r.id === S.askFocusReadId) : undefined), [S.askFocusReadId, reads.reads]);

  const newRead = () => {
    if (reads.session !== "ready") return <SessionGate reads={reads} />;
    const { request } = reads;
    if (request.step === "pending") {
      return <StatusCard tag="READING" title="Reading… up to 60 s" body={`${agentName(reads.agents, request.agentId)} is looking at ${market.symbol} ${cellLabel(request.cell)}.`} tone={READING}><ActivityIndicator color={C.warn} style={{ alignSelf: "flex-start" }} /></StatusCard>;
    }
    if (request.step === "failed") {
      return (
        <View style={{ gap: 11 }}>
          <StatusCard tag="FAILED" title="No read this time" body={request.text} tone={FAILED} />
          <Btn label="Try again" onPress={reads.resetRequest} variant="ghost" accessibilityLabel="ask-retry" />
        </View>
      );
    }
    if (request.step === "done") {
      return (
        <ReadCard read={request.read} agentName={agentName(reads.agents, request.read.agentId)} now={now} pushOff={pushOff}
          footer={<Btn label="Ask another" onPress={() => { reads.resetRequest(); set({ askCell: undefined }); }} variant="ghost" accessibilityLabel="ask-another" />} />
      );
    }
    return (
      <View style={{ gap: 11 }}>
        <CreditsRow credits={reads.credits} />
        <MatrixGrid market={market} selected={S.askCell} onSelect={(c) => set({ askCell: c })} />
        {S.askCell ? (
          <AskSheet market={market} cell={S.askCell} reads={reads} agentId={S.askAgentId} onAgent={(id) => set({ askAgentId: id })}
            onAsk={() => { void reads.ask(S.askCell!, S.askAgentId ?? reads.agents?.[0]?.id ?? "jesus"); }} />
        ) : <T w={400} s={11} lh={1.4} color={C.faint}>Tap a cell: level above or below the mark × horizon.</T>}
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
      </View>
    );
  };

  const myReads = () => {
    if (reads.session !== "ready") return <SessionGate reads={reads} />;
    if (focused) {
      return (
        <ReadCard read={focused} agentName={agentName(reads.agents, focused.agentId)} now={now} pushOff={pushOff}
          footer={<Btn label="Back to list" onPress={() => set({ askFocusReadId: undefined })} variant="ghost" accessibilityLabel="read-back" />} />
      );
    }
    return (
      <View style={{ gap: 7 }}>
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
        {reads.reads.length === 0 ? <T w={400} s={12} lh={1.4} color={C.faint}>No reads on {market.symbol} yet.</T> : null}
        {reads.reads.map((r) => <ReadRow key={r.id} read={r} name={agentName(reads.agents, r.agentId)} now={now} onPress={() => set({ askFocusReadId: r.id })} />)}
      </View>
    );
  };

  return (
    <View style={{ paddingTop: 13, paddingHorizontal: 15, paddingBottom: 20, gap: 11 }}>
      <Segmented options={[["new", "New read"], ["mine", "My reads"]] as const} value={S.askView} onChange={(k) => set({ askView: k, askFocusReadId: undefined })} />
      {S.askView === "new" ? newRead() : myReads()}
    </View>
  );
}
```
Notas para el implementador: `Tag` recibe `style` (ya existe en primitives); `Segmented`/`StatusCard`/`Chip`/`TouchCard` se usan con las props que tienen hoy (no añadir props a `primitives.tsx`). Si `Touch` con `style` de flex no reparte el ancho, envolver la fila en `View` con `flexDirection: "row"` como ya se hace. **Sin «Trade this level»** (P9).

- [ ] **Step 2: Verificación y commit**

```bash
npx tsc --noEmit && echo TSC-OK
git add src/screens/ask.tsx
git commit -m "feat(mobile): pantalla Ask — gate de sesión, matriz 5×4, AskSheet, ReadCard y My reads"
```
Expected: `TSC-OK` (nada la importa todavía; Task 9 la conecta).

---

### Task 9: `AgentsTab`, enrutado de pills, hooks montados, pull-to-refresh y **recorrido en el simulador**

**Files:**
- Create: `apps/mobile/src/screens/agents.tsx`
- Modify: `apps/mobile/src/screens/market.tsx`, `apps/mobile/src/screens/comingSoon.tsx`, `apps/mobile/src/screens/comingSoonCopy.ts`, `apps/mobile/__tests__/comingSoon.test.ts`, `apps/mobile/src/ctx.ts`, `apps/mobile/App.tsx`, `apps/mobile/src/Shell.tsx`

**Interfaces:**
- Consumes: todo lo anterior. `AppCtx` gana `reads: Reads` y `notifications: Notifications` (con eso el tipo `Ctx` de `ask.tsx` es redundante y se puede dejar como `AppCtx`).

- [ ] **Step 0: Limpiar las wallets de prueba de F1 (P13)** — desde `services/reads` del worktree:

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/services/reads
W="'0xf73ffe46b43ada3e2ef0cc6da6795ffb83ea1b4f','0x6b4e000fdc719ddfb56607aaa2af3563edd0768e','0x1449bd0ef13c2a935998fed58080aec385eb1408','0xdea47c75a81ec6bd367bbe6114e4c63b6bbf6616'"
node scripts/query.mjs --read-only "select address, credits from mobile.wallets where address in ($W)"
node scripts/query.mjs "delete from mobile.credit_events where address in ($W); delete from mobile.reminders where address in ($W); delete from mobile.reads where address in ($W); delete from mobile.devices where address in ($W); delete from mobile.wallets where address in ($W);"
node scripts/query.mjs --read-only "select id, reads, resolved, right_count, brier_avg from mobile.agent_records order by sort"
```
Expected: antes, 4 filas; después, `agent_records` con `reads 0, resolved 0` en `jesus`, `drift`, `anchor`. Si hay otras wallets (de otra sesión), **no tocarlas**; anotar.

- [ ] **Step 1: `comingSoon.test.ts` (RED)** — sustituir el segundo test por:

```ts
test("Ask and Agents are real now: no inline coming-soon copy for Market pills (D13)", () => {
  expect((COMING_SOON_COPY as Record<string, unknown>).ask).toBeUndefined();
  expect((COMING_SOON_COPY as Record<string, unknown>).agents).toBeUndefined();
});
```
y quitar `MARKET_COMING_SOON` del import. Run: `npx jest __tests__/comingSoon.test.ts` → PASS ya (la clave nunca estuvo en `COMING_SOON_COPY`); el RED real es `tsc`: en Step 2 se borra `MARKET_COMING_SOON` y `ComingSoonCard`, y `market.tsx` deja de compilar hasta el Step 4.

- [ ] **Step 2: Quitar el coming soon de los pills**

`comingSoonCopy.ts`: borrar `MarketComingSoon` y `MARKET_COMING_SOON` (quedan `ComingSoonTab`, `ComingSoonCopy`, `COMING_SOON_COPY`). `comingSoon.tsx`: borrar `ComingSoonCard` y el import de `MARKET_COMING_SOON`; quitar `Card` y `Tag` del import si quedan sin uso.

- [ ] **Step 3: `src/screens/agents.tsx`**

```tsx
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { recordLabel } from "../reads/matrix";
import { Avatar, Chip, T, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

/** Pill Agents (D15): lista de agentes con récord real; tocar uno lo preselecciona en Ask. */
export function AgentsTab({ reads, set }: AppCtx) {
  return (
    <View style={{ paddingTop: 13, paddingHorizontal: 15, paddingBottom: 20, gap: 7 }}>
      {reads.agentsError ? (
        <Warn title="Couldn't load agents" body={reads.agentsError}>
          <Chip label="Retry" onPress={() => { void reads.refresh(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agents" />
        </Warn>
      ) : null}
      {reads.agents === null && !reads.agentsError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading agents…</T> : null}
      {(reads.agents ?? []).map((a) => (
        <TouchCard key={a.id} onPress={() => set({ askAgentId: a.id, marketTab: "ask", askView: "new" })} accessibilityLabel={`agent-row-${a.id}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
          <Avatar initials={a.name.slice(0, 1).toUpperCase()} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={14} lh={1.2}>{a.name}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} style={{ marginTop: 3 }}>by {a.owner}</T>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <T w={500} s={10.5} lh={1} mono color={C.dim}>{recordLabel(a.record)}</T>
            <T w={500} s={10} lh={1} mono color={C.faint}>{a.priceCredits} credit</T>
          </View>
        </TouchCard>
      ))}
    </View>
  );
}
```

- [ ] **Step 4: `ctx.ts`, `market.tsx`, `App.tsx`, `Shell.tsx`**

`src/ctx.ts`:
```ts
import type { AccountState } from "./account";
import type { AccountActions } from "./hooks/useAccount";
import type { Notifications } from "./hooks/useNotifications";
import type { Perpl } from "./hooks/usePerpl";
import type { Reads } from "./hooks/useReads";
import type { Treasury } from "./hooks/useTreasury";
import type { AppStore } from "./store";

/** Todo lo que reciben Shell, DevControls y las pantallas. */
export type AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury; perpl: Perpl; reads: Reads; notifications: Notifications };
```
`src/screens/market.tsx`: quitar `import { ComingSoonCard } from "./comingSoon";`, añadir `import { AgentsTab } from "./agents";` y `import { AskTab } from "./ask";`, y en `MarketScreen`:
```tsx
      {S.marketTab === "trade" ? <TradeTab {...ctx} /> : S.marketTab === "ask" ? <AskTab {...ctx} /> : <AgentsTab {...ctx} />}
```
En `ask.tsx`, cambiar `type Ctx = AppCtx & {…}` por `type Ctx = AppCtx;` (o usar `AppCtx` directo) y borrar los imports de tipo que sobren.

`App.tsx`:
```tsx
import { useNotifications } from "./src/hooks/useNotifications";
import { useReads } from "./src/hooks/useReads";
import { patchForPush } from "./src/reads/push";
…
  const store = useAppStore({ hasAccount, perpsMarkets: perpl.context?.markets ?? [] });
  const { requireAccount } = store;
  // Tap en un push: abre Market en la read (o en Trade para un recordatorio) respetando el gate (P7).
  const onPushTarget = useCallback((t: PushTarget) => requireAccount("market", patchForPush(t)), [requireAccount]);
  const notifications = useNotifications(onPushTarget);
  const reads = useReads(account ?? NONE, onWallet, notifications, store.S.perpsMarketId);
  …
  const perpsActive = PERPL_SCREENS.includes(store.S.screen);
  const readsActive = store.S.screen === "market" && store.S.marketTab !== "trade";
  const { setActive } = perpl;
  const { setActive: setReadsActive } = reads;
  useEffect(() => { setActive(perpsActive); }, [perpsActive, setActive]);
  useEffect(() => { setReadsActive(readsActive); }, [readsActive, setReadsActive]);
  …
  const ctx: AppCtx = { ...store, account, treasury, perpl, reads, notifications, onWallet, lock, signOut };
```
(añadir `useCallback` al import de React y `import type { PushTarget } from "./src/reads/push";`).

`src/Shell.tsx`: `const { S, back, requireAccount, treasury, perpl, reads } = ctx;`, `const refreshable = S.screen === "wallet" || S.screen === "markets" || S.screen === "market";` y en `onRefresh`:
```ts
      await Promise.allSettled(
        S.screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()]
        : S.screen === "market" ? [perpl.refreshContext(), reads.refresh()]
        : [perpl.refreshContext()],
      );
```
con `[S.screen, treasury, perpl, reads]` en las deps.

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
```
Expected: `TSC-OK`; todos los tests en verde.

- [ ] **Step 5: Instalar y arrancar en el simulador**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/apps/mobile
mkdir -p "$SCRATCH/f2-shots"
npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 2>&1 | tee "$SCRATCH/run.log" | tail -6
xcrun simctl spawn 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 notifyutil -p com.apple.BiometricKit.enrollmentChanged
```
Sign in con el passkey existente del simulador (Apple Passwords; presentar cara con `xcrun simctl spawn <UDID> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match` cuando lo pida). Captura `01-wallet.png`. Anotar la **dirección** de la wallet del simulador (Wallet → dirección) en el audit: `$SIM_ADDR`.

- [ ] **Step 6: Recorrido Ask → Agents (con capturas, mirando cada una)**

1. Markets → BTC → pill **Ask**. Wallet `locked` → `SessionGate` («Unlock to ask»). Captura `02-ask-gate.png`. Tocar «Unlock with Face ID» → presentar cara → créditos **20**, «Mark … · updates every 5 s», matriz con 20 targets. Verificar a mano un target: `+1.0%` de BTC = `round(mark × 1.01)` con `priceDecimals 1`. Captura `03-ask-matrix.png`.
2. Tocar `cell-100-240` → `AskSheet` con la pregunta, tres chips de agente (el primero seleccionado) y «Ask Jesús's agent · 1 credit». Captura `04-ask-sheet.png`.
3. Tocar «Ask» → **prompt de permiso de notificaciones** (primera vez; aceptar) → `READING` con spinner. Captura `05-ask-reading.png`. En < 60 s aparece la `ReadCard` con probabilidad, YES/NO, 3 razones, límites y «Resolves in 3 h 5x m». Captura `06-ask-readcard.png`. Créditos: volver con «Ask another» → **19**. Captura `07-ask-19.png`.
4. Verificar por SQL que llegó el token (P6):
   ```bash
   cd ../../services/reads && node scripts/query.mjs --read-only "select address, env, length(token) as len, updated_at from mobile.devices where address = '$SIM_ADDR'"
   node scripts/query.mjs --read-only "select id, status, level_bps, horizon_min, probability, expires_at from mobile.reads where address = '$SIM_ADDR' order by created_at desc limit 3"
   ```
   Expected: una fila en `devices` con `env sandbox` y `len 64`; la read `open` con `probability` no nula. Guardar `$READ_ID`.
5. Segmentado **My reads** → un `ReadRow` `+1.0% · 4H`, agente, probabilidad, chip `OPEN` warn, «resolves in …». Captura `08-my-reads.png`. Tocarlo → `ReadCard` + «Back to list». Captura `09-my-reads-card.png`.
6. Pill **Agents** → tres `TouchCard` con «No resolved reads yet» (tras P13) y «1 credit». Captura `10-agents.png`. Tocar `Drift` → vuelve a **Ask · New read** con Drift preseleccionado en la hoja (elegir una celda para verlo). Captura `11-agents-preselect.png`.
7. Pill **Trade** y de vuelta a **Ask**: la sesión no vuelve a pedir Face ID; el pull-to-refresh en Market no cuelga el spinner.

- [ ] **Step 7: Resolución forzada y push**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/services/reads
node scripts/query.mjs "update mobile.reads set expires_at = now() - interval '1 second' where id = '$READ_ID' and status = 'open'"
sleep 75
node scripts/query.mjs --read-only "select status, outcome, brier, mark_at_resolution, resolved_at from mobile.reads where id = '$READ_ID'"
node scripts/query.mjs --read-only "select id, status_code, left(content::text, 160) as content from net._http_response order by id desc limit 2"
```
Expected: `right` o `wrong` con `mark_at_resolution`; `net._http_response` con `{"resolved":1,…,"pushSent":N}`.

- **Si existen los secretos `APNS_*`** (`npx supabase secrets list --project-ref yvdipvcrpbqvofayteqf` los lista): `pushSent` debe ser **1** y el push llega al simulador (banner «BTC +1.0% · 4H — Jesús's agent was right · mark …»). Captura `12-push.png`. Tocarlo → la app abre Market → Ask → My reads con esa read (`RIGHT`/`WRONG`). Captura `13-push-tap.png`.
- **Si no existen** (estado al escribir el plan): `pushSent` es **0** (`console.error apns: APNS secrets missing` en los logs de la función) y el push real **no se puede probar**; se prueba el **tap** con `simctl push`:
  ```bash
  cat > "$SCRATCH/read.apns" <<EOF
  { "Simulator Target Bundle": "fun.pickler.app",
    "aps": { "alert": { "title": "BTC +1.0% · 4H", "body": "Jesús's agent was right · mark 81250.0" }, "sound": "default" },
    "pickler": { "kind": "read", "readId": "$READ_ID", "marketId": 16 } }
  EOF
  xcrun simctl push 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 fun.pickler.app "$SCRATCH/read.apns"
  ```
  Con la app en **segundo plano** (Home): llega el banner → captura `12-push.png` → tocarlo → Market → Ask → My reads con la read enfocada mostrando `RIGHT`/`WRONG` y «resolved at …». Captura `13-push-tap.png`. Repetir con la app **cerrada** (`xcrun simctl terminate <UDID> fun.pickler.app`, push, tocar): debe aterrizar igual (frío, `getLastNotificationResponseAsync`). Captura `14-push-cold.png`. Anotar en el audit que el push real queda pendiente de la key (F1 pendiente 1).
- Si `PUSH_MODE` tuviera que pasar a `"local"` (decisión de Jesús tras el smoke de F1), no es parte de este recorrido.

- [ ] **Step 8: Sign out / sign in**

Wallet → «Sign out» → Sign in con el passkey → Markets → BTC → **Ask**: vuelve el `SessionGate` (la sesión se borró, D6) → «Unlock with Face ID» → créditos **19** (misma wallet) y My reads con la read resuelta. Captura `15-after-signout.png`.

- [ ] **Step 9: Dinero y cuenta**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/services/reads
node scripts/query.mjs --read-only "select reason, sum(delta) from mobile.credit_events where address = '$SIM_ADDR' group by reason order by reason"
```
Expected: `grant 20`, `charge −1` (sin `refund` si la read no falló). Saldos AUSD/MON del simulador **sin cambio** (Wallet muestra los mismos que antes del recorrido; anotar los dos números). Ninguna orden en Perpl.

- [ ] **Step 10: Verificación final y commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/apps/mobile
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/screens/agents.tsx src/screens/market.tsx src/screens/comingSoon.tsx src/screens/comingSoonCopy.ts __tests__/comingSoon.test.ts src/ctx.ts App.tsx src/Shell.tsx src/screens/ask.tsx
git commit -m "feat(mobile): Ask y Agents reales en Market — hooks montados, push abre la read, pull-to-refresh"
```

---

### Task 10: README, spec, overview, manifest, audit F2 y revisión independiente

**Files:**
- Modify: `apps/mobile/README.md`, `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/2026-09-19-mobile-ask.html` (phase-card F2), `docs/overview/data/manifest.js`
- Create: `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`

- [ ] **Step 1: README de la app**

En `apps/mobile/README.md`: primer párrafo, «Reales: Wallet (…) y Markets (Perpl)» → añadir «, Ask (lecturas de agente sobre la matriz nivel × horizonte, créditos simulados) y Agents (récord real)». Sección Tests → el número real (`npm test 2>&1 | tail -4`). Nueva sección tras «Perpl (tab MARKETS)»:

```markdown
## Ask y Agents (pills de Market)

Backend en `services/reads` (Supabase `pickler`, esquema `mobile`; URL en `src/config/reads.ts`, override
`PICKLER_READS_URL`). La app firma una vez al día `pickler-reads:<address>:<ts>` con la wallet (Face ID si está
bloqueada) y guarda `{ address, ts, sig }` en SecureStore (`pickler.reads.v1`); Sign out lo borra. Créditos simulados:
20 por wallet, 1 por lectura, reembolso si el agente falla. El push de resolución lo manda el servidor por APNs
(`expo-notifications`, entorno `sandbox` en dev); tocarlo abre Market → Ask → My reads en esa read. Para probar el
tap sin APNs: `xcrun simctl push <UDID> fun.pickler.app payload.apns` con `{ "pickler": { "kind": "read", "readId", "marketId" } }`.
`PUSH_MODE = "local"` (fallback D10) programa una notificación local al vencer en vez de esperar el push.
`expo-notifications` es nativo: tras instalar, `prebuild --clean` + `run:ios`.
```

- [ ] **Step 2: Correcciones al spec** (marcadas **(F2)**, sin reescribir secciones):

- D6: «**(F2)** la sesión se parte en `src/reads/session.ts` (puro) + `src/storage/reads.ts` (SecureStore); se renueva con menos de 1 h de vida; un `401` la descarta y Ask vuelve al gate (P2); con la wallet abierta se firma sin prompt, bloqueada pide Face ID al tocar «Unlock» (P3).»
- D10: «**(F2)** `PUSH_MODE` en `src/config/reads.ts` conmuta APNs / local; el tap lee `pickler` de `content.data` o del `userInfo`; navega con `requireAccount` (P7). Estado del smoke real: <lo que haya pasado>.»
- D13: `headerFor(screen, symbol, marketTab)`; `TradeLevel` declarado en F2.
- D14: «**(F2)** «Trade this level» no se renderiza hasta F3 (P9); My reads es store-driven por `askFocusReadId` (P8).»
- D16: `src/reads/constants.ts` (timeouts y poll, puro) y `src/reads/push.ts` (nuevo); `expo-notifications 57.x.y`.
- §2.3: añadir `push.ts`, `constants.ts`, `storage/reads.ts`; tests jest reales (`reads-config`, `reads-matrix`, `reads-types`, `reads-session`, `reads-api`, `reads-push`, `store`, `comingSoon`).
- Cabecera **Estado**: «F2 ejecutada (plan `…-f2.md`, audit `…-f2-rulings.md`)».

Run: `npm run docs:html` (raíz del worktree) → `[ok]` para el spec y el plan F2.

- [ ] **Step 3: Overview y manifest**

`docs/overview/2026-09-19-mobile-ask.html`, phase-card `data-phase="2"`: `data-status="completed"` (o `in_progress` si el push real quedó sin probar por la key **y** Jesús quiere que eso bloquee; si no, `completed` con la nota en el audit — decisión suya en el checkpoint), `<option value="…" selected>`, y dentro de `.phase-body` tras `.phase-meta`:
```html
          <details class="tasks">
            <summary>
              <span>Tasks del plan</span>
              <span class="progress-pill" data-tasks-counter>0/0</span>
            </summary>
            <ol>
              <li><label><input type="checkbox" checked> Task 0: expo-notifications, readsUrl, src/config/reads.ts y rebuild nativo</label></li>
              <li><label><input type="checkbox" checked> Task 1: src/reads/matrix.ts — matriz, target, pregunta, etiquetas, cuenta regresiva</label></li>
              <li><label><input type="checkbox" checked> Task 2: src/reads/types.ts — tipos y parseo estricto de los DTOs</label></li>
              <li><label><input type="checkbox" checked> Task 3: Sesión firmada (session.ts, storage/reads.ts, Sign out)</label></li>
              <li><label><input type="checkbox" checked> Task 4: src/reads/api.ts — cliente HTTP con timeouts y errores</label></li>
              <li><label><input type="checkbox" checked> Task 5: Store — askView, askCell, askAgentId, askFocusReadId, tradeLevel, headerFor</label></li>
              <li><label><input type="checkbox" checked> Task 6: push.ts + useNotifications — permiso, token, tap, fallback local</label></li>
              <li><label><input type="checkbox" checked> Task 7: useReads — sesión, créditos, lista, agentes, ask(), polling</label></li>
              <li><label><input type="checkbox" checked> Task 8: Pantalla Ask — gate, matriz, AskSheet, ReadCard, My reads</label></li>
              <li><label><input type="checkbox" checked> Task 9: AgentsTab, enrutado, hooks montados y recorrido en el simulador</label></li>
              <li><label><input type="checkbox" checked> Task 10: README, spec, overview, manifest, audit F2 y revisión independiente</label></li>
            </ol>
          </details>
```
(marcar `checked` sólo lo que realmente cerró). `manifest.js`: `phases[1].status` a `completed` / `in_progress`.

- [ ] **Step 4: Audit de F2**

`docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`, secciones en este orden, con la evidencia pegada (no descrita):
1. **Qué quedó hecho y verificado** — por task: comandos y salidas (`expo install` con la versión, `prebuild`/`run:ios` con `Build Succeeded`, `npm test` con el conteo final, `tsc`, la línea del `.entitlements`, las consultas SQL de Task 9 con sus filas, `net._http_response`, el resultado de `simctl push`, el ledger de la wallet del simulador) y la lista de capturas con lo que muestra cada una.
2. **Decisiones tomadas durante la ejecución (rulings)** — numeradas; cualquier desviación de P1–P14 o del spec, con *qué cuesta si está mal*.
3. **Correcciones a afirmaciones previas** — del spec o de este plan (nombres reales de la API de `expo-notifications`, conteos de tests, etc.).
4. **Estado de las cuentas y del servicio al cierre** — dirección de la wallet del simulador y sus créditos; saldos AUSD/MON antes/después (iguales); `mobile.devices` (`env`, `updated_at`, nunca el token completo); wallets de prueba borradas (P13); secretos presentes (sólo nombres) y si el push real se vio llegar o quedó pendiente de la key.
5. **Pendientes / residuales** — ordenados por peso; incluir: key APNs + smoke F1 + push real en el simulador; capability Push Notifications en el App ID (F4); `PUSH_MODE` (decisión tras el smoke); persona de `jesus`; minors diferidos de las revisiones.
6. **Siguiente punto de decisión** — F3 (`LevelCard`, `reminder-set`, `BookCard` o versión reducida según el riesgo §4 del spec) y si se mergea/pushea F2.

- [ ] **Step 5: Revisión independiente**

Dispatch de un subagente revisor (regla global) con: el spec, este plan, `git diff main...HEAD -- apps/mobile docs` y el audit. Pedirle que verifique: (a) la sesión nunca se firma sin gesto del usuario cuando la wallet está bloqueada, se borra en Sign out y un `401` la descarta; (b) `pushToken` sólo viaja con permiso concedido y `pushEnv` es `sandbox` en `__DEV__`; (c) `targetFor`/`questionFor` de la app coinciden con `services/reads/supabase/functions/_shared/matrix.ts` (mismos números en ambos tests); (d) ningún secreto ni token de dispositivo en archivos versionados ni en el audit (`git grep -n "sbp_\|sk-ant\|BEGIN PRIVATE"` vacío; `mobile.devices` sólo con `length(token)`); (e) los estados de la `ReadCard` cubren los seis `status`; (f) `AbortController` en todos los `fetch` y ningún `AbortSignal.timeout`. Aplicar lo que proceda y anotar la revisión (hallazgos y qué se hizo) en el audit.

- [ ] **Step 6: Checks finales**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git status --short
```
Expected: `docs:check` `errors=0`; `agents:check` `"errors": []`; tests y `tsc` en verde; el árbol muestra sólo lo que va en el commit de esta task.

- [ ] **Step 7: Commit (sólo si Jesús autorizó commits) y handoff**

```bash
git add apps/mobile/README.md docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-19-mobile-ask-f2.md docs/superpowers/plans/2026-09-19-mobile-ask-f2.html docs/overview/2026-09-19-mobile-ask.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md
git commit -m "docs(mobile-ask): F2 ejecutada — spec corregido, overview, manifest, README y audit F2"
```
Handoff al cierre: qué quedó en la app, qué falta (push real pendiente de la key APNs, capability Push en el App ID, `PUSH_MODE`), y que el siguiente paso es el **plan de F3**, que no se escribe en la misma sesión sin checkpoint. **Sin push, sin merge, sin TestFlight.**

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec (F2)**: D6 → Tasks 3, 4, 7 (mensaje canónico, 24 h en SecureStore, headers, borrado en Sign out, firma con `openWallet()`); D10 (push de resolución, lado app) → Tasks 0, 6, 7, 9 (plugin y entitlement, permiso en la primera confirmación, `pushToken`/`pushEnv` en `read-request`, tap → `market` con el pill, fallback local detrás de `PUSH_MODE`); D13 → Task 5 (+ `COMING_SOON_COPY`/`ComingSoonCard` en Task 9); D14 → Task 8 (Segmented, créditos, matriz, hoja, `READING`/`FAILED`/`ReadCard`, My reads con chips y vacío, «No credits left»); D15 → Task 9 (`AgentsTab`, preselección, `refreshable` gana `market`); D16 → Tasks 0–7 (`config/reads.ts`, `types`, `matrix`, `session`, `api` con 65 s/15 s, `useReads` con polling de 15 s y foreground, `useNotifications`). §2.3: todos los módulos nombrados salvo los de F3; tests jest `reads-matrix`, `reads-session`, `reads-types`, `store` como pide el spec, más `reads-api`, `reads-push`, `reads-config`. Verificación §3 F2 completa en Task 9 (créditos 20 → 19, Face ID una sola vez, pending → card < 60 s, My reads OPEN, Agents con «No resolved reads yet» y preselección, read forzada por SQL + push o `simctl push` + tap que abre My reads, Sign out + sign in vuelve a pedir la firma, capturas, saldos sin cambio). Fuera a propósito: «Trade this level» y `LevelCard` (P9, F3).
- **Placeholders**: ninguno; las dos entradas externas (key APNs → push real; capability Push en el App ID → F4) están declaradas como bloqueos con su camino alterno, no como TBD.
- **Consistencia de tipos**: `ReadsSession { address, ts, sig }` (Task 3) lo consumen `signedHeaders` (Task 4) y `useReads` (Task 7); `Read`/`Agent` (Task 2) los usan `api`, `push`, `useReads`, `ask`, `agents`; `AskCell` del store (Task 5) es el tipo de `RequestState.pending.cell` y de `ask(cell, agentId)`; `Cell` de `matrix.ts` (literal) es asignable a `AskCell` (numérico); `Notifications` (Task 6) entra a `useReads` (Task 7) y a `AppCtx` (Task 9); `PushTarget` → `patchForPush` → `requireAccount` en `App.tsx`; `headerFor` gana un tercer parámetro con default, así las llamadas existentes siguen compilando; `pushEnvFor(__DEV__)` produce el mismo `"sandbox" | "production"` que acepta `ReadRequest.pushEnv`.
