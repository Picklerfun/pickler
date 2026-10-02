# Ask — F2-matrix: la matriz de Ask como el `Grid` del prototipo (sparkline, escalera, celdas con punto, hoja violeta con steppers) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la pestaña **Ask** de `Market` se vea como el prototipo (`jjesusaf/pickler-mobile`, `ConsultTab` + `Grid`): una card con sparkline real a la izquierda, escalera de precios de 5 niveles, celdas de 44 px sin texto con un punto donde ya hay reads, fila y columna realzadas en violeta al tocar, horizontes abajo; y la hoja de la celda re-vestida en violeta con chip «Asking {agente} · 1 credit» + «Change», la pregunta, la línea `RESOLVES ON PERPL MARK · +1.0% FROM MARK`, dos steppers (nivel, horizonte), «Ask {agente} · 1 credit» + «Clear» y «Nothing charged yet.». Sin tocar hooks, contratos con el servidor ni Trade.

**Architecture:** Corrección de diseño sobre la rama `feat/mobile-ask-f2` (F2 ejecutada). Todo lo nuevo con reglas va a módulos puros con test: `src/reads/matrix.ts` gana steppers, distancia y puntos; `src/perpl/marks.ts` (nuevo) guarda los últimos 60 marks por mercado que `usePerpl.refreshContext` recibe cada 5 s y los normaliza a un `viewBox 0..100` (`sparkPoints`); `src/ui/theme.ts` gana los tokens del acento de la matriz (violeta en Ask, lima en Trade para F3). `src/ui/primitives.tsx` gana `Sparkline` (react-native-svg, ya instalado y enlazado) y `Stepper`. `src/screens/ask.tsx` reescribe `MatrixGrid` y `AskSheet` y añade la cabecera `HISTORY · MARK`, el hint y la card `MARK PRICE · PERPL ON MONAD`. `useReads.ask(cell, agentId)`, `ReadCard`, My reads, Agents y el servidor **no cambian**.

**Tech Stack:** Expo SDK 57, React Native 0.86, `react-native-svg 15.15.4` (ya en `package.json` y en el binario: `Shell.tsx` lo usa), jest-expo 57 (`__tests__/*.test.ts`), TypeScript (`npx tsc --noEmit`). Simulador iPhone 17 Pro `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`, Maestro (`taplabel.sh`), Playwright MCP para el prototipo.

**Spec:** `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` — **D14 describió mal la matriz** (grilla de pills con el target en cada celda): fue un error al escribir el spec, no de la ejecución de F2. Este plan la corrige contra el prototipo (`/tmp/pickler-mobile-src`: `src/screens/markets.js` `Grid` l. 28–60 y `ConsultTab` l. 72–120, `src/store.js` l. 46–70, `src/ui.js` `Sparkline` l. 183) y la marca **(F2-matrix)** en D14/D16 (Task 6). Leer antes: audit F2 `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` §2 (rulings), §5 (pendientes) y «Revisión final de rama»; plan F2 `docs/superpowers/plans/2026-09-19-mobile-ask-f2.md` P8–P12, P14.

## Global Constraints

- Worktree `.claude/worktrees/mobile-ask-f2`, rama `feat/mobile-ask-f2` (HEAD `9fec62c`, 18 commits sobre `main` = `e0101d9`; `origin/main` = `5ed4e1c`). Árbol limpio al empezar. Todo lo de la app desde `apps/mobile` **dentro del worktree** (`npm install` ya hecho); los checks de docs desde la raíz del worktree. Nunca `git add -A`; archivos por nombre. **Commits autorizados por Jesús en esta sesión** («commits por nombre de archivo con el trailer del modelo que escribe»): cada task termina en commit `feat(mobile): …` / `docs(mobile-ask): …` con trailer `Co-Authored-By: <modelo que escribe el commit> <noreply@anthropic.com>` (Opus 5 (1M context), Sonnet 5 o Haiku 4.5, el que sea: atribución veraz, audit F2 ruling 3) y `Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi`. **Sin push, sin merge, sin TestFlight.**
- `apps/mobile` es **npm** (no pnpm). **Ninguna dependencia nueva ni cambio nativo**: `react-native-svg` ya está instalado y enlazado (lo importa `Shell.tsx`), así que no hay `prebuild` ni `run:ios` si la app sigue instalada en el simulador (hoy lo está, y Metro vive en `:8081` con cwd `…/mobile-ask-f2/apps/mobile`).
- **Alcance cerrado**: `MatrixGrid`, `AskSheet`, cabecera/hint/card de mark en `ask.tsx`; `Sparkline` y `Stepper` en `primitives.tsx`; tokens en `theme.ts`; helpers puros en `matrix.ts`; buffer de marks en `perpl/marks.ts` + `usePerpl`. **No** se toca `useReads`, `reads/api.ts`, `reads/types.ts`, `ReadCard`, `ReadRow`, My reads, `agents.tsx`, `market.tsx` (Trade), el store ni el servidor. **Sin «Trade this level», sin `LevelCard`** (F3, P9 del plan F2).
- **Niveles: los 5 del spec/servidor** (`LEVELS_BPS = [250, 100, 50, −50, −100]`, D2), no los 7 del prototipo; `targetFor` sigue siendo la fuente del precio de cada fila y del stepper. Horizontes `[60, 240, 720, 1440]` → `1H 4H 12H 24H`.
- Acento violeta en Ask (`C.vio`, `accOn = rgba(155,123,255,0.45)`, `accSoft = rgba(155,123,255,0.09)`); lima queda declarado para Trade (F3) sin usarse aquí.
- Simulador **siempre por UDID `2B2A0BAD-7B14-4DAE-8652-C7E9472505E0`**, nunca `booted` (hay dos arrancados). Capturas con `xcrun simctl io <UDID> screenshot …` y **mirar cada captura** antes de afirmar nada. **Cuenta #620 del simulador: no mover AUSD ni MON**; ninguna orden, depósito, retiro ni «Reconnect trading». Una sola read real se pide en Task 5 (créditos 19 → 18); no se fuerza nada por SQL.
- Backend F1 sin cambios: nunca `supabase db push/reset`, nunca Drizzle, nunca DDL fuera de `mobile`, nunca el MCP de Supabase de la sesión (apunta a Proflores). Sólo consultas `--read-only` con `node scripts/query.mjs` desde `services/reads` del worktree.
- `npm test` (hoy 30 suites / 230 tests) y `npx tsc --noEmit` en verde al cierre de cada task. Ninguna prueba de UI (P12 del plan F2): primitivas y pantalla se verifican con `tsc` y en el simulador (Task 5). Copy en inglés; código y comentarios en español donde el archivo vecino los tenga; tests en inglés.
- Docs: contrato de `docs/CLAUDE.md`; spec/plan Markdown → `npm run docs:html`; el dev tracker se crea con la skill `pickler-dev-new` (leer `.claude/skills/pickler-dev-new/SKILL.md` y seguirla); `docs:check` `errors=0`, `agents:check` `"errors": []`.

## Decisiones del plan (no están en el spec)

