# Pulido de navegación (mobile-polish) — Plan F1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los tres tabs en mock digan "coming soon" con la estética de la app, que la app arranque en Wallet, que Wallet y Trade se refresquen jalando, que las pantallas con `←` regresen con swipe desde el borde, y que Trade muestre el PnL no realizado bajo el saldo con "in positions / free" correctos.

**Architecture:** Toda la lógica nueva va en funciones puras con tests de Jest (`store.ts`, `ui/gestures.ts`, `perpl/orders.ts`); `Shell.tsx`, `App.tsx` y las pantallas sólo las consumen. Sin dependencias nuevas: `RefreshControl` y `PanResponder` son de React Native core. El mock de Market/Activity/Portfolio no se borra: el `Shell` decide qué renderiza según `COMING_SOON`.

**Tech Stack:** Expo 57 / React Native 0.86 / React 19, TypeScript 6, Jest 29 con `jest-expo`, viem (bigint para AUSD con 6 decimales), Ionicons de `@expo/vector-icons`.

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-polish-design.md` (decisiones D1–D13).

## Global Constraints

- Sin dependencias nuevas ni cambios nativos (D13): no `react-native-gesture-handler`, no `reanimated`, no react-navigation. No tocar `ios/`, `app.config.ts` ni `package.json`.
- Nada del mock se borra (D2): `SCREENS`, `mock/data.ts` y las pantallas `market/search/agent/activity/post/ask/portfolio/position/trade` siguen existiendo.
- Umbrales del gesto (D7): borde `≤ 24 px`, disparo con `dx > 60`.
- Copy exacto de coming soon (§2.3 del spec): Market → "Agents and their tokens"; Activity → "What the agents you follow are doing"; Portfolio → "Your token positions". Tag: "COMING SOON". Botón: "Go to Wallet". Subtítulo de header: "Coming soon".
- Copy de Trade (D10–D11): `"{locked} in positions · {free} free"` y `"+X unrealised PnL"` / `"−X unrealised PnL"` (signo "−" U+2212 como en `PositionRow`).
- Todo en `apps/mobile` corre desde esa carpeta (`npm test`, `npx tsc --noEmit`). El worktree es `.claude/worktrees/mobile-polish`, rama `feat/mobile-polish`; el primer paso ahí es `npm install` dentro de `apps/mobile` (sin `node_modules` no corre nada).
- Commits por nombre de archivo, conventional commits, nunca `git add -A`.
- Los tests nuevos se corren también **contra el defecto** (paso "verify it fails") antes de implementar.

---

### Task 0: Bootstrap del worktree

**Files:** ninguno (sólo instala).

- [ ] **Step 1: Instalar dependencias de la app**

Run: `cd apps/mobile && npm install`
Expected: termina sin errores; existe `apps/mobile/node_modules/jest-expo`.

- [ ] **Step 2: Línea base**

Run: `cd apps/mobile && npm test 2>&1 | tail -5 && npx tsc --noEmit && echo TSC_OK`
Expected: `Tests: N passed` (anota N — el README dice 41/41 pero puede haber crecido; el número real es la línea base) y `TSC_OK`.

---

### Task 1: Store — `COMING_SOON`, arranque en Wallet, `bootState`, header "Coming soon"

**Files:**
- Modify: `apps/mobile/src/store.ts`
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Produces:
  - `export const COMING_SOON: readonly Screen[]` = `["market", "activity", "portfolio"]`
  - `export function bootState(s: StoreState, hasAccount: boolean): StoreState`
  - `AppStore` gana `boot: (hasAccount: boolean) => void` y `comingSoon: boolean`
  - `INITIAL.screen === "wallet"`; `backState` cae a `"wallet"` con stack vacío (ruling: el spec fija Wallet como inicio; el fallback a `market` mandaría al usuario a un coming soon — se registra en el audit).
  - `headerFor("market" | "activity" | "portfolio", …)` → `[título, "Coming soon"]`.

- [ ] **Step 1: Actualizar los tests existentes que asumían `market` como inicio y añadir los nuevos**

En `__tests__/store.test.ts`, añade `bootState` y `COMING_SOON` al import y cambia estos tres asserts:

```ts
// test "nav pushes the current screen and applies the patch"
expect(s.stack).toEqual(["wallet"]);

