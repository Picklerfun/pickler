# Carga visible (mobile-loading) — F1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada sección con datos remotos de la app muestre su propio skeleton hasta que llegue su dato, que el pull-to-refresh deje un sello `UPDATED HH:MM:SS` (o `COULDN'T REFRESH` 3 s), y que la app abra con la P lima sobre `#05061A` en vez de un splash en blanco.

**Architecture:** Tres piezas independientes sobre lo que ya existe. (1) Primitivas `Skeleton` (`Line`/`Card`/`Row`, un solo pulso compartido) y `Reveal` (fade 150 ms) en `ui/primitives.tsx`; cada pantalla sustituye sus textos «Loading…» por skeletons con la regla `dato === null && !error`, y `reads.reads` pasa a `Read[] | null`. (2) `Shell.tsx` guarda `updatedAt` por pantalla y decide éxito/fallo del jalón con helpers puros de `store.ts` (`refreshOk`, `screenHasData`, `updatedLabel`) evaluados en un efecto tras terminar el jalón. (3) `expo-splash-screen` (plugin + `assets/splash-mark.png` recortado de `icon.png`) y `hideAsync` cuando `account !== null`, con timeout de 2 s.

**Tech Stack:** Expo SDK 57 / RN 0.86 (`Animated` nativo), jest-expo (`__tests__/*.test.ts`), TypeScript (`npx tsc --noEmit`), `expo-splash-screen` (SDK 57), PIL (python3 del sistema, 12.3) para el asset. Simulador iPhone 17 Pro `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Maestro (`taplabel.sh`).

**Spec:** `docs/superpowers/specs/2026-09-21-mobile-loading-design.md` (D1–D8). Overview `docs/overview/2026-09-21-mobile-loading.html` (F1 `pending` → `plan_ready` al guardar este plan → `completed` con el audit).

## Global Constraints

- Worktree `.claude/worktrees/mobile-loading`, rama `feat/mobile-loading` desde `main` local = `4be010c`. Primer comando en el worktree: `cd apps/mobile && npm ci`. Nunca `cd` al checkout principal para editar. Nunca `git add -A`; archivos por nombre. Commits `feat(mobile): …` / `fix(mobile): …` / `docs(mobile-loading): …` con trailers `Co-Authored-By: <modelo que escribe> <noreply@anthropic.com>` y `Claude-Session: <URL de la sesión que ejecuta>`. **Sin push, sin merge, sin TestFlight** salvo autorización explícita de Jesús en la sesión.
- **Metro**: hoy corre en :8081 desde `.claude/worktrees/markets-ask-gate/apps/mobile` (otro worktree, ya mergeado). Para las tasks con simulador hay que **matarlo** (`lsof -tiTCP:8081 -sTCP:LISTEN | xargs kill`) y arrancarlo desde **este** worktree: `nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 &` y esperar `Waiting on http://localhost:8081`. Task 6 (splash) cambia nativo → `npx expo prebuild --platform ios --clean` + `npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0` (reinstala el dev build; **borra la cuenta local del simulador**: sign in con el passkey «pickler» de Apple Passwords + Face ID `xcrun simctl spawn <UDID> notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`; si el simulador no tiene Face ID enrolado, antes `notifyutil -s com.apple.BiometricKit.enrollmentChanged 1`).
- Simulador **siempre por UDID**, nunca `booted`. Capturas con `xcrun simctl io <UDID> screenshot …` y **mirar cada una**. Cuenta #620: **no mover AUSD ni MON, ninguna orden, ningún Enable/Reconnect/Reset**. Otra sesión (Proflores iOS) usa el mismo simulador: anotar y recuperar si algo cambia solo.
- Regla D2 (única, sin excepciones): una sección pinta skeleton **si y sólo si** su dato es `null` y no hay error; con error, la `Warn`/card de error existente; con dato, el contenido. Una sección con dato nunca vuelve a skeleton. **Nada de `loading` booleanos nuevos en hooks.**
- Sin dependencias nuevas salvo `expo-splash-screen` (Task 6, `npx expo install`). Copy en inglés; comentarios en español donde el archivo vecino los tenga; tests en inglés. `npm test` (hoy 31 suites / 237 tests) y `npx tsc --noEmit` en verde al cierre de cada task que toca código. Sin tests de UI (P12 del plan F2 de Ask): pantallas por `tsc` + simulador.
- Splash (D6/D7, verificado en `https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/` el 2026-09-21): plugin `["expo-splash-screen", { image, imageWidth, resizeMode, backgroundColor }]`; API `import * as SplashScreen from "expo-splash-screen"`; `preventAutoHideAsync()` **en ámbito de módulo**; `hideAsync()`; `setOptions({ fade, duration })`. `ios/` no está versionado (`.gitignore`): el storyboard lo regenera `prebuild`.
- Docs: contrato `docs/CLAUDE.md`; `npm run docs:html`; `docs:check` errors=0; `agents:check` `"errors": []`.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | **`Skeleton` = `Object.assign(SkeletonBlock, { Line, Card, Row })`** exportado desde primitives; el pulso es un `Animated.Value` de módulo con `Animated.loop` arrancado por refcount (`usePulse`). `Reveal` es un `Animated.View` que va de 0 a 1 en 150 ms al montarse. | D1/D4 sin dependencias; un solo loop aunque haya 20 bloques. |
| P2 | **Sección Market con `context === null`**: `AskTab`/`TradeTab`/`AgentsTab` no pueden renderizar sin `market` (viene de `perpl.context`), así que el skeleton de «matriz» del spec (D3) es un **`MarketSkeleton`** en `market.tsx` que sustituye «Loading market…»: pills en skeleton + `Skeleton.Card` (créditos) + 5 `Skeleton.Row` (la escalera) — `MatrixGrid` **no** gana prop `loading`. Se marca **(F1)** en D3 del spec (Task 8). | Desde Markets el contexto siempre existe; el caso real es el arranque en frío por push. |
| P3 | **Card `TRADING · AUSD` (Markets) y línea «in trading» (Wallet)** pintan skeleton sólo si `perpl.live === null && perpl.lastBalance === null`: `lastBalance` («last seen») es dato válido por diseño de hifi F2. | No borrar un dato que la app ya enseña a propósito. |
| P4 | **Éxito del jalón** (D5): `treasury.refresh()` y `perpl.refreshContext()` tragan errores (los guardan en `rpcError`/`movementsError`/`contextError`), así que «fulfilled» en `allSettled` no es éxito. `Shell` incrementa `refreshDone` al terminar el jalón y un efecto evalúa `refreshOk(screen, errors)` con los errores **de ese render** (evita leer estado viejo tras el `await`). | Estado de React tras un `await` no está garantizado en la misma tarea. |
| P5 | **Sello inicial** (D5): efecto en `Shell` que fija `updatedAt[screen] = Date.now()` la primera vez que `screenHasData(screen, …)` es true. | La carga inicial la disparan los hooks al montar, no el Shell. |
| P6 | **`COULDN'T REFRESH`** se pinta en el mismo `Tag` del sello, en `C.down`, 3 s (`setTimeout` limpiado al desmontar), y luego vuelve el sello anterior (o nada si no había). | Un solo sitio, sin card nueva. |
| P7 | **Asset del splash**: `scripts/splash-mark.py` (PIL, flood fill desde los bordes con `thresh=140`, recorte + margen 40 px, 720×720) versionado en `apps/mobile/scripts/`; el PNG generado también se versiona (`assets/splash-mark.png`). Probado el 2026-09-21: recorte limpio (queda una sombra mínima entre los dos bloques del pie, invisible a 140 pt). | Reproducible; `icon.png` es la única fuente a 1024 px. |
| P8 | **`SplashScreen.setOptions({ fade: true, duration: 200 })`** justo después de `preventAutoHideAsync()`; si `tsc` dice que la firma difiere en la versión instalada, quitar `setOptions` y anotarlo. | La doc del SDK 57 lo lista; se comprueba contra la versión real. |
| P9 | El estado `!fontsLoaded || account === null` de `App.tsx` deja de pintar el `ActivityIndicator` lima: devuelve `null` (la vista nativa del splash sigue visible porque `hideAsync` aún no corrió). | Evitar el spinner entre splash y primera pantalla. |
| P10 | **Capturas de skeleton** (D8): el skeleton de Ask/Agents se fuerza arrancando Metro con `PICKLER_READS_URL=http://127.0.0.1:9/` (puerto cerrado → la petición falla rápido: eso da la **card de error**, no skeleton) — para ver el skeleton se usa `PICKLER_READS_URL=http://10.255.255.1/` (IP no enrutable: la petición cuelga hasta el timeout de 12 s de `useReads`) y se captura en los primeros 5 s. Wallet/Markets: capturar en el primer segundo tras `launch` (RPC y Perpl tardan 1–3 s). | Reproducible sin tocar cuentas. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/src/store.ts`, `__tests__/store.test.ts` | 1 | `updatedLabel`, `refreshOk`, `screenHasData` (puros, con test) |
| `apps/mobile/src/ui/primitives.tsx` | 2 | `Skeleton` (+ `Line`/`Card`/`Row`), `Reveal`, `usePulse` |
| `apps/mobile/src/hooks/useReads.ts`, `src/screens/ask.tsx`, `src/screens/agents.tsx` | 3 | `reads: Read[] \| null`; skeletons de créditos, chips de agentes, My reads, Agents |
| `apps/mobile/src/screens/wallet.tsx`, `src/screens/markets.tsx`, `src/screens/market.tsx` | 4 | skeletons de saldos, trading, movimientos, lista de mercados, posiciones, `MarketSkeleton` |
| `apps/mobile/src/Shell.tsx` | 5 | sello `UPDATED` / `COULDN'T REFRESH` |
| `apps/mobile/package.json`, `package-lock.json`, `app.config.ts`, `App.tsx`, `assets/splash-mark.png`, `scripts/splash-mark.py` | 6 | splash |
| Simulador | 7 | capturas (D8) |
| `docs/superpowers/specs/2026-09-21-mobile-loading-design.md`, `docs/overview/2026-09-21-mobile-loading.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-21-mobile-loading-f1-rulings.md`, `docs/superpowers/audits/img/*.png`, `apps/mobile/README.md` | 8 | marcas (F1), F1 `completed`, audit, README |