| # | Decisión | Por qué |
|---|---|---|
| P1 | **El buffer de marks vive en `usePerpl`** (`Perpl.marks: MarkHistory`, `Record<marketId, number[]>`), alimentado en `refreshContext` con `appendMarks` (puro, `src/perpl/marks.ts`, tope `SPARK_POINTS = 60` = 5 min a 5 s). En memoria, sin persistir; se pierde al reiniciar la app y arranca plano. | `refreshContext` es el único punto por donde entra un mark (poll de 5 s mientras `screen ∈ {markets, market, perpsFunds}` y pull-to-refresh); es dato de Perpl, no de reads. `usePerpl` ya se monta en `App.tsx`; `AppCtx.perpl` lo expone a `ask.tsx` sin tocar `ctx.ts`. |
| P2 | **Sparkline con datos reales, corrección al spec**: el prototipo dibuja `SPARK_MARKET` (fake). `pub/context` no da historial, así que la app sólo tiene los marks que ha visto. Con < 2 puntos, línea plana a media altura (`[[0,50],[100,50]]`); con todos los marks iguales, plana también. | No inventar datos: una sparkline que empieza vacía y se llena en 10 s es honesta; un histórico fake no. Se declara en D14 **(F2-matrix)**. |
| P3 | **Tokens de la matriz en `theme.ts`**: `GRID_ACCENT = { ask: { fg: C.vio, on, soft }, trade: { fg: C.lime, on, soft } }`, `GRID_DOT = rgba(245,246,255,0.35)`, `GRID_MARK_RULE = rgba(200,240,58,0.35)` (lima en ambas pestañas, como `store.js` l. 55). `theme.test.ts` los fija. | F3 (Trade) usa el mismo `Grid` en lima sin volver a tocar `theme.ts`; los valores son los literales del prototipo. |
| P4 | **La regla del mark** es el borde inferior de la fila del último nivel positivo (`+0.5 %`, entre `+50` y `−50`): `bps > 0 && LEVELS_BPS[i + 1] < 0`. | En el prototipo es `pct === 0.5` (7 niveles); con los 5 del spec la aritmética es la misma y no depende del literal `50`. |
| P5 | **Los puntos** se calculan con `readDots(reads.reads)` (puro): claves `${levelBps}\|${horizonMin}` de las reads `open`, `right` o `wrong` del mercado activo; `pending`, `void` y `failed` no pintan. Un punto por celda aunque haya varias reads. | `reads.reads` ya es la lista por mercado (máx. 50, poll de 15 s); el prototipo pinta un punto plano sin conteo (`GRID_DOTS[...]` truthy). |
| P6 | **Steppers** (`stepLevel`, `stepHorizon`, puros): «+» sube el nivel (hacia `+2.5 %`) o alarga el horizonte; «−» al revés; tope en los extremos (no envuelven). El valor del stepper de nivel es el **target formateado** (`formatPrice(targetFor(mark, bps), pd)`, como `selLevel = priceAt(pct)` del prototipo); el de horizonte, `horizonLabel`. Ancho 118 px el de horizonte, `flex 1` el de nivel. Un nivel fuera de la matriz (imposible hoy) cae al primero. | Literal del prototipo (`lvlUp/lvlDown/horPrev/horNext`, `store.js` l. 137–140) con la lista de 5. |
| P7 | **«Change»** conmuta (`useState` local en `AskSheet`) la fila de chips de agente **inline** bajo el chip «Asking …»; tocar un chip elige el agente (`onAgent`) y colapsa la fila; mientras está abierta el toque dice «Done». Chip seleccionado en violeta (`fg C.vio`, `bd C.vioBd`, `bg C.vioBg`), el resto `C.dim`/`C.hair18`. La regla de D14 (**el agente mostrado es el que se cobra**: `find(id) ?? agents[0]` y `onAsk(agent.id)`) no cambia. | El prototipo navega a una pantalla `agents` para elegir; aquí no hay ruta nueva y los chips ya existen (Task 8 de F2). Ocultarlos de fábrica es lo que hace que la hoja se vea como el prototipo. |
| P8 | **Botón «Ask {agente} · {n} credit»** con la variante **por defecto (`outline`) + `arrow` + `flex 1` + `py 12`**, no `lime`: es literalmente `<Btn label={M.sheetCta} arrow flex={1} py={12} />` del prototipo. «Clear» = `variant="ghost"`, hace `set({ askCell: undefined })`. Sin créditos: label «No credits left», deshabilitado, y la línea de abajo cambia de «Nothing charged yet.» a «Credits are simulated for the testnet.». | Copiar el prototipo; conservar el estado sin créditos de D14. |
| P9 | **`CreditsRow` se conserva** encima de la cabecera `HISTORY · MARK`. Orden final de **New read**: `CreditsRow` → cabecera → `MatrixGrid` → hint → `AskSheet` (si hay celda) → card `MARK PRICE · PERPL ON MONAD` → `Warn` de `listError`. La card de mark **no** trae la fila `FUNDING / NEXT / OI` (no hay datos: no inventar). | D14 pide la fila de créditos y Task 5 la usa como evidencia (19 → 18); el prototipo no la tiene porque su balance vive en otro sitio. |
| P10 | **Hint** bajo la matriz: «Tap a cell: a level and a horizon.» sin celda; «Use the steppers to move it.» con celda (no «Drag…»: no hay drag). | No prometer un gesto que no existe. |
| P11 | **`accessibilityLabel`s** para Maestro: celdas `cell-<bps>-<min>` (sin cambio), `ask`, `agent-<id>` (sin cambio), nuevos `ask-change`, `ask-clear`, `step-level-down/up`, `step-horizon-down/up`. | Task 5 toca por label con `taplabel.sh`; los de F2 siguen valiendo para los flujos existentes. |
| P12 | **Evidencia visual versionada**: las dos capturas de la comparación (app y prototipo, ambas con la hoja abierta) se copian a `docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-{app,proto}.png` y se referencian con `![…](img/…)` desde el addendum del audit (los audits son Markdown sin conversión HTML) y desde el dev tracker (`<img>`). El resto de capturas queda en el workspace SDD (git-ignored) y se lista con lo que muestra cada una. | Jesús pidió «pegar ambas capturas en el audit»; un path a `.superpowers/` no sobrevive a un clone. Dos PNG de ~300 KB son asumibles. |

## Mapa de archivos

| Archivo | Task | Responsabilidad |
|---|---|---|
| `apps/mobile/src/ui/theme.ts`, `__tests__/theme.test.ts` | 1 | `GRID_ACCENT`, `GRID_DOT`, `GRID_MARK_RULE` (P3) |
| `apps/mobile/src/reads/matrix.ts`, `__tests__/reads-matrix.test.ts` | 1 | `stepLevel`, `stepHorizon`, `distanceLabel`, `dotKey`, `readDots` (P5, P6) |
| `apps/mobile/src/perpl/marks.ts`, `__tests__/perpl-marks.test.ts`, `src/hooks/usePerpl.ts` | 2 | Buffer de marks por mercado y `sparkPoints` (P1, P2); `Perpl.marks` |
| `apps/mobile/src/ui/primitives.tsx` | 3 | `Sparkline` (react-native-svg) y `Stepper` |
| `apps/mobile/src/screens/ask.tsx` | 4 | `MatrixGrid` = `Grid` del prototipo, `AskSheet` violeta con steppers, cabecera, hint, card de mark (P4–P11) |
| Simulador + Playwright (sin archivos del repo) | 5 | Recorrido con capturas, read real desde la hoja nueva, comparación con el prototipo |
| `docs/superpowers/specs/2026-09-19-mobile-ask-design.md`, `docs/overview/dev/2026-09-20-mobile-ask-matrix.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`, `docs/superpowers/audits/img/…`, `apps/mobile/README.md` | 6 | Corrección D14/D16 **(F2-matrix)**, dev tracker, addendum al audit, revisión independiente, checks |

---

### Task 1: Tokens de la matriz en `theme.ts` y helpers puros en `matrix.ts`

**Files:**
- Modify: `apps/mobile/src/ui/theme.ts` (al final, tras `pill`)
- Modify: `apps/mobile/src/reads/matrix.ts` (al final)
- Test: `apps/mobile/__tests__/theme.test.ts`, `apps/mobile/__tests__/reads-matrix.test.ts`

**Interfaces:**
- Produces (theme): `GridAccent = { fg: string; on: string; soft: string }`, `GRID_ACCENT: Record<"ask" | "trade", GridAccent>`, `GRID_DOT: string`, `GRID_MARK_RULE: string`.
- Produces (matrix): `stepLevel(levelBps: number, dir: 1 | -1): LevelBps`, `stepHorizon(horizonMin: number, dir: 1 | -1): HorizonMin`, `distanceLabel(levelBps: number): string`, `dotKey(c: { levelBps: number; horizonMin: number }): string`, `readDots(reads: readonly { levelBps: number; horizonMin: number; status: string }[]): Set<string>`. Los usa Task 4.

- [ ] **Step 1: Línea base**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/apps/mobile
git status --short && git log --oneline -1
npm test 2>&1 | tail -4
npx tsc --noEmit && echo TSC-OK
```
Expected: árbol limpio, HEAD `9fec62c`; `Tests: 230 passed, 230 total` / `Test Suites: 30 passed`; `TSC-OK`. Si el conteo difiere, anotarlo en el reporte (no parar).

- [ ] **Step 2: Tests de tokens (RED)** — añadir al final de `__tests__/theme.test.ts`:

```ts
import { GRID_ACCENT, GRID_DOT, GRID_MARK_RULE } from "../src/ui/theme";