// test "back pops the stack and falls back to market when empty" → renómbralo:
test("back pops the stack and falls back to wallet when empty", () => {
  const s = navState(navState(INITIAL, "agent"), "trade");
  expect(backState(s).screen).toBe("agent");
  expect(backState(INITIAL).screen).toBe("wallet");
  expect(backState(INITIAL).stack).toEqual([]);
});

// test "after sign-in it lands on Wallet …" (línea ~70)
expect(s.stack).toEqual(["wallet"]);
```

Y agrega al final del archivo:

```ts
test("the app starts on Wallet", () => {
  expect(INITIAL.screen).toBe("wallet");
});

test("boot keeps Wallet with an account and goes through Sign in without one", () => {
  expect(bootState(INITIAL, true)).toBe(INITIAL);
  const s = bootState(INITIAL, false);
  expect(s).toMatchObject({ screen: "signin", stack: [], next: "wallet", resume: false });
  expect(s.nextPatch).toBeUndefined();
  expect(afterSigninState(s).screen).toBe("wallet");
});

test("coming soon covers the three mock tabs and never the real ones", () => {
  expect(COMING_SOON).toEqual(["market", "activity", "portfolio"]);
  expect(COMING_SOON).not.toContain("wallet");
  expect(COMING_SOON).not.toContain("perps");
  for (const screen of COMING_SOON) expect(headerFor(screen, agent, post, "buy", 0)[1]).toBe("Coming soon");
  expect(headerFor("wallet", agent, post, "buy", 0)[1]).toBe("AUSD available and movements");
  expect(headerFor("perps", agent, post, "buy", 0)[1]).toBe("Perps on Perpl · Monad");
});
```

(`agent` y `post` ya están definidos en el test de `headerFor` existente — si son locales a ese test, súbelos a nivel de módulo: `const agent = AGENTS.pkl; const post = POSTS[0];`.)

- [ ] **Step 2: Verificar que fallan**

Run: `cd apps/mobile && npx jest __tests__/store.test.ts 2>&1 | tail -20`
Expected: FAIL — `bootState is not a function` / `COMING_SOON` undefined, y los asserts de `["wallet"]` fallan con `["market"]`.

- [ ] **Step 3: Implementar en `src/store.ts`**

```ts
// INITIAL
export const INITIAL: StoreState = {
  screen: "wallet", stack: [], dataCase: "normal",
  // …resto igual
};

// backState: fallback a wallet
const prev = stack.pop() ?? "wallet";

/** Tabs que todavía muestran el mock: el Shell renderiza "Coming soon" en vez de la pantalla (D1/D2). */
export const COMING_SOON: readonly Screen[] = ["market", "activity", "portfolio"];

/** Al resolver la cuenta por primera vez: con cuenta se queda en Wallet; sin cuenta pasa por Sign in y aterriza en Wallet (D3). */
export function bootState(s: StoreState, hasAccount: boolean): StoreState {
  if (hasAccount) return s;
  return { ...s, screen: "signin", stack: [], next: "wallet", nextPatch: undefined, resume: false };
}