---

### Task 1: Helpers puros del sello en `store.ts`

**Files:**
- Modify: `apps/mobile/src/store.ts` (después de `marketEntryTab`, línea ~118)
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Produces: `updatedLabel(ts: number): string`; `type RefreshErrors = { rpcError: string; movementsError: string; contextError: string; listError: string }`; `refreshOk(screen: Screen, e: RefreshErrors): boolean`; `screenHasData(screen: Screen, d: { balances: unknown; context: unknown }): boolean`. Los usa Task 5.

- [ ] **Step 1: Línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-loading/apps/mobile
git status --short && git log --oneline -1
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio, HEAD `4be010c`; `Tests: 237 passed` / `31 passed`; `TSC-OK`. Si falta `node_modules`, `npm ci` primero.

- [ ] **Step 2: Tests (RED)** — añadir `updatedLabel, refreshOk, screenHasData` al import de `../src/store` en `__tests__/store.test.ts` y al final del archivo:

```ts
test("updatedLabel formats a local 24h timestamp", () => {
  const ts = new Date(2026, 8, 21, 8, 5, 9).getTime(); // local time on purpose: the label is what the user sees
  expect(updatedLabel(ts)).toBe("UPDATED 08:05:09");
  expect(updatedLabel(new Date(2026, 8, 21, 23, 59, 0).getTime())).toBe("UPDATED 23:59:00");
});

test("refreshOk needs at least one source of the screen to succeed", () => {
  const ok = { rpcError: "", movementsError: "", contextError: "", listError: "" };
  expect(refreshOk("wallet", ok)).toBe(true);
  expect(refreshOk("wallet", { ...ok, rpcError: "x" })).toBe(true); // movements still refreshed
  expect(refreshOk("wallet", { ...ok, rpcError: "x", movementsError: "y" })).toBe(false);
  expect(refreshOk("markets", ok)).toBe(true);
  expect(refreshOk("markets", { ...ok, contextError: "x" })).toBe(false);
  expect(refreshOk("market", { ...ok, contextError: "x" })).toBe(true); // reads still refreshed
  expect(refreshOk("market", { ...ok, contextError: "x", listError: "y" })).toBe(false);
  expect(refreshOk("signin", ok)).toBe(false); // not refreshable
});

test("screenHasData follows the null contract of the hooks", () => {
  expect(screenHasData("wallet", { balances: null, context: null })).toBe(false);
  expect(screenHasData("wallet", { balances: {}, context: null })).toBe(true);
  expect(screenHasData("markets", { balances: {}, context: null })).toBe(false);
  expect(screenHasData("market", { balances: null, context: {} })).toBe(true);
  expect(screenHasData("signin", { balances: {}, context: {} })).toBe(false);
});
```