test("the matrix accent is the prototype's accFg/accOn/accSoft: violet in Ask, lime in Trade", () => {
  expect(GRID_ACCENT.ask).toEqual({ fg: C.vio, on: "rgba(155,123,255,0.45)", soft: "rgba(155,123,255,0.09)" });
  expect(GRID_ACCENT.trade).toEqual({ fg: C.lime, on: "rgba(200,240,58,0.45)", soft: "rgba(200,240,58,0.09)" });
  expect(GRID_DOT).toBe("rgba(245,246,255,0.35)");
  expect(GRID_MARK_RULE).toBe("rgba(200,240,58,0.35)");
});
```
(Fusionar el `import` con el existente `import { C, fam, pill, textStyle } from "../src/ui/theme";` — un solo import.)

- [ ] **Step 3: Tests de helpers (RED)** — añadir al final de `__tests__/reads-matrix.test.ts` (y añadir `distanceLabel, dotKey, readDots, stepHorizon, stepLevel` al import existente):

```ts
test("steppers walk the matrix in spec order and stop at the edges (P6)", () => {
  expect(stepLevel(50, 1)).toBe(100);
  expect(stepLevel(50, -1)).toBe(-50);
  expect(stepLevel(250, 1)).toBe(250);
  expect(stepLevel(-100, -1)).toBe(-100);
  expect(stepLevel(75, 1)).toBe(250); // fuera de la matriz: cae al primero
  expect(stepHorizon(240, 1)).toBe(720);
  expect(stepHorizon(240, -1)).toBe(60);
  expect(stepHorizon(60, -1)).toBe(60);
  expect(stepHorizon(1440, 1)).toBe(1440);
  expect(stepHorizon(30, 1)).toBe(60);
});

test("distanceLabel is the sheet's mono line", () => {
  expect(distanceLabel(100)).toBe("+1.0% FROM MARK");
  expect(distanceLabel(-50)).toBe("−0.5% FROM MARK");
});

test("readDots marks only cells with open/right/wrong reads, once per cell (P5)", () => {
  const dots = readDots([
    { levelBps: 100, horizonMin: 240, status: "right" },
    { levelBps: 100, horizonMin: 240, status: "open" },
    { levelBps: -50, horizonMin: 60, status: "failed" },
    { levelBps: 250, horizonMin: 1440, status: "void" },
    { levelBps: 50, horizonMin: 720, status: "pending" },
  ]);
  expect([...dots]).toEqual(["100|240"]);
  expect(dots.has(dotKey({ levelBps: 100, horizonMin: 240 }))).toBe(true);
  expect(readDots([]).size).toBe(0);
});
```

- [ ] **Step 4: Correr en rojo**

```bash
npx jest __tests__/theme.test.ts __tests__/reads-matrix.test.ts 2>&1 | tail -15
```
Expected: FAIL — `GRID_ACCENT`/`stepLevel`… `is not a function` / `undefined`.

- [ ] **Step 5: Implementar** — al final de `src/ui/theme.ts`:

```ts
/** Acento de la matriz nivel × horizonte (el `Grid` del prototipo, store.js): violeta en Ask, lima en Trade (F3). */
export type GridAccent = { fg: string; on: string; soft: string };
export const GRID_ACCENT: Record<"ask" | "trade", GridAccent> = {
  ask: { fg: C.vio, on: "rgba(155,123,255,0.45)", soft: "rgba(155,123,255,0.09)" },
  trade: { fg: C.lime, on: "rgba(200,240,58,0.45)", soft: "rgba(200,240,58,0.09)" },
};
/** Punto de una celda con reads previas y regla de la fila del mark (lima en ambas pestañas, como el prototipo). */
export const GRID_DOT = "rgba(245,246,255,0.35)";
export const GRID_MARK_RULE = "rgba(200,240,58,0.35)";
```

Al final de `src/reads/matrix.ts`:

```ts
// Hoja de la matriz (F2-matrix): steppers, distancia y puntos de reads previas. Puro.

/** «+» sube un nivel (hacia +2.5 %), «−» baja; tope en los extremos. La lista va de +2.5 % a −1.0 %, por eso i − dir. */
export function stepLevel(levelBps: number, dir: 1 | -1): LevelBps {
  const i = (LEVELS_BPS as readonly number[]).indexOf(levelBps);
  if (i < 0) return LEVELS_BPS[0];
  return LEVELS_BPS[Math.min(LEVELS_BPS.length - 1, Math.max(0, i - dir))];
}

/** «+» alarga el horizonte, «−» lo acorta; tope en los extremos. */
export function stepHorizon(horizonMin: number, dir: 1 | -1): HorizonMin {
  const i = (HORIZONS_MIN as readonly number[]).indexOf(horizonMin);
  if (i < 0) return HORIZONS_MIN[0];
  return HORIZONS_MIN[Math.min(HORIZONS_MIN.length - 1, Math.max(0, i + dir))];
}

/** «+1.0% FROM MARK»: la línea mono de la hoja (selDistance del prototipo). */
export const distanceLabel = (levelBps: number): string => `${levelLabel(levelBps)} FROM MARK`;

export const dotKey = (c: { levelBps: number; horizonMin: number }): string => `${c.levelBps}|${c.horizonMin}`;

/** Celdas con reads que cuentan (open/right/wrong) para el punto de la matriz. */
export function readDots(reads: readonly { levelBps: number; horizonMin: number; status: string }[]): Set<string> {
  const out = new Set<string>();
  for (const r of reads) if (r.status === "open" || r.status === "right" || r.status === "wrong") out.add(dotKey(r));
  return out;
}
```

- [ ] **Step 6: Verde y commit**

```bash
npx jest __tests__/theme.test.ts __tests__/reads-matrix.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/ui/theme.ts src/reads/matrix.ts __tests__/theme.test.ts __tests__/reads-matrix.test.ts
git commit -m "feat(mobile): tokens del Grid (acento, punto, regla del mark) y steppers/puntos de la matriz de Ask" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi"
```
Expected: 30 suites / 234 tests (4 nuevos), `TSC-OK`.

---

### Task 2: Buffer de marks por mercado (`src/perpl/marks.ts`) y `Perpl.marks`

**Files:**
- Create: `apps/mobile/src/perpl/marks.ts`, `apps/mobile/__tests__/perpl-marks.test.ts`
- Modify: `apps/mobile/src/hooks/usePerpl.ts` (tipo `Perpl`, estado, `refreshContext`, `return`)

**Interfaces:**
- Produces: `SPARK_POINTS = 60`, `MarkHistory = Readonly<Record<number, readonly number[]>>`, `appendMarks(history: MarkHistory, markets: readonly { id: number; mark: number }[], max = SPARK_POINTS): MarkHistory`, `sparkPoints(marks: readonly number[]): [number, number][]`; `Perpl.marks: MarkHistory` (más antiguo → más reciente). Los usa Task 4 (`perpl.marks[market.id] ?? []`).

- [ ] **Step 1: Test (RED)** — `__tests__/perpl-marks.test.ts`:

```ts
import { appendMarks, type MarkHistory, SPARK_POINTS, sparkPoints } from "../src/perpl/marks";

test("appendMarks keeps the last SPARK_POINTS marks per market without mutating the input (P1)", () => {
  const h0: MarkHistory = {};
  const h1 = appendMarks(h0, [{ id: 16, mark: 100 }, { id: 3, mark: 5 }]);
  expect(h1).toEqual({ 16: [100], 3: [5] });
  expect(h0).toEqual({});
  const h2 = appendMarks(h1, [{ id: 16, mark: 101 }]);
  expect(h2).toEqual({ 16: [100, 101], 3: [5] });
  expect(h1[16]).toEqual([100]);
  let h: MarkHistory = {};
  for (let i = 0; i < SPARK_POINTS + 5; i++) h = appendMarks(h, [{ id: 1, mark: i }]);
  expect(h[1]).toHaveLength(SPARK_POINTS);
  expect(h[1][0]).toBe(5);
  expect(h[1][SPARK_POINTS - 1]).toBe(SPARK_POINTS + 4);
  expect(appendMarks({ 7: [1, 2] }, [{ id: 7, mark: 3 }], 2)[7]).toEqual([2, 3]);
});

test("sparkPoints normalizes to a 0..100 viewBox with y inverted; flat with < 2 or equal marks (P2)", () => {
  expect(sparkPoints([10, 20, 15, 30])).toEqual([[0, 100], [33.3, 50], [66.7, 75], [100, 0]]);
  expect(sparkPoints([7, 7, 7])).toEqual([[0, 50], [50, 50], [100, 50]]);
  expect(sparkPoints([])).toEqual([[0, 50], [100, 50]]);
  expect(sparkPoints([812345])).toEqual([[0, 50], [100, 50]]);
});
```

- [ ] **Step 2: Rojo**

```bash
npx jest __tests__/perpl-marks.test.ts 2>&1 | tail -8
```
Expected: FAIL — `Cannot find module '../src/perpl/marks'`.

- [ ] **Step 3: Implementar** — `src/perpl/marks.ts`:

```ts
// Historial de marks por mercado para la sparkline de la matriz (F2-matrix). Puro.
// Perpl pub/context no da historial: la app guarda los últimos SPARK_POINTS marks que recibe
// (uno por refreshContext, cada CONTEXT_POLL_MS mientras la pestaña está activa). En memoria, sin persistir.

