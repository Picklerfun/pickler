# Rediseño light — F2: board, barras fijas, perfil de agente y onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Market muestra el board nivel × tiempo del Handoff, igual en *Trade it* y en *Ask an agent*. Market, Read y el perfil de agente tienen su barra de acción fija abajo. La tarjeta de Agents abre el perfil, que muestra la calibración y el récord calculados en la app. Tras **crear** una wallet salen 3 hojas de onboarding, una sola vez. La lógica de Perpl, wallet, reads y push no cambia.

**Architecture:** Toda la lógica nueva es pura y va con tests: geometría y rótulos del board (`reads/board.ts`), calibración y récord (`reads/calibration.ts`) y reglas del onboarding (`onboarding.ts`). `Page` gana un modo `bare`. En ese modo la pantalla pinta su propio scroll (`PageScroll`, con el mismo pull-to-refresh y el mismo sello) y una `FooterBar` fuera del scroll. Así el ticket conserva su estado local y la barra fija lo lee sin subirlo al store. El board (`screens/board.tsx`) reemplaza a `MatrixGrid` y recibe el modo: en Trade, tocar un cuadro arma `tradeLevel` (el `LevelCard` y los recordatorios de hoy); en Ask, arma `askCell` (el `AskSheet` de hoy). El onboarding es una ruta del RootStack, entre Sign up y `finishSignin`.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / TypeScript / Jest 29 (`jest-expo`) / react-navigation 7 / `react-native-svg` 15.15.4 (ya instalado). **Sin dependencias nuevas y sin prebuild:** F2 no toca nada nativo.

**Spec:** `docs/superpowers/specs/2026-09-28-mobile-light-design.md`. F2 cubre el resto de D10 (board), D11 y D12 sobre el board, D16 (perfil) y D21 (onboarding). También las barras fijas de D11 y D14, que F1 dejó como botón al final (audit F1, ruling 12 y residual 2), y el residual 3 (la sparkline cruza las celdas y las celdas son blancas). Léelo antes de empezar, junto con el audit `docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md`. Referencia visual: `jjesusaf/pickler-mobile@1808d5b`, carpeta `design/`, archivos `Market`, `Agent Profile`, `Onboarding` y `Read Mobile Light.dc.html`. Para verla: `gh repo clone jjesusaf/pickler-mobile <scratch>/pickler-mobile && git -C <scratch>/pickler-mobile checkout 1808d5b && python3 -m http.server 8765 --directory <scratch>/pickler-mobile/design` (con `file://` no carga).

## Global Constraints

- Worktree `.claude/worktrees/mobile-light`, rama `feat/mobile-light`. Antes de Task 0, F1 ya está mergeada a `main` local y la rama se adelanta con `git merge --ff-only main`. Los comandos de app se corren desde `apps/mobile` dentro del worktree; los de docs, desde la raíz del worktree. Nunca `git add -A`: archivos por nombre. Commits locales `feat(mobile): …` / `fix(mobile): …` / `docs(mobile-light): …` con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sin push, merge ni TestFlight.**
- Niveles y horizontes **no cambian** (D10): `LEVELS_BPS = [250, 100, 50, -50, -100]` y `HORIZONS_MIN = [60, 240, 720, 1440]`. El board tiene 5 filas de nivel, la banda MARK entre +0.5 % y −0.5 %, y 4 columnas. El Handoff dibuja 6 × 3; manda el backend.
- La orden sigue siendo **de mercado** y los recordatorios siguen con `reminder-set` (D11). Sin TP, sin cierre por deadline, sin «three orders» y sin fila `IF IT HITS` (ruling 7 de F1).
- Paleta (D3) con los nombres de `ui/theme.ts`: vacío `C.empty` (`#E2E5EE`), punto `C.agentDot` (`#9B7BFF`), tinte long `C.limeBg` (`#F3F8E0`), tinte short `C.downBg` (`#FDF0F5`), tinte ask `C.vioBg` (`#EEEAFF`), trayectoria `C.spark` (`#B9BED0`), punto now `C.vio`. **La lima nunca es texto sobre blanco**: como texto, `C.limeInk`.
- Fuera de alcance (spec §5): Back it, tokens, NET AUSD, reglas o chips del agente («NEVER FUTURES»…), «Trade $HALF» en el perfil, «BOOK IS AT» y SOURCES. En el onboarding, nada de deportes ni «Back it» (D21).
- Copy en inglés, como hoy. Reglas de `mobile-nav`: navegar con `ctx.nav` / `requireAccount` / `navigateTo` (`pop: true`) y nunca llamar a `navigationRef` desde una pantalla.
- `npx tsc --noEmit` limpio y `npm test` en verde **al terminar cada tarea**.
- Metro y el simulador: sólo el simulador `pickler-mobile-light` (udid `700707EF-53E1-42F2-BE6B-893515BDB95C`) y sólo tu propio Metro. Nada de `pkill` amplio: detén por PID o por puerto (nota de proceso del audit F1).

## Review Focus

1. **Trayectoria con marks fuera de rango**: si un mark del historial queda por encima de +2.5 % o por debajo de −1 % del mark actual, la línea se pega al borde (2 %–98 %) y no sale del board ni da `NaN`. Lo pinnea el test de `trajectory` en Task 1.
2. **Calibración en las fronteras**: una probabilidad de exactamente 0.2 cae en el bucket 20–40 y 1.0 en 80–100. Las reads `void`, `failed` o `open` no cuentan, y con menos de 5 resueltas sale el estado vacío. Lo pinnea el test de `calibration` en Task 5.
3. **Onboarding con acción retenida**: si Sign up llegó desde un gate (`next = "portfolio"`), al cerrar las hojas se aterriza en Portfolio, no en Markets. Sign in (recuperar la cuenta) nunca muestra hojas. Lo pinnean los tests de `shouldOnboard` y `onboardingExit` en Task 7 y la verificación de Task 8.
4. **Barra fija y teclado**: al escribir el margen, el teclado decimal tapa la barra; al cerrarlo, la barra vuelve y muestra el monto nuevo. La barra nunca muestra un «Review» habilitado con un margen inválido, porque usa el mismo `ok` que el cuerpo. Lo pinnea el test de `stickyPhrase` en Task 1 y la verificación de Task 8.
5. **Perfil sin sesión de reads**: sin firma diaria, el récord muestra «Unlock» y no el vacío «No reads with this agent yet»; la calibración sale vacía sin error. Lo pinnea la rama `reads.session !== "ready"` de Task 6, verificada en Task 8 con la app recién abierta.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `apps/mobile/src/reads/board.ts` | crear | filas del board, tono de celda, rótulo, trayectoria, frase de la barra |
| `apps/mobile/src/reads/calibration.ts` | crear | `calibration`, `recordFor` |
| `apps/mobile/src/onboarding.ts` | crear | copy de las 3 hojas, `shouldOnboard`, `onboardingExit` |
| `apps/mobile/src/storage/onboarding.ts` | crear | flag persistido `pickler.onboarded.v1` |
| `apps/mobile/src/ui/Page.tsx` | modificar | modo `bare`, `PageScroll`, `FooterBar`, título del perfil |
| `apps/mobile/src/screens/board.tsx` | crear | componente `Board` (reemplaza a `MatrixGrid`) |
| `apps/mobile/src/screens/ask.tsx` | modificar | usa `Board`; sale `MatrixGrid` |
| `apps/mobile/src/screens/market.tsx` | modificar | board en Trade, `PageScroll` + barra fija |
| `apps/mobile/src/screens/read.tsx` | modificar | barra fija «Trade this market» |
| `apps/mobile/src/screens/agent.tsx` | crear | perfil (D16) |
| `apps/mobile/src/screens/agents.tsx` | modificar | la tarjeta abre el perfil |
| `apps/mobile/src/screens/onboarding.tsx` | crear | pantalla de 3 hojas |
| `apps/mobile/src/screens/signin.tsx` | modificar | Sign up → onboarding |
| `apps/mobile/src/navigation/screens.ts`, `routes.ts`, `ref.ts`, `Navigator.tsx` | modificar | ruta `onboarding`, `agent` real |
| `apps/mobile/src/store.ts` | modificar | `headerFor` del perfil y del onboarding, `finishSignin(fallback)`, `startOnboarding` |
| `apps/mobile/__tests__/board.test.ts`, `calibration.test.ts`, `onboarding.test.ts` | crear | lógica pura |
| `apps/mobile/__tests__/routes.test.ts`, `store.test.ts` | modificar | `onboarding` y `headerFor` |
| `apps/mobile/README.md`, `docs/overview/2026-09-28-mobile-light.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-28-mobile-light-f2-rulings.md` | modificar/crear | cierre |