```bash
npx jest __tests__/store.test.ts 2>&1 | tail -8
```
Expected: FAIL — `updatedLabel is not a function` (y los otros dos).

- [ ] **Step 3: Implementar** — en `src/store.ts`, justo después de `export const marketEntryTab = …;`:

```ts
// ---------------------------------------------------------------------------
// Sello del pull-to-refresh (spec mobile-loading D5). Puros: el Shell los evalúa en un efecto.

/** `UPDATED HH:MM:SS` en hora local, 24 h. */
export function updatedLabel(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `UPDATED ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type RefreshErrors = { rpcError: string; movementsError: string; contextError: string; listError: string };

/** Un jalón «hizo algo» si al menos una de las fuentes de la pantalla quedó sin error (los hooks tragan errores: `allSettled` no basta). */
export function refreshOk(screen: Screen, e: RefreshErrors): boolean {
  switch (screen) {
    case "wallet": return !e.rpcError || !e.movementsError;
    case "markets": return !e.contextError;
    case "market": return !e.contextError || !e.listError;
    default: return false;
  }
}

/** La pantalla ya tiene su dato principal (contrato `null` = sin dato de los hooks): fija el sello inicial. */
export function screenHasData(screen: Screen, d: { balances: unknown; context: unknown }): boolean {
  switch (screen) {
    case "wallet": return d.balances !== null;
    case "markets":
    case "market": return d.context !== null;
    default: return false;
  }
}
```

- [ ] **Step 4: Verde y commit**

```bash
npx jest __tests__/store.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/store.ts __tests__/store.test.ts
git commit -m "feat(mobile): helpers puros del sello de pull-to-refresh (updatedLabel, refreshOk, screenHasData)" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: 31 suites / 240 tests; `TSC-OK`.

---

### Task 2: Primitivas `Skeleton` y `Reveal`

**Files:**
- Modify: `apps/mobile/src/ui/primitives.tsx` (imports y final del archivo)

**Interfaces:**
- Produces: `Skeleton({ w?, h?, r?, style? })`, `Skeleton.Line({ s?, w? })`, `Skeleton.Card({ lines?, big? })`, `Skeleton.Row()`, `Reveal({ children, style? })`. Las usan Tasks 3–5.

- [ ] **Step 1: Imports** — en `src/ui/primitives.tsx` cambiar la primera línea y la segunda por:

```tsx
import { type ReactNode, useEffect, useRef } from "react";
import { Animated, Easing, Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
```

- [ ] **Step 2: Implementar** — al final de `src/ui/primitives.tsx`:

```tsx
// ---------------------------------------------------------------------------
// Skeletons (spec mobile-loading D1/D4). Un solo pulso compartido: `PULSE` vive en el módulo y el loop
// arranca con el primer skeleton montado y se detiene con el último (refcount), aunque haya 20 bloques.
const PULSE = new Animated.Value(1);
let pulseLoop: Animated.CompositeAnimation | null = null;
let pulseMounted = 0;

function usePulse(): Animated.Value {
  useEffect(() => {
    if (pulseMounted++ === 0) {
      pulseLoop = Animated.loop(Animated.sequence([
        Animated.timing(PULSE, { toValue: 0.45, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(PULSE, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]));
      pulseLoop.start();
    }
    return () => {
      if (--pulseMounted === 0) { pulseLoop?.stop(); pulseLoop = null; PULSE.setValue(1); }
    };
  }, []);
  return PULSE;
}

type SkeletonProps = { w?: number | `${number}%`; h?: number; r?: number; style?: StyleProp<ViewStyle> };

function SkeletonBlock({ w = "100%", h = 12, r = 8, style }: SkeletonProps) {
  const opacity = usePulse();
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: C.hair, opacity }, style]} />;
}

/** Una línea de texto de tamaño `s` (alto ≈ 1.1·s). */
function SkeletonLine({ s = 13, w = "60%" }: { s?: number; w?: number | `${number}%` }) {
  return <SkeletonBlock h={Math.round(s * 1.1)} w={w} r={6} />;
}

/** Card con `lines` líneas; `big` pone la primera a 30 px (una cifra grande, como los saldos). */
function SkeletonCard({ lines = 2, big }: { lines?: number; big?: boolean }) {
  const widths: (number | `${number}%`)[] = ["45%", "70%", "55%", "62%"];
  return (
    <Card pad={big ? 15 : 13} gap={9}>
      {Array.from({ length: lines }, (_, i) => <SkeletonBlock key={i} h={i === 0 && big ? 30 : 12} w={widths[i % widths.length]} />)}
    </Card>
  );
}

/** Fila de lista: título + subtítulo a la izquierda, valor + variación a la derecha (como `MarketsList`). */
function SkeletonRow() {
  return (
    <Card pad={13} style={{ flexDirection: "row", alignItems: "center", gap: 11 }}>
      <View style={{ flex: 1, gap: 6 }}>
        <SkeletonBlock h={14} w="30%" />
        <SkeletonBlock h={11} w="55%" />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <SkeletonBlock h={13} w={72} />
        <SkeletonBlock h={10} w={44} />
      </View>
    </Card>
  );
}

export const Skeleton = Object.assign(SkeletonBlock, { Line: SkeletonLine, Card: SkeletonCard, Row: SkeletonRow });

/** El contenido entra con un fade de 150 ms al montarse (skeleton → dato). Nada más (D4). */
export function Reveal({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start(); }, [opacity]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}
```

- [ ] **Step 3: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/ui/primitives.tsx
git commit -m "feat(mobile): primitivas Skeleton (Line/Card/Row, pulso compartido) y Reveal" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 31 / 240.

---

### Task 3: `reads.reads` nullable y skeletons de Ask / Agents