export const SPARK_POINTS = 60;
export type MarkHistory = Readonly<Record<number, readonly number[]>>;

/** Añade el mark actual de cada mercado y recorta al máximo. No muta la entrada. */
export function appendMarks(history: MarkHistory, markets: readonly { id: number; mark: number }[], max = SPARK_POINTS): MarkHistory {
  const next: Record<number, readonly number[]> = { ...history };
  for (const m of markets) {
    const prev = next[m.id] ?? [];
    next[m.id] = prev.length >= max ? [...prev.slice(prev.length - max + 1), m.mark] : [...prev, m.mark];
  }
  return next;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Puntos de la polilínea en un viewBox 0..100: x por índice, y invertida (0 = máximo, 100 = mínimo). Con < 2 puntos o todos iguales, línea plana a media altura. */
export function sparkPoints(marks: readonly number[]): [number, number][] {
  if (marks.length < 2) return [[0, 50], [100, 50]];
  const min = Math.min(...marks);
  const max = Math.max(...marks);
  const span = max - min;
  const last = marks.length - 1;
  return marks.map((v, i) => [round1((i / last) * 100), span === 0 ? 50 : round1(100 - ((v - min) / span) * 100)]);
}
```

- [ ] **Step 4: `usePerpl.ts`** — cuatro ediciones:

1. Import: `import { appendMarks, type MarkHistory } from "../perpl/marks";`
2. En el tipo `Perpl`, después de `contextError: string;`:
```ts
  /** Últimos SPARK_POINTS marks por mercado que llegaron por pub/context (más antiguo → más reciente), para la sparkline (F2-matrix). */
  marks: MarkHistory;
```
3. Estado, junto a `const [contextError, setContextError] = useState("");`:
```ts
  const [marks, setMarks] = useState<MarkHistory>({});
```
4. En `refreshContext`, después de `setContext(ctx);`:
```ts
      setMarks((m) => appendMarks(m, ctx.markets));
```
5. En el `return` final, añadir `marks` después de `contextError`.

- [ ] **Step 5: Verde y commit**

```bash
npx jest __tests__/perpl-marks.test.ts 2>&1 | tail -6
npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
git add src/perpl/marks.ts __tests__/perpl-marks.test.ts src/hooks/usePerpl.ts
git commit -m "feat(mobile): buffer de marks por mercado en usePerpl y sparkPoints para la sparkline de Ask" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi"
```
Expected: 31 suites / 236 tests, `TSC-OK`. Si `tsc` se queja de que algo construye un `Perpl` sin `marks` (hoy nada lo hace: sólo `usePerpl` lo devuelve), añadir `marks: {}` ahí y anotarlo.

---

### Task 3: `Sparkline` y `Stepper` en `primitives.tsx`

**Files:**
- Modify: `apps/mobile/src/ui/primitives.tsx` (imports y dos componentes nuevos en la sección «Selectores», tras `PillTabs`)

**Interfaces:**
- Produces: `Sparkline({ points, stroke?, style? })` con `points: readonly (readonly [number, number])[]`; `Stepper({ value, onDown, onUp, width?, accessibilityLabel })` con labels `${accessibilityLabel}-down` / `-up`. Los usa Task 4.

- [ ] **Step 1: Import** — junto a los imports de RN al principio del archivo:

```ts
import Svg, { Polyline } from "react-native-svg";
```

- [ ] **Step 2: Componentes** — después de `PillTabs` (antes de `Bar`):

```tsx
/** Polilínea sobre un viewBox 0..100 con trazo que no escala (Sparkline del prototipo). `points` viene de `sparkPoints`. */
export function Sparkline({ points, stroke = C.spark, style }: { points: readonly (readonly [number, number])[]; stroke?: string; style?: StyleProp<ViewStyle> }) {
  const pts = points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <Svg viewBox="0 0 100 100" preserveAspectRatio="none" style={[{ width: "100%", height: "100%" }, style]}>
      <Polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </Svg>
  );
}

/** Par «−»/«+» con el valor mono en medio (hoja de la matriz). `width` fija el ancho; sin él, flex 1. */
export function Stepper({ value, onDown, onUp, width, accessibilityLabel }: { value: string; onDown: () => void; onUp: () => void; width?: number; accessibilityLabel: string }) {
  const btn: ViewStyle = { width: 26, height: 26, borderRadius: 8, borderWidth: 1, borderColor: "rgba(245,246,255,0.2)", alignItems: "center", justifyContent: "center" };
  return (
    <View style={{ flex: width ? 0 : 1, width, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: C.hair }}>
      <Touch onPress={onDown} style={btn} accessibilityLabel={`${accessibilityLabel}-down`}><T w={700} s={13} lh={1}>−</T></Touch>
      <T w={500} s={10} lh={1} mono color={C.dim}>{value}</T>
      <Touch onPress={onUp} style={btn} accessibilityLabel={`${accessibilityLabel}-up`}><T w={700} s={13} lh={1}>+</T></Touch>
    </View>
  );
}
```
(El «−» es U+2212, igual que en `levelLabel`.)

- [ ] **Step 3: Verificar y commit** (sin test de UI, P12 del plan F2)

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git add src/ui/primitives.tsx
git commit -m "feat(mobile): primitivas Sparkline (react-native-svg) y Stepper del prototipo" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi"
```
Expected: `TSC-OK`; tests sin cambio (31 / 236). Si `tsc` rechaza `vectorEffect` en `Polyline`, comprobar en `node_modules/react-native-svg/src/elements/Polyline.tsx`/`Shape` que el prop existe (en 15.x sí: `vectorEffect?: VectorEffect`) y anotar la firma real; no quitarlo sin mirar.

---

### Task 4: `ask.tsx` — `MatrixGrid` como el `Grid` del prototipo y `AskSheet` violeta con steppers

**Files:**
- Modify: `apps/mobile/src/screens/ask.tsx` (imports, `MatrixGrid`, `AskSheet`, rama `idle` de `newRead`)

**Interfaces:**
- Consumes: Task 1 (`GRID_ACCENT`, `GRID_DOT`, `GRID_MARK_RULE`, `stepLevel`, `stepHorizon`, `distanceLabel`, `dotKey`, `readDots`), Task 2 (`sparkPoints`, `perpl.marks`), Task 3 (`Sparkline`, `Stepper`). Sin cambios en `Reads`, `useReads.ask(cell, agentId)`, `ReadCard`, `ReadRow`, `SessionGate`, `CreditsRow`, `myReads`.

- [ ] **Step 1: Imports** — dejar el bloque de imports así (cambian las líneas de `matrix`, `primitives`, `theme` y se añade `marks`):

```ts
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import type { Reads } from "../hooks/useReads";
import type { Market } from "../perpl/context";
import { sparkPoints } from "../perpl/marks";
import { formatPrice } from "../perpl/orders";
import {
  callOf, type Cell, cellLabel, distanceLabel, dotKey, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, LEVELS_BPS,
  questionFor, readDots, stepHorizon, stepLevel, targetFor,
} from "../reads/matrix";
import type { Agent, Read, ReadStatus } from "../reads/types";
import type { AskCell } from "../store";
import { Btn, Card, Chip, Segmented, Sparkline, StatusCard, Stepper, T, Tag, type Tone, Touch, TouchCard, Warn } from "../ui/primitives";
import { C, GRID_ACCENT, GRID_DOT, GRID_MARK_RULE } from "../ui/theme";
```
(`levelLabel` y `pill` dejan de usarse en este archivo: quitarlos del import.)

- [ ] **Step 2: `MatrixGrid`** — sustituir la función completa por:

```tsx
/** El `Grid` del prototipo: sparkline a la izquierda, escalera de precios, celdas de 44 px con un punto donde ya hay reads, horizontes abajo. */
function MatrixGrid({ market, marks, dots, selected, onSelect }: { market: Market; marks: readonly number[]; dots: Set<string>; selected?: AskCell; onSelect: (c: Cell) => void }) {
  const acc = GRID_ACCENT.ask;
  const pd = market.priceDecimals;
  return (
    <View style={{ borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.card, overflow: "hidden" }}>
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: 74, borderRightWidth: 1, borderRightColor: C.hair10 }}>
          <Sparkline points={sparkPoints(marks)} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {LEVELS_BPS.map((bps, i) => {
            const rowOn = selected?.levelBps === bps;
            const markRule = bps > 0 && LEVELS_BPS[i + 1] < 0; // la regla bajo el último nivel positivo es el mark (P4)
            return (
              <View key={bps} style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: markRule ? GRID_MARK_RULE : C.hair08 }}>
                <View style={{ width: 58, justifyContent: "center", paddingLeft: 7, borderRightWidth: 1, borderRightColor: C.hair08 }}>
                  <T w={500} s={9.5} lh={1} mono color={rowOn ? acc.fg : C.faint}>{formatPrice(targetFor(market.mark, bps), pd)}</T>
                </View>
                {HORIZONS_MIN.map((h) => {
                  const colOn = selected?.horizonMin === h;
                  const on = rowOn && colOn;
                  return (
                    <Touch key={h} onPress={() => onSelect({ levelBps: bps, horizonMin: h })} accessibilityLabel={`cell-${bps}-${h}`}
                      style={{ flex: 1, minWidth: 0, height: 44, borderLeftWidth: 1, borderLeftColor: C.hair08, backgroundColor: on ? acc.on : rowOn || colOn ? acc.soft : "transparent", alignItems: "center", justifyContent: "center" }}>
                      <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: dots.has(dotKey({ levelBps: bps, horizonMin: h })) ? GRID_DOT : "transparent" }} />
                    </Touch>
                  );
                })}
              </View>
            );
          })}
          <View style={{ flexDirection: "row" }}>
            <View style={{ width: 58 }} />
            {HORIZONS_MIN.map((h) => (
              <View key={h} style={{ flex: 1, alignItems: "center", paddingVertical: 6 }}>
                <T w={500} s={9.5} lh={1} mono color={selected?.horizonMin === h ? acc.fg : C.faint}>{horizonLabel(h)}</T>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}
```
Nota: `LEVELS_BPS[i + 1]` en la última fila es `undefined` en runtime (`undefined < 0` → `false`); `tsconfig` es `strict` sin `noUncheckedIndexedAccess`, así que compila. Si `tsc` protestara, usar `(LEVELS_BPS[i + 1] ?? 0) < 0`.

- [ ] **Step 3: `AskSheet`** — sustituir la función completa por:

```tsx
/** La hoja de la celda del prototipo (ConsultTab): chip del agente + Change, pregunta, distancia, steppers, Ask/Clear. */
function AskSheet({ market, cell, reads, agentId, onAgent, onCell, onClear, onAsk }: {
  market: Market; cell: AskCell; reads: Reads; agentId: string | undefined;
  onAgent: (id: string) => void; onCell: (c: AskCell) => void; onClear: () => void; onAsk: (agentId: string) => void;
}) {
  const [picking, setPicking] = useState(false);
  const pd = market.priceDecimals;
  const target = targetFor(market.mark, cell.levelBps);
  const question = questionFor(market.symbol, cell.levelBps, target, pd, expiresAtFor(new Date(), cell.horizonMin));
  const agent = reads.agents?.find((a) => a.id === agentId) ?? reads.agents?.[0]; // el agente mostrado es el que se cobra (D14)
  const noCredits = reads.credits !== null && reads.credits <= 0;
  const price = `${agent?.priceCredits ?? 1} credit`;
  return (
    <Card bd={C.vioBd45} bg={C.vioBg07} gap={9}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Chip label={`Asking ${agent?.name ?? "…"} · ${price}`} fg={C.vio} bd={C.vioBd} bg={C.vioBg} s={10.5} py={5} px={9} />
        <Touch onPress={() => setPicking((p) => !p)} style={{ paddingVertical: 5, paddingHorizontal: 8 }} accessibilityLabel="ask-change">
          <T w={600} s={10.5} lh={1} color={C.faint}>{picking ? "Done" : "Change"}</T>
        </Touch>
      </View>
      {picking ? (reads.agents === null ? <T w={400} s={11.5} color={C.faint}>{reads.agentsError || "Loading agents…"}</T> : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {reads.agents.map((a) => {
            const on = a.id === agent?.id;
            return (
              <Chip key={a.id} label={`${a.name} · by ${a.owner} · ${a.priceCredits} credit`} onPress={() => { onAgent(a.id); setPicking(false); }}
                fg={on ? C.vio : C.dim} bd={on ? C.vioBd : C.hair18} bg={on ? C.vioBg : "transparent"} s={10.5} accessibilityLabel={`agent-${a.id}`} />
            );
          })}
        </View>
      )) : null}
      <Tag color={C.vio}>YOUR QUESTION · NOTHING SENT</Tag>
      <T w={700} s={14} lh={1.3} ls={-0.01}>{question}</T>
      <T w={500} s={10} lh={1.4} mono color={C.faint}>RESOLVES ON PERPL MARK · {distanceLabel(cell.levelBps)}</T>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Stepper value={formatPrice(target, pd)} accessibilityLabel="step-level"
          onDown={() => onCell({ levelBps: stepLevel(cell.levelBps, -1), horizonMin: cell.horizonMin })}
          onUp={() => onCell({ levelBps: stepLevel(cell.levelBps, 1), horizonMin: cell.horizonMin })} />
        <Stepper value={horizonLabel(cell.horizonMin)} width={118} accessibilityLabel="step-horizon"
          onDown={() => onCell({ levelBps: cell.levelBps, horizonMin: stepHorizon(cell.horizonMin, -1) })}
          onUp={() => onCell({ levelBps: cell.levelBps, horizonMin: stepHorizon(cell.horizonMin, 1) })} />
      </View>
      <View style={{ flexDirection: "row", gap: 7 }}>
        <Btn label={noCredits ? "No credits left" : `Ask ${agent?.name ?? "agent"} · ${price}`} onPress={() => { if (agent) onAsk(agent.id); }}
          arrow flex={1} py={12} disabled={noCredits || !agent} accessibilityLabel="ask" />
        <Btn label="Clear" onPress={onClear} variant="ghost" py={12} accessibilityLabel="ask-clear" />
      </View>
      <T w={400} s={10.5} lh={1.4} color={C.faint}>{noCredits ? "Credits are simulated for the testnet." : "Nothing charged yet."}</T>
    </Card>
  );
}
```

- [ ] **Step 4: Rama `idle` de `newRead`** — sustituir el `return (…)` final de `newRead` (el que hoy pinta `CreditsRow` + `MatrixGrid` + `AskSheet`/hint + `Warn`) por:

```tsx
    const dots = readDots(reads.reads);
    return (
      <View style={{ gap: 11 }}>
        <CreditsRow credits={reads.credits} />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
          <Tag s={10}>HISTORY · MARK</Tag>
          <T w={700} s={15} lh={1} mono>{formatPrice(market.mark, market.priceDecimals)}</T>
        </View>
        <MatrixGrid market={market} marks={perpl.marks[market.id] ?? []} dots={dots} selected={S.askCell} onSelect={(c) => set({ askCell: c })} />
        <T w={400} s={11.5} lh={1.45} color={C.faint}>{S.askCell ? "Use the steppers to move it." : "Tap a cell: a level and a horizon."}</T>
        {S.askCell ? (
          <AskSheet market={market} cell={S.askCell} reads={reads} agentId={S.askAgentId}
            onAgent={(id) => set({ askAgentId: id })} onCell={(c) => set({ askCell: c })} onClear={() => set({ askCell: undefined })}
            onAsk={(id) => { void reads.ask(S.askCell!, id); }} />
        ) : null}
        <Card gap={7}>
          <Tag>MARK PRICE · PERPL ON MONAD</Tag>
          <T w={400} s={11.5} lh={1.45} color={C.dim}>Reads resolve on mark, not on your fill.</T>
        </Card>
        {reads.listError ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
      </View>
    );
```
`perpl` ya sale del destructuring `const { S, set, perpl, reads, notifications } = ctx;` de `AskTab`. No se toca `pending`/`failed`/`done` ni `myReads`.

- [ ] **Step 5: Verificar y commit**

```bash
npx tsc --noEmit && echo TSC-OK && npm test 2>&1 | tail -4
git diff --stat
git add src/screens/ask.tsx
git commit -m "feat(mobile): matriz de Ask como el Grid del prototipo — sparkline, escalera, puntos de reads y hoja violeta con steppers" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi"
```
Expected: `TSC-OK`, 31 / 236; `git diff --stat` sólo `ask.tsx` antes del add. Metro recarga solo (fast refresh): si el simulador está en Ask, ya se ve la matriz nueva (la captura formal es Task 5).