// headerFor: los tres casos
case "market": return ["Market", "Coming soon"];
case "activity": return ["Activity", "Coming soon"];
case "portfolio": return ["Portfolio", "Coming soon"];
```

En `AppStore` añade `boot: (hasAccount: boolean) => void;` y `comingSoon: boolean;`. En `useAppStore`:

```ts
const boot = useCallback((has: boolean) => setS((s) => bootState(s, has)), []);
// …
return {
  S, set, nav, back, requireAccount, finishSignin, resetTo, boot,
  // …
  comingSoon: COMING_SOON.includes(S.screen),
};
```

- [ ] **Step 4: Verificar que pasan y que tsc está limpio**

Run: `cd apps/mobile && npx jest __tests__/store.test.ts 2>&1 | tail -8 && npx tsc --noEmit && echo TSC_OK`
Expected: todos los tests de store en PASS; `TSC_OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/store.ts apps/mobile/__tests__/store.test.ts
git commit -m "feat(mobile): arranque en Wallet, bootState y COMING_SOON en el store"
```

---

### Task 2: `App.tsx` — `boot(hasAccount)` una vez al resolver la cuenta

**Files:**
- Modify: `apps/mobile/App.tsx`

**Interfaces:**
- Consumes: `store.boot(hasAccount)` de Task 1.

- [ ] **Step 1: Añadir el efecto de arranque**

En `App.tsx`, importa `useRef` junto a `useEffect` y, justo después de `const store = useAppStore({...})`:

```ts
const hasAccount = account !== null && account.status !== "none";
const booted = useRef(false);
const { boot } = store;
// Una sola vez, cuando la cuenta deja de ser null: sin cuenta pasa por Sign in (D3).
useEffect(() => {
  if (account === null || booted.current) return;
  booted.current = true;
  boot(hasAccount);
}, [account, hasAccount, boot]);
```

Y usa `hasAccount` en el `useAppStore({ hasAccount, … })` en vez de repetir la expresión.

- [ ] **Step 2: tsc**

Run: `cd apps/mobile && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): boot al resolver la cuenta — Wallet o Sign in → Wallet"
```

---

### Task 3: `ui/gestures.ts` — umbrales del swipe atrás

**Files:**
- Create: `apps/mobile/src/ui/gestures.ts`
- Test: `apps/mobile/__tests__/gestures.test.ts`

**Interfaces:**
- Produces:
  - `export const EDGE_PX = 24; export const BACK_DX = 60;`
  - `export function shouldCaptureEdgeSwipe(x0: number, dx: number, dy: number): boolean`
  - `export function shouldGoBack(dx: number): boolean`

- [ ] **Step 1: Test**

```ts
import { BACK_DX, EDGE_PX, shouldCaptureEdgeSwipe, shouldGoBack } from "../src/ui/gestures";

test("only a mostly-horizontal drag that starts at the left edge is captured", () => {
  expect(shouldCaptureEdgeSwipe(0, 10, 2)).toBe(true);
  expect(shouldCaptureEdgeSwipe(EDGE_PX, 10, 2)).toBe(true);
  expect(shouldCaptureEdgeSwipe(EDGE_PX + 1, 10, 2)).toBe(false);
  expect(shouldCaptureEdgeSwipe(5, 4, 8)).toBe(false);   // vertical: es scroll
  expect(shouldCaptureEdgeSwipe(5, -10, 2)).toBe(true);  // se captura y luego no dispara
});