**Files:**
- Modify: `apps/mobile/src/hooks/useReads.ts` (líneas 27, 49, 74, 85)
- Modify: `apps/mobile/src/screens/ask.tsx` (`CreditsRow`, `AskSheet`, `AskTab`)
- Modify: `apps/mobile/src/screens/agents.tsx` (línea 16)

**Interfaces:**
- Consumes: `Skeleton`, `Reveal` (Task 2).
- Produces: `Reads.reads: Read[] | null` (`null` = aún no se ha pedido / sin sesión).

- [ ] **Step 1: Sin test nuevo** — `useReads` es un hook sin tests (P12 del plan F2 de Ask) y `readDots` ya tiene el caso vacío cubierto en `reads-matrix.test.ts`; la garantía de esta task la da `tsc` sobre los consumidores de `reads.reads` (Step 5).

- [ ] **Step 2: `useReads.ts`** —
  - línea 27: `reads: Read[];` → `/** `null` = todavía no se pidió (sin sesión o en vuelo); `[]` = pedido y vacío. */\n  reads: Read[] | null;`
  - línea 49: `useState<Read[]>([])` → `useState<Read[] | null>(null)`
  - líneas 74 y 85: `setReads([]);` → `setReads(null);`
  - línea 192 (`setReads((list) => upsert(list, read))`) → `setReads((list) => upsert(list ?? [], read))`

- [ ] **Step 3: `ask.tsx`** — imports: añadir `Reveal, Skeleton` al import de `../ui/primitives`.

`CreditsRow`: sustituir la función por

```tsx
function CreditsRow({ credits }: { credits: number | null }) {
  return (
    <Card bd={C.hair14} bg={C.card} pad={11} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Tag>CREDITS</Tag>
      {credits === null ? <Skeleton h={16} w={28} r={4} /> : <T w={700} s={16} lh={1} mono>{String(credits)}</T>}
      <T w={400} s={11} lh={1.3} color={C.faint} style={{ flex: 1 }}>1 credit per read · simulated for the testnet</T>
    </Card>
  );
}
```

`AskSheet` (línea ~172): sustituir `{reads.agents === null ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError || "Loading agents…"}</T> : picking ? (` por

```tsx
      {reads.agents === null ? (
        reads.agentsError
          ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError}</T>
          : <View style={{ flexDirection: "row", gap: 6 }}><Skeleton h={28} w={118} r={999} /><Skeleton h={28} w={96} r={999} /><Skeleton h={28} w={104} r={999} /></View>
      ) : picking ? (
```

`AskTab`: línea 224 `reads.reads.find` → `(reads.reads ?? []).find`, dependencias iguales. Línea 246 `readDots(reads.reads)` → `readDots(reads.reads ?? [])`. En `myReads()`, sustituir las dos líneas de lista por:

```tsx
        {reads.reads === null && !reads.listError ? <><Skeleton.Card lines={3} /><Skeleton.Card lines={3} /></> : null}
        {reads.reads !== null && reads.reads.length === 0 ? <T w={400} s={12} lh={1.4} color={C.faint}>No reads on {market.symbol} yet.</T> : null}
        {reads.reads !== null && reads.reads.length > 0 ? <Reveal style={{ gap: 7 }}>{reads.reads.map((r) => <ReadRow key={r.id} read={r} name={agentName(reads.agents, r.agentId)} now={now} onPress={() => set({ askFocusReadId: r.id })} />)}</Reveal> : null}
```

- [ ] **Step 4: `agents.tsx`** — import `Reveal, Skeleton` de `../ui/primitives`; sustituir la línea 16 por

```tsx
      {reads.agents === null && !reads.agentsError ? <><Skeleton.Card lines={3} /><Skeleton.Card lines={3} /><Skeleton.Card lines={3} /></> : null}
```
y envolver el `.map` de agentes (línea 17 en adelante) en `<Reveal style={{ gap: 7 }}>…</Reveal>` sólo cuando `reads.agents !== null` (mantener el `gap` que tenga hoy el contenedor: si el `View` padre ya tiene `gap`, el `Reveal` lleva el mismo valor).

- [ ] **Step 5: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
grep -n "Loading agents\|Loading reads" src/screens/ask.tsx src/screens/agents.tsx || echo "sin Loading… en Ask/Agents"
git add src/hooks/useReads.ts src/screens/ask.tsx src/screens/agents.tsx
git commit -m "feat(mobile): reads nullable y skeletons de créditos, agentes y My reads" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK` (si `tsc` señala otro consumidor de `reads.reads`, aplicar `?? []` ahí y citarlo en el reporte), 31 / 240, `sin Loading… en Ask/Agents`.

---

### Task 4: Skeletons de Wallet, Markets y Market

**Files:**
- Modify: `apps/mobile/src/screens/wallet.tsx` (card de saldos, movimientos, TESTNET)
- Modify: `apps/mobile/src/screens/markets.tsx` (`MarketsList`, card `TRADING · AUSD`, posiciones)
- Modify: `apps/mobile/src/screens/market.tsx` (`MarketScreen` sin `market`)

**Interfaces:**
- Consumes: `Skeleton`, `Reveal` (Task 2); `perpl.live`, `perpl.lastBalance`, `perpl.context`, `treasury.balances`, `treasury.movements` (ya existen).

- [ ] **Step 1: `wallet.tsx`** — import `Reveal, Skeleton` de `../ui/primitives`. En la card de saldos, sustituir la línea del importe

```tsx
        <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{available}</T>
```
por
```tsx
        {treasury.balances === null && !treasury.rpcError
          ? <Skeleton h={30} w="45%" style={{ marginTop: 6 }} />
          : <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{available}</T>}
```
La línea «AUSD in trading» (dentro de `perpl.state.status === "ready"`): sustituir el `<Touch …>…</Touch>` por

```tsx
          perpl.live === null && perpl.lastBalance === null
            ? <Skeleton h={12} w="62%" style={{ marginTop: 4 }} />
            : (
              <Touch onPress={() => nav("markets")} accessibilityLabel="in-trading">
                <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 2 }}>
                  {formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)} AUSD in trading{perpl.live?.account ? "" : perpl.lastBalance !== null ? " · last seen" : ""} · Markets
                </T>
              </Touch>
            )