---

### Task 5: Recorrido en el simulador con capturas, read real desde la hoja nueva y comparación con el prototipo

**Files:** ninguno del repo. Workspace: `SC=/Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/.superpowers/sdd/2026-09-19-mobile-ask-f2` (git-ignored; ahí viven `taplabel.sh`, `tap-point.yaml` y `flows/` de F2). Capturas en `$SC/matrix-shots/`.

**Interfaces:**
- Consumes: la app de Task 4 por Metro. Labels de P11. `taplabel.sh <label>` (toca por bounds reales; falla con `NOT_FOUND_OR_OFFSCREEN` si el elemento no está en pantalla: hacer scroll con `flows/scroll.yaml` / `scroll-up.yaml` y repetir).
- Produces: `$SC/matrix-shots/*.png` mirados uno a uno; `$SC/task-5-report.md` con la lista de capturas y qué muestra cada una; dos PNG copiados a `docs/superpowers/audits/img/` (P12); el `id` de la read pedida y los créditos antes/después.

- [ ] **Step 0: Estado del simulador y de Metro**

```bash
U=2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
SC=/Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/.superpowers/sdd/2026-09-19-mobile-ask-f2
mkdir -p "$SC/matrix-shots"
xcrun simctl list devices | grep "$U"                       # (Booted)
xcrun simctl listapps "$U" | grep -c fun.pickler.app         # ≥ 1 = instalada
PID=$(lsof -tiTCP:8081 -sTCP:LISTEN); echo "metro pid=$PID"; lsof -p "$PID" 2>/dev/null | grep cwd | awk '{print $NF}'
```
Expected: `Booted`, app instalada, Metro con cwd `…/.claude/worktrees/mobile-ask-f2/apps/mobile`. Tres casos:
- **Todo vivo** (caso esperado hoy): `xcrun simctl terminate "$U" fun.pickler.app; xcrun simctl launch "$U" fun.pickler.app` y seguir.
- **Metro muerto, app instalada**: `cd …/mobile-ask-f2/apps/mobile && nohup npx expo start --port 8081 > "$SC/metro.log" 2>&1 &`, esperar `Waiting on http://localhost:8081`, luego `simctl launch`. No hay cambio nativo: no hace falta `run:ios`.
- **App no instalada** (simulador borrado): `nohup npx expo run:ios --device "$U" > "$SC/run.log" 2>&1 &` y esperar `Installing on` / `Build Succeeded` en el log. `run:ios` borra la cuenta local: Sign in con el passkey «pickler» de Apple Passwords (`flows/usar-llave.yaml`; presentar cara con `xcrun simctl spawn "$U" notifyutil -p com.apple.BiometricKit_Sim.fingerTouch.match`), y antes re-inscribir Face ID (`notifyutil -s com.apple.BiometricKit.enrollmentChanged 1` + `notifyutil -p com.apple.BiometricKit.enrollmentChanged`).

- [ ] **Step 1: Llegar a Ask (BTC)** — Markets → fila BTC (`taplabel.sh market-BTC`; si la lista está `readOnly` sin key de Perpl, entrar por Dev controls como en 9b de F2, audit ruling 9) → pill `pill-ask`. Si aparece `SessionGate` (sesión de F2 caducada: se firmó a las 15:22 UTC del 2026-09-20 y dura 24 h), `taplabel.sh ask-unlock` + presentar cara. Captura `00-ask-first.png` y mirarla: `CreditsRow` (19), cabecera `HISTORY · MARK` con el mark, matriz con sparkline (plana si acaba de arrancar), escalera de 5 precios, **un punto en `+1.0% · 4H`** (la read `right` de F2 del simulador, `9f386c32…`), horizontes `1H 4H 12H 24H`, hint «Tap a cell: a level and a horizon.», card `MARK PRICE · PERPL ON MONAD`. **Verificar a mano** dos precios de la escalera: `+1.0 %` = `round(mark × 1.01)` y `−0.5 %` = `round(mark × 0.995)` con `priceDecimals` de BTC (1). Esperar ≥ 15 s (≥ 3 polls) y capturar `01-btc-spark.png`: la sparkline ya no es plana (si el mark no se movió en 15 s, esperar hasta 60 s y decirlo).

- [ ] **Step 2: Matriz sin puntos** — volver a Markets y abrir otro mercado sin reads del simulador (MON o ETH, el que tenga `readOnly` abierto; si sólo BTC es alcanzable por Dev controls, anotarlo y saltar): pill Ask → captura `02-other-empty.png`: ninguna celda con punto. Volver a BTC.

- [ ] **Step 3: Celda seleccionada** — `taplabel.sh cell-100-240` → captura `03-cell-selected.png` y mirar: fila `+1.0 %` y columna `4H` en `accSoft`, la celda en `accOn`, precio de la fila y `4H` en violeta, el punto sigue visible sobre el fondo violeta, hint «Use the steppers to move it.», hoja violeta debajo (`vioBd45`/`vioBg07`) con chip «Asking Jesús's agent · 1 credit» + «Change», `YOUR QUESTION · NOTHING SENT`, la pregunta, `RESOLVES ON PERPL MARK · +1.0% FROM MARK`, dos steppers (target formateado | `4H`), «Ask Jesús's agent · 1 credit →» y «Clear», «Nothing charged yet.». Si la hoja queda fuera de pantalla, `flows/scroll.yaml` y captura `03b-sheet.png`.

- [ ] **Step 4: Steppers y Change** — `taplabel.sh step-level-up` → la fila realzada pasa a `+2.5 %`, el stepper muestra el target de `+2.5 %`, la línea dice `+2.5% FROM MARK`; captura `04-step-level.png`. `taplabel.sh step-horizon-up` → columna `12H`, stepper `12H`; captura `05-step-horizon.png`. `taplabel.sh step-level-up` otra vez → sigue en `+2.5 %` (tope). Volver: `step-level-down` ×1 (`+1.0 %`), `step-horizon-down` ×1 (`4H`). `taplabel.sh ask-change` → chips de los tres agentes (el actual en violeta); captura `06-change.png`. `taplabel.sh agent-drift` → chips colapsan, chip «Asking Drift · 1 credit», botón «Ask Drift · 1 credit»; captura `07-drift.png`.

- [ ] **Step 5: Read real desde la hoja nueva** — antes, créditos por SQL:

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/services/reads
SIM_ADDR=0xe3719a93b75cee42c5a8f3dce45e5b4b327851c1
node scripts/query.mjs --read-only "select credits from mobile.wallets where address = '$SIM_ADDR'"
```
Expected: `19`. Luego `taplabel.sh ask` → `READING` con spinner (captura `08-reading.png` si da tiempo) → `ReadCard` de Drift en `+1.0% · 4H` (captura `09-readcard.png`). `taplabel.sh ask-another` → `CreditsRow` **18**, y ahora la celda `+1.0% · 4H` sigue con su punto (ya lo tenía; la read nueva es `open` en la misma celda); captura `10-credits-18.png`. Confirmar por SQL:

```bash
node scripts/query.mjs --read-only "select id, agent_id, status, level_bps, horizon_min, probability, expires_at from mobile.reads where address = '$SIM_ADDR' order by created_at desc limit 2"
node scripts/query.mjs --read-only "select credits from mobile.wallets where address = '$SIM_ADDR'"
```
Expected: la read nueva `open`, `agent_id drift`, `100 · 240`; créditos `18`. **No forzar su resolución**: vence sola en 4 h y el cron la resuelve. Anotar `id` y `expires_at`.

- [ ] **Step 6: Clear** — `taplabel.sh cell-250-60` → hoja abierta; `taplabel.sh ask-clear` → hoja cerrada, hint vuelve a «Tap a cell…», ninguna fila realzada; captura `11-clear.png`.

- [ ] **Step 7: Prototipo con Playwright** — cargar las herramientas (`ToolSearch "select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_resize,mcp__plugin_playwright_playwright__browser_snapshot,mcp__plugin_playwright_playwright__browser_click,mcp__plugin_playwright_playwright__browser_take_screenshot"`), `browser_resize` 390×844, `browser_navigate` a `https://claude.ai/artifact/KRjappPSPi48KJC3Z4G4ig`, `browser_snapshot`, clic en **Markets** → **BTC-PERP** → pill **Ask**; screenshot `proto-ask-empty.png`; clic en una celda (la de `+1.0 %` × `4H`) → screenshot `proto-ask-sheet.png`. Si el artifact pide login o no renderiza, **parar ese paso, decirlo en el reporte y pedirle a Jesús las dos capturas** (no inventar la comparación). Guardar ambas en `$SC/matrix-shots/`.