test("back fires only past the drag threshold", () => {
  expect(shouldGoBack(BACK_DX)).toBe(false);
  expect(shouldGoBack(BACK_DX + 1)).toBe(true);
  expect(shouldGoBack(-100)).toBe(false);
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd apps/mobile && npx jest __tests__/gestures.test.ts 2>&1 | tail -6`
Expected: FAIL — `Cannot find module '../src/ui/gestures'`.

- [ ] **Step 3: Implementar `src/ui/gestures.ts`**

```ts
/** Swipe desde el borde izquierdo = atrás (D7). Puro: sin react-native para poder testearlo. */
export const EDGE_PX = 24;
export const BACK_DX = 60;

export function shouldCaptureEdgeSwipe(x0: number, dx: number, dy: number): boolean {
  return x0 <= EDGE_PX && Math.abs(dx) > Math.abs(dy);
}

export function shouldGoBack(dx: number): boolean {
  return dx > BACK_DX;
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `cd apps/mobile && npx jest __tests__/gestures.test.ts 2>&1 | tail -6`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/ui/gestures.ts apps/mobile/__tests__/gestures.test.ts
git commit -m "feat(mobile): umbrales puros del swipe desde el borde"
```

---

### Task 4: `perpl/orders.ts` — `lockedCollateral` y `unrealisedPnl`

**Files:**
- Modify: `apps/mobile/src/perpl/orders.ts`
- Test: `apps/mobile/__tests__/perpl-orders.test.ts`

**Interfaces:**
- Produces:
  - `export function lockedCollateral(positions: readonly { c: bigint }[]): bigint`
  - `export function unrealisedPnl(positions: readonly PositionLike[], markets: readonly Market[]): bigint | null`

- [ ] **Step 1: Tests** (añadir a `perpl-orders.test.ts`; `MON` y `BTC` ya existen ahí, `MON.mark` es 2221 con `pd 5, sd 0` en el fixture — confírmalo con `console.log(MON.mark, BTC.mark)` si dudas)

```ts
test("lockedCollateral sums the collateral of every position", () => {
  expect(lockedCollateral([])).toBe(0n);
  expect(lockedCollateral([{ c: 10_000_000n }, { c: 2_500_000n }])).toBe(12_500_000n);
});

test("unrealisedPnl sums positionPnl across markets and skips unknown markets", () => {
  const longMon = { mkt: 64, sd: 1 as const, s: 100, ep: 2217, lv: 100 };   // MON mark 2221 → +4000
  const shortMon = { mkt: 64, sd: 2 as const, s: 100, ep: 2217, lv: 100 };  // → −4000
  const orphan = { mkt: 999, sd: 1 as const, s: 100, ep: 1, lv: 100 };
  expect(unrealisedPnl([longMon], [MON, BTC])).toBe(positionPnl(longMon, MON.mark, MON.priceDecimals, MON.sizeDecimals));
  expect(unrealisedPnl([longMon], [MON, BTC])).toBe(4000n);
  expect(unrealisedPnl([shortMon], [MON, BTC])).toBe(-4000n);
  expect(unrealisedPnl([longMon, shortMon], [MON, BTC])).toBe(0n);
  expect(unrealisedPnl([longMon, orphan], [MON, BTC])).toBe(4000n);
  expect(unrealisedPnl([orphan], [MON, BTC])).toBeNull();
  expect(unrealisedPnl([], [MON, BTC])).toBeNull();
});
```

Añade `lockedCollateral, unrealisedPnl` al import.

- [ ] **Step 2: Verificar que fallan**

Run: `cd apps/mobile && npx jest __tests__/perpl-orders.test.ts 2>&1 | tail -8`
Expected: FAIL — `lockedCollateral is not a function`.

- [ ] **Step 3: Implementar** (después de `positionPnl` en `orders.ts`)

```ts
/** Colateral en posiciones = Σ c. El `lb` de la cuenta no lo es (audit mobile-perpl-f1, aprendido 1). */
export function lockedCollateral(positions: readonly { c: bigint }[]): bigint {
  return positions.reduce((sum, p) => sum + p.c, 0n);
}

/** Σ positionPnl sobre las posiciones con mercado conocido; null si ninguna lo tiene (la UI oculta la línea). */
export function unrealisedPnl(positions: readonly PositionLike[], markets: readonly Market[]): bigint | null {
  let sum = 0n, any = false;
  for (const p of positions) {
    const m = markets.find((x) => x.id === p.mkt);
    if (!m) continue;
    any = true;
    sum += positionPnl(p, m.mark, m.priceDecimals, m.sizeDecimals);
  }
  return any ? sum : null;
}
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd apps/mobile && npx jest __tests__/perpl-orders.test.ts 2>&1 | tail -8 && npx tsc --noEmit && echo TSC_OK`
Expected: PASS y `TSC_OK`.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/perpl/orders.ts apps/mobile/__tests__/perpl-orders.test.ts
git commit -m "feat(mobile): lockedCollateral y unrealisedPnl para el saldo de Trade"
```

---

### Task 5: `ComingSoonScreen` + `Shell` la renderiza

**Files:**
- Create: `apps/mobile/src/screens/comingSoon.tsx`
- Modify: `apps/mobile/src/Shell.tsx`
- Test: `apps/mobile/__tests__/comingSoon.test.ts`

**Interfaces:**
- Consumes: `COMING_SOON`, `ctx.comingSoon` (Task 1).
- Produces: `export const COMING_SOON_COPY: Record<"market" | "activity" | "portfolio", { icon: "storefront-outline" | "pulse-outline" | "pie-chart-outline"; title: string; copy: string }>` y `export function ComingSoonScreen(props: { screen: Screen; nav: AppCtx["nav"] })`.

- [ ] **Step 1: Test** (`__tests__/comingSoon.test.ts`; importar el módulo `.tsx` desde Jest funciona con `jest-expo` — el test sólo toca el mapa)

```ts
import { COMING_SOON_COPY } from "../src/screens/comingSoon";
import { COMING_SOON } from "../src/store";

test("every coming-soon tab has its icon, title and one-line copy", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.market).toEqual({ icon: "storefront-outline", title: "Market", copy: "Agents and their tokens" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "pulse-outline", title: "Activity", copy: "What the agents you follow are doing" });
  expect(COMING_SOON_COPY.portfolio).toEqual({ icon: "pie-chart-outline", title: "Portfolio", copy: "Your token positions" });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `cd apps/mobile && npx jest __tests__/comingSoon.test.ts 2>&1 | tail -6`
Expected: FAIL — `Cannot find module '../src/screens/comingSoon'`.

- [ ] **Step 3: Crear `src/screens/comingSoon.tsx`**

```tsx
import { View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AppCtx } from "../ctx";
import type { Screen } from "../store";
import { T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";

type ComingSoonTab = "market" | "activity" | "portfolio";
type Copy = { icon: "storefront-outline" | "pulse-outline" | "pie-chart-outline"; title: string; copy: string };

/** Mismo icono que la tab bar (Shell.BOTTOM_TABS), variante outline. Copy fijado en el spec §2.3. */
export const COMING_SOON_COPY: Record<ComingSoonTab, Copy> = {
  market: { icon: "storefront-outline", title: "Market", copy: "Agents and their tokens" },
  activity: { icon: "pulse-outline", title: "Activity", copy: "What the agents you follow are doing" },
  portfolio: { icon: "pie-chart-outline", title: "Portfolio", copy: "Your token positions" },
};

const secondaryBtn = { paddingVertical: 14, paddingHorizontal: 22, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;

export function ComingSoonScreen({ screen, nav }: { screen: Screen; nav: AppCtx["nav"] }) {
  const c = COMING_SOON_COPY[screen as ComingSoonTab] ?? COMING_SOON_COPY.market;
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: C.surf, borderWidth: 1, borderColor: "rgba(200,240,58,0.35)", alignItems: "center", justifyContent: "center" }}>
        <Ionicons name={c.icon} size={30} color={C.lime} />
      </View>
      <T w={800} s={22} lh={1.1} ls={-0.03}>{c.title}</T>
      <Tag label="COMING SOON" fg={C.lime} bd="rgba(200,240,58,0.45)" dashed />
      <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", maxWidth: 260 }}>{c.copy}</T>
      <Touch onPress={() => nav("wallet")} style={{ ...secondaryBtn, marginTop: 6 }}>
        <T w={700} s={13.5}>Go to Wallet</T>
      </Touch>
    </View>
  );
}
```

(Si `Tag` no acepta `dashed` con esa firma, revisa `src/ui/primitives.tsx:45-56` — sí lo acepta: `dashed?: boolean`.)

- [ ] **Step 4: `Shell.tsx` — renderizar y ocultar ★/Alerts**

```tsx
import { ComingSoonScreen } from "./screens/comingSoon";
// …
const Current = SCREENS[ctx.scr];
// header actions: sólo cuando Market es real
const headerActions: HeaderAction[] = S.screen === "market" && !ctx.comingSoon
  ? [{ label: "★", go: () => nav("search") }, { label: "Alerts", go: () => nav("activity") }]
  : S.screen === "agent"
    ? [{ label: "★", active: S.following, go: () => set({ following: !S.following }) }]
    : [];
// …
<ScrollView …>
  {ctx.comingSoon ? <ComingSoonScreen screen={ctx.scr} nav={nav} /> : <Current {...ctx} />}
</ScrollView>
```

- [ ] **Step 5: Verificar**

Run: `cd apps/mobile && npx jest __tests__/comingSoon.test.ts 2>&1 | tail -6 && npx tsc --noEmit && echo TSC_OK`
Expected: PASS y `TSC_OK`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/screens/comingSoon.tsx apps/mobile/src/Shell.tsx apps/mobile/__tests__/comingSoon.test.ts
git commit -m "feat(mobile): pantalla Coming soon para Market, Activity y Portfolio"
```

---

### Task 6: `Shell` — pull-to-refresh y swipe atrás; `own.tsx` sin botón Refresh

**Files:**
- Modify: `apps/mobile/src/Shell.tsx`
- Modify: `apps/mobile/src/screens/own.tsx` (bloque TESTNET, el `Touch` "Refresh")

**Interfaces:**
- Consumes: `shouldCaptureEdgeSwipe`, `shouldGoBack` (Task 3); `treasury.refresh`, `treasury.refreshMovements`, `perpl.refreshContext` (existentes).

- [ ] **Step 1: RefreshControl en el `ScrollView`**

En `Shell.tsx`:

```tsx
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Image, PanResponder, RefreshControl, ScrollView, View } from "react-native";
import { shouldCaptureEdgeSwipe, shouldGoBack } from "./ui/gestures";
// …
export function Shell({ ctx }: { ctx: AppCtx }) {
  const { S, set, nav, back, requireAccount, agent, balance, tradeHolds: holds, treasury, perpl } = ctx;
  const [refreshing, setRefreshing] = useState(false);
  const refreshable = S.screen === "wallet" || S.screen === "perps";
  // D5: Wallet = saldos + movimientos; Trade = markets. allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(S.screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()] : [perpl.refreshContext()]);
    } finally {
      setRefreshing(false);
    }
  }, [S.screen, treasury, perpl]);
```

y en el `ScrollView`:

```tsx
<ScrollView
  style={{ flex: 1 }}
  contentContainerStyle={{ flexGrow: 1 }}
  showsVerticalScrollIndicator={false}
  refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
>
```

- [ ] **Step 2: PanResponder para el swipe atrás**

Dentro de `Shell`, después de `onRefresh`:

```tsx
  // D7: captura en fase *Capture* para ganarle al ScrollView; sólo desde el borde y sólo horizontal.
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_e, g) => shouldCaptureEdgeSwipe(g.x0, g.dx, g.dy),
    onPanResponderRelease: (_e, g) => { if (shouldGoBack(g.dx)) back(); },
  }), [back]);
```

y envuelve el `ScrollView`:

```tsx
<View style={{ flex: 1 }} {...(ctx.canBack ? pan.panHandlers : {})}>
  <ScrollView …>…</ScrollView>
</View>
```

- [ ] **Step 3: Quitar el botón Refresh de Wallet**

En `src/screens/own.tsx` (≈ línea 224) elimina exactamente este bloque; el `Retry` del `rpcError` de abajo se queda:

```tsx
<Touch onPress={() => { void treasury.refresh(); }} style={secondaryBtn}>
  <T w={600} s={13}>Refresh</T>
</Touch>
```

Si `secondaryBtn` deja de usarse en `own.tsx` tras esto, `tsc` no se queja (es una const), pero revisa con `grep -n secondaryBtn src/screens/own.tsx`: si sólo queda la declaración, bórrala también.

- [ ] **Step 4: Verificar**

Run: `cd apps/mobile && npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -5`
Expected: `TSC_OK`; todos los tests en PASS (línea base + 4 nuevos archivos/tests).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/Shell.tsx apps/mobile/src/screens/own.tsx
git commit -m "feat(mobile): pull-to-refresh en Wallet y Trade, swipe desde el borde para atrás"
```

---

### Task 7: `perps.tsx` — "in positions / free" y línea de PnL no realizado

**Files:**
- Modify: `apps/mobile/src/screens/perps.tsx` (bloque "Trading balance", ≈ líneas 186–193)

**Interfaces:**
- Consumes: `lockedCollateral`, `unrealisedPnl` (Task 4).

- [ ] **Step 1: Sustituir el cálculo y la línea**

Import: añade `lockedCollateral, unrealisedPnl` al import de `../perpl/orders`. Reemplaza `const locked = acc?.lb ?? 0n;` por:

```tsx
const positions = live?.positions ?? [];
const markets = perpl.context?.markets ?? [];
const locked = lockedCollateral(positions);
const upnl = unrealisedPnl(positions, markets);
```

(Las declaraciones de `markets` y `positions` que ya existen unas líneas más abajo se eliminan para no duplicarlas.) Y el bloque del saldo queda:

```tsx
<T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{formatAusd(b)} AUSD</T>
<T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 8 }}>{formatAusd(locked)} in positions · {formatAusd(b)} free{acc ? "" : " · last seen"}</T>
{upnl !== null ? (
  <T w={500} s={12} lh={1.4} mono color={upnl >= 0n ? C.up : C.down} style={{ marginTop: 4 }}>{upnl >= 0n ? "+" : "−"}{formatAusd(upnl < 0n ? -upnl : upnl)} unrealised PnL</T>
) : null}
```

**"free" es `b` por D10, condicionado a D12**: si la medición de Task 8 muestra que `b` **no** baja al abrir la posición, cambia `free` a `formatAusd(b - locked)` y regístralo en el audit.

- [ ] **Step 2: Verificar**

Run: `cd apps/mobile && npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/perps.tsx
git commit -m "feat(mobile): Trade muestra colateral en posiciones y PnL no realizado bajo el saldo"
```

---

### Task 8: Verificación manual en el simulador, medición D12, README y overview

**Files:**
- Modify: `apps/mobile/README.md` (línea "jest, 41/41 esperado" → el conteo real)
- Modify: `docs/overview/2026-09-18-mobile-polish.html` (tasks de F1 marcadas, status)
- Modify: `docs/overview/data/manifest.js` (F1 → `completed` sólo con esta evidencia)
- Create: `docs/superpowers/audits/2026-09-18-mobile-polish-f1-rulings.md`

- [ ] **Step 1: Correr la app en el simulador**

Run (desde `apps/mobile`): `npx expo run:ios` (si `ios/` no existe en el worktree, primero `npx expo prebuild --platform ios --clean`). El simulador con cuenta es el que tiene la passkey del simulador (`0xe371…51C1`, Perpl #620).
Expected: la app abre en **Wallet** (no en Market).

- [ ] **Step 2: Capturas** (guardar en el scratchpad de la sesión con `xcrun simctl io booted screenshot <ruta>.png` y mirarlas con la herramienta de lectura de imágenes)

1. Arranque → Wallet. 2. Tab Market → coming soon con `storefront`; header "Market · Coming soon" sin ★/Alerts. 3. Activity y Portfolio, ídem con sus iconos. 4. Wallet: jalar (con `idb ui swipe` si está disponible, o a mano) → spinner lime → suelta; sin botón Refresh. 5. Trade: jalar → spinner. 6. Deposit: swipe desde el borde → vuelve a Wallet. 7. Wallet: el mismo swipe no hace nada.

- [ ] **Step 3: Medición D12 en la cuenta #620**

En Trade, anota `b` (Trading balance) con la cuenta plana. Abre un long pequeño de MON (el mínimo que acepte el mercado, 1x). Anota: `b` después, `c` de la posición (línea "in positions"), y la línea de PnL. Cierra la posición. Registra los tres números en el audit. Regla: si `b_después ≈ b_antes − c` → "free" = `b` (como está); si `b_después ≈ b_antes` → cambia `free` a `b − locked` en `perps.tsx` (Task 7) y commitea `fix(mobile): free = b − colateral, medido en #620`.