```
Movimientos: sustituir `{treasury.movements === null && !treasury.movementsError ? <T …>Loading movements…</T> : null}` por
```tsx
      {treasury.movements === null && !treasury.movementsError ? <><Skeleton.Row /><Skeleton.Row /><Skeleton.Row /></> : null}
```
y `{rows.map((m) => <MovementRow key={m.hash} m={m} />)}` por
```tsx
      {treasury.movements !== null && rows.length > 0 ? <Reveal style={{ gap: 11 }}>{rows.map((m) => <MovementRow key={m.hash} m={m} />)}</Reveal> : null}
```
(`gap: 11` = el `gap` del `Page`; si `MovementRow` ya lleva margen propio, usar `gap: 0`.) Si `treasury.pending` tiene filas mientras `movements === null`, siguen pintándose: dejar `{treasury.movements === null ? treasury.pending.map((m) => <MovementRow key={m.hash} m={m} />) : null}` justo antes de los skeletons.

TESTNET: `<KV k="MON (GAS)" v={treasury.balances ? formatMon(treasury.balances.mon) : "—"} />` se queda (es `KV` con `—`; una segunda skeleton en la misma pantalla para el mismo dato no aporta).

- [ ] **Step 2: `markets.tsx`** — import `Reveal, Skeleton`. En `MarketsList`, sustituir `{perpl.context === null && !perpl.contextError ? <T …>Loading markets…</T> : null}` por
```tsx
      {perpl.context === null && !perpl.contextError ? <>{Array.from({ length: 6 }, (_, i) => <Skeleton.Row key={i} />)}</> : null}
```
y envolver el `.map` de mercados: `{perpl.context !== null ? <Reveal style={{ gap: 7 }}>{(perpl.context.markets).map((m) => { … })}</Reveal> : null}` (el `gap: 7` es el del `View` contenedor; el `View` exterior conserva su `gap`).

Card `TRADING · AUSD` (estado `ready`, línea ~200): sustituir la cifra
```tsx
        <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{formatAusd(b)}</T>
```
por
```tsx
        {live === null && perpl.lastBalance === null
          ? <Skeleton h={30} w="45%" style={{ marginTop: 6 }} />
          : <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{formatAusd(b)}</T>}
```
Posiciones: donde hoy `positions.length === 0 ? <EmptyPanel>…</EmptyPanel> : positions.map(…)`, anteponer la rama `live === null ? <Skeleton.Card lines={3} /> :` (una card; con `live` presente y sin posiciones sigue el `EmptyPanel`).

- [ ] **Step 3: `market.tsx` — `MarketSkeleton` (P2)** — import `Skeleton` de `../ui/primitives`. Añadir antes de `export function MarketScreen`:

```tsx
/** Market sin contexto de Perpl todavía (arranque en frío por push): pills + créditos + escalera en skeleton (spec D3, P2 del plan F1). */
function MarketSkeleton() {
  return (
    <View>
      <View style={{ flexDirection: "row", gap: 8, paddingTop: 11, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair12 }}>
        <Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} /><Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} /><Skeleton h={36} w="30%" r={999} style={{ flex: 1 }} />
      </View>
      <Page top={13} gap={11}>
        <Skeleton.Card lines={1} />
        {Array.from({ length: 5 }, (_, i) => <Skeleton.Row key={i} />)}
      </Page>
    </View>
  );
}
```
y en `MarketScreen`, sustituir el bloque `if (!market) { return ( <Page gap={11}> … ) }` por

```tsx
  if (!market) {
    if (perpl.context === null && !perpl.contextError) return <MarketSkeleton />;
    return (
      <Page gap={11}>
        <T w={400} s={13} color={C.faint}>{perpl.contextError ? `Couldn't load markets. ${perpl.contextError}` : "This market isn't listed on Perpl anymore."}</T>
        <Btn label="Back to Markets" onPress={() => nav("markets")} variant="lime" accessibilityLabel="back-to-markets" />
      </Page>
    );
  }
```

- [ ] **Step 4: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
grep -n "Loading movements\|Loading markets\|Loading market" src/screens/wallet.tsx src/screens/markets.tsx src/screens/market.tsx || echo "sin Loading… en Wallet/Markets/Market"
git add src/screens/wallet.tsx src/screens/markets.tsx src/screens/market.tsx
git commit -m "feat(mobile): skeletons por sección en Wallet, Markets y Market" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 31 / 240, `sin Loading…`.

---

### Task 5: Sello `UPDATED` / `COULDN'T REFRESH` en `Shell`

**Files:**
- Modify: `apps/mobile/src/Shell.tsx` (imports, estado, `onRefresh`, efectos, render bajo la cabecera)

**Interfaces:**
- Consumes: `updatedLabel`, `refreshOk`, `screenHasData`, `RefreshErrors` (Task 1) de `./store`; `Tag` de `./ui/primitives`.

- [ ] **Step 1: Imports y estado** — en `Shell.tsx`: añadir `refreshOk, screenHasData, updatedLabel, type Screen` al import de `./store` (comprobar cómo importa hoy `./store`; si no importa nada, crear la línea `import { refreshOk, screenHasData, updatedLabel, type Screen } from "./store";`). Añadir `Tag` al import de `./ui/primitives`. Justo después de `const [refreshing, setRefreshing] = useState(false);`:

```tsx
  // Sello del pull-to-refresh (spec mobile-loading D5): por pantalla; la carga inicial también lo fija (P5 del plan F1).
  const [updatedAt, setUpdatedAt] = useState<Partial<Record<Screen, number>>>({});
  const [refreshDone, setRefreshDone] = useState(0); // se incrementa al terminar cada jalón; el efecto de abajo lo evalúa con el estado ya actualizado (P4)
  const [refreshFailed, setRefreshFailed] = useState(false);
```

- [ ] **Step 2: `onRefresh`** — sustituir el `finally` por

```tsx
    } finally {
      setRefreshing(false);
      setRefreshDone((n) => n + 1);
    }
```

- [ ] **Step 3: Efectos** — después de `onRefresh`:

```tsx
  const errors = { rpcError: treasury.rpcError, movementsError: treasury.movementsError, contextError: perpl.contextError, listError: reads.listError };
  // Evalúa el jalón que acaba de terminar con los errores de ESTE render (tras el await el estado puede no estar aplicado).
  useEffect(() => {
    if (refreshDone === 0) return;
    if (refreshOk(S.screen, errors)) { setUpdatedAt((u) => ({ ...u, [S.screen]: Date.now() })); setRefreshFailed(false); return; }
    setRefreshFailed(true);
    const t = setTimeout(() => setRefreshFailed(false), 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al terminar un jalón
  }, [refreshDone]);
  // Sello inicial: la primera vez que la pantalla tiene su dato principal.
  const hasData = screenHasData(S.screen, { balances: treasury.balances, context: perpl.context });
  useEffect(() => {
    if (!refreshable || !hasData || updatedAt[S.screen] !== undefined) return;
    setUpdatedAt((u) => ({ ...u, [S.screen]: Date.now() }));
  }, [refreshable, hasData, S.screen, updatedAt]);
```
(Si el proyecto no tiene eslint con `react-hooks`, quitar el comentario `eslint-disable`.)

- [ ] **Step 4: Render** — dentro del `ScrollView`, justo antes de `<Current {...ctx} />`:

```tsx
            {refreshable && (refreshFailed || updatedAt[S.screen] !== undefined) ? (
              <View style={{ paddingHorizontal: 15, paddingTop: 10 }}>
                <Tag color={refreshFailed ? C.down : C.faint}>{refreshFailed ? "COULDN'T REFRESH" : updatedLabel(updatedAt[S.screen]!)}</Tag>
              </View>
            ) : null}
```
(`Page` ya pone `paddingTop: 14`; el sello suma 10 + su alto ≈ 20 pt. Si en el simulador queda demasiado aire, bajar `top` del `Page` de esas tres pantallas **no** es de esta task: anotarlo.)

- [ ] **Step 5: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/Shell.tsx
git commit -m "feat(mobile): sello UPDATED / COULDN'T REFRESH por pantalla en el pull-to-refresh" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 31 / 240.

---

### Task 6: Splash nativo con la marca

**Files:**
- Create: `apps/mobile/scripts/splash-mark.py`, `apps/mobile/assets/splash-mark.png`
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json` (`npx expo install`), `apps/mobile/app.config.ts` (plugins), `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `account` (`useAccount`, `null` mientras carga).

- [ ] **Step 1: Dependencia**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-loading/apps/mobile
npx expo install expo-splash-screen 2>&1 | tail -3
grep -n '"expo-splash-screen"' package.json
```
Expected: una línea `"expo-splash-screen": "~57.0.x"` (la versión que fije `expo install`; anotarla en el reporte).

- [ ] **Step 2: Asset** — crear `scripts/splash-mark.py`:

```python
# Recorta la P lima de assets/icon.png a fondo transparente para el splash (spec mobile-loading D6, P7 del plan F1).
# Flood fill desde los bordes: el fondo violeta es conexo y rodea la P; la cara oscura interior queda protegida por
# el contorno lima. Salida 720×720 con margen. Uso: python3 scripts/splash-mark.py assets/icon.png assets/splash-mark.png
import sys
from PIL import Image, ImageDraw

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
w, h = im.size
KEY = (0, 255, 0, 255)  # color temporal que no existe en el icono
for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)):
    ImageDraw.floodfill(im, (x, y), KEY, thresh=140)
px = im.load()
for y in range(h):
    for x in range(w):
        if px[x, y] == KEY:
            px[x, y] = (0, 0, 0, 0)
bbox = im.getbbox()
crop = im.crop(bbox)
side = max(crop.size) + 40
out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
out.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
out = out.resize((720, 720), Image.LANCZOS)
out.save(dst)
print("bbox", bbox, "->", out.size)
```

```bash
python3 scripts/splash-mark.py assets/icon.png assets/splash-mark.png
python3 -c "from PIL import Image; im=Image.open('assets/splash-mark.png'); bg=Image.new('RGBA', im.size, (5,6,26,255)); bg.alpha_composite(im); bg.save('/tmp/splash-preview.png'); print(im.size, im.mode)"
```
Expected: `bbox (278, 246, 757, 759) -> (720, 720)` (medido el 2026-09-21 sobre el `icon.png` actual), `(720, 720) RGBA`. **Mirar `/tmp/splash-preview.png`**: P lima sobre navy, sin halo violeta visible, cara oscura intacta.

- [ ] **Step 3: `app.config.ts`** — en `plugins`, después de la entrada de `expo-notifications`:

```ts
    ["expo-splash-screen", { image: "./assets/splash-mark.png", imageWidth: 140, resizeMode: "contain", backgroundColor: "#05061A" }],
```

- [ ] **Step 4: `App.tsx`** — imports: añadir `import * as SplashScreen from "expo-splash-screen";` (junto a los de expo) y quitar `ActivityIndicator` del import de `react-native` si queda sin uso. A nivel de módulo, después de `const PERPL_SCREENS = …;`:

```ts
// Splash nativo (spec mobile-loading D7): se queda hasta que la cuenta local se resolvió; 2 s de tope por si el almacenamiento no responde.
void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ fade: true, duration: 200 });
```
Dentro de `App()`, después del `useLayoutEffect` del `boot`:

```tsx
  const ready = fontsLoaded && account !== null;
  useEffect(() => {
    if (ready) { void SplashScreen.hideAsync(); return; }
    const t = setTimeout(() => { void SplashScreen.hideAsync(); }, 2000);
    return () => clearTimeout(t);
  }, [ready]);
```
Y sustituir el bloque `if (!fontsLoaded || account === null) { return ( <View …><ActivityIndicator …/></View> ); }` por

```tsx
  if (!ready) return null; // el splash nativo sigue en pantalla (P9)