---

### Task 0: Línea base sobre main

**Files:** ninguno.

**Interfaces:**
- Produces: la rama `feat/mobile-light` igual a `main` local, con F1 mergeada, y el número N de tests de la línea base.

- [ ] **Step 1: Comprobar que F1 está en main y adelantar la rama**

Desde la raíz del worktree:
```bash
git log --oneline -1 main
git merge-base --is-ancestor 3bb93ab main && echo F1_IN_MAIN
git status --short
git merge --ff-only main
git log --oneline -1
```
Expected: `F1_IN_MAIN`, un árbol limpio (salvo este plan y su HTML, si aún no están commiteados) y HEAD = main. Si `F1_IN_MAIN` no sale, **para**: el merge de F1 lo corre Jesús.

- [ ] **Step 2: Medir**

Desde `apps/mobile`:
```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: `Tests: 282 passed, 282 total` (lo que dejó F1; anota el número real) y `TSC_OK`. Si la línea base no está en verde, **para** y repórtalo.

---

### Task 1: Lógica pura del board (D10, D11)

**Files:**
- Create: `apps/mobile/src/reads/board.ts`
- Test: `apps/mobile/__tests__/board.test.ts`

**Interfaces:**
- Consumes: `LEVELS_BPS`, `horizonLabel`, `levelLabel`, `targetFor` de `src/reads/matrix.ts`; `formatPrice`, `type Side` de `src/perpl/orders.ts`.
- Produces:
  - `BOARD_CELL_H = 48`, `BOARD_MARK_H = 26`, `BOARD_H = 266`.
  - `type BoardMode = "trade" | "ask"`.
  - `type BoardRow = { kind: "level"; bps: number; price: number; label: string; side: Side } | { kind: "mark" }`.
  - `boardRows(mark: number): BoardRow[]`: 5 niveles con la banda después del último positivo (6 filas).
  - `cellTone(mode: BoardMode, bps: number): "long" | "short" | "ask"`.
  - `boardCaption(mode, cell: { levelBps: number; horizonMin: number } | undefined, mark: number, pd: number): { text: string; tone: "long" | "short" | "ask" | "none" }`.
  - `trajectory(marks: readonly number[], mark: number): [number, number][]`: puntos en un viewBox 0..100.
  - `stickyPhrase(side: Side, symbol: string, level: { target: number; horizonMin: number } | undefined, pd: number): string`.

- [ ] **Step 1: Escribir el test que falla**

Crea `apps/mobile/__tests__/board.test.ts`:
```ts
import { BOARD_H, boardCaption, boardRows, cellTone, stickyPhrase, trajectory } from "../src/reads/board";

// BTC con pd 1: mark 762555 = 76,255.5 (mismos números que reads-matrix.test).
const MARK = 762555;

test("rows: 5 levels high to low with the mark band between +0.5% and −0.5% (D10)", () => {
  const rows = boardRows(MARK);
  expect(rows.map((r) => (r.kind === "mark" ? "MARK" : r.bps))).toEqual([250, 100, 50, "MARK", -50, -100]);
  expect(rows[0]).toEqual({ kind: "level", bps: 250, price: 781619, label: "+2.5%", side: "long" });
  expect(rows[4]).toEqual({ kind: "level", bps: -50, price: 758742, label: "−0.5%", side: "short" });
  expect(BOARD_H).toBe(5 * 48 + 26);
});

test("cell tone: above the mark is long, below is short; Ask is always ask", () => {
  expect(cellTone("trade", 100)).toBe("long");
  expect(cellTone("trade", -50)).toBe("short");
  expect(cellTone("ask", -50)).toBe("ask");
});

test("caption: trade phrase with the absolute level; ask phrase; hint without a cell", () => {
  expect(boardCaption("trade", { levelBps: 100, horizonMin: 240 }, MARK, 1)).toEqual({ text: "LONG TO 77018.1 WITHIN 4H", tone: "long" });
  expect(boardCaption("trade", { levelBps: -100, horizonMin: 1440 }, MARK, 1)).toEqual({ text: "SHORT TO 75492.9 WITHIN 24H", tone: "short" });
  expect(boardCaption("ask", { levelBps: 50, horizonMin: 60 }, MARK, 1)).toEqual({ text: "ASK ABOUT 76636.8 WITHIN 1H", tone: "ask" });
  expect(boardCaption("trade", undefined, MARK, 1)).toEqual({ text: "TAP A SQUARE", tone: "none" });
});

test("trajectory: the current mark sits on the band; x spans 0..100", () => {
  const pts = trajectory([MARK, MARK], MARK);
  expect(pts[0][0]).toBe(0);
  expect(pts[1][0]).toBe(100);
  // centro de la banda: (3 × 48 + 13) / 266 = 59.0 %
  expect(pts[1][1]).toBeCloseTo(59.0, 1);
});

test("trajectory: a past mark at +1.0% sits on the +1.0% row centre", () => {
  const up = Math.round((MARK * 10100) / 10000);
  const [[, y]] = trajectory([up, MARK], MARK);
  expect(y).toBeCloseTo((72 / 266) * 100, 1);
});