- [ ] **Step 8: Comparación y evidencia versionada** — mirar lado a lado `03-cell-selected.png`/`03b-sheet.png` contra `proto-ask-sheet.png` y `00-ask-first.png` contra `proto-ask-empty.png`; listar en el reporte **cada diferencia** con su causa: 5 filas vs 7 (spec D2), `CreditsRow` (P9), sin fila FUNDING/NEXT/OI (P9), chips inline en vez de pantalla de agentes (P7), sparkline real (P2), hint sin «Drag» (P10), «Done» mientras se elige agente (P7), y cualquier otra que se vea (tamaños, espaciados, colores). Lo que sea una desviación no decidida en este plan se anota como **defecto** con captura, no se corrige en silencio. Copiar las dos parejas al repo:

```bash
mkdir -p /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2/docs/superpowers/audits/img
cp "$SC/matrix-shots/03-cell-selected.png" …/docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-app.png
cp "$SC/matrix-shots/proto-ask-sheet.png"  …/docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-proto.png
ls -la …/docs/superpowers/audits/img/
```
(Si la captura buena de la hoja es `03b-sheet.png`, usar esa.) Nada más se commitea en esta task; Task 6 añade los PNG con el audit.

- [ ] **Step 9: Reporte** — `$SC/task-5-report.md`: tabla de capturas (archivo → qué muestra, mirada ✓), los dos precios de escalera verificados a mano con la fórmula, créditos 19 → 18 con la salida SQL, el `id` de la read, la lista de diferencias con el prototipo y los defectos encontrados (si hay, **parar aquí**: se deciden con Jesús antes de Task 6).

---

### Task 6: Spec D14/D16 **(F2-matrix)**, dev tracker, addendum al audit F2, README, revisión independiente y checks

**Files:**
- Modify: `docs/superpowers/specs/2026-09-19-mobile-ask-design.md` (D14, D16, §2.3, cabecera Estado), `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md` (nueva §7), `docs/overview/data/manifest.js` (entrada del dev tracker, al principio de `window.DOCS`), `apps/mobile/README.md` (sección Ask y conteo de tests)
- Create: `docs/overview/dev/2026-09-20-mobile-ask-matrix.html` (vía skill `pickler-dev-new`), `docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-{app,proto}.png` (copiados en Task 5)

- [ ] **Step 1: Spec** — sin reescribir secciones, marcando **(F2-matrix)**:

- **D14**, al final de la celda «Decisión»: «**(F2-matrix)** La descripción de la matriz de arriba (celda = `pill(on)` con `+2.5%` y el target) fue un error al escribir el spec, no de la ejecución: la matriz es el `Grid` del prototipo (`pickler-mobile` `src/screens/markets.js`): card `C.card` con borde `C.hair` radio 14; columna de 74 px con `Sparkline`; escalera de precios de 58 px (mono 9.5, `C.faint`, acento en la fila seleccionada; el precio es `targetFor(mark, bps)`); celdas de 44 px **sin texto** con un punto de 5 px donde el usuario ya tiene reads `open/right/wrong` en esa celda; al tocar, fila y columna en `accSoft` y la celda en `accOn` (violeta en Ask; lima en Trade, F3); regla lima bajo la fila `+0.5 %` (el mark); horizontes `1H 4H 12H 24H` abajo. Encima de la card, `Tag HISTORY · MARK` + mark mono 700/15. **Los niveles son los 5 del spec (D2), no los 7 del prototipo.** La hoja de la celda es la del prototipo (`ConsultTab`): `Card vioBd45/vioBg07`, chip «Asking {agente} · 1 credit» + «Change» (despliega los chips de agente inline), `Tag vio YOUR QUESTION · NOTHING SENT`, pregunta 700/14, línea mono `RESOLVES ON PERPL MARK · {±x.x% FROM MARK}`, dos `Stepper` (nivel: target formateado; horizonte), «Ask {agente} · 1 credit» (outline, arrow, flex) + «Clear» (ghost), «Nothing charged yet.». Debajo de la matriz, hint «Tap a cell: a level and a horizon.» / «Use the steppers to move it.»; después de la hoja, card `MARK PRICE · PERPL ON MONAD` + «Reads resolve on mark, not on your fill.» **sin** la fila FUNDING/NEXT/OI (no hay datos). La fila de créditos se conserva encima de la cabecera. **La sparkline usa datos reales**: el prototipo dibuja una serie fake; `pub/context` no da historial, así que la app guarda los últimos 60 marks recibidos por mercado (`usePerpl.marks`, en memoria) y con < 2 puntos dibuja una línea plana. Plan `2026-09-20-mobile-ask-matrix.md`.»
- **D16**, al final: «**(F2-matrix)** `src/perpl/marks.ts` (puro: `SPARK_POINTS = 60`, `appendMarks`, `sparkPoints`) y `Perpl.marks`; `matrix.ts` gana `stepLevel`, `stepHorizon`, `distanceLabel`, `dotKey`, `readDots`; `theme.ts` gana `GRID_ACCENT`, `GRID_DOT`, `GRID_MARK_RULE`; `primitives.tsx` gana `Sparkline` (react-native-svg) y `Stepper`. Test nuevo `perpl-marks`.»
- **§2.3**, línea de `ask.tsx`: añadir «(**F2-matrix**: `MatrixGrid` = `Grid` del prototipo, `AskSheet` con `Stepper`)» y una línea nueva «- `src/perpl/marks.ts`, `Sparkline`/`Stepper` en `src/ui/primitives.tsx` (F2-matrix).»
- Cabecera **Estado**: «F2 ejecutada (…); **F2-matrix** (corrección de diseño de la matriz, plan `2026-09-20-mobile-ask-matrix.md`, addendum §7 del audit F2).»

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2
npm run docs:html 2>&1 | grep -i 'mobile-ask'
```
Expected: `[ok]` para el spec y para `plans/2026-09-20-mobile-ask-matrix.md` (genera su `.html` vecino).

- [ ] **Step 2: Dev tracker** — leer `.claude/skills/pickler-dev-new/SKILL.md` y seguirlo: `types: ['feature']`, slug `mobile-ask-matrix`, fecha `2026-09-20`, título «Matriz de Ask como el Grid del prototipo», lede «Sparkline real, escalera de precios, celdas con punto y hoja violeta con steppers; corrige D14 del spec de Ask.», `status: 'in_progress'` (rama sin merge: no es `shipped`), tags `['mobile', 'ask', 'ui']`. «Qué cambió»: los bullets de las Tasks 1–4 (de `git log --oneline 9fec62c..HEAD`). «Archivos tocados»: `git diff --stat 9fec62c..HEAD`. «Validación»: capturas de Task 5 (nombres y qué muestra cada una), créditos 19 → 18 con el `id` de la read, tests y `tsc`, comparación con el prototipo con `<img src="../../superpowers/audits/img/2026-09-20-mobile-ask-matrix-app.png">` y `…-proto.png` (ancho 100 %, dentro de una fila de dos columnas si el template lo permite; si no, una debajo de otra), fuente «audit F2 §7». Render: `node scripts/agent-infra/render-check.mjs <scratch> dev/2026-09-20-mobile-ask-matrix` y **mirar la captura de 390 px**.

- [ ] **Step 3: Addendum al audit F2** — añadir al final de `docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md`:

```markdown
## 7. Addendum F2-matrix (2026-09-20): la matriz como el Grid del prototipo

Corrección de diseño sobre la misma rama (`feat/mobile-ask-f2`, commits `<sha1>`…`<shaN>` sobre `9fec62c`), plan
`docs/superpowers/plans/2026-09-20-mobile-ask-matrix.md`. D14 describió la matriz como pills con el target; fue un
error al escribir el spec, no de la ejecución de F2 (corregido en el spec con la marca **(F2-matrix)**).

### Qué quedó hecho y verificado
<por task: comandos y salidas — conteos de `npm test` por task, `tsc`, `git log --oneline 9fec62c..HEAD`>

### Recorrido en el simulador (Task 5, <hora> CST)
<tabla de capturas de `$SC/matrix-shots/`: archivo → qué muestra; precios de escalera verificados con la fórmula;
créditos 19 → 18 con la salida SQL; `id` y `expires_at` de la read de Drift, dejada vencer sola>

### Comparación con el prototipo
![App — celda +1.0% · 4H con la hoja](img/2026-09-20-mobile-ask-matrix-app.png)
![Prototipo — Markets → BTC-PERP → Ask](img/2026-09-20-mobile-ask-matrix-proto.png)
<lista de diferencias con su causa (P2, P7, P9, P10; 5 vs 7 niveles) y defectos encontrados>