```
Si `tsc` marca `setOptions` como inexistente en la versión instalada, quitar esa línea y anotarlo (P8).

- [ ] **Step 5: Prebuild + run en el simulador** (cambio nativo; reinstala el dev build y borra la cuenta local)

```bash
U=2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
SC=/Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-loading/.superpowers/sdd/2026-09-21-mobile-loading-f1
lsof -tiTCP:8081 -sTCP:LISTEN | xargs kill 2>/dev/null; sleep 1
npx expo prebuild --platform ios --clean 2>&1 | tail -3
grep -c "splash-mark\|SplashScreenLogo" ios/Pickler/SplashScreen.storyboard; ls ios/Pickler/Images.xcassets/ | grep -i splash
nohup npx expo run:ios --device "$U" > "$SC/run.log" 2>&1 &
```
Esperar a «Installing on» / «Opening» en `run.log` (3–6 min). Expected: el storyboard referencia la imagen del splash y existe `SplashScreenLogo.imageset` (o el nombre que genere el plugin) con `splash-mark.png` dentro; el `run:ios` deja Metro en :8081 desde este worktree.

- [ ] **Step 6: Ver el splash**

```bash
xcrun simctl terminate "$U" fun.pickler.app; xcrun simctl launch "$U" fun.pickler.app & sleep 0.4; xcrun simctl io "$U" screenshot "$SC/shots/splash-00.png"; sleep 2.5; xcrun simctl io "$U" screenshot "$SC/shots/splash-01-after.png"
```
**Mirar** `splash-00.png` (P lima centrada sobre navy, sin blanco) y `splash-01-after.png` (Sign in o Wallet con el mismo fondo, sin spinner lima intermedio). Si el primer frame sale ya en la app (el splash dura < 0.4 s con la cuenta en caché), repetir con `sleep 0.15`; si sigue sin verse, anotarlo: el splash existe (storyboard) pero es demasiado rápido para la captura — y capturar tras `xcrun simctl shutdown`/`boot` (arranque en frío).

- [ ] **Step 7: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add package.json package-lock.json app.config.ts App.tsx assets/splash-mark.png scripts/splash-mark.py
git commit -m "feat(mobile): splash nativo con la P lima (expo-splash-screen) y hide al resolver la cuenta" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `TSC-OK`, 31 / 240; `git status` sin `ios/` (ignorado).

---

### Task 7: Recorrido en el simulador (capturas)

**Files:** ninguno del repo. Workspace `SC=<worktree>/.superpowers/sdd/2026-09-21-mobile-loading-f1` (lo crea `scripts/sdd-workspace`); copiar ahí `taplabel.sh`, `tap-point.yaml` y `flows/` desde `<repo>/.claude/worktrees/markets-ask-gate/.superpowers/sdd/2026-09-21-markets-ask-gate/` (o desde `<repo>/.superpowers/sdd/2026-09-20-mobile-ask-matrix/`) y ajustar `SC` en `taplabel.sh`. Capturas en `$SC/shots/`.

**Interfaces:**
- Labels: `tab-wallet`, `tab-markets`, `market-BTC`, `pill-ask`, `pill-agents`, `pill-trade`, `segment-mine`; Dev controls (⚙) → «Sign out».
- Produces: `$SC/task-7-report.md`; PNG a `docs/superpowers/audits/img/2026-09-21-mobile-loading-{skeleton-wallet,skeleton-markets,skeleton-ask,updated,splash}.png` (reducidos con `sips -Z 1300`).

- [ ] **Step 0: Estado** — el dev build de Task 6 está instalado y Metro corre desde este worktree (comprobar `lsof -tiTCP:8081 -sTCP:LISTEN` y `grep -c "Waiting on" $SC/metro.log` o `run.log`). Sign in si hace falta (passkey «pickler» + Face ID). Wallet → anotar AUSD/MON (`00-wallet-before.png`).

- [ ] **Step 1: Skeletons de Wallet y Markets (carga inicial)** — `xcrun simctl terminate … ; launch …` y captura a los **0.8 s** (`01-wallet-skeleton.png`): card de saldos con el bloque de 30 px pulsando y 3 `Skeleton.Row` bajo MOVEMENTS; a los 4 s (`02-wallet-loaded.png`) los datos reales. `tab-markets` inmediatamente tras un relaunch (`03-markets-skeleton.png`): 6 filas de skeleton bajo MARKETS (y la cifra de la card si no hay `lastBalance`); a los 4 s (`04-markets-loaded.png`). Si el simulador está sin trading key (Gate), la card de trading no aplica: anotarlo.

- [ ] **Step 2: Skeletons de Ask/Agents** — con Metro arrancado con `PICKLER_READS_URL=http://10.255.255.1/` (P10): matar Metro, `PICKLER_READS_URL=http://10.255.255.1/ nohup npx expo start --port 8081 > "$SC/metro-slow.log" 2>&1 &`, relaunch, `market-BTC` → `pill-ask` → (si aparece `SessionGate`, `ask-unlock` + Face ID) → captura en los primeros 5 s (`05-ask-skeleton.png`: CREDITS con bloque, matriz real, chips de agentes en skeleton al tocar `cell-100-240`), `segment-mine` (`06-myreads-skeleton.png`: 2 cards), `pill-agents` (`07-agents-skeleton.png`: 3 cards). Tras el timeout (~12 s) deben verse las `Warn` de error (`08-ask-error.png`), **no** skeleton. Volver a arrancar Metro **sin** la variable y relaunch: Ask con datos (`09-ask-loaded.png`).

- [ ] **Step 3: `MarketSkeleton`** — desde Markets, Dev controls → «Sign out» → sign in → **sin** entrar a Markets, abrir Market por Dev controls → «Market · ticket» en los primeros 500 ms tras el sign in (o, más fiable: relaunch estando en Market; el contexto tarda 1–3 s) → captura `10-market-skeleton.png` (3 pills + card + 5 filas). Si no se consigue a tiempo, anotarlo (el estado es de ventanas de < 1 s).

- [ ] **Step 4: Sello** — Wallet: jalar (`flows/ptr.yaml`) → tras el spinner, `UPDATED HH:MM:SS` bajo la cabecera (`11-updated.png`); jalar de nuevo y comprobar que la hora cambia (`12-updated-2.png`). `COULDN'T REFRESH` exige que fallen **todas** las fuentes de la pantalla: en Market · Ask con Metro en `PICKLER_READS_URL=http://10.255.255.1/` falla reads pero no Perpl, así que sólo se ve cortando la red del Mac (desactivar el WiFi 15 s, jalar, captura `13-couldnt-refresh.png`, reactivar). Si no se puede cortar la red en esta sesión, anotarlo como **no capturado** y dejarlo cubierto por el test de `refreshOk`.