- [ ] **Step 4: Arranque sin cuenta**

Sign out → cierra la app (`xcrun simctl terminate booted <bundleId>`) → relanza. Expected: Sign in; tras "I already have one" → Wallet. Captura.

- [ ] **Step 5: README y suite completa**

Actualiza la línea `npm test          # jest, 41/41 esperado` con el conteo real de `npm test`. Run: `cd apps/mobile && npm test 2>&1 | tail -5 && npx tsc --noEmit && echo TSC_OK`.

- [ ] **Step 6: Overview, manifest y audit**

- En `docs/overview/2026-09-18-mobile-polish.html`: `data-status="completed"` en la phase-card, `<option value="completed" selected>`, las 8 tasks de este plan como `<li>` con `checked`, bloque `<h3 class="section-sub">Rulings en ejecución</h3>` con los rulings reales del audit, footer con el audit.
- En `manifest.js`: `phases: [{ num: 1, status: 'completed' }]`, `status: 'completed'`, `types: ['spec', 'plan']`.
- Audit `docs/superpowers/audits/2026-09-18-mobile-polish-f1-rulings.md` con: rulings (fallback de `backState` a wallet; resultado de D12; cualquier desviación), correcciones, evidencia (salida de `npm test`/`tsc`, lista de capturas), **"## Estado de las cuentas de testnet al cierre"** (b, c, #620 tras la medición) y residuales.
- Desde la raíz del worktree: `npm run docs:html && npm run agents:check && npm run docs:check` en verde; `node scripts/agent-infra/render-check.mjs <scratch> 2026-09-18-mobile-polish` y mirar la captura de 390 px.

- [ ] **Step 7: Commit de docs**

```bash
git add apps/mobile/README.md docs/overview/2026-09-18-mobile-polish.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-18-mobile-polish-f1-rulings.md docs/superpowers/plans/2026-09-18-mobile-polish-f1.md docs/superpowers/plans/2026-09-18-mobile-polish-f1.html
git commit -m "docs: cierre de F1 de mobile-polish — overview, manifest, audit y README"
```

- [ ] **Step 8: Revisión independiente**

Antes de proponer merge: subagente revisor con el spec, este plan, `git diff main...feat/mobile-polish` y la evidencia. Sus hallazgos Important se corrigen en la rama; los Minor van a "Pendientes" del overview y al audit.