### Rulings
<P1–P12 del plan que se ejecutaron tal cual, y cualquier desviación con *qué cuesta si está mal*>

### Correcciones a afirmaciones previas
- D14 (spec) — descripción de la matriz y de la hoja: ver **(F2-matrix)** en el spec.
- <otras>

### Estado de las cuentas al cierre
Wallet del simulador `$SIM_ADDR`: créditos 18 (ledger: +20, −1 F2, −1 F2-matrix); reads: 2 (`9f386c32…` right, `<id>` open
hasta `<expires_at>`); AUSD/MON sin cambio (<valores de la captura de Wallet si se abrió; si no, «no se abrió Wallet:
ninguna acción on-chain en la sesión»>); cuenta Perpl #620 sin tocar.

### Pendientes / residuales
<defectos visuales no decididos; el resto de §5 sigue igual; F3 usa `GRID_ACCENT.trade` con el mismo `MatrixGrid`>

### Revisión independiente
<veredicto, hallazgos y qué se hizo>
```
(Rellenar cada `<…>` con lo real; ninguno puede quedar.)

- [ ] **Step 4: README** — `apps/mobile/README.md`: en la sección «Ask y Agentes (pills de Market)» añadir una línea: «La matriz es el `Grid` del prototipo (sparkline con los últimos 60 marks que la app vio, escalera de 5 niveles, celdas con punto donde ya hay reads, hoja con steppers); `src/perpl/marks.ts` y `src/reads/matrix.ts` son puros y tienen test.» Sección Tests → el conteo real (`npm test 2>&1 | tail -4`).

- [ ] **Step 5: Revisión independiente** — dispatch de un subagente revisor (regla global) con: este plan, el spec (D14/D16 corregidos), `git diff 9fec62c..HEAD -- apps/mobile docs`, el reporte de Task 5 y las capturas. Pedirle que verifique: (a) `MatrixGrid` y `AskSheet` contra `Grid`/`ConsultTab` del prototipo (`/tmp/pickler-mobile-src/src/screens/markets.js`; si no existe, `git clone --depth 1 https://github.com/jjesusaf/pickler-mobile /tmp/pickler-mobile-src`) — medidas, colores, orden de elementos, y que las diferencias sean sólo las decididas (P2, P7–P10, 5 niveles); (b) `useReads.ask`, `ReadCard`, `ReadRow`, My reads, Agents, store, hooks de reads y servidor **sin cambios** (`git diff 9fec62c..HEAD --stat` no los lista); (c) el agente mostrado es el que se cobra (D14) también con los chips ocultos; (d) `appendMarks` no muta, recorta a 60 y `sparkPoints` invierte Y; el buffer sólo crece en `refreshContext`; (e) sin dependencias nuevas ni cambios nativos (`package.json`, `package-lock.json`, `ios/` intactos); (f) los tests nuevos fallan si se rompe lo que prueban (correrlos contra un `stepLevel` que envuelva o un `readDots` que cuente `failed`: deben ponerse en rojo). Aplicar lo que proceda (con test si es lógica) y anotar la revisión en §7 del audit.

- [ ] **Step 6: Checks finales**

```bash
cd /Users/josedejesusacevedoflores/Documents/predict/.claude/worktrees/mobile-ask-f2
npm run docs:html && npm run docs:check && npm run agents:check
cd apps/mobile && npm test 2>&1 | tail -4 && npx tsc --noEmit && echo TSC-OK
cd .. && git status --short
```
Expected: `docs:check` `errors=0`; `agents:check` `"errors": []`; 31 suites / 236 tests (más los que añada la revisión); `TSC-OK`; el árbol muestra sólo los archivos de esta task.

- [ ] **Step 7: Commit y handoff**

```bash
git add docs/superpowers/specs/2026-09-19-mobile-ask-design.md docs/superpowers/specs/2026-09-19-mobile-ask-design.html docs/superpowers/plans/2026-09-20-mobile-ask-matrix.md docs/superpowers/plans/2026-09-20-mobile-ask-matrix.html docs/overview/dev/2026-09-20-mobile-ask-matrix.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-19-mobile-ask-f2-rulings.md docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-app.png docs/superpowers/audits/img/2026-09-20-mobile-ask-matrix-proto.png apps/mobile/README.md
git commit -m "docs(mobile-ask): F2-matrix — D14/D16 corregidos, dev tracker, addendum §7 al audit F2 con capturas app/prototipo" -m "Co-Authored-By: <modelo> <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01UVnRjUqFZvAUjKSn3t4xUi"
```
Handoff: qué quedó en la app (matriz y hoja nuevas; read de Drift abierta hasta `<expires_at>`), créditos 18, defectos visuales pendientes (si hay), y que el siguiente punto de decisión sigue siendo el del audit F2 §6: **F3** (Trade con `GRID_ACCENT.trade` sobre el mismo `MatrixGrid`, `LevelCard`, `reminder-set`, book), merge/push de F1+F2, key APNs, Markets `readOnly`. **Sin push, sin merge, sin TestFlight.**

---

## Self-review del plan (hecho al escribirlo)

- **Cobertura del brief**: (1) `MatrixGrid` = `Grid` → Task 4 Step 2 con Task 1 (tokens, puntos) y Task 2 (marks): card `C.card`/`C.hair`/14, columna 74 con `Sparkline`, escalera 58/mono 9.5/`C.faint`/acento, celdas 44 sin texto con punto de 5 px por `reads.reads` (`open/right/wrong`), fila+columna `accSoft` y celda `accOn`, regla del mark, horizontes abajo, cabecera `HISTORY · MARK` + mark 700/15, violeta, 5 niveles con `targetFor`. (2) `Sparkline` en `primitives.tsx` con `Svg viewBox 0 0 100 100`, `Polyline`, `preserveAspectRatio="none"`, `vectorEffect="non-scaling-stroke"`, `C.spark` → Task 3; datos reales con buffer de 60 por mercado en `usePerpl.refreshContext` → Task 2; `sparkPoints` puro con test, plano con < 2 → Task 2; declarado como corrección al spec → Task 6 Step 1. (3) `AskSheet` → Task 4 Step 3 (chip + Change, Tag vio, pregunta 700/14, línea mono con distancia, dos `Stepper` 26 px / mono 10, Ask flex+arrow, Clear ghost, «Nothing charged yet.»); hint `T faint 11.5` con los dos textos y card `MARK PRICE · PERPL ON MONAD` sin FUNDING → Task 4 Step 4. (4) Sin «Trade this level», sin `LevelCard`, sin tocar Trade, `ReadCard`, My reads, Agents, hooks de reads ni servidor: ninguna task los lista; `useReads.ask(cell, agentId)` igual (Task 4 lo llama sin cambios); la revisión (Task 6 Step 5 b) lo comprueba con `--stat`. Verificación en el simulador con las cinco capturas pedidas (vacía = Step 2, seleccionada = Step 3, puntos = Step 1, hoja con steppers = Steps 3–4, read desde la hoja con créditos −1 = Step 5), comparación con el prototipo y capturas en el audit (Steps 7–8, Task 6 Step 3), `npm test` + `tsc` por task; docs: spec D14 **(F2-matrix)**, dev tracker `pickler-dev-new` (feature, validación con capturas), addendum al audit, `docs:html`/`docs:check`/`agents:check` → Task 6.
- **Placeholders**: los `<…>` del addendum (Task 6 Step 3) y `<modelo>` en los commits son huecos que el ejecutor rellena con datos reales y el plan lo dice; no hay «TBD» ni «similar a».
- **Consistencia de tipos**: `stepLevel/stepHorizon` reciben `number` (el `AskCell` del store es numérico) y devuelven literales asignables a `AskCell`; `MatrixGrid.onSelect` produce `Cell` (literal) que `set({ askCell })` acepta; `AskSheet.onCell: (c: AskCell) => void`; `readDots` acepta `Read[]` (tiene `levelBps`, `horizonMin`, `status`) porque su parámetro es estructural; `Sparkline.points` acepta el `[number, number][]` de `sparkPoints`; `perpl.marks[market.id]` es `readonly number[] | undefined` → `?? []` cumple `marks: readonly number[]`; `GRID_ACCENT.ask` tiene `fg/on/soft`, los tres usados en `MatrixGrid`; `Stepper.accessibilityLabel` genera `step-level-down/up` y `step-horizon-down/up`, los que usa Task 5.