- [ ] **Step 5: Reporte** — `$SC/task-7-report.md`: tabla captura → qué se ve (mirada ✓), saldos antes/después (iguales), qué no se pudo capturar y por qué, defectos (parar antes de Task 8 si los hay). Copiar los 5 PNG de evidencia a `docs/superpowers/audits/img/` con `sips -Z 1300`.

---

### Task 8: Docs — marcas (F1), F1 `completed`, audit, README, checks

**Files:**
- Modify: `docs/superpowers/specs/2026-09-21-mobile-loading-design.md` (D3, D7, Estado), `docs/overview/2026-09-21-mobile-loading.html` (phase-card F1 → `completed`, tasks checked, «Rulings en ejecución»), `docs/overview/data/manifest.js` (`phases[0].status = 'completed'`, `status: 'active'` se queda hasta el merge), `apps/mobile/README.md`
- Create: `docs/superpowers/audits/2026-09-21-mobile-loading-f1-rulings.md`, `docs/superpowers/audits/img/2026-09-21-mobile-loading-*.png` (Task 7)

- [ ] **Step 1: Spec** — D3: tras «matriz completa (`MatrixGrid` recibe `loading` …)» añadir «**(F1)** `MatrixGrid` no cambia: sin `context` no hay `market`, así que Market entero pinta `MarketSkeleton` (pills + card + 5 filas) — P2 del plan F1.». D7: si `setOptions` no existió en la versión instalada, marcarlo **(F1)**. Cabecera **Estado**: «F1 ejecutada (plan `2026-09-21-mobile-loading-f1.md`, audit `2026-09-21-mobile-loading-f1-rulings.md`); rama `feat/mobile-loading` lista para merge local.»

- [ ] **Step 2: Overview** — phase-card `data-phase="1"` → `data-status="completed"` + `<option value="completed" selected>`; `<details class="tasks">` con las 8 tasks de este plan (`checked` las ejecutadas; Task 7 y las capturas no conseguidas se anotan sin marcar si faltaron); sección Decisiones: añadir `<h3 class="section-sub">Rulings en ejecución</h3><ol>…</ol>` con los rulings del ledger SDD (uno por `<li>`, con «coste si está mal»). Manifest: `phases: [{ num: 1, status: 'completed' }]`. `npm run docs:html`; render-check y **mirar** la captura de 390 px.

- [ ] **Step 3: Audit** — `docs/superpowers/audits/2026-09-21-mobile-loading-f1-rulings.md` con: §1 qué quedó hecho (commits `git log --oneline 4be010c..HEAD`, `git diff --stat`), §2 evidencia (tests 31/240, tsc, tabla de capturas de Task 7 con `![…](img/2026-09-21-mobile-loading-….png)` de las cinco), §3 rulings (P1–P10 de este plan + los del ledger), §4 correcciones a afirmaciones previas (spec D3/D7; lo que no se capturó), §5 estado de las cuentas al cierre (AUSD/MON iguales; cuenta #620 sin tocar), §6 pendientes/residuales (p. ej. `COULDN'T REFRESH` sin captura; aire bajo el sello; Android sin verificar).

- [ ] **Step 4: README** — en `apps/mobile/README.md`: sección nueva «Carga y splash» de 4 líneas: regla `null` = skeleton (D2), sello `UPDATED` por pantalla, `expo-splash-screen` con `assets/splash-mark.png` regenerable con `python3 scripts/splash-mark.py assets/icon.png assets/splash-mark.png` (requiere PIL), y que `prebuild --clean` regenera el storyboard. Conteo de tests real (31 suites / 240).

- [ ] **Step 5: Checks y commit**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-loading
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK && cd ../..
git status --short
git add docs/superpowers/specs/2026-09-21-mobile-loading-design.md docs/superpowers/specs/2026-09-21-mobile-loading-design.html docs/superpowers/plans/2026-09-21-mobile-loading-f1.md docs/superpowers/plans/2026-09-21-mobile-loading-f1.html docs/overview/2026-09-21-mobile-loading.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-21-mobile-loading-f1-rulings.md docs/superpowers/audits/img/2026-09-21-mobile-loading-skeleton-wallet.png docs/superpowers/audits/img/2026-09-21-mobile-loading-skeleton-markets.png docs/superpowers/audits/img/2026-09-21-mobile-loading-skeleton-ask.png docs/superpowers/audits/img/2026-09-21-mobile-loading-updated.png docs/superpowers/audits/img/2026-09-21-mobile-loading-splash.png apps/mobile/README.md
git commit -m "docs(mobile-loading): F1 completed — spec (F1), overview, audit con capturas, README" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: <url>"
```
Expected: `docs:check` errors=0; `agents:check` `"errors": []`; 31 / 240; `TSC-OK`; árbol limpio. (Si alguna captura de Task 7 no existió, quitarla del `git add` y del audit.) Handoff: rama lista para merge local (decisión de Jesús); siguiente: build 7 de TestFlight cuando Jesús lo pida, y el plan F3 de Ask.

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del spec**: D1 → Task 2; D2 → Task 3 (`reads` nullable) + regla en Tasks 3–4; D3 → Tasks 3–4 (con P2 para la matriz); D4 → Task 2 (`Reveal`) usado en 3–4; D5 → Tasks 1 + 5; D6 → Task 6 (plugin + asset); D7 → Task 6 (`App.tsx`); D8 → Task 1 (tests), 7 (capturas), 8 (docs). Sin gaps.
- **Placeholders**: `<modelo>`, `<url>`, `<worktree>`, `<repo>` los rellena el ejecutor; la versión de `expo-splash-screen` la fija `expo install` (Step 1 de Task 6). Ningún «TBD».
- **Consistencia de tipos**: `Skeleton` acepta `w: number | \`${number}%\``, `h`, `r`, `style`; `Skeleton.Card({ lines, big })`, `Skeleton.Row()`, `Skeleton.Line({ s, w })` iguales en Tasks 2–4; `refreshOk(screen, RefreshErrors)` y `screenHasData(screen, { balances, context })` iguales en Tasks 1 y 5; `reads.reads: Read[] | null` en Task 3 con `?? []` en los tres usos de `ask.tsx`.
- **Trampa conocida**: en la fila de pills de `MarketSkeleton` cada `Skeleton` lleva `w="30%"` además de `flex: 1`, para que el ancho no lo dispute el `100%` por defecto.