test("trajectory: marks outside the board are clamped to 2..98 and never NaN (Review Focus 1)", () => {
  const pts = trajectory([MARK * 2, MARK / 2, MARK], MARK);
  expect(pts[0][1]).toBe(2);
  expect(pts[1][1]).toBe(98);
  expect(pts.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
});

test("trajectory: fewer than 2 marks draws nothing", () => {
  expect(trajectory([], MARK)).toEqual([]);
  expect(trajectory([MARK], MARK)).toEqual([]);
});

test("sticky phrase: with a level it names target and horizon; without, a market order", () => {
  expect(stickyPhrase("long", "BTC", { target: 770181, horizonMin: 240 }, 1)).toBe("Long to 77018.1 within 4H");
  expect(stickyPhrase("short", "ETH", undefined, 2)).toBe("Short ETH at market");
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `npx jest __tests__/board.test.ts`
Expected: FAIL con `Cannot find module '../src/reads/board'`.

- [ ] **Step 3: Implementar**

Crea `apps/mobile/src/reads/board.ts`:
```ts
// Board nivel × tiempo (spec mobile-light D10–D12). Puro: geometría, rótulos y trayectoria.
// El Handoff dibuja 6 niveles × 3 horizontes; aquí mandan los del backend (5 × 4).
import { formatPrice, type Side } from "../perpl/orders";
import { horizonLabel, LEVELS_BPS, levelLabel, targetFor } from "./matrix";

export const BOARD_CELL_H = 48;
export const BOARD_MARK_H = 26;
const ABOVE = LEVELS_BPS.filter((b) => b > 0).length; // 3 filas sobre la banda
export const BOARD_H = LEVELS_BPS.length * BOARD_CELL_H + BOARD_MARK_H;

export type BoardMode = "trade" | "ask";
export type BoardRow = { kind: "level"; bps: number; price: number; label: string; side: Side } | { kind: "mark" };

export function boardRows(mark: number): BoardRow[] {
  const levels: BoardRow[] = LEVELS_BPS.map((bps) => ({ kind: "level", bps, price: targetFor(mark, bps), label: levelLabel(bps), side: bps > 0 ? "long" : "short" }));
  return [...levels.slice(0, ABOVE), { kind: "mark" }, ...levels.slice(ABOVE)];
}

export const cellTone = (mode: BoardMode, bps: number): "long" | "short" | "ask" => (mode === "ask" ? "ask" : bps > 0 ? "long" : "short");

export function boardCaption(mode: BoardMode, cell: { levelBps: number; horizonMin: number } | undefined, mark: number, pd: number): { text: string; tone: "long" | "short" | "ask" | "none" } {
  if (!cell) return { text: "TAP A SQUARE", tone: "none" };
  const price = formatPrice(targetFor(mark, cell.levelBps), pd);
  const h = horizonLabel(cell.horizonMin);
  if (mode === "ask") return { text: `ASK ABOUT ${price} WITHIN ${h}`, tone: "ask" };
  const tone = cellTone(mode, cell.levelBps) as "long" | "short";
  return { text: `${tone.toUpperCase()} TO ${price} WITHIN ${h}`, tone };
}

// Anclas en bps respecto al mark actual → y en px del board: centro de cada fila y de la banda.
const ANCHORS: [number, number][] = [
  ...LEVELS_BPS.slice(0, ABOVE).map((b, i): [number, number] => [b, i * BOARD_CELL_H + BOARD_CELL_H / 2]),
  [0, ABOVE * BOARD_CELL_H + BOARD_MARK_H / 2],
  ...LEVELS_BPS.slice(ABOVE).map((b, i): [number, number] => [b, (ABOVE + i) * BOARD_CELL_H + BOARD_MARK_H + BOARD_CELL_H / 2]),
];

function yFor(bps: number): number {
  // Segmento entre dos anclas; fuera del board se extrapola con el segmento del extremo y el clamp lo pega al borde.
  const j = ANCHORS.findIndex(([b]) => b <= bps);
  const i = j <= 0 ? 1 : j; // j = -1: por debajo de la última ancla; j = 0: por encima de la primera
  const [b0, y0] = ANCHORS[j === -1 ? ANCHORS.length - 2 : i - 1];
  const [b1, y1] = ANCHORS[j === -1 ? ANCHORS.length - 1 : i];
  const px = y0 + ((b0 - bps) / (b0 - b1)) * (y1 - y0);
  return Math.min(98, Math.max(2, Math.round((px / BOARD_H) * 1000) / 10));
}

/** Historial de marks en memoria (`perpl/marks.ts`) → polilínea detrás de las celdas. Con < 2 marks, nada. */
export function trajectory(marks: readonly number[], mark: number): [number, number][] {
  if (marks.length < 2 || !(mark > 0)) return [];
  const last = marks.length - 1;
  return marks.map((m, i) => [Math.round((i / last) * 1000) / 10, yFor(((m - mark) / mark) * 10000)]);
}

export function stickyPhrase(side: Side, symbol: string, level: { target: number; horizonMin: number } | undefined, pd: number): string {
  const s = side === "long" ? "Long" : "Short";
  return level ? `${s} to ${formatPrice(level.target, pd)} within ${horizonLabel(level.horizonMin)}` : `${s} ${symbol} at market`;
}
```

- [ ] **Step 4: Correrlo y verlo pasar**

Run: `npx jest __tests__/board.test.ts`
Expected: PASS, 8 tests. Si un precio esperado no coincide, recalcúlalo con `targetFor` y `formatPrice` (no ajustes la fórmula al test). Después, **contra el defecto**: quita el `Math.min(98, Math.max(2, …))` (deja sólo el redondeo), confirma que el test de clamp falla y restaura.

- [ ] **Step 5: Suite completa, tipos y commit**

```bash
npm test 2>&1 | tail -3 && npx tsc --noEmit && echo TSC_OK
git add apps/mobile/src/reads/board.ts apps/mobile/__tests__/board.test.ts
git commit -m "feat(mobile): lógica pura del board nivel × tiempo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `Page` con barra fija — modo `bare`, `PageScroll` y `FooterBar`

**Files:**
- Modify: `apps/mobile/src/ui/Page.tsx`

**Interfaces:**
- Produces:
  - `withPage(screen, Component, opts?: { headerRight?; bare?: boolean })`. Con `bare`, `Page` pinta la cabecera y deja que el componente llene un `View` con `flex: 1`.
  - `PageScroll({ screen, children }: { screen: Screen; children: ReactNode })`: el `ScrollView` de hoy, con pull-to-refresh, sello `UPDATED`/`COULDN'T REFRESH`, `keyboardShouldPersistTaps="handled"` y el hueco de la tab bar en las raíces.
  - `FooterBar({ children }: { children: ReactNode })`: fuera del scroll, fondo `C.bg`, `borderTopWidth: 1` en `C.hair08`, padding `12 / 18 / 12`. El inset inferior lo pone el `SafeAreaView`: las pantallas no raíz ya usan `edges={["top", "bottom"]}` y no llevan tab bar.

- [ ] **Step 1: Extraer `PageScroll` sin cambiar el comportamiento**

En `Page.tsx`, mueve a un componente exportado `PageScroll` todo lo que hoy va del `useState(refreshing)` al cierre del `ScrollView`: `onRefresh`, `label`, `failed` y el `ScrollView` con su `RefreshControl` y el sello. Toma `screen` por prop y el resto de `useAppCtx()` y `useSafeAreaInsets()`. `Page` queda así:
```tsx
export function Page({ screen, children, headerRight, bare }: { screen: Screen; children: ReactNode; headerRight?: ReactNode; bare?: boolean }) {
  // … cabecera igual que hoy …
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }} edges={showTabs ? ["top"] : ["top", "bottom"]}>
        {/* cabecera sin cambios */}
        {bare ? <View style={{ flex: 1 }}>{children}</View> : <PageScroll screen={screen}>{children}</PageScroll>}
      </SafeAreaView>
    </View>
  );
}

/** Barra de acción fija (Handoff: STICKY ACTION de Market, Read y el perfil). Sólo en pantallas no raíz: ahí no hay tab bar. */
export function FooterBar({ children }: { children: ReactNode }) {
  return <View style={{ paddingTop: 12, paddingHorizontal: 18, paddingBottom: 12, backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.hair08, gap: 10 }}>{children}</View>;
}
```
`withPage` pasa `bare={opts?.bare}` a `Page`.

- [ ] **Step 2: Tipos y tests**

```bash
npx tsc --noEmit && echo TSC_OK
npm test 2>&1 | tail -3
```
Expected: `TSC_OK` y el mismo número de tests que en Task 0. Todavía ninguna pantalla usa `bare`: el comportamiento no cambia.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/ui/Page.tsx
git commit -m "feat(mobile): Page con modo bare, PageScroll y FooterBar para las barras fijas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Componente `Board` y Market con el board en los dos modos (D10, D11, D12; residual 3 de F1)

**Files:**
- Create: `apps/mobile/src/screens/board.tsx`
- Modify: `apps/mobile/src/screens/ask.tsx` (sale `MatrixGrid` y la fila «HISTORY · MARK»), `apps/mobile/src/screens/market.tsx` (el board entra en Trade)

**Interfaces:**
- Consumes: `boardRows`, `cellTone`, `boardCaption`, `trajectory`, `BOARD_CELL_H`, `BOARD_MARK_H`, `type BoardMode` (Task 1); `HORIZONS_MIN`, `horizonLabel`, `dotKey`, `readDots`, `readsForMarket`, `type Cell` (`reads/matrix.ts`); `levelFromCell`, `levelIsLive`, `sideFor` (`reads/level.ts`).
- Produces: `Board({ mode, market, marks, dots, selected, onSelect }: { mode: BoardMode; market: Market; marks: readonly number[]; dots: Set<string>; selected?: Cell; onSelect: (c: Cell) => void })`.

- [ ] **Step 1: Crear `Board`**

Valores del Handoff (`Market Mobile Light.dc.html`), con 5 × 4:

- Tarjeta: `Card` con radio 20, fondo `C.card`, `pad={0}`.
- Cabecera de la tarjeta, con padding `14/16` y `space-between`:
  - «LEVEL × TIME» con `Tag s={10}`.
  - `boardCaption(...).text` en mono 500 10, ls 0.06. Color según el tono: `C.limeInk` para long, `C.down` para short, `C.vio` para ask y `C.faint` para none.
- Grid interior: `marginHorizontal: 6`, `marginBottom: 6`, radio 14, fondo `C.bg`, `overflow: "hidden"`.
- Capa de trayectoria **detrás** de las filas:
  - `View` absoluto con `left: 84`, `right: 0`, `top: 0` y `height: BOARD_H`, con `pointerEvents="none"`.
  - Dentro, un `Svg` de `react-native-svg` con `viewBox="0 0 100 100"` y `preserveAspectRatio="none"`.
  - `Polygon` de área: `fill="rgba(91,60,224,0.07)"`, con los puntos de la línea más `100,100 0,100`.
  - `Polyline`: `stroke={C.spark}`, `strokeWidth={2}`, `strokeLinejoin="round"`, `strokeLinecap="round"`, `vectorEffect="non-scaling-stroke"` y `fill="none"`.
  - Punto «now»: un `View` absoluto de 9 × 9 con `right: 2`, radio 999, fondo `C.vio`, borde de 2 en `C.bg` y `top` en `y% − 4.5`. Va en la `y` del último punto; sin trayectoria no se pinta.
  - Sin animación de desplazamiento (el `pk-slide` del prototipo): el polling ya mueve la línea.
- Filas: `boardRows(market.mark)`.
  - Fila de nivel:
    - Borde inferior de 1 en `C.hair06`.
    - Columna de precio de **84** de ancho, con `paddingLeft: 12` y `gap: 3`:
      - `formatPrice(row.price, pd)` en mono 700 12, ls −0.03; color `C.limeInk` si es long y `C.down` si es short.
      - `row.label` en mono 500 9, `C.faint`.
    - 4 celdas `Touch`, cada una con `flex: 1` y alto `BOARD_CELL_H`, centradas y con `accessibilityLabel={`cell-${bps}-${h}`}`.
  - Celda sin selección: fondo transparente y un cuadrado de 6 × 6, radio 2, en `C.agentDot` si `dots.has(dotKey(...))` y en `C.empty` si no.
  - Celda seleccionada: tinte y pill según `cellTone(mode, bps)`.
    - long: tinte `C.limeBg` y pill «LONG» con fondo `C.lime` y texto `C.ink`.
    - short: tinte `C.downBg` y pill «SHORT» con fondo `C.short` y texto `C.onInk`.
    - ask: tinte `C.vioBg` y pill «ASK» con fondo `C.vio` y texto `C.onInk`.
    - Pill: padding `5/9`, radio 999, mono 600 9.5, ls 0.06.
    - Si la celda seleccionada tiene read, el pill la tapa; el punto reaparece al deseleccionar.
  - Banda MARK: alto `BOARD_MARK_H`, fondo `C.ink`, `paddingHorizontal: 12`, `gap: 8` y a todo el ancho. Lleva `formatPrice(market.mark, pd)` en mono 700 10.5 `C.onInk` y «MARK» en mono 500 9, ls 0.12, `C.onInkDim`. `accessibilityLabel="mark-band"`.
- Fila de horizontes bajo el grid:
  - «TIME» en la columna de 84, mono 500 9, ls 0.1, `C.faint`.
  - `horizonLabel(h)` centrado, `paddingVertical: 10`, mono 700 11; `C.ink` si `selected?.horizonMin === h` y `C.dim` si no.
- Leyenda bajo la tarjeta: cuadrado de 7 × 7, radio 2, `C.agentDot`, y «YOU ASKED AN AGENT HERE» en mono 500 10, ls 0.06, `C.dim`.
  - Ruling: el Handoff dice «AN AGENT HAS A CALL HERE», pero nuestros puntos son **tus** reads (D10).

- [ ] **Step 2: Ask usa `Board`**

En `ask.tsx`:

1. Borra `MatrixGrid` y la fila «HISTORY · MARK» (el mark ya está en la cabecera y en la banda).
2. Cambia los imports:
   - Quita `sparkPoints`, `Sparkline`, `StyleSheet`, `GRID_ACCENT`, `GRID_DOT`, `levelLabel` y `targetFor` si quedan sin uso.
   - Agrega `import { Board } from "./board";`.
3. En `newRead()`, en su lugar:
```tsx
<Board mode="ask" market={market} marks={perpl.marks[market.id] ?? []} dots={dots} selected={S.askCell as Cell | undefined} onSelect={(c) => set({ askCell: c })} />
```
El hint «Tap a cell: a level and a horizon.» / «Use the steppers to move it.» se conserva. Si `GRID_ACCENT` y `GRID_DOT` quedan sin consumidores en todo `src/`, bórralos de `theme.ts` y de `theme.test.ts`: `grep -rn "GRID_ACCENT\|GRID_DOT" apps/mobile/src apps/mobile/__tests__`.

- [ ] **Step 3: Trade usa `Board`**

En `TradeTab` de `market.tsx`, **antes** del `if (perpl.state.status === "loading")`, calcula:
```tsx
const dots = readDots(readsForMarket(reads.reads, market.id));
const board = (
  <Board mode="trade" market={market} marks={perpl.marks[market.id] ?? []} dots={dots}
    selected={level ? { levelBps: level.levelBps, horizonMin: level.horizonMin } as Cell : undefined}
    onSelect={(c) => set({ tradeLevel: levelFromCell(market, c, new Date()), perpsSide: sideFor(c.levelBps) })} />
);
```
Píntalo arriba en los tres estados de edición:
- sin key: `board` y debajo `EnableTrading`;
- cargando: `board` y el spinner;
- listo: `TradingWarns`, luego `board`, luego `LevelCard` y el resto del ticket.

Review y result no llevan board. `level` ya filtra por mercado y vigencia (`levelIsLive`). Tocar otra celda **reemplaza** el nivel. Tocar la misma celda no lo quita: para eso está «Remove level» del `LevelCard`.

- [ ] **Step 4: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK
npm test 2>&1 | tail -3
git add apps/mobile/src/screens/board.tsx apps/mobile/src/screens/ask.tsx apps/mobile/src/screens/market.tsx
# + theme.ts / theme.test.ts sólo si Step 2 los tocó
git commit -m "feat(mobile): board nivel × tiempo del Handoff en Trade it y Ask an agent

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Barras fijas de Market y Read (D11, D14; ruling 12 y residual 2 de F1)

**Files:**
- Modify: `apps/mobile/src/navigation/Navigator.tsx` (Market y Read con `bare: true`), `apps/mobile/src/screens/market.tsx`, `apps/mobile/src/screens/ask.tsx`, `apps/mobile/src/screens/read.tsx`

**Interfaces:**
- Consumes: `PageScroll`, `FooterBar` (Task 2); `stickyPhrase` (Task 1).

- [ ] **Step 1: Market pasa a `bare`**

En `Navigator.tsx`: `const Market = withPage("market", MarketScreen, { headerRight: MarkBadge, bare: true });`.

En `market.tsx`:
- `MarketScreen` deja de envolver en un `View`. El segmentado pasa a una prop `head`: `<TradeTab {...ctx} head={seg} />` / `<AskTab {...ctx} head={seg} />`, con `seg` = el `View` con el `Segmented` de hoy. Los estados `MarketSkeleton` y `!market` van dentro de `<PageScroll screen="market">`.
- `TradeTab` devuelve siempre `<><PageScroll screen="market">{head}{cuerpo}</PageScroll>{footer}</>`. `footer` sólo existe en el paso `edit` con `perpl.state.status === "ready"`:
```tsx
<FooterBar>
  <T w={600} s={17} lh={1.25} ls={-0.03} accessibilityLabel="sticky-phrase">{stickyPhrase(side, sym, level, market.priceDecimals)}</T>
  <Btn label={ok ? `Review · ${formatAusd(units ?? 0n)} AUSD` : "Enter a margin"} onPress={() => setSt({ step: "review" })} arrow disabled={!ok} py={16} variant="lime" accessibilityLabel="review" />
</FooterBar>
```
- Borra del cuerpo el `Btn` «Review» de hoy, que duplicaría el `accessibilityLabel="review"`. «Nothing sent yet…» se queda en el cuerpo.
- En review, «Confirm» y «Change amount» siguen en el cuerpo. En result, no hay barra.
- `AskTab` devuelve `<PageScroll screen="market">{head}<View …>{newRead()}</View></PageScroll>`, sin barra: Ask pregunta desde su hoja (D12).

- [ ] **Step 2: Read pasa a `bare`**

En `Navigator.tsx`: `const ReadView = withPage("read", ReadScreen, { bare: true });`.

En `read.tsx`:
- Los estados skeleton y missing van dentro de `<PageScroll screen="read">`.
- La read cargada devuelve `<><PageScroll screen="read"><Page gap={14}>…</Page></PageScroll><FooterBar>…</FooterBar></>`.
- «Trade this market» y «A read is not a trading permission.» salen del cuerpo y pasan a la barra, con el `trade` de hoy:
```tsx
<FooterBar>
  <Btn label="Trade this market" arrow onPress={trade} variant="lime" py={16} accessibilityLabel="trade-this-market" />
  <T w={400} s={13} lh={1.4} color={C.dim} style={{ textAlign: "center" }}>A read is not a trading permission.</T>
</FooterBar>
```

- [ ] **Step 3: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK
npm test 2>&1 | tail -3
git add apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/screens/market.tsx apps/mobile/src/screens/ask.tsx apps/mobile/src/screens/read.tsx
git commit -m "feat(mobile): barras fijas en Market (Review) y Read (Trade this market)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Calibración y récord, puros (D16)

**Files:**
- Create: `apps/mobile/src/reads/calibration.ts`
- Test: `apps/mobile/__tests__/calibration.test.ts`

**Interfaces:**
- Consumes: `type Read` (`reads/types.ts`).
- Produces:
  - `CALIBRATION_MIN = 5`.
  - `type Bucket = { lo: number; hi: number; promised: number; actual: number | null; n: number }`.
  - `calibration(reads: readonly Read[]): Bucket[] | null`: 5 buckets de 0.2; `null` con menos de 5 resueltas.
  - `type RecordFilter = "all" | "right" | "wrong" | "open"`.
  - `recordFor(reads: readonly Read[] | null, agentId: string, filter: RecordFilter): Read[] | null`.

Definición: una read **resuelta** tiene `status` `right` o `wrong`, `probability` y `outcome` no nulos. Cae en el bucket `i` si `lo ≤ p < hi`; el último incluye 1.0. `actual` = fracción con `outcome === true`, es decir, cuántas veces pasó el evento al que el agente le puso probabilidad `p`. `promised` es el centro del bucket y la diagonal lo dibuja.

- [ ] **Step 1: Escribir el test que falla**

Crea `apps/mobile/__tests__/calibration.test.ts`:
```ts
import { calibration, recordFor } from "../src/reads/calibration";
import type { Read } from "../src/reads/types";

const base: Read = {
  id: "r", agentId: "drift", marketId: 1, symbol: "BTC", priceDecimals: 1, levelBps: 100, horizonMin: 240, markAtRequest: 762555, target: 770181,
  question: "q", status: "open", probability: 0.5, reasons: null, limits: null, creditsCharged: 1, error: null,
  createdAt: "2026-09-28T10:00:00Z", expiresAt: "2026-09-28T14:00:00Z", resolvedAt: null, markAtResolution: null, outcome: null, brier: null,
};
const r = (id: string, p: Partial<Read>): Read => ({ ...base, id, ...p });
const resolved = (id: string, probability: number, outcome: boolean): Read => r(id, { status: outcome === probability >= 0.5 ? "right" : "wrong", probability, outcome });

test("fewer than 5 resolved reads → empty state (null)", () => {
  expect(calibration([resolved("a", 0.1, false), resolved("b", 0.3, false), resolved("c", 0.5, true), resolved("d", 0.9, true)])).toBeNull();
});

test("open, void and failed reads do not count (Review Focus 2)", () => {
  const four = [resolved("a", 0.1, false), resolved("b", 0.3, false), resolved("c", 0.5, true), resolved("d", 0.9, true)];
  expect(calibration([...four, r("o", { status: "open" }), r("v", { status: "void" }), r("f", { status: "failed", probability: null })])).toBeNull();
});

test("5 buckets of 0.2; boundaries go up; 1.0 falls in the last (Review Focus 2)", () => {
  const b = calibration([resolved("a", 0.2, false), resolved("b", 0.25, true), resolved("c", 1, true), resolved("d", 0.85, false), resolved("e", 0.05, false)])!;
  expect(b.map((x) => x.n)).toEqual([1, 2, 0, 0, 2]);
  expect(b[1]).toEqual({ lo: 0.2, hi: 0.4, promised: 0.3, actual: 0.5, n: 2 });
  expect(b[2].actual).toBeNull();
  expect(b[4].actual).toBe(0.5);
  expect(b[0].promised).toBeCloseTo(0.1);
});

test("record: only this agent, newest first as given, filtered", () => {
  const list = [r("1", { status: "right" }), r("2", { status: "wrong" }), r("3", { status: "open" }), r("4", { agentId: "anchor" }), r("5", { status: "void" })];
  expect(recordFor(list, "drift", "all")!.map((x) => x.id)).toEqual(["1", "2", "3", "5"]);
  expect(recordFor(list, "drift", "right")!.map((x) => x.id)).toEqual(["1"]);
  expect(recordFor(list, "drift", "wrong")!.map((x) => x.id)).toEqual(["2"]);
  expect(recordFor(list, "drift", "open")!.map((x) => x.id)).toEqual(["3"]);
  expect(recordFor(null, "drift", "all")).toBeNull();
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

Run: `npx jest __tests__/calibration.test.ts`
Expected: FAIL con `Cannot find module '../src/reads/calibration'`.

- [ ] **Step 3: Implementar**

Crea `apps/mobile/src/reads/calibration.ts`:
```ts
// Perfil de agente (spec mobile-light D16): calibración y récord con TUS reads de ese agente (máx. 50 de reads-list). Puro.
import type { Read } from "./types";

export const CALIBRATION_MIN = 5;
const N = 5;

export type Bucket = { lo: number; hi: number; promised: number; actual: number | null; n: number };

const isResolved = (r: Read): boolean => (r.status === "right" || r.status === "wrong") && r.probability !== null && r.outcome !== null;

export function calibration(reads: readonly Read[]): Bucket[] | null {
  const done = reads.filter(isResolved);
  if (done.length < CALIBRATION_MIN) return null;
  return Array.from({ length: N }, (_, i) => {
    const lo = i / N, hi = (i + 1) / N;
    const inB = done.filter((r) => r.probability! >= lo && (r.probability! < hi || (i === N - 1 && r.probability! <= 1)));
    const yes = inB.filter((r) => r.outcome === true).length;
    return { lo, hi, promised: (2 * i + 1) / (2 * N), actual: inB.length === 0 ? null : yes / inB.length, n: inB.length };
  });
}

export type RecordFilter = "all" | "right" | "wrong" | "open";

export function recordFor(reads: readonly Read[] | null, agentId: string, filter: RecordFilter): Read[] | null {
  if (reads === null) return null;
  const mine = reads.filter((r) => r.agentId === agentId);
  return filter === "all" ? mine : mine.filter((r) => r.status === filter);
}
```

- [ ] **Step 4: Correrlo y verlo pasar; contra el defecto**

Run: `npx jest __tests__/calibration.test.ts`
Expected: PASS, 4 tests. Contra el defecto: quita `|| (i === N - 1 && …)`, confirma que falla el test de fronteras (1.0 se pierde) y restaura.

- [ ] **Step 5: Commit**

```bash
npm test 2>&1 | tail -3 && npx tsc --noEmit && echo TSC_OK
git add apps/mobile/src/reads/calibration.ts apps/mobile/__tests__/calibration.test.ts
git commit -m "feat(mobile): calibración y récord del agente con tus reads (puros)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Perfil de agente (D15, D16, D23)

**Files:**
- Create: `apps/mobile/src/screens/agent.tsx`
- Modify: `apps/mobile/src/screens/agents.tsx`, `apps/mobile/src/navigation/Navigator.tsx`, `apps/mobile/src/store.ts` (`headerFor`), `apps/mobile/src/ui/Page.tsx` (título del perfil), `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `calibration`, `recordFor`, `type RecordFilter`, `CALIBRATION_MIN` (Task 5); `PageScroll`, `FooterBar` (Task 2); `agentBlurb`, `hitRate` (`reads/agentsCopy.ts`); `askMarketId` (`store.ts`).
- Produces: `AgentScreen(ctx: AppCtx)`; `headerFor(screen, perpsSymbol?, agent?: { name: string; owner: string })`.

- [ ] **Step 1: Test de `headerFor` para el perfil (falla)**

En `__tests__/store.test.ts`, agrega:
```ts
test("agent header: the agent's name and owner once agents-list is loaded (D16)", () => {
  expect(headerFor("agent", undefined, { name: "Drift", owner: "pickler" })).toEqual(["Drift", "By pickler"]);
  expect(headerFor("agent")).toEqual(["Agent", ""]);
});
```
Run: `npx jest __tests__/store.test.ts`. Expected: FAIL (hoy devuelve `["Agent", ""]` siempre).

- [ ] **Step 2: `headerFor` y `Page`**

En `store.ts`: `export function headerFor(screen: Screen, perpsSymbol?: string, agent?: { name: string; owner: string }): [string, string]` y `case "agent": return agent ? [agent.name, `By ${agent.owner}`] : ["Agent", ""];`.

En `Page.tsx`: `const agent = screen === "agent" ? reads.agents?.find((a) => a.id === S.agentId) : undefined;` y `headerFor(screen, perpsSymbol, agent)`. La cabecera ya pone el subtítulo en mayúsculas («BY PICKLER»).

Run: `npx jest __tests__/store.test.ts`. Expected: PASS.

- [ ] **Step 3: Pantalla `agent.tsx`**

`AgentScreen({ S, reads, perpl, nav, requireAccount }: AppCtx)`. Busca el agente con `reads.agents?.find((a) => a.id === S.agentId)`.

Estados sin agente:
- `reads.agents === null` y sin error: `Skeleton.Card` × 3.
- Con `agentsError`: `Warn` con «Retry» (`reads.refresh()`).
- No está en la lista: `Warn title="This agent isn't listed anymore"`.

Con agente, `<><PageScroll screen="agent"><Page gap={12}>…</Page></PageScroll><FooterBar>…</FooterBar></>`, con este contenido:

1. **Stats**: 2 baldosas `flex: 1` con `gap: 8`, padding 16, radio 18 y fondo `C.card`. El valor va en mono 700 26, ls −0.05; la etiqueta, en mono 500 9.5 ls 0.06 `C.dim`, con `marginTop: 8`.
   - `hitRate(a.record)` con «HIT · {resolved} RESOLVED».
   - `brierAvg?.toFixed(2) ?? "—"` con «BRIER · {reads} READS».
   - Sin NET AUSD (D15).
2. **ITS BEAT**: `Card` con padding 18, `Tag` «ITS BEAT» y `agentBlurb(a.id)` en 400 16/1.4. Sin chips de reglas.
3. **CALIBRATION**: `InkBlock` con `Tag color={C.onInkDim}` «CALIBRATION» y un texto en 400 14.5/1.4 `C.onInkSoft`: «Bars are what happened with your reads. The dashed line is what it promised.».
   - Con `calibration(mine)` distinto de `null`: un área de 150 de alto.
     - Diagonal: un `Svg` absoluto de 118 de alto con `viewBox="0 0 100 100"` y `preserveAspectRatio="none"`, y un `Line` de (0,88) a (100,8) con `stroke="#6E7490"`, `strokeWidth={1.5}`, `strokeDasharray="5 5"` y `vectorEffect="non-scaling-stroke"`.
     - Barras: 5 columnas `flex: 1` con `gap: 7`, alineadas abajo. Cada barra mide `max(2, actual × 108)` de alto (0 si `actual` es `null`), con radio `6/6/0/0`. Las dos primeras (0–40) van en `C.vio` y las demás en `C.lime`.
     - Etiquetas «0–20», «20–40»… en mono 500 9, `C.onInkDim`, con `gap: 9`.
     - `accessibilityLabel={`calib-${i}`}` en cada barra.
   - Con `null`: «Not enough resolved reads yet — {CALIBRATION_MIN} needed.» en 400 13 `C.onInkDim`.
4. **THE RECORD**:
   - Título «THE RECORD» en display 700 22, ls −0.04, y a la derecha un filtro de pills ALL / RIGHT / WRONG / OPEN (estado local `RecordFilter`).
     - Contenedor con fondo `C.ctl`, padding 4 y `gap: 3`.
     - Pill: padding `8/13`, radio 999, mono 500 11, ls 0.04. Activa `C.ink`/`C.onInk`; inactiva transparente/`C.dim`.
     - `accessibilityLabel={`record-${f}`}`.
     - Ruling: el Handoff dice ALL/WON/LOST; manda la spec D16.
   - `reads.session !== "ready"`: `Warn` «Unlock to see your record» con «Unlock with Face ID» (`reads.ensureSession()`), igual que Portfolio → Reads (Review Focus 5).
   - `recordFor(...) === null`: skeletons.
   - Lista vacía: `EmptyPanel` «No reads with this agent yet.».
   - Fila (`TouchCard` con padding `15/16`, radio 16, `gap: 12` y `accessibilityLabel={`record-row-${r.id}`}`):
     - un cuadrado de 11 × 11, radio 4: `C.lime` si right, `C.short` si wrong, `C.pending` si open y `C.empty` en los demás estados;
     - `{symbol} {cellLabel(r)}` en 600 15.5;
     - la meta `{formatProbability(p)} · {creditsCharged} CREDIT` en mono 500 10.5 `C.dim`;
     - a la derecha, la etiqueta del estado en mono 700 13: RIGHT en `C.up`, WRONG en `C.down`, OPEN en `C.warn` y el resto en `C.faint`.
     - Al tocarla, `nav("read", { readId: r.id })`, que cambia a Portfolio (D14).
5. **Barra fija**: `Btn` `variant="ask"` `icon="ask"` con `Ask · {priceCredits} credit{s}` y `onPress={() => requireAccount("market", { askAgentId: a.id, marketTab: "ask", perpsMarketId: askMarketId(S.perpsMarketId, perpl.context?.markets ?? []) })}` y `accessibilityLabel="profile-ask"`.

`mine` = `recordFor(reads.reads, a.id, "all") ?? []` para la calibración.

- [ ] **Step 4: Cablear**

- `Navigator.tsx`: `const AgentProfile = withPage("agent", AgentScreen, { bare: true });`. Borra el stub y su comentario.
- `agents.tsx`: la tarjeta abre el perfil. `onPress={() => requireAccount("agent", { agentId: a.id })}`, con el gate de D23 (Agents es pública; el perfil pide cuenta). El botón «Ask» sigue con `ask(a)`. Actualiza el JSDoc: «La tarjeta abre el perfil; "Ask" abre Market en Ask con el agente (D13)».
- `README.md` de la app no se toca aquí (Task 8).

- [ ] **Step 5: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK
npm test 2>&1 | tail -3
git add apps/mobile/src/screens/agent.tsx apps/mobile/src/screens/agents.tsx apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/store.ts apps/mobile/src/ui/Page.tsx apps/mobile/__tests__/store.test.ts
git commit -m "feat(mobile): perfil de agente con calibración y récord de tus reads

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Onboarding de 3 hojas tras crear la wallet (D21)

**Files:**
- Create: `apps/mobile/src/onboarding.ts`, `apps/mobile/src/storage/onboarding.ts`, `apps/mobile/src/screens/onboarding.tsx`
- Modify: `apps/mobile/src/navigation/screens.ts`, `routes.ts`, `ref.ts`, `Navigator.tsx`, `apps/mobile/src/store.ts`, `apps/mobile/src/screens/signin.tsx`, `apps/mobile/__tests__/routes.test.ts`, `apps/mobile/__tests__/store.test.ts`
- Test: `apps/mobile/__tests__/onboarding.test.ts`

**Interfaces:**
- Produces:
  - `ONBOARDING_SHEETS: readonly { eyebrow: string; title: string; body: string; art: "reads" | "board" | "ways" }[]` (3).
  - `shouldOnboard(mode: "in" | "up", seen: boolean): boolean`.
  - `onboardingExit(next: Screen | undefined): Screen`: `next ?? "markets"`.
  - `loadOnboarded(): Promise<boolean>` y `saveOnboarded(): Promise<void>` en `storage/onboarding.ts`.
  - `Screen` suma `"onboarding"`; `RootParamList.onboarding: SigninParams`.
  - `AppStore.finishSignin(fallback?: Screen)` y `AppStore.startOnboarding()`.

- [ ] **Step 1: Test que falla**

Crea `apps/mobile/__tests__/onboarding.test.ts`:
```ts
import { ONBOARDING_SHEETS, onboardingExit, shouldOnboard } from "../src/onboarding";

test("only after creating a wallet, and only once (D21, Review Focus 3)", () => {
  expect(shouldOnboard("up", false)).toBe(true);
  expect(shouldOnboard("up", true)).toBe(false);
  expect(shouldOnboard("in", false)).toBe(false);
});

test("closing lands on the held action, else Markets (D21, Review Focus 3)", () => {
  expect(onboardingExit("portfolio")).toBe("portfolio");
  expect(onboardingExit(undefined)).toBe("markets");
});

test("3 sheets, copy for what the app does: no sports, no Back it (D21)", () => {
  expect(ONBOARDING_SHEETS.map((s) => s.title)).toEqual(["AGENTS READ THE MARKET.", "PICK A SQUARE.", "ASK, OR TRADE."]);
  const all = ONBOARDING_SHEETS.map((s) => `${s.title} ${s.body}`).join(" ");
  expect(all).not.toMatch(/back it|lakers|celtics|chiefs|memecoin|token/i);
});
```
En `__tests__/routes.test.ts`, el primer test filtra `s !== "signin"`. Cámbialo a `s !== "signin" && s !== "onboarding"`, y el cast a `Exclude<Screen, "signin" | "onboarding">`. Agrega:
```ts
test("onboarding lives in the RootStack, outside the tabs (D21)", () => {
  expect(SCREENS_ALL).toContain("onboarding");
  expect(screenOfRoute("onboarding")).toBe("onboarding");
  expect(GATED).not.toContain("onboarding");
});
```
Run: `npx jest __tests__/onboarding.test.ts __tests__/routes.test.ts`. Expected: FAIL (módulo inexistente y `onboarding` fuera de `SCREENS_ALL`).

- [ ] **Step 2: Lógica y copy**

Crea `apps/mobile/src/onboarding.ts`:
```ts
// Onboarding (spec mobile-light D21): 3 hojas sólo tras crear la wallet, una vez por dispositivo. Puro.
import type { Screen } from "./navigation/screens";

export type OnboardingSheet = { eyebrow: string; title: string; body: string; art: "reads" | "board" | "ways" };

export const ONBOARDING_SHEETS: readonly OnboardingSheet[] = [
  { eyebrow: "01 · WHAT THIS IS", title: "AGENTS READ THE MARKET.", body: "Ask an agent about a price and a time. It answers with a probability, and every read resolves on Perpl's mark.", art: "reads" },
  { eyebrow: "02 · THE BOARD", title: "PICK A SQUARE.", body: "Row is the level, column is the time. Above the mark is a long, below is a short.", art: "board" },
  { eyebrow: "03 · TWO WAYS IN", title: "ASK, OR TRADE.", body: "Violet asks an agent for a read, for one simulated credit. Lime opens a trade on Perpl with your own margin.", art: "ways" },
];

export const shouldOnboard = (mode: "in" | "up", seen: boolean): boolean => mode === "up" && !seen;

export const onboardingExit = (next: Screen | undefined): Screen => next ?? "markets";
```
Crea `apps/mobile/src/storage/onboarding.ts`:
```ts
import { getItemAsync, type SecureStoreOptions, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";

const KEY = "pickler.onboarded.v1";
// No es secreto: sin gate biométrico, igual que la dirección de la cuenta.
const OPTIONS = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY } satisfies SecureStoreOptions;

/** Un fallo de lectura cuenta como «ya visto»: mejor no mostrar hojas que bloquear el alta. */
export async function loadOnboarded(): Promise<boolean> {
  try { return (await getItemAsync(KEY, OPTIONS)) === "1"; } catch { return true; }
}

export async function saveOnboarded(): Promise<void> {
  try { await setItemAsync(KEY, "1", OPTIONS); } catch { /* sin flag, a lo sumo se repiten las hojas en el próximo alta */ }
}
```

- [ ] **Step 3: Rutas**

- `screens.ts`: `Screen` suma `| "onboarding"`. `ROOT_OF` suma `onboarding: "wallet"`, como `signin`. No entra en `GATED`, `CAN_BACK` ni `SHOW_TABS`.
- `routes.ts`:
  - `RootParamList` = `{ Tabs: …; signin: SigninParams; onboarding: SigninParams }`.
  - `TAB_OF: Record<Exclude<Screen, "signin" | "onboarding">, TabName>`.
  - `SCREENS_ALL` suma `"onboarding"`.
- `ref.ts`, en `navigateTo`: `if (screen === "signin" || screen === "onboarding") { navigationRef.navigate(screen, signinParams); return; }`.
- `store.ts`:
  - `headerFor` suma `case "onboarding": return ["Pickler", ""];`.
  - `finishSignin` pasa a `(fallback?: Screen) => { const p = currentParams(); if (signinIsRoot()) resetRootTo("Tabs"); nav(p?.next ?? fallback ?? "wallet", p?.patch); }`.
  - Nuevo `startOnboarding: () => navigateTo("onboarding", currentParams())`, en `AppStore` y en el `return`.
  - `currentParams()` lee la ruta enfocada. Desde `signin` son sus params; desde `onboarding`, los mismos, porque se copian.
- `Navigator.tsx`: `<Root.Screen name="onboarding" component={OnboardingScreen} options={{ gestureEnabled: false, animation: "fade" }} />`. No usa `withPage`: es a pantalla completa.

Run: `npx jest __tests__/onboarding.test.ts __tests__/routes.test.ts __tests__/store.test.ts`. Expected: PASS.

- [ ] **Step 4: Pantalla `onboarding.tsx`**

`OnboardingScreen()` usa `useAppCtx()` para `finishSignin`, `useRoute().params as SigninParams` para `next` y `useSafeAreaInsets()`. Tiene un estado `step` de 0 a 2.

- **Fondo**: réplica estática de Markets, sin datos, con `opacity: 0.55` y `padding` `insets.top + 8 / 18`. Lleva:
  - el logo `pickler-mark.png` de 24 junto a «MARKETS» en display 700 30;
  - un pill de 46 de alto en `C.ctl`;
  - 3 bloques de 150 de alto, radio 20, en `C.card`.

  Encima va un overlay absoluto `rgba(11,13,26,0.32)`. Ruling: el Handoff aplica `blur(2px)`; RN no difumina un `View` sin `expo-blur`, y D2 lo descarta.
- **SKIP**: absoluto con `right: 18` y `top: insets.top + 8`, padding `9/14`, radio 999, fondo `rgba(255,255,255,0.92)`, mono 500 11.5, ls 0.06, `C.dim`. Hace `setStep(2)` y lleva `accessibilityLabel="onboarding-skip"`. En la última hoja no se muestra.
- **Hoja**: absoluta abajo, con padding `22 / 20 / insets.bottom + 18`, radios superiores de 28, fondo `C.bg` y `gap: 18`.
  - Grabber de 38 × 4 en `C.empty`, centrado.
  - Arte de 150 de alto con radio 20; el fondo es `C.card` para `reads`, `C.limeBg` para `board` y `C.vioBg` para `ways`.
  - Eyebrow en mono 500 10, ls 0.12, `C.vio`.
  - Título en display 700 30/1, ls −0.045.
  - Cuerpo en 400 16/1.45, `C.dim`.
- **Artes**, construidos con `View` y datos de ejemplo marcados como tales, sin deportes:
  - `reads`: 3 filas blancas al 78 % de ancho, con radio 12 y padding `10/12`. Cada fila lleva un cuadrado de 10 × 10 y radio 3, el mercado en 600 12.5 y un valor en mono 700 11:
    - «BTC +1.0% · 4H»: cuadrado `C.lime`, valor «62%» en `C.up`.
    - «ETH −0.5% · 1H»: cuadrado `C.short`, valor «34%» en `C.down`.
    - «MON +2.5% · 24H»: cuadrado `C.pending`, valor «OPEN» en `C.warn`.
  - `board`: 3 columnas de 44 con `gap: 4`.
    - Fila de arriba: celdas blancas de 30 con radio 8; la del medio va en `C.lime` con «LONG» en mono 700 8.
    - Una banda de 12 en `C.ink`.
    - Fila de abajo: celdas blancas; la del medio con un punto de 7 × 7 en `C.agentDot`.
  - `ways`: 2 pills al 80 % de ancho con padding 14 y 600 14:
    - «Ask», en `C.vio` / `C.onInk`, con el icono `ask`.
    - «Trade», en `C.lime` / `C.ink`, con el icono `arrow`.
- **Pie**: puntos tocables de 5 de alto y radio 999, con `gap: 5`. El activo mide 22 de ancho y va en `C.ink`; el inactivo, 7 en `C.dotOff`. Llevan `accessibilityLabel={`onboarding-dot-${i}`}`. El CTA va con `marginLeft: "auto"`:
  - «Next» (`variant` oscuro de `Btn`) avanza.
  - En la última hoja, «Go to markets» (`variant="lime"`) cierra.

  Si hay `next`, la etiqueta es «Continue»: no se aterriza en Markets.
- **Cerrar**: `void saveOnboarded(); finishSignin(onboardingExit(next));`. `onboardingExit` ya resuelve el fallback; `finishSignin` usa `p?.next` si existe.
- Sin transición entre hojas (el Handoff tampoco la tiene), salvo el ancho de los puntos. Si se anima, que sea con `LayoutAnimation`: nada nuevo.

- [ ] **Step 5: Sign up → onboarding**

En `signin.tsx`, dentro de `run()`, tras `setPhase({ step: "done", … })`:
```ts
const onboard = shouldOnboard(mode, await loadOnboarded());
doneTimer.current = setTimeout(onboard ? startOnboarding : () => finishSignin(), DONE_MS);
```
`startOnboarding` sale del ctx. El `finishSignin` sin argumento conserva el `wallet` por defecto de hoy para Sign in.

- [ ] **Step 6: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK
npm test 2>&1 | tail -3
git add apps/mobile/src/onboarding.ts apps/mobile/src/storage/onboarding.ts apps/mobile/src/screens/onboarding.tsx apps/mobile/src/screens/signin.tsx apps/mobile/src/navigation/screens.ts apps/mobile/src/navigation/routes.ts apps/mobile/src/navigation/ref.ts apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/store.ts apps/mobile/__tests__/onboarding.test.ts apps/mobile/__tests__/routes.test.ts apps/mobile/__tests__/store.test.ts
git commit -m "feat(mobile): onboarding de 3 hojas tras crear la wallet

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Verificación en el simulador, README, overview y audit

**Files:**
- Modify: `apps/mobile/README.md`, `docs/overview/2026-09-28-mobile-light.html`, `docs/overview/data/manifest.js`
- Create: `docs/superpowers/audits/2026-09-28-mobile-light-f2-rulings.md`

- [ ] **Step 1: Arrancar**

Desde `apps/mobile`, con un puerto propio y sin prebuild (F2 no toca nada nativo):
```bash
npx expo start --dev-client --port 8082
```
Abre la app ya instalada en `pickler-mobile-light` (`xcrun simctl launch 700707EF-53E1-42F2-BE6B-893515BDB95C <bundle id>`) apuntando a ese Metro. Anota el PID de Metro para detenerlo al final.

Expected: Metro sin `ERROR`.

- [ ] **Step 2: Recorrido con capturas (scratchpad, `f2-*.png`)**

Compara cada captura contra el Handoff en `http://localhost:8765/`:

1. Market en **Ask**:
   - board 5 × 4 con la banda MARK, los precios en verde arriba y en rojo abajo, y la trayectoria **detrás** de las celdas, que crece con el polling (captura a los 0 y a los ~60 s);
   - el punto «now»;
   - los puntos violeta en las celdas con read (ETH +1.0 % · 4H de F1, si sigue en la ventana);
   - tocar una celda: tinte y pill ASK, rótulo «ASK ABOUT … WITHIN …» y el `AskSheet`.
2. Market en **Trade**: tocar +1.0 % · 4H.
   - Con key: el pill LONG, «LONG TO … WITHIN 4H», el `LevelCard` y la barra fija «Long to … within 4H» + «Review · X AUSD».
   - Sin key: el board y «Enable trading» debajo, sin barra.
   - Escribir el margen con el teclado abierto y cerrarlo: la barra refleja el monto (Review Focus 4).
3. Read: la barra fija «Trade this market» sobre el home indicator; el cuerpo hace scroll por debajo.
4. Agents → tarjeta → perfil:
   - cabecera con nombre y «BY …», stats, ITS BEAT, CALIBRATION (vacía con < 5 resueltas) y THE RECORD con el filtro;
   - una fila abre Read en Portfolio;
   - la barra «Ask · 1 credit» abre Market en Ask con ese agente.
   - Con la app recién abierta, sin sesión de reads: «Unlock to see your record» (Review Focus 5).
5. Onboarding: DevControls no lo cubre, así que hay dos caminos.
   - (a) Sign out → Sign up → Face ID → las 3 hojas, SKIP, los puntos y «Go to markets» → Markets. Esto **crea otra wallet** en el simulador. Anota su dirección en el audit; la wallet con fondos sigue recuperable con Sign in, porque su passkey vive en Apple Passwords del simulador.
   - (b) Si Jesús no quiere otra wallet: borra el flag con DevControls o con un `saveOnboarded` invertido temporal, **sin commitear**, y navega a `onboarding` a mano. Anota el camino usado.
   - Después, Sign out → Sign in con la wallet con fondos: **no** salen hojas.
6. Con la wallet con fondos (si el recorrido de dinero previo a F2 ya la dejó con key): un long de 2 AUSD a 1× desde el board → «See it in Portfolio» → Close. Registra los saldos antes y después por RPC. Si la wallet no tiene key, queda como residual y **no** se intenta ningún atajo que mueva fondos.
7. Dynamic Type XXXL en Market, el perfil y el onboarding, relanzando la app antes de juzgar (audit F1).

- [ ] **Step 3: Tests y tipos finales**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: N (Task 0) + los nuevos: 8 de board, 4 de calibración, 3 de onboarding, 1 de routes y 1 de store (**+17**), todos en verde, y `TSC_OK`.

- [ ] **Step 4: README, overview, manifest y audit**

- README de la app: el número de tests y de suites; «Market: board nivel × tiempo»; el perfil y el onboarding.
- Overview:
  - phase-card F2 → `completed` (select y `data-status`), con las tasks marcadas con su commit y `<details class="followups">` con los residuales;
  - status board y progressbar al día;
  - en el manifest, `{ num: 2, status: 'completed' }` y el `status` global `completed` **sólo** si no queda ninguna fase abierta. El spike de velas va aparte y no es fase.
- Audit `2026-09-28-mobile-light-f2-rulings.md`, con el formato del de F1: qué quedó hecho y la evidencia, las capturas miradas contra el Handoff, los rulings (los de este plan más los de la ejecución), las correcciones, la evidencia cara y los residuales ordenados por peso.

Rulings que este plan ya tomó y que el audit debe repetir:
- 5 × 4 en lugar de 6 × 3;
- la leyenda «YOU ASKED AN AGENT HERE»;
- el pill ASK en modo Ask (el Handoff no diseña Ask sobre el board);
- sin `pk-slide`;
- el filtro ALL/RIGHT/WRONG/OPEN en lugar de ALL/WON/LOST;
- sin NET, reglas ni «Trade $HALF» en el perfil;
- el onboarding sin blur;
- «Continue» en lugar de «Go to markets» cuando hay acción retenida;
- la barra de Market sólo en edición y con key.

Desde la raíz del worktree:
```bash
npm run docs:check && npm run agents:check
```
Mira el overview renderizado a 390 px antes de afirmar nada.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/README.md docs/overview/2026-09-28-mobile-light.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-28-mobile-light-f2-rulings.md
git commit -m "docs(mobile-light): cierre de F2 con audit, overview y README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Detén tu Metro por PID. **Para**: el merge, el push y el TestFlight los decide Jesús.

---

## Fuera de este plan

- El **recorrido con dinero de F1** (residual 1): va **antes** de ejecutar F2, con MON de faucet para la wallet `0xd6da…Ed23` del simulador (decisión del 2026-09-28).
- **Spike de velas de Perpl**: aparte (spec §4). Si Perpl expone historial, la trayectoria del board y la sparkline de Markets se conectan después; `trajectory` ya recibe un arreglo de marks.
- Residuales de F1 que no entran: 4 (estilo del bloque THE QUESTION de Read), 5 (separador de miles), 6 y 9 (Dynamic Type), 7 (accesibilidad de los botones anidados), 8, 10–14.
