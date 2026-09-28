# Rediseño light — F1: sistema, 4 pestañas y re-vestido — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app corre en el simulador con el sistema claro del Handoff en todas las pantallas. Tiene 4 pestañas (MARKETS · AGENTS · PORTFOLIO · WALLET) y Portfolio y Read son reales. Market funciona con el segmentado *Trade it / Ask an agent*. La lógica de Perpl, wallet, reads y push queda intacta, salvo el cableado declarado en D26.

**Architecture:** Primero se **reasignan los valores** de los tokens de `ui/theme.ts` a su equivalente claro, conservando los nombres cuando el rol no cambia (`ink` = texto principal, `card` = superficie, etc.). Así toda la app pasa a claro en una sola tarea y compila. Después se re-visten las primitivas y se reorganiza la navegación (4 pestañas visibles; Launchpad y Activity siguen registradas pero ocultas). Al final se re-maquetan las pantallas una por una y se crean Portfolio, Read y Agents. Toda la lógica nueva es pura y tiene tests; los componentes se verifican en el simulador.

**Tech Stack:** Expo SDK 57 / React Native 0.86.3 / TypeScript / Jest 29 (`jest-expo`) / react-navigation 7. Nuevas: `@expo-google-fonts/instrument-sans@0.4.2`, `react-native-qrcode-svg@6.3.26` y el `.ttf` generado `assets/fonts/ArchivoPickler-Bold.ttf`. Salen `@expo-google-fonts/chakra-petch` y `@expo-google-fonts/manrope`.

**Spec:** `docs/superpowers/specs/2026-09-28-mobile-light-design.md`. F1 cubre D2–D9, D13–D15, D17–D20 y D22–D27, más la parte de D10 del segmentado y `marketTab`. Léelo antes de empezar. Referencia visual: `jjesusaf/pickler-mobile@1808d5b`, carpeta `design/`. Para verla: `gh repo clone jjesusaf/pickler-mobile <scratch>/pickler-mobile && python3 -m http.server 8765 --directory <scratch>/pickler-mobile/design`, y luego abrir `http://localhost:8765/`.

## Global Constraints

- Worktree `.claude/worktrees/mobile-light`, rama `feat/mobile-light`. Los comandos de app se corren desde `apps/mobile` dentro del worktree; los de docs, desde la raíz del worktree. Nunca `git add -A`: archivos por nombre. Commits locales `feat(mobile): …` / `chore(mobile): …` / `docs(mobile-light): …` con el trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sin push, merge ni TestFlight.**
- Paleta del Handoff (D3), valores exactos: ink `#0B0D1A`, lima `#C8F03A`, violeta `#5B3CE0`, win `#2E7D32`, loss `#C62C62`, pending `#FFC93F`, short `#FF5FA2`, agentDot `#9B7BFF`, fondo `#FFFFFF`, card `#F5F6FA`, control `#F1F2F7`, baldosa sobre ink `#15182A`.
- **La lima nunca es color de texto sobre blanco**: como relleno va `C.lime`; como texto o borde, `C.limeInk` (`#3F6B00`) o `C.limeBd`. Lo mismo con el ámbar: `C.pending` es relleno y punto; `C.warn` (`#8A6200`) es texto.
- Fuentes (D4): display `ArchivoPickler-Bold` (Archivo con wdth 112 y wght 700, generada en Task 0); cuerpo Instrument Sans 400/500/600/700; mono JetBrains Mono 400/500/700.
- Pestañas visibles (D1/D2): `MarketsTab · AgentsTab · PortfolioTab · WalletTab`. `LaunchpadTab` y `ActivityTab` siguen en el navegador, pero no se pintan en la barra.
- Niveles y horizontes **no cambian**: `LEVELS_BPS = [250, 100, 50, -50, -100]`, `HORIZONS_MIN = [60, 240, 720, 1440]`.
- Arranque en WalletTab; pull-to-refresh y sello, swipe atrás y reglas de `ref.ts` (`pop: true`, `initial: false`) se conservan.
- Copy en inglés, como hoy. Sin "three orders", TP ni cierre por deadline (D11). Sin "BOOK IS AT" ni SOURCES (D14).
- Entre las tareas 1 y 11, `npx tsc --noEmit` debe quedar limpio **al terminar cada tarea**, y `npm test` en verde.

## Review Focus

1. **Texto lima o ámbar sobre blanco**: tras Task 1, `C.lime` sólo se usa como relleno. Sobre ink, el texto lima va con `C.limeOnInk`. Lo pinnea la revisión manual de `grep -rn "C\.lime\b"` en Task 1 Step 6 y en Task 14. Un grep por patrón no detecta ternarios ni `vFg`.
2. **Reads de otro mercado en el board**: al quitar el filtro de `reads-list`, los puntos de la matriz sólo deben salir de reads del mercado abierto. Lo pinnea el test de `readsForMarket` en Task 6.
3. **Portfolio sin socket**: con la cuenta #620, Positions debe llegar a LIVE en Portfolio sin pasar por Markets. Lo pinnea el test de `perplActiveFor("portfolio")` en Task 6 y la verificación de Task 12.
4. **Push de read con la app cerrada**: debe abrir la pantalla Read aunque la read no esté en la lista (se pide con `fetchRead`). Lo pinnea el test de `pushTarget` en Task 3 y la ruta de `fetchOne` en Task 13.
5. **Totales de Portfolio**: TOTAL = libre + en órdenes + colateral + PnL. Si `lb` o el PnL faltan, no debe salir NaN ni un total negativo sin sentido. Lo pinnea el test de `portfolioTotals` en Task 12.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `apps/mobile/package.json`, `package-lock.json` | modificar | deps de D27 |
| `apps/mobile/scripts/archivo-instance.sh` | crear | genera `ArchivoPickler-Bold.ttf` |
| `apps/mobile/assets/fonts/ArchivoPickler-Bold.ttf` | crear | fuente display |
| `apps/mobile/app.config.ts` | modificar | `userInterfaceStyle: "light"`, fondos `#FFFFFF` |
| `apps/mobile/App.tsx` | modificar | fuentes, StatusBar, `perplActiveFor`/`readsActiveFor`, `pushTarget` |
| `src/ui/theme.ts` | reescribir | tokens claros, `F`, `fam`, `pill`, `GRID_*`, `TAB_TINT` |
| `src/ui/variants.ts` | crear | tabla pura de variantes de `Btn` |
| `src/ui/primitives.tsx` | modificar | primitivas re-vestidas + `InkBlock`, `InkTile`, `SearchBox`, iconos |
| `src/ui/Page.tsx` | modificar | cabecera clara, sin `Backdrop` |
| `src/ui/TabBar.tsx`, `src/ui/tabBarLayout.ts` | reescribir | 4 botones fijos |
| `src/navigation/screens.ts`, `routes.ts`, `Navigator.tsx` | modificar | pestañas y pilas nuevas |
| `src/store.ts` | modificar | `MarketTab`, `readId`, headers, `askMarketId`, activadores |
| `src/reads/push.ts` | modificar | `pushTarget` |
| `src/reads/matrix.ts` | modificar | `readsForMarket` |
| `src/reads/agentsCopy.ts` | crear | descripción de cada agente (D15) |
| `src/hooks/useReads.ts` | modificar | lista sin filtro, `fetchOne` |
| `src/perpl/filter.ts` | crear | `filterMarkets` |
| `src/perpl/portfolio.ts` | crear | `portfolioTotals` |
| `src/wallet/movements.ts` | crear | `splitMovements` |
| `src/screens/tradingGate.tsx` | crear | `EnableTrading` + `TradingWarns` (salen de markets.tsx) |
| `src/screens/signin.tsx`, `wallet.tsx`, `perpsFunds.tsx`, `markets.tsx`, `market.tsx`, `ask.tsx`, `book.tsx`, `comingSoon.tsx`, `comingSoonCopy.ts` | modificar | re-vestido |
| `src/screens/agents.tsx` | reescribir | pestaña Agents |
| `src/screens/portfolio.tsx`, `src/screens/read.tsx` | crear | pantallas nuevas |
| `src/DevControls.tsx` | modificar | fondo claro |
| `__tests__/theme.test.ts`, `variants.test.ts`, `tabBarLayout.test.ts`, `routes.test.ts`, `store.test.ts`, `comingSoon.test.ts`, `reads-push.test.ts`, `reads-matrix.test.ts`, `filter.test.ts`, `portfolio.test.ts`, `movements.test.ts`, `agentsCopy.test.ts` | crear/modificar | lógica pura |
| `apps/mobile/README.md`, `docs/overview/2026-09-28-mobile-light.html`, `docs/overview/data/manifest.js`, `docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md` | modificar/crear | cierre |

---

### Task 0: Bootstrap, dependencias y fuente display

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json`
- Create: `apps/mobile/scripts/archivo-instance.sh`, `apps/mobile/assets/fonts/ArchivoPickler-Bold.ttf`

**Interfaces:**
- Produces: `node_modules` con `@expo-google-fonts/instrument-sans` y `react-native-qrcode-svg`; el archivo `assets/fonts/ArchivoPickler-Bold.ttf` (familia interna `Archivo Pickler`, PostScript `ArchivoPickler-Bold`).

- [ ] **Step 1: Instalar y medir la línea base**

Desde `.claude/worktrees/mobile-light/apps/mobile`:
```bash
npm install
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: `Tests: N passed, N total` (anota N; el README dice 270) y `TSC_OK`. Si la línea base no está en verde, **para** y repórtalo.

- [ ] **Step 2: Agregar las dependencias**

```bash
npm install --save-exact @expo-google-fonts/instrument-sans@0.4.2 react-native-qrcode-svg@6.3.26
npm ls @expo-google-fonts/instrument-sans react-native-qrcode-svg react-native-svg
```
Expected: las dos versiones exactas y `react-native-svg@15.15.4` como dependencia deduplicada. `expo-system-ui` ya está instalado (`57.0.4`) y no se toca. Chakra Petch y Manrope salen en Task 1, cuando ya no tienen consumidores.

- [ ] **Step 3: Script de la fuente display**

Crea `apps/mobile/scripts/archivo-instance.sh`:
```bash
#!/usr/bin/env bash
# Genera assets/fonts/ArchivoPickler-Bold.ttf: Archivo (OFL, google/fonts) instanciado a wdth 112 / wght 700,
# el `font-variation-settings:'wdth' 112` del Handoff (spec mobile-light D4). RN no garantiza ejes variables en iOS.
# Uso: scripts/archivo-instance.sh <directorio-temporal>
set -euo pipefail
TMP="${1:?directorio temporal}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/assets/fonts/ArchivoPickler-Bold.ttf"
mkdir -p "$TMP" "$(dirname "$OUT")"
python3 -m venv "$TMP/ftvenv"
"$TMP/ftvenv/bin/pip" install -q fonttools
curl -sSfL -o "$TMP/Archivo-VF.ttf" "https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf"
"$TMP/ftvenv/bin/fonttools" varLib.instancer "$TMP/Archivo-VF.ttf" wdth=112 wght=700 -o "$TMP/Archivo-112-Bold.ttf"
"$TMP/ftvenv/bin/python" - "$TMP/Archivo-112-Bold.ttf" "$OUT" <<'PY'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
n = f["name"]
for nid, val in [(1, "Archivo Pickler"), (2, "Bold"), (4, "Archivo Pickler Bold"), (6, "ArchivoPickler-Bold"), (16, "Archivo Pickler"), (17, "Bold")]:
    n.setName(val, nid, 3, 1, 0x409)
f.save(sys.argv[2])
print("ok", sys.argv[2], "fvar" in f, f["hmtx"]["H"][0])
PY
```

- [ ] **Step 4: Generar la fuente y comprobarla**

```bash
chmod +x scripts/archivo-instance.sh
scripts/archivo-instance.sh /private/tmp/claude-501/archivo-build
ls -la assets/fonts/ArchivoPickler-Bold.ttf
```
Expected: `ok …/ArchivoPickler-Bold.ttf False 860` (sin tabla `fvar`; la H mide 860 unidades contra 732 del ancho normal, así que el ancho se aplicó) y un archivo de ~120 KB. Si la descarga falla, **para** y repórtalo; el fallback de D4 (Archivo 700 normal) exige otra dependencia y lo decide Jesús.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/package.json apps/mobile/package-lock.json apps/mobile/scripts/archivo-instance.sh apps/mobile/assets/fonts/ArchivoPickler-Bold.ttf
git commit -m "chore(mobile): deps del rediseño light y fuente display Archivo wdth 112

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: `ui/theme.ts` — tokens claros, fuentes y reasignación de texto lima (D3, D4, D5)

**Files:**
- Rewrite: `apps/mobile/src/ui/theme.ts`, `apps/mobile/__tests__/theme.test.ts`
- Modify: `apps/mobile/App.tsx` (fuentes y StatusBar), `apps/mobile/app.config.ts`, `src/navigation/Navigator.tsx`, `src/ui/Page.tsx`, `src/ui/TabBar.tsx`, `src/DevControls.tsx` (sólo los `bg*`) y cada pantalla que use lima o `down` como texto o relleno (Step 6)
- Modify: `apps/mobile/package.json`, `package-lock.json` (sacar Chakra Petch y Manrope)

**Interfaces:**
- Produces: `C` con los nombres de hoy más `bg`, `ctl`, `tile`, `onInk`, `onInkDim`, `onInkSoft`, `limeInk`, `short`, `pending`, `blueBg`, `empty`, `dotOff`, `agentDot`, `hair06`. Salen `bgTop`, `bgMid`, `bgBottom` y `cyan`. También `F`, `fam`, `textStyle` (misma firma), `pill`, `GRID_ACCENT`, `GRID_DOT`, `GRID_MARK_RULE` y `TAB_TINT: Record<"markets"|"agents"|"portfolio"|"wallet", string>`.

- [ ] **Step 1: Escribir el test que falla**

Reemplaza `__tests__/theme.test.ts` por:
```ts
import { C, fam, GRID_ACCENT, GRID_DOT, GRID_MARK_RULE, pill, TAB_TINT, textStyle } from "../src/ui/theme";

test("body weights map to Instrument Sans; 800 collapses to 700", () => {
  expect(fam(400)).toBe("InstrumentSans_400Regular");
  expect(fam(500)).toBe("InstrumentSans_500Medium");
  expect(fam(600)).toBe("InstrumentSans_600SemiBold");
  expect(fam(700)).toBe("InstrumentSans_700Bold");
  expect(fam(800)).toBe("InstrumentSans_700Bold");
});

test("mono keeps three cuts; display is the single Archivo wdth 112 instance", () => {
  expect(fam(400, "mono")).toBe("JetBrainsMono_400Regular");
  expect(fam(500, "mono")).toBe("JetBrainsMono_500Medium");
  expect(fam(700, "mono")).toBe("JetBrainsMono_700Bold");
  expect(fam(600, "display")).toBe("ArchivoPickler-Bold");
  expect(fam(700, "display")).toBe("ArchivoPickler-Bold");
});

test("textStyle converts lh ratio and ls em to pixels", () => {
  expect(textStyle(700, 30, { display: true, lh: 1, ls: -0.045 })).toEqual({
    fontFamily: "ArchivoPickler-Bold", fontSize: 30, color: C.ink, lineHeight: 30, letterSpacing: -1.35,
  });
  expect(textStyle(500, 10, { mono: true, color: C.faint })).toEqual({ fontFamily: "JetBrainsMono_500Medium", fontSize: 10, color: C.faint });
});

test("tokens come verbatim from the Handoff (light system)", () => {
  expect([C.ink, C.dim, C.faint]).toEqual(["#0B0D1A", "#5A5F78", "#6B7186"]);
  expect([C.bg, C.card, C.ctl, C.tile]).toEqual(["#FFFFFF", "#F5F6FA", "#F1F2F7", "#15182A"]);
  expect(C.limeOnInk).toBe("#C8F03A");
  expect([C.lime, C.limeInk, C.vio, C.up, C.down, C.short, C.pending, C.warn, C.agentDot])
    .toEqual(["#C8F03A", "#3F6B00", "#5B3CE0", "#2E7D32", "#C62C62", "#FF5FA2", "#FFC93F", "#8A6200", "#9B7BFF"]);
  expect((C as Record<string, unknown>).bgBottom).toBeUndefined();
});

test("lime is a fill, never text: onLime is ink and the selected pill is ink", () => {
  expect(C.onLime).toBe("#0B0D1A");
  expect(pill(true)).toEqual({ bd: C.ink, bg: C.ink, fg: C.onInk });
  expect(pill(false)).toEqual({ bd: C.ctl, bg: C.ctl, fg: C.dim });
});

test("tab tints are the Handoff tab bar's, not the nav map's", () => {
  expect(TAB_TINT).toEqual({ markets: "#3F6B00", agents: "#5B3CE0", portfolio: "#8A6200", wallet: "#C62C62" });
});

test("the matrix: violet for Ask, lime tint for Trade, agent dot violet always, mark rule ink", () => {
  expect(GRID_ACCENT.ask).toEqual({ fg: C.vio, on: "rgba(91,60,224,0.18)", soft: "rgba(91,60,224,0.06)" });
  expect(GRID_ACCENT.trade).toEqual({ fg: C.limeInk, on: "#EDF7CE", soft: "#F3F8E0" });
  expect(GRID_DOT).toBe("#9B7BFF");
  expect(GRID_MARK_RULE).toBe("#0B0D1A");
});
```

- [ ] **Step 2: Correrlo para verlo fallar**

Run: `npx jest __tests__/theme.test.ts`
Expected: FAIL (`fam(400)` devuelve `Manrope_400Regular` y `C.bg` es `undefined`).

- [ ] **Step 3: Reescribir `src/ui/theme.ts`**

```ts
import type { TextStyle } from "react-native";

// Tokens del "Pickler Mobile Handoff" (Claude Design, jjesusaf/pickler-mobile@1808d5b, design/), spec mobile-light D3.
// Los nombres de mobile-hifi se conservan cuando el rol es el mismo (ink = texto principal, card = superficie);
// sólo cambia el valor. Regla: la lima es relleno; como texto o borde va limeInk / limeBd.
export const C = {
  ink: "#0B0D1A",
  dim: "#5A5F78",
  faint: "#6B7186",

  bg: "#FFFFFF",
  card: "#F5F6FA",
  ctl: "#F1F2F7",
  tile: "#15182A",
  onInk: "#FFFFFF",
  onInkDim: "#9AA0B8",
  onInkSoft: "#C7CAD8",

  hair: "rgba(11,13,26,0.1)",
  hair2: "rgba(11,13,26,0.16)",
  hair06: "rgba(11,13,26,0.06)",
  hair08: "rgba(11,13,26,0.08)",
  hair10: "rgba(11,13,26,0.10)",
  hair12: "rgba(11,13,26,0.12)",
  hair14: "rgba(11,13,26,0.14)",
  hair18: "rgba(11,13,26,0.18)",
  hair22: "rgba(11,13,26,0.22)",
  hair28: "rgba(11,13,26,0.28)",
  hair34: "rgba(11,13,26,0.34)",

  card04: "#F8F9FC",
  card09: "#EEF0F5",
  card10: "#E9EBF2",
  deep: "#F1F2F7",
  deep50: "#FFFFFF",
  deep60: "#F1F2F7",
  onDeep: "#FFFFFF",
  slab: "#F1F2F7",

  vio: "#5B3CE0",
  vioSolid: "#5B3CE0",
  vioBd: "rgba(91,60,224,0.5)",
  vioBd45: "rgba(91,60,224,0.45)",
  vioBd40: "rgba(91,60,224,0.4)",
  vioBg: "#EEEAFF",
  vioBg10: "#F1EEFF",
  vioBg08: "#F3F0FF",
  vioBg07: "#F5F2FF",
  vioBg06: "#F6F4FF",

  lime: "#C8F03A",
  /** Lima como texto o icono **sobre ink** (bloques oscuros, tarjeta de passkey): ahí sí se lee. */
  limeOnInk: "#C8F03A",
  onLime: "#0B0D1A",
  limeInk: "#3F6B00",
  limeBd: "rgba(63,107,0,0.35)",
  limeBd40: "rgba(63,107,0,0.3)",
  limeBg: "#F3F8E0",
  limeBg14: "#EDF7CE",
  limeBg06: "#F3F8E0",

  up: "#2E7D32",
  down: "#C62C62",
  short: "#FF5FA2",
  downBd: "rgba(198,44,98,0.4)",
  downBd45: "rgba(198,44,98,0.45)",
  downBg: "#FDF0F5",
  warn: "#8A6200",
  pending: "#FFC93F",
  warnBd: "rgba(255,201,63,0.6)",
  warnBg: "#FBF0D4",
  blue: "#2F55C8",
  blueBg: "#EAF0FF",
  spark: "#B9BED0",
  disabled: "#C9CDDB",
  empty: "#E2E5EE",
  dotOff: "#D3D6E2",
  agentDot: "#9B7BFF",
} as const;

// Familias: las de @expo-google-fonts/* y la instancia local de Archivo (Task 0, assets/fonts).
export const F = {
  r: "InstrumentSans_400Regular",
  m: "InstrumentSans_500Medium",
  sb: "InstrumentSans_600SemiBold",
  b: "InstrumentSans_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoM: "JetBrainsMono_500Medium",
  monoB: "JetBrainsMono_700Bold",
  display: "ArchivoPickler-Bold",
} as const;

export type FontKind = "mono" | "display";

/** Peso numérico del diseño → familia cargada. Display tiene un solo corte (Archivo 700 · wdth 112). */
export function fam(weight: number, kind?: FontKind): string {
  if (kind === "display") return F.display;
  if (kind === "mono") return weight >= 700 ? F.monoB : weight >= 500 ? F.monoM : F.mono;
  if (weight >= 700) return F.b;
  if (weight >= 600) return F.sb;
  if (weight >= 500) return F.m;
  return F.r;
}

export type TypeOpts = { lh?: number; ls?: number; mono?: boolean; display?: boolean; color?: string };

/** `font: <weight> <size>/<lh> <family>` del diseño. `ls` en em, convertido a px. */
export function textStyle(weight: number, size: number, { lh, ls = 0, mono = false, display = false, color }: TypeOpts = {}): TextStyle {
  const kind: FontKind | undefined = display ? "display" : mono ? "mono" : undefined;
  const style: TextStyle = { fontFamily: fam(weight, kind), fontSize: size, color: color ?? C.ink };
  if (lh) style.lineHeight = Math.round(size * lh);
  if (ls) style.letterSpacing = +(size * ls).toFixed(2);
  return style;
}

export type Pill = { bd: string; bg: string; fg: string };

/** pill(on): chip de filtro del Handoff — activo ink/blanco, inactivo control/dim. */
export function pill(on: boolean): Pill {
  return on ? { bd: C.ink, bg: C.ink, fg: C.onInk } : { bd: C.ctl, bg: C.ctl, fg: C.dim };
}

/** Color del icono y la etiqueta de la pestaña activa (barra hi-fi del Handoff, spec D2). */
export const TAB_TINT = { markets: "#3F6B00", agents: "#5B3CE0", portfolio: "#8A6200", wallet: "#C62C62" } as const;

/** Acento de la matriz nivel × horizonte: violeta en Ask, tinte lima en Trade (estados del board del Handoff). */
export type GridAccent = { fg: string; on: string; soft: string };
export const GRID_ACCENT: Record<"ask" | "trade", GridAccent> = {
  ask: { fg: C.vio, on: "rgba(91,60,224,0.18)", soft: "rgba(91,60,224,0.06)" },
  trade: { fg: C.limeInk, on: "#EDF7CE", soft: "#F3F8E0" },
};
/** Punto de una celda con reads ("Violet, always") y regla del mark (banda ink del board). */
export const GRID_DOT = C.agentDot;
export const GRID_MARK_RULE = C.ink;
```

- [ ] **Step 4: Fuentes, StatusBar y fondos nativos**

En `App.tsx`, reemplaza los imports de Chakra Petch y Manrope y el `useFonts` por:
```ts
import { InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold } from "@expo-google-fonts/instrument-sans";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
// …
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular, InstrumentSans_500Medium, InstrumentSans_600SemiBold, InstrumentSans_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    "ArchivoPickler-Bold": require("./assets/fonts/ArchivoPickler-Bold.ttf"),
  });
```
y `<StatusBar barStyle="light-content" />` por `<StatusBar barStyle="dark-content" />`.

En `app.config.ts`, cambia `userInterfaceStyle: "dark"` por `"light"` y los tres `"#05061A"` (raíz, `ios.backgroundColor` y el splash) por `"#FFFFFF"`.

En `src/navigation/Navigator.tsx` cambia los dos `C.bgBottom` por `C.bg`; en `src/ui/TabBar.tsx` y `src/ui/Page.tsx`, cada `C.bgBottom` por `C.bg`. En `Page.tsx` el `Backdrop` usa `C.bgTop/bgMid/bgBottom`: **borra la función `Backdrop`** y su uso `<Backdrop />`, y quita los imports que queden sin uso (`LinearGradient`, `Svg`, `Circle`, `Defs`, `Pattern`, `Rect`, `StyleSheet` si ya no se usa). En `src/DevControls.tsx` cambia `C.bgMid` por `C.bg`.

- [ ] **Step 5: Sacar las fuentes viejas**

```bash
grep -rn "chakra-petch\|manrope\|ChakraPetch\|Manrope" src App.tsx __tests__ || echo SIN_CONSUMIDORES
npm uninstall @expo-google-fonts/chakra-petch @expo-google-fonts/manrope
```
Expected: `SIN_CONSUMIDORES` antes de desinstalar. `expo-linear-gradient` se queda: `grep -rn LinearGradient src` puede seguir listando consumidores; si no hay ninguno, desinstálalo también y anótalo en el audit.

- [ ] **Step 6: Reasignar la lima y el `down` según su uso (regla de Global Constraints)**

Lista los usos:
```bash
grep -rn "C\.lime\b" src | grep -v "src/ui/theme.ts"
grep -rn "C\.down\b" src | grep -v "src/ui/theme.ts"
grep -rn "C\.vioSolid\|C\.onDeep" src | grep -v "src/ui/theme.ts"
```
Aplica esta regla a cada línea:
- `C.lime` como **relleno** (`bg:`, `backgroundColor`, `variant: lime`, `tone` del segmento Long) se queda.
- `C.lime` como **texto, icono, borde o `ActivityIndicator`** (`fg:`, `color=`, `color:`, `tintColor=`, `Tag color`, `LEVEL.fg`, `TONES.*.fg`, `CONNECTION.live.fg`, `STATUS.right.fg`) pasa a `C.limeInk`.
- `C.down` como **relleno** (el segmento Short: `tone={(k) => ({ bg: k === "long" ? C.lime : C.down, … })}` en `market.tsx`) pasa a `C.short`. Como texto se queda.
- `C.onLime` en ese mismo `tone` sigue valiendo (ahora es ink).

Después revisa **a mano** cada línea que quede de:
```bash
grep -rn "C\.lime\b" src | grep -v "src/ui/theme.ts"
```
Cada una debe ser un relleno (`bg`, `backgroundColor`, `variant`, `tone.bg`). Los ternarios (`color={x ? C.lime : …}`) y los `vFg={C.lime}` también cuentan: pásalos a `C.limeInk`, o a `C.limeOnInk` si el fondo es ink. Pega la lista revisada en el audit.

- [ ] **Step 7: Correr tests y tipos**

```bash
npx jest __tests__/theme.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: theme PASS, suite completa en verde (mismo N de Task 0) y `TSC_OK`. `tsc` señala cualquier `C.bgTop` o `C.cyan` que quede: corrígelo con `C.bg` o `C.blue`.

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/ui/theme.ts apps/mobile/__tests__/theme.test.ts apps/mobile/App.tsx apps/mobile/app.config.ts apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/ui/Page.tsx apps/mobile/src/ui/TabBar.tsx apps/mobile/src/DevControls.tsx apps/mobile/package.json apps/mobile/package-lock.json
git add $(git diff --name-only -- apps/mobile/src/screens)
git commit -m "feat(mobile): tokens y fuentes del sistema light del Handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(El segundo `git add` agrega por nombre sólo las pantallas que el Step 6 tocó; revisa la lista con `git status --short` antes de commitear.)

---

### Task 2: Primitivas re-vestidas (D5, D6)

**Files:**
- Create: `apps/mobile/src/ui/variants.ts`, `apps/mobile/__tests__/variants.test.ts`
- Modify: `apps/mobile/src/ui/primitives.tsx`

**Interfaces:**
- Consumes: `C` de Task 1.
- Produces: `BTN_VARIANTS: Record<BtnVariant, { bg: string; bd: string; fg: string; w: number }>` y `type BtnVariant` en `ui/variants.ts`. Las variantes nuevas son `"ink" | "ask" | "tile"`; las viejas se conservan. En `primitives.tsx`: `Btn` con radio pill, `InkBlock({ children, pad?, gap?, style? })`, `InkTile({ children, style? })`, `SearchBox({ value, onChange, placeholder, accessibilityLabel })` e iconos nuevos `grid`, `user`, `ask`, `down`, `up`, `external`, `faceId`. Las firmas de `Card`, `TouchCard`, `Chip`, `Segmented`, `Tag`, `KV`, `Warn`, `StatusCard`, `Page`, `Avatar`, `Skeleton` y `Reveal` no cambian.

- [ ] **Step 1: Test de la tabla de variantes**

`__tests__/variants.test.ts`:
```ts
import { BTN_VARIANTS } from "../src/ui/variants";
import { C } from "../src/ui/theme";

test("primary is lime with ink text; ink is the dark CTA; ask is the violet tint", () => {
  expect(BTN_VARIANTS.lime).toEqual({ bg: C.lime, bd: C.lime, fg: C.ink, w: 600 });
  expect(BTN_VARIANTS.ink).toEqual({ bg: C.ink, bd: C.ink, fg: C.onInk, w: 600 });
  expect(BTN_VARIANTS.ask).toEqual({ bg: C.vioBg, bd: C.vioBg, fg: C.vio, w: 600 });
  expect(BTN_VARIANTS.tile).toEqual({ bg: C.tile, bd: C.tile, fg: C.onInk, w: 600 });
});

test("the old outline variants become control fills (the Handoff has no hairline buttons)", () => {
  for (const v of ["outline", "outline2", "outline20"] as const) expect(BTN_VARIANTS[v]).toEqual({ bg: C.ctl, bd: C.ctl, fg: C.ink, w: 600 });
  expect(BTN_VARIANTS.violetSoft).toEqual(BTN_VARIANTS.ask);
  expect(BTN_VARIANTS.violetSoft10).toEqual(BTN_VARIANTS.ask);
});

test("no variant paints lime text", () => {
  for (const v of Object.values(BTN_VARIANTS)) expect(v.fg).not.toBe(C.lime);
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npx jest __tests__/variants.test.ts`
Expected: FAIL (`Cannot find module '../src/ui/variants'`).

- [ ] **Step 3: `src/ui/variants.ts`**

```ts
import { C } from "./theme";

// Variantes de Btn (spec mobile-light D6). Pura para poder testearla sin react-native.
export type BtnVariant =
  | "lime" | "ink" | "ask" | "tile"
  | "outline" | "outline2" | "outline20" | "violet" | "violetSoft" | "violetSoft10" | "violetLine" | "violetLine45" | "ghost" | "dashed";

type V = { bg: string; bd: string; fg: string; w: number };
const CTL: V = { bg: C.ctl, bd: C.ctl, fg: C.ink, w: 600 };
const ASK: V = { bg: C.vioBg, bd: C.vioBg, fg: C.vio, w: 600 };

export const BTN_VARIANTS: Record<BtnVariant, V> = {
  lime: { bg: C.lime, bd: C.lime, fg: C.ink, w: 600 },
  ink: { bg: C.ink, bd: C.ink, fg: C.onInk, w: 600 },
  ask: ASK,
  tile: { bg: C.tile, bd: C.tile, fg: C.onInk, w: 600 },
  outline: CTL,
  outline2: CTL,
  outline20: CTL,
  violet: { bg: C.vioSolid, bd: C.vioSolid, fg: C.onInk, w: 600 },
  violetSoft: ASK,
  violetSoft10: ASK,
  violetLine: { bg: "transparent", bd: C.vioBd, fg: C.vio, w: 600 },
  violetLine45: { bg: "transparent", bd: C.vioBd45, fg: C.vio, w: 600 },
  ghost: { bg: "transparent", bd: "transparent", fg: C.dim, w: 600 },
  dashed: { bg: "transparent", bd: C.hair22, fg: C.faint, w: 500 },
};
```

- [ ] **Step 4: Re-vestir `primitives.tsx`**

Cambios exactos (el resto del archivo no se toca):

1. Imports de lucide: agrega `ArrowDown, ArrowUp, ExternalLink, LayoutGrid, MessageCircle, ScanFace, User` y amplía `ICONS`:
```ts
const ICONS = {
  back: ArrowLeft, arrow: ArrowRight, search: Search, send: Send, sliders: SlidersHorizontal, help: CircleQuestionMark,
  chart: ChartLine, rocket: Rocket, activity: Activity, layers: Layers, wallet: Wallet,
  grid: LayoutGrid, user: User, ask: MessageCircle, down: ArrowDown, up: ArrowUp, external: ExternalLink, faceId: ScanFace,
} as const;
```
y el `strokeWidth` por defecto de `Icon` a `1.9`.

2. `Tag`: `s = 10`, mismo resto (mono 500, `ls 0.1`, `C.faint`).

3. `Card` y `TouchCard`: por defecto `bd = "transparent"`, `bg = C.card`, `radius = 20`, `pad = 16`. `borderWidth` sigue siendo 1, así que un `bd` explícito se pinta.

4. `KV`: `k` mono 500 10.5 `C.faint`; `v` mono 700 12.5 con `vFg`.

5. `Hair`: `backgroundColor: C.hair06`.

6. `Chip`: por defecto `fg = C.dim`, `bd = C.ctl`, `bg = C.ctl`, `py = 8`, `px = 13`. Sin otros cambios.

7. `Avatar`: sin borde, `backgroundColor: C.vioBg10`, texto `C.vio`, `radius = 12`.

8. `Btn`: borra la tabla `VARIANTS` **y la declaración `export type BtnVariant = …` actual** (`primitives.tsx:133`; si no, el identificador queda duplicado) y usa la de `variants.ts`:
```ts
import { BTN_VARIANTS, type BtnVariant } from "./variants";
export type { BtnVariant } from "./variants";
// …
export function Btn({ label, onPress, variant = "outline", arrow, icon, s = 15, py = 14, style, disabled, fg, bd, flex, busy, accessibilityLabel }: BtnProps) {
  const v = BTN_VARIANTS[variant];
  const color = fg ?? v.fg;
  return (
    <Touch
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel}
      style={[{
        flex, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
        paddingVertical: py, paddingHorizontal: 18, borderRadius: 999,
        borderWidth: 1, borderColor: bd ?? v.bd, backgroundColor: v.bg,
        borderStyle: variant === "dashed" ? "dashed" : "solid",
        opacity: disabled ? 0.45 : busy ? 0.8 : 1,
      }, style]}
    >
      {icon ? <Icon name={icon} size={16} color={color} /> : null}
      <T w={v.w} s={s} lh={1} mono={variant === "dashed"} color={color}>{label}</T>
      {arrow ? <Icon name="arrow" size={15} color={color} /> : null}
    </Touch>
  );
}
```

9. `Segmented`: contenedor `{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 999, backgroundColor: C.ctl }` (sin borde). El activo sin `tone` es `{ bg: C.ink, fg: C.onInk }` y el inactivo `{ bg: "transparent", fg: C.dim }`. Texto `w={600} s={13}` y `paddingVertical: 10`.

10. `PillTabs` **se conserva en esta tarea**: `market.tsx` todavía la usa. Task 10 la cambia por `Segmented` y la borra de este archivo.

11. `Sparkline`: `stroke = C.spark`, `strokeWidth={1.6}`.

12. `Bar`: `h = 8`, pista `C.empty`, `color = C.limeInk`.

13. `Warn`: `<Card bd="transparent" bg={C.warnBg} pad={14} radius={16} gap={6}>` con título `color={C.warn}`.

14. `StatusCard`: `radius={20}`; el título grande es `display` de 20 px, igual que hoy.

15. `Page` (el primitivo): `paddingHorizontal: 18`.

16. `StatGrid`: celdas con `backgroundColor: C.card`, borde `C.hair06` y radio 16.

17. `EmptyPanel`: borde `C.hair22` punteado, radio 20.

18. `SkeletonBlock`: `backgroundColor: C.empty`.

19. Primitivas nuevas, al final de la sección "Superficies":
```tsx
/** Bloque oscuro del Handoff (TOTAL VALUE, AVAILABLE, CALIBRATION): ink, radio 22. */
export function InkBlock({ children, pad = 18, gap, style }: { children?: ReactNode; pad?: number; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: C.ink, borderRadius: 22, padding: pad, gap }, style]}>{children}</View>;
}

/** Baldosa interna de un InkBlock: #15182A, radio 14. */
export function InkTile({ children, style }: { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ backgroundColor: C.tile, borderRadius: 14, padding: 12, flex: 1 }, style]}>{children}</View>;
}

/** Buscador del Handoff: pill de control con lupa. */
export function SearchBox({ value, onChange, placeholder, accessibilityLabel }: { value: string; onChange: (v: string) => void; placeholder: string; accessibilityLabel: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.ctl }}>
      <Icon name="search" size={16} color={C.faint} />
      <TextInput
        value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={C.faint}
        autoCapitalize="none" autoCorrect={false} accessibilityLabel={accessibilityLabel}
        style={[textStyle(400, 15, { color: C.ink }), { flex: 1, paddingVertical: 12 }]}
      />
    </View>
  );
}
```
(agrega `TextInput` al import de `react-native`).

- [ ] **Step 5: Tests y tipos**

```bash
npx jest __tests__/variants.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: PASS, verde y `TSC_OK`.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/ui/variants.ts apps/mobile/__tests__/variants.test.ts apps/mobile/src/ui/primitives.tsx
git commit -m "feat(mobile): primitivas del Handoff (pill, InkBlock, SearchBox, variantes)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Navegación — 4 pestañas visibles, pilas nuevas y destino de los pushes (D1, D13, D19, D22, D23)

**Files:**
- Modify: `src/navigation/screens.ts`, `src/navigation/routes.ts`, `src/navigation/Navigator.tsx`, `src/store.ts`, `src/reads/push.ts`, `src/screens/comingSoonCopy.ts`, `src/screens/comingSoon.tsx`, `App.tsx`
- Test: `__tests__/routes.test.ts`, `__tests__/store.test.ts`, `__tests__/comingSoon.test.ts`, `__tests__/reads-push.test.ts`

**Interfaces:**
- Produces:
  - `Screen` suma `"agents" | "agent" | "read"`.
  - `TabName` suma `"AgentsTab"`.
  - `TAB_ORDER` = las 4 visibles y `ALL_TABS` = las 6 registradas.
  - `StoreState.marketTab: "trade" | "ask"`; `StoreState.readId?: string` (reemplaza `askFocusReadId`); sale `askView`; `StoreState.agentId?: string` (perfil, F2).
  - `pushTarget(t: PushTarget): { screen: Screen; patch: Patch }` en `reads/push.ts` (reemplaza `patchForPush`).
  - `askMarketId(current: number | undefined, markets: readonly { id: number; symbol: string }[]): number | undefined` en `store.ts`.

Temporal hasta sus tareas: `agents`, `portfolio` y `read` se registran con componentes provisionales (`AgentsTab` actual y `ComingSoonScreen`) que Tasks 11–13 reemplazan.

- [ ] **Step 1: Tests de rutas y store**

En `__tests__/routes.test.ts` reemplaza el primer test por:
```ts
test("every screen except signin belongs to exactly one tab; only four tabs are visible (D1)", () => {
  const screens = SCREENS_ALL.filter((s) => s !== "signin");
  expect(screens).toHaveLength(12);
  for (const s of screens) {
    const tab = TAB_OF[s as Exclude<Screen, "signin">];
    expect(ALL_TABS).toContain(tab);
    expect(ROOT_OF[s]).toBe(TAB_ROOT[tab]);
  }
  expect(TAB_ORDER).toEqual(["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab"]);
  expect(ALL_TABS).toEqual(["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab", "LaunchpadTab", "ActivityTab"]);
  expect(TAB_OF.perpsFunds).toBe("WalletTab");
  expect(TAB_OF.read).toBe("PortfolioTab");
  expect(TAB_OF.agent).toBe("AgentsTab");
});
```
agrega `ALL_TABS` al import y cambia el caso del gate:
```ts
  expect(gateTarget(false, "agents")).toEqual({ screen: "agents" }); // la lista es pública (D23)
  expect(gateTarget(false, "agent")).toEqual({ screen: "signin", next: "agent" });
```

En `__tests__/store.test.ts`:
- Cambia el import quitando `marketEntryTab` y agregando `askMarketId`.
- Reemplaza el test "the screen sets of D5…" por:
```ts
test("the screen sets of the light redesign (D1, D23)", () => {
  expect([...COMING_SOON]).toEqual(["launchpad", "activity"]);
  expect([...GATED]).toEqual(["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "portfolio", "read", "agent"]);
  expect([...CAN_BACK]).toEqual(["market", "perpsFunds", "deposit", "withdraw", "signin", "agent", "read"]);
  expect([...SHOW_TABS]).toEqual(["markets", "agents", "portfolio", "wallet", "launchpad", "activity"]);
});
```
- En "every screen maps…" cambia `expect(ROOT_OF.perpsFunds).toBe("markets")` por `expect(ROOT_OF.perpsFunds).toBe("wallet")` y agrega `expect(ROOT_OF.read).toBe("portfolio"); expect(ROOT_OF.agent).toBe("agents");`.
- Reemplaza el test "headers" por:
```ts
test("headers", () => {
  expect(headerFor("markets")).toEqual(["Markets", ""]);
  expect(headerFor("agents")).toEqual(["Agents", ""]);
  expect(headerFor("portfolio")).toEqual(["Portfolio", ""]);
  expect(headerFor("wallet")).toEqual(["Wallet", ""]);
  expect(headerFor("market", "BTC")).toEqual(["BTC-PERP", "Perpl · isolated margin"]);
  expect(headerFor("market")).toEqual(["PERP", "Perpl · isolated margin"]);
  expect(headerFor("perpsFunds")).toEqual(["Trading funds", "Between wallet and trading"]);
  expect(headerFor("deposit")).toEqual(["Deposit", "AUSD · Monad testnet"]);
  expect(headerFor("withdraw")).toEqual(["Withdraw", "AUSD to an external address"]);
  expect(headerFor("read")).toEqual(["Read", ""]);
  expect(headerFor("agent")).toEqual(["Agent", ""]);
  expect(headerFor("signin")).toEqual(["Pickler", ""]);
});
```
- Borra los tests "Ask state: New read by default…", "the Market header subtitle follows the pill (D13)" y "a market opens on Trade with a trading key…", y agrega:
```ts
test("INITIAL opens Market on Trade; sign out clears Ask and the focused read", () => {
  expect(INITIAL).toEqual({ marketTab: "trade" });
  const s = signedOutState({ marketTab: "ask", askCell: { levelBps: 50, horizonMin: 60 }, askAgentId: "drift", readId: "r1", agentId: "drift" });
  expect(s).toEqual({ marketTab: "ask", askCell: undefined, askAgentId: undefined, readId: undefined, agentId: undefined, tradeLevel: undefined });
});

test("askMarketId keeps the last market, else BTC, else the first listed", () => {
  const mk = [{ id: 7, symbol: "MON" }, { id: 1, symbol: "BTC" }];
  expect(askMarketId(7, mk)).toBe(7);
  expect(askMarketId(99, mk)).toBe(1); // ya no listado → BTC
  expect(askMarketId(undefined, mk)).toBe(1);
  expect(askMarketId(undefined, [{ id: 3, symbol: "ETH" }])).toBe(3);
  expect(askMarketId(undefined, [])).toBeUndefined();
});
```
y borra el viejo "signedOutState clears the Ask state…" (queda cubierto arriba). Agrega a `heldActionFor`:
```ts
  expect(heldActionFor("portfolio")).toBe("Your portfolio");
  expect(heldActionFor("read")).toBe("A read");
  expect(heldActionFor("agent")).toBe("An agent's record");
```

`__tests__/comingSoon.test.ts`, primer test:
```ts
test("launchpad and activity stay as coming-soon screens, hidden from the tab bar (D1)", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.launchpad).toEqual({ icon: "rocket", title: "Launchpad", copy: "Agents with a token" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "activity", title: "Activity", copy: "What the agents you follow are doing" });
  expect((COMING_SOON_COPY as Record<string, unknown>).portfolio).toBeUndefined();
});
```

`__tests__/reads-push.test.ts`: reemplaza los casos de `patchForPush` por:
```ts
test("a read push opens the Read screen on that read; a reminder opens Market on Trade (D22)", () => {
  expect(pushTarget({ kind: "read", readId: "r1", marketId: 3 })).toEqual({ screen: "read", patch: { readId: "r1", perpsMarketId: 3 } });
  expect(pushTarget({ kind: "reminder", reminderId: "m1", marketId: 3, readId: null })).toEqual({ screen: "market", patch: { perpsMarketId: 3, marketTab: "trade" } });
});
```
(lee el archivo primero: conserva los tests de parseo del payload y cambia el import de `patchForPush` a `pushTarget`. El literal debe cumplir el tipo `PushTarget` de `src/reads/push.ts:7-9`, porque `tsc` también revisa `__tests__`. Comprueba sus campos con `sed -n 1,12p src/reads/push.ts` y ajusta el literal de `read` igual.)

- [ ] **Step 2: Verlos fallar**

Run: `npx jest __tests__/routes.test.ts __tests__/store.test.ts __tests__/comingSoon.test.ts __tests__/reads-push.test.ts`
Expected: FAIL (tipos y valores viejos).

- [ ] **Step 3: `navigation/screens.ts`**

```ts
export type Screen =
  | "markets" | "market"
  | "agents" | "agent"
  | "portfolio" | "read"
  | "wallet" | "deposit" | "withdraw" | "perpsFunds"
  | "launchpad" | "activity" | "signin";

/** Pantallas que exigen cuenta (D23). La lista de Agents es pública; los coming soon nunca la piden. */
export const GATED: readonly Screen[] = ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw", "portfolio", "read", "agent"];
export const CAN_BACK: readonly Screen[] = ["market", "perpsFunds", "deposit", "withdraw", "signin", "agent", "read"];
/** Raíces con tab bar: las 4 visibles y las 2 ocultas (Launchpad y Activity siguen siendo raíces de su pestaña, D1). */
export const SHOW_TABS: readonly Screen[] = ["markets", "agents", "portfolio", "wallet", "launchpad", "activity"];
/** Qué tab se ilumina en cada pantalla. */
export const ROOT_OF: Record<Screen, Screen> = {
  markets: "markets", market: "markets",
  agents: "agents", agent: "agents",
  portfolio: "portfolio", read: "portfolio",
  wallet: "wallet", deposit: "wallet", withdraw: "wallet", perpsFunds: "wallet",
  launchpad: "launchpad", activity: "activity", signin: "wallet",
};
```

- [ ] **Step 4: `navigation/routes.ts`**

```ts
export type TabName = "MarketsTab" | "AgentsTab" | "PortfolioTab" | "WalletTab" | "LaunchpadTab" | "ActivityTab";

export type SigninParams = { next?: Screen; patch?: Patch } | undefined;

export type MarketsStackParamList = { markets: undefined; market: undefined };
export type AgentsStackParamList = { agents: undefined; agent: undefined };
export type PortfolioStackParamList = { portfolio: undefined; read: undefined };
export type WalletStackParamList = { wallet: undefined; deposit: undefined; withdraw: undefined; perpsFunds: undefined };
export type SoloStackParamList<K extends string> = Record<K, undefined>;
export type TabParamList = {
  MarketsTab: NavigatorScreenParams<MarketsStackParamList> | undefined;
  AgentsTab: NavigatorScreenParams<AgentsStackParamList> | undefined;
  PortfolioTab: NavigatorScreenParams<PortfolioStackParamList> | undefined;
  WalletTab: NavigatorScreenParams<WalletStackParamList> | undefined;
  LaunchpadTab: NavigatorScreenParams<SoloStackParamList<"launchpad">> | undefined;
  ActivityTab: NavigatorScreenParams<SoloStackParamList<"activity">> | undefined;
};
export type RootParamList = { Tabs: NavigatorScreenParams<TabParamList> | undefined; signin: SigninParams };

/** Pestañas pintadas en la barra (D1/D2). */
export const TAB_ORDER: readonly TabName[] = ["MarketsTab", "AgentsTab", "PortfolioTab", "WalletTab"];
/** Todas las registradas: Launchpad y Activity se integran después, fuera de la barra (D1). */
export const ALL_TABS: readonly TabName[] = [...TAB_ORDER, "LaunchpadTab", "ActivityTab"];

export const TAB_OF: Record<Exclude<Screen, "signin">, TabName> = {
  markets: "MarketsTab", market: "MarketsTab",
  agents: "AgentsTab", agent: "AgentsTab",
  portfolio: "PortfolioTab", read: "PortfolioTab",
  wallet: "WalletTab", deposit: "WalletTab", withdraw: "WalletTab", perpsFunds: "WalletTab",
  launchpad: "LaunchpadTab", activity: "ActivityTab",
};

export const TAB_ROOT: Record<TabName, Screen> = {
  MarketsTab: "markets", AgentsTab: "agents", PortfolioTab: "portfolio", WalletTab: "wallet", LaunchpadTab: "launchpad", ActivityTab: "activity",
};

export const SCREENS_ALL: readonly Screen[] = [
  "markets", "market", "agents", "agent", "portfolio", "read", "wallet", "deposit", "withdraw", "perpsFunds", "launchpad", "activity", "signin",
];
```
(`screenOfRoute` y `gateTarget` no cambian).

- [ ] **Step 5: `store.ts`**

Cambios:
```ts
export type MarketTab = "trade" | "ask";
export type AskCell = { levelBps: number; horizonMin: number };
export type TradeLevel = { marketId: number; levelBps: number; horizonMin: number; target: number; expiresAt: string; readId?: string };

export type StoreState = {
  perpsMarketId?: number;
  perpsSide?: "long" | "short";
  marketTab: MarketTab;
  fundsMode?: "add" | "withdraw";
  /** Ask: celda armada y agente elegido. */
  askCell?: AskCell;
  askAgentId?: string;
  /** Read abierta en la pantalla `read` (Portfolio → Reads, récord del perfil o push, D14/D22). */
  readId?: string;
  /** Perfil abierto en `agent` (F2). */
  agentId?: string;
  tradeLevel?: TradeLevel;
};

export const INITIAL: StoreState = { marketTab: "trade" };

/** Launchpad y Activity: pantallas coming soon registradas, fuera de la barra (D1). */
export const COMING_SOON: readonly ComingSoonTab[] = ["launchpad", "activity"];

export const REFRESHABLE: readonly Screen[] = ["wallet", "markets", "market", "portfolio"];

export function signedOutState(s: StoreState): StoreState {
  return { ...s, askCell: undefined, askAgentId: undefined, readId: undefined, agentId: undefined, tradeLevel: undefined };
}

export function heldActionFor(next: Screen | undefined): string | null {
  switch (next) {
    case "markets": case "market": return "Trading on Perpl";
    case "perpsFunds": return "Moving trading funds";
    case "deposit": return "A deposit";
    case "withdraw": return "A withdrawal";
    case "portfolio": return "Your portfolio";
    case "read": return "A read";
    case "agent": return "An agent's record";
    default: return null;
  }
}

/** Mercado en el que "Ask" abre Market (D13): el último usado si sigue listado; si no, BTC; si no, el primero. */
export function askMarketId(current: number | undefined, markets: readonly { id: number; symbol: string }[]): number | undefined {
  if (current !== undefined && markets.some((m) => m.id === current)) return current;
  return (markets.find((m) => m.symbol === "BTC") ?? markets[0])?.id;
}

export function headerFor(screen: Screen, perpsSymbol?: string): [string, string] {
  switch (screen) {
    case "markets": return ["Markets", ""];
    case "agents": return ["Agents", ""];
    case "portfolio": return ["Portfolio", ""];
    case "wallet": return ["Wallet", ""];
    case "market": return [perpsSymbol ? `${perpsSymbol}-PERP` : "PERP", "Perpl · isolated margin"];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
    case "deposit": return ["Deposit", "AUSD · Monad testnet"];
    case "withdraw": return ["Withdraw", "AUSD to an external address"];
    case "read": return ["Read", ""];
    case "agent": return ["Agent", ""];
    case "signin": return ["Pickler", ""];
    case "launchpad": case "activity": return [COMING_SOON_COPY[screen].title, "Coming soon"];
  }
}
```
Borra `AskView`, `MARKET_SUBTITLES` y `marketEntryTab`. En `refreshOk` agrega `case "portfolio":` junto a `"market"` (misma regla: `!e.contextError || (e.listError !== null && !e.listError)`), y en `screenHasData` `case "portfolio":` junto a `"markets"` (`d.context !== null`). Agents no es refrescable en F1: la lista se recarga con el polling de 15 s (D26). `Page.tsx` llama `headerFor(screen, perpsSymbol, S.marketTab)`: quita el tercer argumento.

- [ ] **Step 6: `reads/push.ts`**

Reemplaza `patchForPush` por:
```ts
/** Destino del tap en un push (D22): la read abre su pantalla; el recordatorio abre Trade sin nivel (el payload no trae target). */
export function pushTarget(t: PushTarget): { screen: Screen; patch: Patch } {
  return t.kind === "read"
    ? { screen: "read", patch: { readId: t.readId, perpsMarketId: t.marketId } }
    : { screen: "market", patch: { perpsMarketId: t.marketId, marketTab: "trade" } };
}
```
(importa `Screen` de `../navigation/screens`). En `App.tsx` cambia las dos llamadas `requireAccount("market", patchForPush(t))` por:
```ts
const { screen, patch } = pushTarget(t);
requireAccount(screen, patch);
```

- [ ] **Step 7: Coming soon sin Portfolio**

`comingSoonCopy.ts`:
```ts
/** Launchpad y Activity: se integran después (spec mobile-light D1); hoy son pantallas registradas fuera de la barra. */
export type ComingSoonTab = "launchpad" | "activity";
// …
export const COMING_SOON_COPY: Record<ComingSoonTab, ComingSoonCopy> = {
  launchpad: { icon: "rocket", title: "Launchpad", copy: "Agents with a token" },
  activity: { icon: "activity", title: "Activity", copy: "What the agents you follow are doing" },
};
```
`comingSoon.tsx` no cambia su lógica; el icono va en `C.vio` sobre `C.vioBg` sin borde.

- [ ] **Step 8: `Navigator.tsx`**

Registra las pilas nuevas (componentes provisionales marcados):
```tsx
const AgentsStack = createNativeStackNavigator<AgentsStackParamList>();
const PortfolioStack = createNativeStackNavigator<PortfolioStackParamList>();
// Provisionales hasta Tasks 11–13:
const AgentsList = withPage("agents", AgentsTab);            // screens/agents.tsx (Task 11 la reescribe)
const AgentProfile = withPage("agent", AgentsTab);           // F2: perfil
const Portfolio = withPage("portfolio", PortfolioScreen);    // Task 12 crea screens/portfolio.tsx; hasta entonces un stub que devuelve <Page><T>Portfolio</T></Page>
const ReadView = withPage("read", ReadScreen);               // Task 13 crea screens/read.tsx; mismo stub

function MarketsTab() {
  return (
    <MarketsStack.Navigator screenOptions={STACK}>
      <MarketsStack.Screen name="markets" component={Markets} />
      <MarketsStack.Screen name="market" component={Market} />
    </MarketsStack.Navigator>
  );
}
function AgentsTabNav() {
  return (
    <AgentsStack.Navigator screenOptions={STACK}>
      <AgentsStack.Screen name="agents" component={AgentsList} />
      <AgentsStack.Screen name="agent" component={AgentProfile} />
    </AgentsStack.Navigator>
  );
}
function PortfolioTabNav() {
  return (
    <PortfolioStack.Navigator screenOptions={STACK}>
      <PortfolioStack.Screen name="portfolio" component={Portfolio} />
      <PortfolioStack.Screen name="read" component={ReadView} />
    </PortfolioStack.Navigator>
  );
}
function WalletTab() {
  return (
    <WalletStack.Navigator screenOptions={STACK}>
      <WalletStack.Screen name="wallet" component={Wallet} />
      <WalletStack.Screen name="deposit" component={Deposit} />
      <WalletStack.Screen name="withdraw" component={Withdraw} />
      <WalletStack.Screen name="perpsFunds" component={PerpsFunds} />
    </WalletStack.Navigator>
  );
}
```
El orden de `Tabs.Screen` es el de `ALL_TABS`: Markets, Agents, Portfolio, Wallet, Launchpad y Activity. Borra el `Portfolio` de coming soon. Crea los stubs `src/screens/portfolio.tsx` y `src/screens/read.tsx` con:
```tsx
import type { AppCtx } from "../ctx";
import { Page, T } from "../ui/primitives";
export function PortfolioScreen(_ctx: AppCtx) { return <Page><T>Portfolio</T></Page>; }
```
(y `ReadScreen` igual). `AgentsTab` de `screens/agents.tsx` sigue como está.

- [ ] **Step 9: Tests y tipos**

```bash
npx jest __tests__/routes.test.ts __tests__/store.test.ts __tests__/comingSoon.test.ts __tests__/reads-push.test.ts __tests__/navigation.test.ts
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
```
Expected: PASS. `tsc` va a señalar cada uso de `askView`, `askFocusReadId`, `marketTab === "agents"`, `marketEntryTab` y `patchForPush`. Corrígelos así:
- `agents.tsx` → `set({ askAgentId: a.id, marketTab: "ask" })`.
- `ask.tsx` → deja **sólo** la rama `newRead()`: borra `myReads`, `ReadRow`, el `Segmented` New/My reads y `focused`. La lista vive en Portfolio (Task 12).
- `market.tsx` → las PillTabs pasan a `[["trade","Trade it"],["ask","Ask an agent"]]`; Task 10 las cambia por `Segmented`.
- `markets.tsx` → `nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: "trade" })`.

**Aviso:** entre esta tarea y Task 4 la app **no abre**. La barra vieja hace `TABS.find(...)!` y no conoce "agents". Tests y `tsc` quedan verdes. No lances el simulador hasta cerrar Task 4.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/navigation/screens.ts apps/mobile/src/navigation/routes.ts apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/store.ts apps/mobile/src/reads/push.ts apps/mobile/src/screens/comingSoonCopy.ts apps/mobile/src/screens/comingSoon.tsx apps/mobile/src/screens/portfolio.tsx apps/mobile/src/screens/read.tsx apps/mobile/src/screens/agents.tsx apps/mobile/src/screens/ask.tsx apps/mobile/src/screens/market.tsx apps/mobile/src/screens/markets.tsx apps/mobile/src/ui/Page.tsx apps/mobile/App.tsx apps/mobile/__tests__/routes.test.ts apps/mobile/__tests__/store.test.ts apps/mobile/__tests__/comingSoon.test.ts apps/mobile/__tests__/reads-push.test.ts
git commit -m "feat(mobile): 4 pestañas, pilas de Agents/Portfolio y destino de los pushes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Tab bar de 4 botones fijos (D2)

**Files:**
- Rewrite: `src/ui/TabBar.tsx`, `src/ui/tabBarLayout.ts`, `__tests__/tabBarLayout.test.ts`

**Interfaces:**
- Consumes: `TAB_ORDER`, `TAB_ROOT` (Task 3), `TAB_TINT` (Task 1).
- Produces: `tabBarHeight(insetBottom: number): number` (sigue siendo el alto que usa Page), `ROW_TOP`, `ROW_H`, `ROW_BOTTOM`. Salen `itemWidth`, `tabIndexAt`, `pillX`, `pillWidth`, `TAB_COUNT` y `PILL_INSET`.

- [ ] **Step 1: Test**

`__tests__/tabBarLayout.test.ts`:
```ts
import { ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight } from "../src/ui/tabBarLayout";

test("the bar is 8 + 54 + inset + 8: icon 19, gap 5, label 10.5 and 10 pt of padding on each side", () => {
  expect([ROW_TOP, ROW_H, ROW_BOTTOM]).toEqual([8, 54, 8]);
  expect(tabBarHeight(0)).toBe(70);
  expect(tabBarHeight(34)).toBe(104);
});
```

- [ ] **Step 2: Verlo fallar**

Run: `npx jest __tests__/tabBarLayout.test.ts`
Expected: FAIL (`ROW_H` es 45).

- [ ] **Step 3: `tabBarLayout.ts`**

```ts
// Geometría de la tab bar del Handoff (spec mobile-light D2). Puro, para testearlo.
// La fila mide ROW_TOP + ROW_H y se apoya sobre insetBottom + ROW_BOTTOM.
export const ROW_TOP = 8;
/** 10 + icono 19 + gap 5 + etiqueta ~10 + 10. */
export const ROW_H = 54;
export const ROW_BOTTOM = 8;

/** Alto total de la barra (paddingBottom de las raíces y translateY al esconderla). */
export function tabBarHeight(insetBottom: number): number {
  return ROW_TOP + ROW_H + insetBottom + ROW_BOTTOM;
}
```

- [ ] **Step 4: `TabBar.tsx`**

```tsx
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { getFocusedRouteNameFromRoute } from "@react-navigation/native";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useAppCtx } from "../navigation/context";
import { type TabName, TAB_ORDER, TAB_ROOT } from "../navigation/routes";
import { ROOT_OF, type Screen, SHOW_TABS } from "../store";
import { Icon, type IconName, T, Touch } from "./primitives";
import { ROW_BOTTOM, ROW_H, ROW_TOP, tabBarHeight } from "./tabBarLayout";
import { C, TAB_TINT } from "./theme";

/** Pestañas visibles del Handoff (D2): clave, etiqueta mono, icono lucide. Iconos del Handoff (grid · user · chart · wallet); D1 del spec quedó corregido. */
export const TABS: Record<"markets" | "agents" | "portfolio" | "wallet", [string, IconName]> = {
  markets: ["MARKETS", "grid"],
  agents: ["AGENTS", "user"],
  portfolio: ["PORTFOLIO", "chart"],
  wallet: ["WALLET", "wallet"],
};
const HIDE_MS = 220;

/**
 * Tab bar custom de bottom-tabs: 4 botones fijos (Launchpad y Activity están registradas pero no se pintan, D1).
 * Activo = fondo de control + tinte de la pestaña; se esconde deslizando en pantallas no raíz (mobile-nav D13).
 * Fondo blanco al 96 % sin blur (D2: sin expo-blur) y hairline arriba.
 */
export function TabBar({ state, navigation, insets }: BottomTabBarProps) {
  const { switchTab } = useAppCtx();
  const focusedTab = state.routes[state.index];
  const focusedScreen = (getFocusedRouteNameFromRoute(focusedTab) ?? TAB_ROOT[focusedTab.name as TabName]) as Screen;
  const visible = SHOW_TABS.includes(focusedScreen);
  const height = tabBarHeight(insets.bottom);
  const ty = useSharedValue(visible ? 0 : height);
  useEffect(() => { ty.value = withTiming(visible ? 0 : height, { duration: HIDE_MS }); }, [visible, height, ty]);
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  const select = (name: TabName) => {
    const route = state.routes.find((r) => r.name === name)!;
    const e = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
    if (route.key !== focusedTab.key && !e.defaultPrevented) switchTab(name);
  };

  return (
    <Animated.View
      pointerEvents={visible ? "auto" : "none"}
      style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height, paddingTop: ROW_TOP, paddingBottom: insets.bottom + ROW_BOTTOM, paddingHorizontal: 10, borderTopWidth: 1, borderTopColor: C.hair08, backgroundColor: "rgba(255,255,255,0.96)" }, barStyle]}
    >
      <View style={{ flexDirection: "row", height: ROW_H, gap: 4 }}>
        {TAB_ORDER.map((name) => {
          const root = TAB_ROOT[name] as keyof typeof TABS;
          const [label, icon] = TABS[root];
          const on = ROOT_OF[focusedScreen] === root;
          const fg = on ? TAB_TINT[root] : C.faint;
          return (
            <Touch key={name} onPress={() => select(name)} accessibilityLabel={`tab-${root}`}
              style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 16, backgroundColor: on ? C.ctl : "transparent" }}>
              <Icon name={icon} size={19} color={fg} />
              <T w={500} s={10.5} lh={1} ls={0.06} mono color={fg}>{label}</T>
            </Touch>
          );
        })}
      </View>
    </Animated.View>
  );
}
```
Si `expo-haptics`, `react-native-gesture-handler` o `react-native-worklets` quedan sin consumidores (`grep -rn "expo-haptics\|GestureDetector\|scheduleOnRN" src App.tsx`), **no** los desinstales: gesture-handler y worklets los exige reanimated y el `GestureHandlerRootView` de App.tsx. Anota en el audit que `expo-haptics` quedó sin uso.

- [ ] **Step 5: Tests, tipos y commit**

```bash
npx jest __tests__/tabBarLayout.test.ts && npm test 2>&1 | tail -5 && npx tsc --noEmit && echo TSC_OK
git add apps/mobile/src/ui/TabBar.tsx apps/mobile/src/ui/tabBarLayout.ts apps/mobile/__tests__/tabBarLayout.test.ts
git commit -m "feat(mobile): tab bar de 4 botones fijos con el tinte de cada pestaña

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Cabecera de página clara (D5)

**Files:**
- Modify: `src/ui/Page.tsx`

**Interfaces:**
- Consumes: `headerFor(screen, perpsSymbol)` (Task 3).
- Produces: `Page` pinta dos cabeceras. En **raíces**, el título en mayúsculas en display de 30 px (`ls -0.045`) con el logo a la izquierda. En **detalles**, un botón atrás circular de 38 px (`C.ctl`), el título display de 22 px y el subtítulo mono de 10.5 px (`C.faint`). Además, `Page` acepta `headerRight?: ReactNode` (lo usa Market para el mark en Task 10). `withPage(screen, Component, opts?: { headerRight?: (ctx: AppCtx) => ReactNode })`.

- [ ] **Step 1: Reemplazar el bloque de cabecera**

En `Page`, el `View` de la cabecera queda así (la firma pasa a `Page({ screen, children, headerRight })`):
```tsx
<View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingTop: 10, paddingHorizontal: 18, paddingBottom: 12, backgroundColor: C.bg }}>
  {canBack ? (
    <Touch onPress={back} accessibilityLabel="back" style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: C.ctl, alignItems: "center", justifyContent: "center" }}>
      <Icon name="back" size={17} color={C.ink} />
    </Touch>
  ) : null}
  {isRoot ? <Image source={require("../../assets/pickler-mark.png")} style={{ width: 26, height: 26 }} resizeMode="contain" /> : null}
  <View style={{ flex: 1, minWidth: 0 }}>
    {isRoot
      ? <T w={700} s={30} lh={1} ls={-0.045} display numberOfLines={1}>{title.toUpperCase()}</T>
      : <T w={700} s={22} lh={1.05} ls={-0.03} display numberOfLines={1}>{title.toUpperCase()}</T>}
    {!isRoot && sub ? <T w={500} s={10.5} lh={1.2} ls={0.08} mono color={C.faint} numberOfLines={1} style={{ marginTop: 3 }}>{sub.toUpperCase()}</T> : null}
  </View>
  {headerRight}
  {__DEV__ ? (
    <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
      <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
    </Touch>
  ) : null}
</View>
```
En `onRefresh`, Portfolio refresca contexto y reads: la rama `screen === "market"` pasa a `screen === "market" || screen === "portfolio"`.

El contenedor raíz de `Page` queda `backgroundColor: C.bg`, y el `RefreshControl` con `tintColor={C.faint}`. El sello del refresh (`Tag`) va con `paddingHorizontal: 18`. En `withPage`, agrega el tercer parámetro opcional y pasa `headerRight={opts?.headerRight?.(ctx)}`.

- [ ] **Step 2: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/ui/Page.tsx
git commit -m "feat(mobile): cabecera clara del Handoff (título display, atrás circular)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Cableado de datos — reads sin filtro, sockets por pantalla, `fetchOne` (D26)

**Files:**
- Modify: `src/hooks/useReads.ts`, `src/reads/matrix.ts`, `src/store.ts`, `App.tsx`, `src/screens/ask.tsx`
- Test: `__tests__/reads-matrix.test.ts`, `__tests__/store.test.ts`

**Interfaces:**
- Produces:
  - `readsForMarket(reads: readonly Read[] | null, marketId: number | undefined): Read[]` en `reads/matrix.ts`.
  - `perplActiveFor(scr: Screen): boolean` y `readsActiveFor(scr: Screen, marketTab: MarketTab): boolean` en `store.ts`.
  - `Reads.fetchOne: (id: string) => Promise<Read | null>`. `Reads.reads` pasa a ser **todas** tus reads (máx. 50, las más recientes primero).

- [ ] **Step 1: Tests**

En `__tests__/reads-matrix.test.ts` agrega (importa `readsForMarket`):
```ts
test("readsForMarket keeps only the open market's reads (the list is no longer filtered by the server)", () => {
  const r = (id: string, marketId: number) => ({ id, marketId }) as unknown as import("../src/reads/types").Read;
  const all = [r("a", 1), r("b", 2), r("c", 1)];
  expect(readsForMarket(all, 1).map((x) => x.id)).toEqual(["a", "c"]);
  expect(readsForMarket(all, undefined)).toEqual([]);
  expect(readsForMarket(null, 1)).toEqual([]);
});
```
En `__tests__/store.test.ts` agrega (importa `perplActiveFor`, `readsActiveFor`):
```ts
test("the Perpl socket runs where trading data is shown, Portfolio included (D26)", () => {
  for (const s of ["markets", "market", "perpsFunds", "portfolio"] as const) expect(perplActiveFor(s)).toBe(true);
  for (const s of ["wallet", "agents", "agent", "read", "signin"] as const) expect(perplActiveFor(s)).toBe(false);
});

test("reads poll on Ask, Portfolio, Agents, the profile, Read and Markets (agent count), not on Trade", () => {
  expect(readsActiveFor("market", "ask")).toBe(true);
  expect(readsActiveFor("market", "trade")).toBe(false);
  for (const s of ["portfolio", "agents", "agent", "read", "markets"] as const) expect(readsActiveFor(s, "trade")).toBe(true);
  expect(readsActiveFor("wallet", "trade")).toBe(false);
});
```

- [ ] **Step 2: Verlos fallar**

Run: `npx jest __tests__/reads-matrix.test.ts __tests__/store.test.ts`
Expected: FAIL (funciones no definidas).

- [ ] **Step 3: Implementar**

`reads/matrix.ts`:
```ts
/** Reads del mercado abierto: `reads-list` ya no se filtra por mercado (spec mobile-light D26). */
export function readsForMarket<R extends { marketId: number }>(reads: readonly R[] | null, marketId: number | undefined): R[] {
  return reads && marketId !== undefined ? reads.filter((r) => r.marketId === marketId) : [];
}
```
`store.ts`:
```ts
const PERPL_SCREENS: readonly Screen[] = ["markets", "market", "perpsFunds", "portfolio"];
const READS_SCREENS: readonly Screen[] = ["portfolio", "agents", "agent", "read", "markets"];

/** Pantallas con socket y polling de contexto de Perpl (D26: Portfolio muestra las posiciones). */
export const perplActiveFor = (scr: Screen): boolean => PERPL_SCREENS.includes(scr);
/** Polling de reads y agentes: Ask dentro de Market, más las pantallas que listan reads o agentes (D26). */
export const readsActiveFor = (scr: Screen, marketTab: MarketTab): boolean => (scr === "market" ? marketTab === "ask" : READS_SCREENS.includes(scr));
```
`App.tsx`: borra la constante `PERPL_SCREENS` local, importa `perplActiveFor` y `readsActiveFor` de `./src/store` y reemplaza:
```ts
const perpsActive = perplActiveFor(scr);
const readsActive = readsActiveFor(scr, store.S.marketTab);
```
`useReads.ts`:
- En `loadReads`, pide sin filtro y quita la guarda por mercado:
```ts
  const loadReads = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const r = await fetchReads(READS_URL, s); // todas tus reads (máx. 50); el board filtra por mercado (D26)
      setReads(r.reads);
      setCredits(r.credits);
      setListError("");
    } catch (e) {
      if (isSessionError(e)) { await dropSession(); return; }
      setListError(describeReadsError(e));
    }
  }, [dropSession]);
```
  Borra `marketIdRef` si queda sin uso; `marketId` sigue siendo parámetro para `ask()` y para el reset de `request`.
- Agrega `fetchOne`:
```ts
  /** Una read por id (pantalla Read abierta desde un push, D14): primero la lista; si no está, read-get. */
  const fetchOne = useCallback(async (id: string): Promise<Read | null> => {
    if (!(await ensureSession())) return null;
    try {
      const read = await fetchRead(READS_URL, sessionRef.current!, id);
      setReads((list) => upsert(list ?? [], read));
      return read;
    } catch (e) {
      if (isSessionError(e)) await dropSession();
      return null;
    }
  }, [ensureSession, dropSession]);
```
  (importa `fetchRead`; súmalo al tipo `Reads` y al `return`). Actualiza el comentario del campo `reads` en el tipo: "Todas tus reads, más recientes primero (máx. 50, D26)".

`ask.tsx`: `const dots = readDots(readsForMarket(reads.reads, market.id));`.

- [ ] **Step 4: Tests, tipos y commit**

```bash
npx jest __tests__/reads-matrix.test.ts __tests__/store.test.ts __tests__/reads-api.test.ts
npm test 2>&1 | tail -5 && npx tsc --noEmit && echo TSC_OK
git add apps/mobile/src/hooks/useReads.ts apps/mobile/src/reads/matrix.ts apps/mobile/src/store.ts apps/mobile/App.tsx apps/mobile/src/screens/ask.tsx apps/mobile/__tests__/reads-matrix.test.ts apps/mobile/__tests__/store.test.ts
git commit -m "feat(mobile): reads sin filtro de mercado, socket de Perpl en Portfolio y fetchOne

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Sign in (D20)

**Files:**
- Modify: `src/screens/signin.tsx`

**Interfaces:**
- Consumes: `createAccount`, `signIn`, `onWallet`, `finishSignin`, `heldActionFor`; `Icon` `faceId`; `Segmented`.
- Produces: nada nuevo. Timing: tras el éxito, el estado `done` se muestra 1000 ms y luego se llama `finishSignin()`.

- [ ] **Step 1: Reescribir el cuerpo**

```tsx
import { useRoute } from "@react-navigation/native";
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { accountAddress } from "../account";
import { shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { SigninParams } from "../navigation/routes";
import { heldActionFor } from "../store";
import { Card, Icon, Page, Segmented, T, Tag, Touch } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

type Mode = "in" | "up";
type Phase = { step: "idle" } | { step: "busy" } | { step: "done"; address: string };
const DONE_MS = 1000; // el banner ACCOUNT CREATED / WELCOME BACK se ve antes de navegar (D20)

export function SigninScreen({ onWallet, finishSignin }: AppCtx) {
  const held = heldActionFor((useRoute().params as SigninParams)?.next);
  const [mode, setMode] = useState<Mode>("in");
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [error, setError] = useState("");

  async function run() {
    setPhase({ step: "busy" });
    setError("");
    try {
      const wallet = mode === "up" ? await createAccount() : await signIn();
      onWallet(wallet);
      setPhase({ step: "done", address: wallet.address });
      setTimeout(finishSignin, DONE_MS);
    } catch (e) {
      setError(describeError(e));
      setPhase({ step: "idle" });
    }
  }

  const busy = phase.step === "busy";
  const done = phase.step === "done" ? phase : null;
  return (
    <Page top={8} gap={16}>
      <Segmented options={[["in", "Sign in"], ["up", "Sign up"]] as const} value={mode} onChange={(k) => { if (phase.step === "idle") setMode(k); }} />
      <T w={700} s={44} lh={0.92} ls={-0.045} display>{mode === "up" ? "BUILD AN AGENT." : "GET IN."}</T>
      {held ? (
        <Card bg={C.vioBg} pad={14} radius={16}>
          <T w={600} s={14} lh={1.3}>We kept what you were about to do</T>
          <T w={400} s={13} lh={1.45} color={C.dim} style={{ marginTop: 4 }}>{held}. You come straight back after this step.</T>
        </Card>
      ) : null}
      <Touch onPress={() => { if (phase.step === "idle") void run(); }} disabled={phase.step !== "idle"} accessibilityLabel={mode === "up" ? "create-wallet" : "sign-in"}
        style={{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 20, backgroundColor: C.ink }}>
        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.tile, alignItems: "center", justifyContent: "center" }}>
          {busy ? <ActivityIndicator color={C.limeOnInk} /> : <Icon name="faceId" size={20} color={C.limeOnInk} />}
        </View>
        <View style={{ flex: 1 }}>
          <T w={600} s={17} lh={1.2} color={C.onInk}>{done ? shortHash(done.address) : busy ? "Waiting on Face ID…" : mode === "up" ? "Create with Face ID" : "Continue with Face ID"}</T>
          <T w={500} s={10} lh={1} ls={0.1} mono color={C.onInkDim} style={{ marginTop: 5 }}>{done ? "MONAD TESTNET" : "PASSKEY · SAME ACCOUNT ON WEB"}</T>
        </View>
        {phase.step === "idle" ? <Icon name="arrow" size={17} color={C.onInk} /> : null}
      </Touch>
      {done ? (
        <View style={{ padding: 12, borderRadius: 14, backgroundColor: C.limeBg14 }}>
          <Tag color={C.limeInk}>{mode === "up" ? "ACCOUNT CREATED" : "WELCOME BACK"} · {shortHash(done.address).toUpperCase()}</Tag>
        </View>
      ) : null}
      {error ? <T w={400} s={13} lh={1.4} color={C.down}>{error}</T> : null}
      <T w={400} s={13} lh={1.5} color={C.dim}>Reading and following never need an account. Passkey only: no seed phrase, no extension, no password.</T>
      <T w={400} s={12} lh={1.4} color={C.faint}>Connecting is not signing. Every operation is confirmed on its own.</T>
    </Page>
  );
}
```
(`accountAddress` no se usa: bórralo del import. `Wallet.address` es un `EvmAddress`, que es string, en `wallet/wallet.ts:26`.)

- [ ] **Step 2: Tipos y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/screens/signin.tsx
git commit -m "feat(mobile): Sign in del Handoff (passkey idle/waiting/done, banner)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Wallet, Deposit (QR), Withdraw y Trading funds (D7, D18, D19)

**Files:**
- Create: `src/wallet/movements.ts`, `__tests__/movements.test.ts`
- Modify: `src/screens/wallet.tsx`, `src/screens/perpsFunds.tsx`

**Interfaces:**
- Produces: `splitMovements(rows: readonly Movement[]): { activity: Movement[]; pending: Movement[] }`. Complete y Reverted van a `activity`; Confirming, a `pending`. El orden de entrada se conserva.

- [ ] **Step 1: Test**

`__tests__/movements.test.ts`:
```ts
import { splitMovements } from "../src/wallet/movements";
import type { Movement } from "../src/wallet/explorer";

const m = (hash: string, status: Movement["status"]) => ({ hash, status }) as unknown as Movement;

test("Activity keeps complete and reverted rows; Pending keeps what is still confirming (D18)", () => {
  const rows = [m("0x1", "Confirming"), m("0x2", "Complete"), m("0x3", "Reverted"), m("0x4", "Confirming")];
  const { activity, pending } = splitMovements(rows);
  expect(activity.map((r) => r.hash)).toEqual(["0x2", "0x3"]);
  expect(pending.map((r) => r.hash)).toEqual(["0x1", "0x4"]);
  expect(splitMovements([])).toEqual({ activity: [], pending: [] });
});
```

- [ ] **Step 2: Verlo fallar y luego implementar**

Run: `npx jest __tests__/movements.test.ts` → FAIL (módulo no existe).

`src/wallet/movements.ts`:
```ts
import type { Movement } from "./explorer";

/** Segmentado Activity / Pending de Wallet (spec mobile-light D18). */
export function splitMovements(rows: readonly Movement[]): { activity: Movement[]; pending: Movement[] } {
  return { activity: rows.filter((r) => r.status !== "Confirming"), pending: rows.filter((r) => r.status === "Confirming") };
}
```
Run: `npx jest __tests__/movements.test.ts` → PASS.

- [ ] **Step 3: Re-maquetar `WalletScreen`**

Conserva todo el cálculo previo al `return` y reemplaza el JSX por (agrega `const [tab, setTab] = useState<"activity" | "pending">("activity");` y `const { activity, pending: pendingRows } = splitMovements(rows);`):
```tsx
<Page gap={14}>
  <InkBlock gap={14}>
    <Tag color={C.onInkDim}>AVAILABLE · AUSD</Tag>
    {treasury.balances === null && !treasury.rpcError
      ? <Skeleton h={44} w="55%" />
      : <Reveal><T w={700} s={44} lh={1} ls={-0.03} mono color={C.onInk}>{available}</T></Reveal>}
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Btn label="Deposit" icon="down" onPress={() => nav("deposit")} variant="lime" flex={1} accessibilityLabel="deposit" />
      <Btn label="Withdraw" icon="up" onPress={() => nav("withdraw")} variant="tile" flex={1} accessibilityLabel="withdraw" />
    </View>
    {perpl.state.status === "ready" ? (
      <Touch onPress={() => nav("perpsFunds", { fundsMode: "add" })} accessibilityLabel="in-trading">
        <InkTile style={{ flex: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Tag color={C.onInkDim}>IN TRADING · AUSD</Tag>
          {trading === "skeleton" ? <Skeleton h={14} w={80} /> : (
            <T w={700} s={15} lh={1} mono color={C.onInk}>
              {trading === "unknown" ? "—" : formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)}{trading === "lastSeen" ? " · last seen" : ""}
            </T>
          )}
        </InkTile>
      </Touch>
    ) : null}
  </InkBlock>

  <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
    <View style={{ flex: 1 }}>
      <T w={600} s={15} lh={1.2}>Monad testnet</T>
      <T w={500} s={11} lh={1.2} mono color={C.faint} style={{ marginTop: 3 }}>{address ? shortHash(address) : "—"}</T>
    </View>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: C.up }} />
      <Tag color={C.up}>CONNECTED</Tag>
    </View>
  </Card>

  <Segmented options={[["activity", "Activity"], ["pending", `Pending${confirming ? ` · ${confirming}` : ""}`]] as const} value={tab} onChange={setTab} />
  {treasury.movementsError ? (
    <Warn title="Couldn't load movements" body={treasury.movementsError}>
      <Chip label="Retry" onPress={() => { void treasury.refreshMovements(); }} style={{ alignSelf: "flex-start" }} />
    </Warn>
  ) : null}
  {tab === "pending" ? (
    pendingRows.length === 0 ? <T w={400} s={13} lh={1.4} color={C.faint}>Nothing pending.</T> : <View style={{ gap: 8 }}>{pendingRows.map((m) => <MovementRow key={m.hash} m={m} />)}</View>
  ) : treasury.movements === null && !treasury.movementsError ? (
    <><Skeleton.Row /><Skeleton.Row /><Skeleton.Row /></>
  ) : activity.length === 0 ? (
    <T w={400} s={13} lh={1.4} color={C.faint}>Nothing has ever arrived in this wallet.</T>
  ) : (
    <Reveal style={{ gap: 8 }}>{activity.map((m) => <MovementRow key={m.hash} m={m} />)}</Reveal>
  )}
  <T w={400} s={12} lh={1.45} color={C.faint}>Withdrawals always ask for Face ID.</T>

  {/* TESTNET y SESSION: mismo contenido y lógica que hoy; sólo cambia el estilo (Card sin borde, Btn lime/outline, Chip). */}
  …las secciones TESTNET, RPC error, notice, error y SESSION del archivo actual, copiadas tal cual…
</Page>
```
Cómo aplicar el marcador `…`: copia literalmente las secciones actuales desde `<Tag s={10} style={{ marginTop: 6 }}>TESTNET</Tag>` hasta el final del `Page`. Quita `bg="transparent"` de la `Card` de TESTNET y el `bd={C.hair22} fg={C.ink}` de los `Chip` (los defaults nuevos ya son de control). `MovementRow` queda:
```tsx
function MovementRow({ m }: { m: Movement }) {
  const dot = m.status === "Confirming" ? C.pending : m.sign === "+" ? C.lime : C.vio;
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} accessibilityLabel={`movement-${shortHash(m.hash)}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.card }}>
      <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: dot }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w={600} s={14} lh={1.25}>{m.kind}</T>
        <T w={500} s={10} lh={1} mono color={C.faint} style={{ marginTop: 4 }}>{movementDate(m.when)} · {m.status.toUpperCase()}</T>
      </View>
      <T w={700} s={13} lh={1} mono color={m.status === "Reverted" ? C.faint : m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)}</T>
    </Touch>
  );
}
```
Borra `STATUS_FG` si queda sin uso. Importa `InkBlock`, `InkTile`, `Segmented` y `splitMovements`.

- [ ] **Step 4: Deposit con QR real**

En `DepositScreen` reemplaza la caja punteada `QR CODE` por:
```tsx
<View style={{ alignSelf: "center", padding: 16, borderRadius: 22, backgroundColor: C.bg, borderWidth: 1, borderColor: C.hair08 }}>
  {address ? <QRCode value={address} size={180} color={C.ink} backgroundColor={C.bg} /> : <Skeleton h={180} w={180} />}
</View>
```
con `import QRCode from "react-native-qrcode-svg";`. El resto de Deposit (StatGrid, dirección, Copy / I've sent it) no cambia.

- [ ] **Step 5: Withdraw y Trading funds**

- `WithdrawScreen`: `inputBox` queda `{ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: C.card }`. Los números de monto (`textStyle(700, 30, { display: true … })`) pasan a `mono: true` en lugar de `display` (el Handoff pone cifras en JetBrains Mono). Lo demás no cambia.
- `perpsFunds.tsx`: el mismo cambio de la cifra a mono; `Card bd={C.hair2} bg={C.deep}` → `Card`; y el botón final de éxito:
```tsx
{st.step !== "sent" ? <Btn label="Back to Wallet" onPress={() => nav("wallet")} variant="lime" py={14} accessibilityLabel="back-to-wallet" /> : null}
```
  y en el copy `"Monad · gas in MON"` no cambia.

- [ ] **Step 6: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/wallet/movements.ts apps/mobile/__tests__/movements.test.ts apps/mobile/src/screens/wallet.tsx apps/mobile/src/screens/perpsFunds.tsx
git commit -m "feat(mobile): Wallet del Handoff (AVAILABLE, IN TRADING, Activity/Pending) y QR real

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Markets — búsqueda y tarjetas; el gate sale a `tradingGate.tsx` (D7, D8, D9)

**Files:**
- Create: `src/perpl/filter.ts`, `__tests__/filter.test.ts`, `src/screens/tradingGate.tsx`, `src/screens/orderResult.tsx`
- Modify: `src/screens/markets.tsx`

**Interfaces:**
- Produces:
  - `filterMarkets<M extends { symbol: string; name: string }>(markets: readonly M[], query: string): M[]`.
  - `EnableTrading(ctx: AppCtx)` es el `Gate` actual **sin** la `MarketsList` ni la frase "Ask an agent on any market below…".
  - `TradingWarns({ perpl }: Pick<AppCtx, "perpl">)` agrupa los avisos de reloj, key rechazada y forwarding, con su `runAction` y `actionError` internos.
  - `PositionRow` y el flujo de cierre (`Closing`, `doClose`) salen de `markets.tsx` y se exportan desde `tradingGate.tsx` para que los use Portfolio: `export function PositionsPanel(ctx: AppCtx)`.

- [ ] **Step 1: Test de `filterMarkets`**

`__tests__/filter.test.ts`:
```ts
import { filterMarkets } from "../src/perpl/filter";

const mk = [{ symbol: "BTC", name: "Bitcoin" }, { symbol: "ETH", name: "Ethereum" }, { symbol: "MON", name: "Monad" }];

test("search matches symbol or name, case and accent insensitive, trimmed; empty query lists all", () => {
  expect(filterMarkets(mk, "").map((m) => m.symbol)).toEqual(["BTC", "ETH", "MON"]);
  expect(filterMarkets(mk, "  btc ").map((m) => m.symbol)).toEqual(["BTC"]);
  expect(filterMarkets(mk, "mon").map((m) => m.symbol)).toEqual(["MON"]);
  expect(filterMarkets(mk, "ether").map((m) => m.symbol)).toEqual(["ETH"]);
  expect(filterMarkets(mk, "Mönad").map((m) => m.symbol)).toEqual(["MON"]);
  expect(filterMarkets(mk, "xyz")).toEqual([]);
});
```

- [ ] **Step 2: Verlo fallar e implementar**

Run: `npx jest __tests__/filter.test.ts` → FAIL.

`src/perpl/filter.ts`:
```ts
// Rango de marcas combinantes U+0300–U+036F: \p{Diacritic} no es fiable en Hermes.
const fold = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Buscador local de Markets (spec mobile-light D9): símbolo o nombre, sin distinguir mayúsculas ni acentos. */
export function filterMarkets<M extends { symbol: string; name: string }>(markets: readonly M[], query: string): M[] {
  const q = fold(query);
  return q === "" ? [...markets] : markets.filter((m) => fold(m.symbol).includes(q) || fold(m.name).includes(q));
}
```
Run: `npx jest __tests__/filter.test.ts` → PASS.

- [ ] **Step 3: `tradingGate.tsx`**

Mueve de `markets.tsx`, sin cambiar su lógica, `CONNECTION`, `PositionRow`, `Closing`, el `Gate` (renombrado `EnableTrading`, sin la `MarketsList` final ni su frase), los avisos (renombrados `TradingWarns`) y el bloque de cierre. Arma `PositionsPanel` con el cuerpo de posiciones y cierre de `MarketsScreen`:
```tsx
/** Posiciones abiertas con Close y su confirmación inline (Portfolio → Positions, D17). */
export function PositionsPanel(ctx: AppCtx) {
  const { perpl } = ctx;
  const [closing, setClosing] = useState<Closing | null>(null);
  const live = perpl.live;
  const positions = live?.positions ?? [];
  const markets = perpl.context?.markets ?? [];
  // doClose: el mismo código de markets.tsx.
  if (closing) { /* el mismo JSX de cierre de markets.tsx, con OrderResultCard primary={{ label: "Back to Portfolio", onPress: () => setClosing(null) }} */ }
  if (live === null) return <Skeleton.Card lines={3} />;
  if (positions.length === 0) return <Reveal><EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No open positions. Pick a market and a square.</T></EmptyPanel></Reveal>;
  return (
    <Reveal style={{ gap: 10 }}>
      {positions.map((p) => {
        const market = markets.find((m) => m.id === p.mkt);
        return market ? <PositionRow key={p.pid} p={p} market={market} onClose={() => setClosing({ p, market, result: null })} /> : null;
      })}
    </Reveal>
  );
}
```
Las dos líneas marcadas con comentario se sustituyen por el código literal de `markets.tsx`: la función `doClose` y el `return` del bloque `if (closing)`. No son instrucciones abiertas. `PositionRow` re-vestido según el Handoff:
```tsx
function PositionRow({ p, market, onClose }: { p: Position; market: Market; onClose: () => void }) {
  const pnl = positionPnl(p, market.mark, market.priceDecimals, market.sizeDecimals);
  const lv = p.lv / 100;
  const long = p.sd === 1;
  const liq = liquidationPrice(p.ep, lv, long ? "long" : "short", market.maintenanceBps, market.maxLeverage);
  const pd = market.priceDecimals;
  return (
    <Card gap={12}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <T w={600} s={17} lh={1.2}>{long ? "Long" : "Short"} {market.symbol}</T>
          <T w={500} s={10.5} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>{formatSize(p.s, market.sizeDecimals)} {market.symbol} · {lv}×</T>
        </View>
        <T w={700} s={15} mono color={pnl <= -10_000n ? C.down : C.up}>{formatPnl(pnl)}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[["ENTRY", formatPrice(p.ep, pd)], ["MARK", formatPrice(market.mark, pd)], ["LIQ. EST.", formatPrice(liq, pd)]].map(([k, v]) => (
          <View key={k} style={{ flex: 1, padding: 10, borderRadius: 12, backgroundColor: C.bg }}>
            <Tag>{k}</Tag>
            <T w={700} s={12.5} mono style={{ marginTop: 5 }}>{v}</T>
          </View>
        ))}
      </View>
      <Btn label="Close" onPress={onClose} variant="outline" py={11} accessibilityLabel={`close-${p.pid}`} />
    </Card>
  );
}
```
**Mueve `OrderResult`, `TONES` y `OrderResultCard` de `market.tsx` a un archivo nuevo, `src/screens/orderResult.tsx`.** Si no, `tradingGate.tsx` ↔ `market.tsx` forman un ciclo de imports, y Metro avisa "Require cycle" (trampa conocida de `mobile-nav`). En el mismo paso cambia su firma a `({ result, primary, onEdit }: { result: OrderResult; primary: { label: string; onPress: () => void }; onEdit?: () => void })`, con el botón lima `primary.label`. `market.tsx` y `tradingGate.tsx` la importan de `./orderResult`. El uso de `market.tsx` queda `primary={{ label: "Back to Markets", onPress: () => nav("markets") }}`. Súmalo a **Files** y al `git add` de esta tarea.

**Aviso:** entre esta tarea y Task 10, el `TradeGate` de Market sigue mandando a Markets, que ya no tiene el gate. Es aceptable entre tareas; Task 10 lo reemplaza.

- [ ] **Step 4: `MarketsScreen`**

```tsx
export function MarketsScreen({ perpl, reads, nav }: AppCtx) {
  const [query, setQuery] = useState("");
  const markets = filterMarkets(perpl.context?.markets ?? [], query);
  const agents = reads.agents?.length;
  return (
    <Page gap={12}>
      <SearchBox value={query} onChange={setQuery} placeholder="Search a market" accessibilityLabel="search-markets" />
      {perpl.contextError ? (
        <Warn title="Couldn't load markets" body={perpl.contextError}>
          <Chip label="Retry" onPress={() => { void perpl.refreshContext(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-markets" />
        </Warn>
      ) : null}
      {perpl.context === null && !perpl.contextError ? <>{Array.from({ length: 4 }, (_, i) => <Skeleton.Card key={i} lines={3} />)}</> : null}
      {perpl.context !== null && markets.length === 0 ? <T w={400} s={13} color={C.faint}>No market matches “{query.trim()}”.</T> : null}
      {perpl.context !== null ? (
        <Reveal style={{ gap: 10 }}>
          {markets.map((m) => <MarketCard key={m.id} m={m} marks={perpl.marks[m.id] ?? []} agents={agents}
            onTrade={() => nav("market", { perpsMarketId: m.id, perpsSide: "long", marketTab: "trade" })}
            onAsk={() => nav("market", { perpsMarketId: m.id, marketTab: "ask" })} />)}
        </Reveal>
      ) : null}
    </Page>
  );
}

function MarketCard({ m, marks, agents, onTrade, onAsk }: { m: Market; marks: readonly number[]; agents: number | undefined; onTrade: () => void; onAsk: () => void }) {
  const chg = change24h(m.mark, m.prev);
  const up = chg >= 0;
  return (
    <TouchCard onPress={onTrade} accessibilityLabel={`market-${m.symbol}`} style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: up ? C.blueBg : C.downBg, alignItems: "center", justifyContent: "center" }}>
          <T w={700} s={10.5} mono color={up ? C.blue : C.down}>{m.symbol.slice(0, 4)}</T>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w={600} s={18} lh={1.15}>{m.symbol}-PERP</T>
          <T w={500} s={10} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>MAX {m.maxLeverage}× · {agents ?? "—"} AGENTS</T>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <T w={700} s={17} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
          <T w={500} s={10.5} lh={1} mono color={up ? C.up : C.down} style={{ marginTop: 5 }}>{up ? "+" : ""}{(chg * 100).toFixed(1)}%</T>
        </View>
      </View>
      <View style={{ height: 46, borderRadius: 12, backgroundColor: C.bg, overflow: "hidden" }}>
        <Sparkline points={sparkPoints(marks)} stroke={up ? C.up : C.down} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Ask" icon="ask" onPress={onAsk} variant="ask" flex={1} py={12} accessibilityLabel={`ask-${m.symbol}`} />
        <Btn label="Trade" arrow onPress={onTrade} variant="lime" flex={1} py={12} accessibilityLabel={`trade-${m.symbol}`} />
      </View>
    </TouchCard>
  );
}
```
Borra de `markets.tsx` todo lo que se movió; los imports que queden sin uso los señala `tsc`.

- [ ] **Step 5: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/perpl/filter.ts apps/mobile/__tests__/filter.test.ts apps/mobile/src/screens/orderResult.tsx apps/mobile/src/screens/tradingGate.tsx apps/mobile/src/screens/markets.tsx apps/mobile/src/screens/market.tsx
git commit -m "feat(mobile): Markets del Handoff (búsqueda, tarjetas con Ask/Trade); gate y posiciones a tradingGate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Market — segmentado Trade it / Ask an agent, Enable dentro de Trade, ticket y Ask re-vestidos (D7, D8, D10 parcial, D11, D12)

**Files:**
- Modify: `src/screens/market.tsx`, `src/screens/ask.tsx`, `src/screens/book.tsx`, `src/ui/primitives.tsx` (borrar `PillTabs`), `src/navigation/Navigator.tsx` (headerRight de Market)

**Interfaces:**
- Consumes: `EnableTrading`, `TradingWarns` (Task 9); `Segmented`.
- Produces: `MarketScreen` con `Segmented` arriba. `TradeTab` sin key renderiza `EnableTrading`, con key renderiza `TradingWarns` y luego el ticket. Market se registra con `withPage("market", MarketScreen, { headerRight: MarkBadge })`, donde `MarkBadge(ctx)` pinta el mark y el % 24h del mercado abierto.

- [ ] **Step 1: Segmentado y gate**

En `MarketScreen` reemplaza el bloque de `PillTabs` por:
```tsx
<View style={{ paddingTop: 4, paddingHorizontal: 18, paddingBottom: 6 }}>
  <Segmented options={[["trade", "Trade it"], ["ask", "Ask an agent"]] as const} value={S.marketTab} onChange={(k) => set({ marketTab: k })} />
</View>
{S.marketTab === "trade" ? <TradeTab {...ctx} /> : <AskTab {...ctx} />}
```
Borra `TradeGate` y la importación de `AgentsTab`. En `TradeTab`, la línea `if (perpl.state.status !== "ready") return <TradeGate … />;` pasa a:
```tsx
if (perpl.state.status === "loading") return <Page top={13}><ActivityIndicator color={C.faint} /></Page>;
if (perpl.state.status !== "ready") return <EnableTrading {...ctx} />;
```
(`TradeTab` recibe el `ctx` completo: cambia su firma a `TradeTab(ctx: AppCtx)` y desestructura dentro). Justo antes del `LevelCard`, en la rama de edición, agrega `<TradingWarns perpl={perpl} />`. Borra `PillTabs` de `primitives.tsx`.

- [ ] **Step 2: MarkBadge en la cabecera**

En `market.tsx`:
```tsx
/** Mark en vivo y % 24h a la derecha de la cabecera (D10). */
export function MarkBadge({ S, perpl }: AppCtx) {
  const m = perpl.context?.markets.find((x) => x.id === S.perpsMarketId);
  if (!m) return null;
  const chg = change24h(m.mark, m.prev);
  return (
    <View style={{ alignItems: "flex-end" }}>
      <T w={700} s={15} lh={1} mono>{formatPrice(m.mark, m.priceDecimals)}</T>
      <T w={500} s={10.5} lh={1} mono color={chg >= 0 ? C.up : C.down} style={{ marginTop: 4 }}>{chg >= 0 ? "+" : ""}{(chg * 100).toFixed(1)}%</T>
    </View>
  );
}
```
(importa `change24h`). En `Navigator.tsx`: `const Market = withPage("market", MarketScreen, { headerRight: MarkBadge });`. El subtítulo de la cabecera de Market pasa a ser dinámico. En `Page`, cuando `screen === "market"`, `sub` = `${reads.agents?.length ?? "—"} AGENTS · MAX ${m.maxLeverage}×`, con `m` el mercado abierto. Implementa esa rama junto al cálculo de `perpsSymbol` en `Page.tsx`; si el mercado no está, deja el `sub` de `headerFor`.

- [ ] **Step 3: Ticket re-vestido (sin cambiar cálculos)**

En la rama de edición de `TradeTab`:
- El `Segmented` Long/Short usa `options={[["long", "Long · up"], ["short", "Short · down"]] as const}` y `tone={(k) => ({ bg: k === "long" ? C.lime : C.short, fg: C.ink })}`.
- La `Card` de margen pasa a `<Card gap={6}>`, y el `TextInput` a `textStyle(700, 32, { lh: 1.3, mono: true, color: C.ink })`.
- Los chips de apalancamiento conservan `pill(l === lvUsed)`, ahora ink activo. La etiqueta queda `${l}×`.
- `rows` cambia sus etiquetas a las del Handoff, conservando los mismos valores calculados: `SIZE` (`${formatSize(size, sd)} ${sym} · ≈ ${formatAusd(notional)} AUSD`), `EST. PRICE`, `FEE · TAKER`, `LIQUIDATION ≈` (`fg: C.down`) y `LEVEL` (`fg: C.limeInk`). No hay fila `IF IT HITS`: su cálculo sería una promesa nueva que la lógica no tiene. Anótalo en el audit como ruling.
- El botón Review queda `<Btn label={ok ? (level ? `${side === "long" ? "Long" : "Short"} to ${formatPrice(level.target, market.priceDecimals)} · Review ${formatAusd(units ?? 0n)} AUSD` : `Review · ${formatAusd(units ?? 0n)} AUSD`) : "Enter a margin"} … variant="lime" />`.
- Review: la `Card` de resumen pasa a `InkBlock`. El `Tag` va con `color={C.onInkDim}`; la cifra con `mono color={C.onInk}`; el `KVList` va dentro con `kFg`/`vFg` claros. Agrega a `KVList` una prop `kFg?: string`, reenviada a `KV`, y pásale `kFg={C.onInkDim}`. Los valores de cada fila se re-mapean para el fondo oscuro con `rows.map((r) => ({ ...r, fg: r.fg === C.down ? C.downOnInk : r.fg === C.limeInk ? C.limeOnInk : C.onInk }))`. Si no, `C.dim`, `C.limeInk` y `C.down` no se leen sobre `#0B0D1A`. El botón Confirm queda `variant="lime"`. (`downOnInk` lo crea Task 12; **créalo aquí**, `downOnInk: "#FF8FB8"`, con su aserción en `theme.test.ts`, y Task 12 sólo lo usa.)
- `OrderResultCard` de apertura: `primary={{ label: "See it in Portfolio", onPress: () => nav("portfolio") }}`. Anota en el audit que el flujo F1 del Handoff ("lands in Portfolio") se implementa así.
- `LevelCard`: `Card bg={C.limeBg} bd="transparent"` y `Tag color={C.limeInk}`. El texto final dice "…close it from Portfolio." en lugar de "from Markets".

- [ ] **Step 4: Ask re-vestido**

En `ask.tsx`:
- `ReadCard`: `Card` sin borde. La probabilidad va en `T w={700} s={40} mono color={C.vio}`. El chip YES/NO lleva `fg={yes ? C.limeInk : C.down}` y `bg={yes ? C.limeBg14 : C.downBg}`. `REASONS` pasa a llamarse `WHY`, y `WHAT WOULD BREAK IT` pasa a `LIMITS` dentro de un bloque `{ padding: 12, borderRadius: 14, backgroundColor: C.warnBg }` (D14). El pie "Push is off — check My reads…" pasa a "Push is off — check Portfolio → Reads to see the result."
- `MatrixGrid`: conserva la estructura, con celdas de `height: 48`. El punto pasa de 5 px a 8 px (`GRID_DOT`). La regla del mark se vuelve una **banda ink** de 22 px con el texto `formatPrice(market.mark) MARK` (`mono 700 10.5`, `C.onInk`), insertada entre el último nivel positivo y el primero negativo en lugar del `borderBottomColor`. Los precios de fila van en `C.up` si `bps > 0` y en `C.down` si no. Debajo de cada precio va `levelLabel(bps)` en `C.faint` (importa `levelLabel`). La sparkline de la izquierda se conserva.
- `AskSheet`: `Card bg={C.vioBg06} bd="transparent"`. El chip del agente queda `bg={C.vioBg}` con `fg={C.vio}`. El botón Ask pasa a `variant="violet"` con la etiqueta `Ask ${agent.name} · ${price}`. "Trade this level" pasa a `variant="lime"`.
- `CreditsRow`: `Card` sin borde.
- `SessionGate`: el botón pasa a `variant="violet"`.

`book.tsx`: la `Card` del book queda **plegada por defecto**. Agrega `const [open, setOpen] = useState(false);`. La cabecera `Touch` con `Tag` "ORDER BOOK · L2" y `Icon` `down`/`up` alterna `open`; el cuerpo actual sólo se renderiza si `open`. Los colores de bid/ask pasan a `C.up`/`C.down` si hoy usan `lime`/`down`, y la línea del target a `C.limeInk`.

- [ ] **Step 5: Tipos, tests y commit**

```bash
grep -rn PillTabs src || echo SIN_PILLTABS
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/screens/market.tsx apps/mobile/src/screens/ask.tsx apps/mobile/src/screens/book.tsx apps/mobile/src/ui/primitives.tsx apps/mobile/src/navigation/Navigator.tsx apps/mobile/src/ui/Page.tsx
git commit -m "feat(mobile): Market con Trade it / Ask an agent, Enable trading dentro de Trade y ticket del Handoff

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Pestaña Agents (D13, D15)

**Files:**
- Create: `src/reads/agentsCopy.ts`, `__tests__/agentsCopy.test.ts`
- Rewrite: `src/screens/agents.tsx`
- Modify: `src/navigation/Navigator.tsx` (`AgentsList` usa `AgentsScreen`), `src/screens/market.tsx` (mercado por defecto)

**Interfaces:**
- Produces: `agentBlurb(id: string): string`; `hitRate(record: AgentRecord): string` (`"58%"` o `"—"` sin resueltas); `AgentsScreen(ctx: AppCtx)`.
- Ruling de F1: el perfil (`agent`) es de F2. En F1, tocar la tarjeta o "Ask" hace lo mismo: abre Market en Ask con ese agente (D13). La ruta `agent` sigue registrada con un stub.

- [ ] **Step 1: Test**

`__tests__/agentsCopy.test.ts`:
```ts
import { agentBlurb, hitRate } from "../src/reads/agentsCopy";

test("each seeded agent has a one-line blurb written in the app, never its persona (D15)", () => {
  expect(agentBlurb("jesus")).toBe("Swing trader on Monad perps. Prefers 4H–24H and fades moves past +2.5%.");
  expect(agentBlurb("drift")).toBe("Momentum. Leans with the 24h change.");
  expect(agentBlurb("anchor")).toBe("Mean reversion. Expects stretched moves to drift back.");
  expect(agentBlurb("new-one")).toBe("Reads Perpl markets on Monad.");
});

test("hitRate is right over resolved, rounded; dash with nothing resolved", () => {
  expect(hitRate({ reads: 10, resolved: 12, right: 7, brierAvg: 0.2 })).toBe("58%");
  expect(hitRate({ reads: 3, resolved: 0, right: 0, brierAvg: null })).toBe("—");
});
```

- [ ] **Step 2: Verlo fallar e implementar**

Run: `npx jest __tests__/agentsCopy.test.ts` → FAIL.

`src/reads/agentsCopy.ts`:
```ts
import type { AgentRecord } from "./types";

// Una línea por agente para la tarjeta y el perfil (spec mobile-light D15). La persona (el prompt) no se expone.
const BLURBS: Record<string, string> = {
  jesus: "Swing trader on Monad perps. Prefers 4H–24H and fades moves past +2.5%.",
  drift: "Momentum. Leans with the 24h change.",
  anchor: "Mean reversion. Expects stretched moves to drift back.",
};

export const agentBlurb = (id: string): string => BLURBS[id] ?? "Reads Perpl markets on Monad.";

export const hitRate = (r: AgentRecord): string => (r.resolved === 0 ? "—" : `${Math.round((r.right / r.resolved) * 100)}%`);
```
Run: `npx jest __tests__/agentsCopy.test.ts` → PASS.

- [ ] **Step 3: `agents.tsx`**

```tsx
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { agentBlurb, hitRate } from "../reads/agentsCopy";
import type { Agent } from "../reads/types";
import { askMarketId } from "../store";
import { Avatar, Btn, Chip, Page, Reveal, Skeleton, T, Tag, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";

const initials = (name: string): string => name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/** Pestaña Agents (D15): lista pública de agents-list. En F1 la tarjeta y "Ask" abren Market en Ask con el agente (D13). */
export function AgentsScreen({ reads, perpl, S, requireAccount }: AppCtx) {
  // Agents es pública, Market no (D23): requireAccount desvía a Sign in y vuelve con el patch.
  const ask = (a: Agent) => requireAccount("market", { askAgentId: a.id, marketTab: "ask", perpsMarketId: askMarketId(S.perpsMarketId, perpl.context?.markets ?? []) });
  return (
    <Page gap={12}>
      {reads.agentsError ? (
        <Warn title="Couldn't load agents" body={reads.agentsError}>
          <Chip label="Retry" onPress={() => { void reads.refresh(); }} style={{ alignSelf: "flex-start" }} accessibilityLabel="retry-agents" />
        </Warn>
      ) : null}
      {reads.agents === null && !reads.agentsError ? <><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /><Skeleton.Card lines={4} /></> : null}
      {reads.agents !== null ? (
        <Reveal style={{ gap: 10 }}>
          {reads.agents.map((a) => (
            <TouchCard key={a.id} onPress={() => ask(a)} accessibilityLabel={`agent-row-${a.id}`} style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar initials={initials(a.name)} size={44} s={13} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T w={600} s={18} lh={1.15}>{a.name}</T>
                  <T w={500} s={10} lh={1} ls={0.06} mono color={C.faint} style={{ marginTop: 4 }}>BY {a.owner.toUpperCase()}</T>
                </View>
              </View>
              <T w={400} s={14.5} lh={1.4} color={C.dim}>{agentBlurb(a.id)}</T>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.bg }}>
                  <Tag>HIT · {a.record.resolved} RESOLVED</Tag>
                  <T w={700} s={19} mono style={{ marginTop: 6 }}>{hitRate(a.record)}</T>
                </View>
                <View style={{ flex: 1, padding: 12, borderRadius: 14, backgroundColor: C.bg }}>
                  <Tag>BRIER · LOWER IS BETTER</Tag>
                  <T w={700} s={19} mono style={{ marginTop: 6 }}>{a.record.brierAvg === null ? "—" : a.record.brierAvg.toFixed(2)}</T>
                </View>
              </View>
              <Btn label={`Ask · ${a.priceCredits} credit${a.priceCredits === 1 ? "" : "s"}`} icon="ask" onPress={() => ask(a)} variant="ask" py={12} accessibilityLabel={`ask-agent-${a.id}`} />
            </TouchCard>
          ))}
        </Reveal>
      ) : null}
    </Page>
  );
}
```
**Market sin mercado elegido.** Agents no está en `PERPL_SCREENS`: si se arranca en Wallet y se pasa a Agents, `perpl.context` es `null` y `askMarketId` devuelve `undefined`. En `MarketScreen` (`market.tsx`), antes del `if (!market)`, agrega:
```tsx
const fallbackId = S.perpsMarketId === undefined ? askMarketId(undefined, perpl.context?.markets ?? []) : undefined;
useEffect(() => { if (fallbackId !== undefined) set({ perpsMarketId: fallbackId }); }, [fallbackId, set]);
if (S.perpsMarketId === undefined) return <MarketSkeleton />;
```
(importa `useEffect` y `askMarketId`; súmalo a **Files** y al `git add`). Con eso Market resuelve BTC cuando llega el contexto, en lugar de mostrar "isn't listed".

En `Navigator.tsx`: `const AgentsList = withPage("agents", AgentsScreen);`. `AgentProfile` sigue siendo un stub, `withPage("agent", () => <Page><T>Agent</T></Page>)` (importa `Page` y `T` de primitives).

- [ ] **Step 4: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/reads/agentsCopy.ts apps/mobile/__tests__/agentsCopy.test.ts apps/mobile/src/screens/agents.tsx apps/mobile/src/screens/market.tsx apps/mobile/src/navigation/Navigator.tsx
git commit -m "feat(mobile): pestaña Agents con récord real y Ask al mercado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Portfolio — totales, Positions, Reads y Backed (D7, D8, D17)

**Files:**
- Create: `src/perpl/portfolio.ts`, `__tests__/portfolio.test.ts`
- Rewrite: `src/screens/portfolio.tsx`

**Interfaces:**
- Consumes: `PositionsPanel`, `TradingWarns` (Task 9); `askMarketId` (Task 3); `lockedCollateral`, `unrealisedPnl`; `ReadCard`-like row; `reads.reads`.
- Produces:
  - `portfolioTotals(input: { b: bigint; lb: bigint; locked: bigint; upnl: bigint | null }): { total: bigint; positions: bigint; available: bigint; inOrders: bigint }`.
  - Las fórmulas:
    - `available = max(b − lb, 0)`
    - `inOrders = min(lb, b)`
    - `positions = locked + (upnl ?? 0)`
    - `total = available + inOrders + positions`
  - `PortfolioScreen(ctx: AppCtx)`.

- [ ] **Step 1: Test**

`__tests__/portfolio.test.ts`:
```ts
import { portfolioTotals } from "../src/perpl/portfolio";

const A = 1_000_000n; // 1 AUSD (6 decimales)

test("total = free + locked in orders + position collateral + unrealised PnL (D7)", () => {
  expect(portfolioTotals({ b: 100n * A, lb: 10n * A, locked: 20n * A, upnl: -2n * A }))
    .toEqual({ available: 90n * A, inOrders: 10n * A, positions: 18n * A, total: 118n * A });
});

test("no PnL yet counts as zero; lb above b never goes negative", () => {
  expect(portfolioTotals({ b: 5n * A, lb: 0n, locked: 0n, upnl: null })).toEqual({ available: 5n * A, inOrders: 0n, positions: 0n, total: 5n * A });
  expect(portfolioTotals({ b: 5n * A, lb: 8n * A, locked: 0n, upnl: null })).toEqual({ available: 0n, inOrders: 5n * A, positions: 0n, total: 5n * A });
});
```

- [ ] **Step 2: Verlo fallar e implementar**

Run: `npx jest __tests__/portfolio.test.ts` → FAIL.

`src/perpl/portfolio.ts`:
```ts
/**
 * Bloque TOTAL de Portfolio (spec mobile-light D7). `b` = saldo de la cuenta de Perpl fuera de posiciones,
 * `lb` = parte de `b` bloqueada por órdenes (el ticket usa `b − lb` como libre), `locked` = colateral de
 * posiciones (`lockedCollateral`), `upnl` = PnL no realizado. El saldo de la wallet no entra: vive en Wallet.
 */
export function portfolioTotals({ b, lb, locked, upnl }: { b: bigint; lb: bigint; locked: bigint; upnl: bigint | null }) {
  const inOrders = lb < b ? lb : b;
  const available = b - inOrders;
  const positions = locked + (upnl ?? 0n);
  return { total: available + inOrders + positions, positions, available, inOrders };
}
```
Run: `npx jest __tests__/portfolio.test.ts` → PASS.

- [ ] **Step 3: `portfolio.tsx`**

```tsx
import { useState } from "react";
import { View } from "react-native";
import { formatAusd } from "../config/chain";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { formatPnl, lockedCollateral, unrealisedPnl } from "../perpl/orders";
import { portfolioTotals } from "../perpl/portfolio";
import { cellLabel, formatProbability, formatRemaining } from "../reads/matrix";
import type { Read, ReadStatus } from "../reads/types";
import { Btn, Card, EmptyPanel, InkBlock, InkTile, Page, Reveal, Segmented, Skeleton, T, Tag, TouchCard, Warn } from "../ui/primitives";
import { C } from "../ui/theme";
import { askMarketId } from "../store";
import { PositionsPanel, TradingWarns } from "./tradingGate";

type Tab = "positions" | "reads" | "backed";

const READ_TAG: Record<ReadStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: "READING", fg: C.faint, bg: C.ctl },
  open: { label: "IN WINDOW", fg: C.warn, bg: C.warnBg },
  right: { label: "RIGHT", fg: C.limeInk, bg: C.limeBg14 },
  wrong: { label: "WRONG", fg: C.down, bg: C.downBg },
  void: { label: "VOID", fg: C.faint, bg: C.ctl },
  failed: { label: "FAILED", fg: C.faint, bg: C.ctl },
};

function Totals({ perpl }: Pick<AppCtx, "perpl">) {
  const acc = perpl.live?.account ?? null;
  const positions = perpl.live?.positions ?? [];
  const b = acc?.b ?? perpl.lastBalance ?? null;
  const t = b === null ? null : portfolioTotals({ b, lb: acc?.lb ?? 0n, locked: lockedCollateral(positions), upnl: unrealisedPnl(positions, perpl.context?.markets ?? []) });
  const upnl = unrealisedPnl(positions, perpl.context?.markets ?? []);
  const tile = (k: string, v: string, fg: string) => (
    <InkTile><Tag color={C.onInkDim}>{k}</Tag><T w={700} s={15} mono color={fg} style={{ marginTop: 6 }}>{v}</T></InkTile>
  );
  return (
    <InkBlock gap={12}>
      <Tag color={C.onInkDim}>TOTAL VALUE · AUSD{acc ? "" : b !== null ? " · LAST SEEN" : ""}</Tag>
      {t === null ? <Skeleton h={44} w="60%" /> : <T w={700} s={44} lh={1} ls={-0.03} mono color={C.onInk}>{formatAusd(t.total)}</T>}
      {upnl !== null ? <T w={500} s={11} mono color={upnl <= -10_000n ? C.downOnInk : C.limeOnInk}>{formatPnl(upnl)} AUSD UNREALISED</T> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {tile("POSITIONS", t ? formatAusd(t.positions) : "—", C.limeOnInk)}
        {tile("AVAILABLE", t ? formatAusd(t.available) : "—", C.onInkSoft)}
        {tile("BACKED", "—", C.vioOnInk)}
      </View>
      {t && t.inOrders > 0n ? <T w={400} s={11.5} color={C.onInkDim}>{formatAusd(t.inOrders)} AUSD held by open orders.</T> : null}
    </InkBlock>
  );
}

function ReadRow({ read, name, now, onPress }: { read: Read; name: string; now: number; onPress: () => void }) {
  const tag = READ_TAG[read.status];
  return (
    <TouchCard onPress={onPress} accessibilityLabel={`read-${read.id}`} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
      <T w={700} s={26} mono color={C.vio} style={{ width: 70 }}>{read.probability === null ? "—" : formatProbability(read.probability)}</T>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <T w={600} s={14} lh={1.3} numberOfLines={2}>{read.symbol} {cellLabel(read)}</T>
        <T w={500} s={10} lh={1} mono color={C.faint}>{name.toUpperCase()} · {read.creditsCharged} CREDIT{read.status === "open" ? ` · ${formatRemaining(Date.parse(read.expiresAt) - now).toUpperCase()}` : ""}</T>
      </View>
      <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: tag.bg }}><Tag color={tag.fg} s={9.5}>{tag.label}</Tag></View>
    </TouchCard>
  );
}

/** Portfolio (D17): TOTAL, Positions (Perpl, con Close), Reads (tus reads) y Backed (coming soon, se integra con Launchpad). */
export function PortfolioScreen(ctx: AppCtx) {
  const { perpl, reads, nav } = ctx;
  const [tab, setTab] = useState<Tab>("positions");
  const now = useNow(30_000);
  const name = (id: string) => reads.agents?.find((a) => a.id === id)?.name ?? id;
  return (
    <Page gap={14}>
      <Totals perpl={perpl} />
      <Segmented options={[["positions", "Positions"], ["reads", "Reads"], ["backed", "Backed"]] as const} value={tab} onChange={setTab} />
      {tab === "positions" ? (
        perpl.state.status === "ready" ? <View style={{ gap: 10 }}><TradingWarns perpl={perpl} /><PositionsPanel {...ctx} /></View>
        : perpl.state.status === "loading" ? <Skeleton.Card lines={3} />
        : (
          <Card gap={10}>
            <T w={600} s={16}>Trading not enabled</T>
            <T w={400} s={13.5} lh={1.45} color={C.dim}>Positions live on Perpl. Enable or reconnect trading from a market's Trade tab.</T>
            <Btn label="Open a market" arrow variant="lime" py={12} onPress={() => nav("market", { marketTab: "trade", perpsMarketId: askMarketId(ctx.S.perpsMarketId, perpl.context?.markets ?? []) })} accessibilityLabel="portfolio-enable" />
          </Card>
        )
      ) : tab === "reads" ? (
        reads.session !== "ready" ? (
          <Warn title="Unlock to see your reads" body="Your wallet signs once a day for Ask. No transaction, no gas.">
            <T w={600} s={13} color={C.vio} onPress={() => { void reads.ensureSession(); }}>Unlock with Face ID</T>
          </Warn>
        ) : reads.reads === null ? <><Skeleton.Card lines={2} /><Skeleton.Card lines={2} /></>
        : reads.reads.length === 0 ? <Reveal><EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>No reads yet. Ask an agent from any market.</T></EmptyPanel></Reveal>
        : <Reveal style={{ gap: 10 }}>{reads.reads.map((r) => <ReadRow key={r.id} read={r} name={name(r.agentId)} now={now} onPress={() => nav("read", { readId: r.id })} />)}</Reveal>
      ) : (
        <EmptyPanel><T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center" }}>Backing agents comes with Launchpad.</T></EmptyPanel>
      )}
      {reads.listError && tab === "reads" ? <Warn title="Couldn't load your reads" body={reads.listError} /> : null}
    </Page>
  );
}
```
`T` no acepta `onPress`: en el Warn de Reads usa `<Btn label="Unlock with Face ID" onPress={() => { void reads.ensureSession(); }} variant="violet" py={11} accessibilityLabel="reads-unlock" />`. Sin key, Portfolio **no** corre Enable: la card manda a Market → Trade, donde vive Enable/Reconnect (D7, D17). `#FF8FB8` es `C.downOnInk` (creado en Task 10). `#B9A5FF` es el violeta claro del Handoff sobre ink: súmalo a `C` como `vioOnInk` y usa ambos por nombre.

- [ ] **Step 4: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/perpl/portfolio.ts apps/mobile/__tests__/portfolio.test.ts apps/mobile/src/screens/portfolio.tsx apps/mobile/src/ui/theme.ts apps/mobile/__tests__/theme.test.ts
git commit -m "feat(mobile): Portfolio real (TOTAL, Positions con Close, Reads, Backed coming soon)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Agrega la aserción de `vioOnInk` al test de tokens: `expect(C.vioOnInk).toBe("#B9A5FF");`).

---

### Task 13: Pantalla Read (D14)

**Files:**
- Rewrite: `src/screens/read.tsx`
- Modify: `src/screens/ask.tsx` (exportar `resolutionLine`)

**Interfaces:**
- Consumes: `S.readId`; `reads.reads`; `reads.fetchOne` (Task 6); `levelFromRead`, `sideFor`, `levelIsLive`.
- Produces: `ReadScreen(ctx: AppCtx)`.

- [ ] **Step 1: `read.tsx`**

```tsx
import { useEffect, useState } from "react";
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { useNow } from "../hooks/useNow";
import { formatPrice } from "../perpl/orders";
import { levelFromRead, levelIsLive, sideFor } from "../reads/level";
import { cellLabel, formatRemaining } from "../reads/matrix";
import type { Read } from "../reads/types";
import { Avatar, Btn, Card, Page, Skeleton, T, Tag, Warn } from "../ui/primitives";
import { C } from "../ui/theme";
import { resolutionLine } from "./ask";

const STATE: Record<Read["status"], { label: string; fg: string; bg: string }> = {
  pending: { label: "READING", fg: C.faint, bg: C.ctl },
  open: { label: "OPEN", fg: C.warn, bg: C.warnBg },
  right: { label: "RIGHT", fg: C.limeInk, bg: C.limeBg14 },
  wrong: { label: "WRONG", fg: C.down, bg: C.downBg },
  void: { label: "VOID", fg: C.faint, bg: C.ctl },
  failed: { label: "FAILED", fg: C.faint, bg: C.ctl },
};

/** Read pagada (D14): pregunta y probabilidad, relojes, ITS READ, WHY, LIMITS. Sin BOOK IS AT ni SOURCES. */
export function ReadScreen({ S, reads, nav }: AppCtx) {
  const now = useNow(30_000);
  const listed = (reads.reads ?? []).find((r) => r.id === S.readId) ?? null;
  const [fetched, setFetched] = useState<Read | null>(null);
  const [missing, setMissing] = useState(false);
  const { fetchOne } = reads;
  useEffect(() => {
    if (listed || !S.readId) return;
    let stale = false;
    void fetchOne(S.readId).then((r) => { if (stale) return; if (r) setFetched(r); else setMissing(true); });
    return () => { stale = true; };
  }, [listed, S.readId, fetchOne]);
  const read = listed ?? fetched;

  if (!read) {
    return missing
      ? <Page><Warn title="Couldn't open this read" body="It may belong to another wallet, or the reads service is unreachable." /></Page>
      : <Page gap={12}><Skeleton.Card lines={4} /><Skeleton.Card lines={2} /></Page>;
  }
  const agent = reads.agents?.find((a) => a.id === read.agentId);
  const name = agent?.name ?? read.agentId;
  const st = STATE[read.status];
  const line = resolutionLine(read, now);
  const trade = () => {
    const level = levelFromRead(read);
    nav("market", levelIsLive(level, now)
      ? { perpsMarketId: read.marketId, marketTab: "trade", tradeLevel: level, perpsSide: sideFor(read.levelBps) }
      : { perpsMarketId: read.marketId, marketTab: "trade" });
  };
  return (
    <Page gap={14}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar initials={name.slice(0, 2).toUpperCase()} size={40} />
        <View style={{ flex: 1 }}>
          <T w={600} s={17}>{name}</T>
          <Tag style={{ marginTop: 4 }}>READ · {read.creditsCharged} CREDIT · {read.symbol} {cellLabel(read)}</Tag>
        </View>
        <View style={{ paddingVertical: 5, paddingHorizontal: 9, borderRadius: 999, backgroundColor: st.bg }}><Tag color={st.fg} s={9.5}>{st.label}</Tag></View>
      </View>
      <View style={{ padding: 18, borderRadius: 22, backgroundColor: C.vio, gap: 10 }}>
        <Tag color="#D9D0FF">THE QUESTION</Tag>
        <T w={600} s={17} lh={1.35} color={C.onInk}>{read.question}</T>
        <T w={700} s={64} lh={1} ls={-0.04} mono color={C.onInk}>{read.probability === null ? "—" : `${Math.round(read.probability * 100)}%`}</T>
        <Tag color="#D9D0FF">ITS PROBABILITY · MARK {formatPrice(read.markAtRequest, read.priceDecimals)} AT REQUEST</Tag>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Card style={{ flex: 1 }} pad={14}><Tag>ASKED</Tag><T w={700} s={15} mono style={{ marginTop: 6 }}>{new Date(read.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</T></Card>
        <Card style={{ flex: 1 }} pad={14}><Tag>EVALUATES</Tag><T w={700} s={15} mono style={{ marginTop: 6 }}>{read.status === "open" ? formatRemaining(Date.parse(read.expiresAt) - now) : new Date(read.expiresAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</T></Card>
      </View>
      <T w={500} s={11.5} lh={1.4} mono color={line.fg}>{line.text}</T>
      {read.reasons ? (
        <View style={{ gap: 8 }}>
          <Tag>WHY</Tag>
          {read.reasons.map((r, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 7, height: 7, borderRadius: 999, marginTop: 7, backgroundColor: [C.vio, C.lime, C.pending][i % 3] }} />
              <T w={400} s={15} lh={1.45} style={{ flex: 1 }}>{r}</T>
            </View>
          ))}
        </View>
      ) : null}
      {read.limits ? (
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.warnBg, gap: 6 }}>
          <Tag color={C.warn}>LIMITS</Tag>
          <T w={400} s={14} lh={1.45} color={C.ink}>{read.limits}</T>
        </View>
      ) : null}
      {read.error ? <Warn title="The agent couldn't answer" body={read.error} /> : null}
      <Btn label="Trade this market" arrow onPress={trade} variant="lime" accessibilityLabel="trade-this-market" />
      <T w={400} s={12} lh={1.4} color={C.faint} style={{ textAlign: "center" }}>A read is not a trading permission.</T>
    </Page>
  );
}
```
**Ruling:** la barra fija de D14 ("Trade this market") y la del ticket de D11 ("Long to X within 4H · Review") quedan en F1 como botón al final del contenido. Fijarlas exige un `footer` en `Page` con estado elevado del ticket, y eso se hace en F2 con el board. Anótalo en el audit como residual para F2. El nombre del Handoff "DELIVERED IN" no tiene dato (no guardamos `latency` en el DTO), así que se usa ASKED (`createdAt`). Anótalo en el audit. `#D9D0FF` es texto claro sobre violeta: súmalo a `C` como `onVio` y úsalo por nombre (con su aserción en `theme.test.ts`). En `ask.tsx` agrega `export` a `function resolutionLine`.

- [ ] **Step 2: Tipos, tests y commit**

```bash
npx tsc --noEmit && echo TSC_OK && npm test 2>&1 | tail -3
git add apps/mobile/src/screens/read.tsx apps/mobile/src/screens/ask.tsx apps/mobile/src/ui/theme.ts apps/mobile/__tests__/theme.test.ts
git commit -m "feat(mobile): pantalla Read del Handoff (pregunta, probabilidad, WHY, LIMITS)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Barrido de restos oscuros y copy

**Files:**
- Modify: los que el barrido encuentre (típicamente `DevControls.tsx`, `comingSoon.tsx`, `book.tsx`)

- [ ] **Step 1: Buscar valores y copy viejos**

```bash
grep -rnE "#05061A|#0A0B2E|#1B1F6B|#F5F6FF|rgba\(245,246,255|rgba\(5,6,26|ChakraPetch|Manrope|light-content" src App.tsx app.config.ts || echo SIN_RESTOS
grep -rnE "My reads|from Markets|Back to Markets" src
grep -rn "C\.lime\b" src | grep -v theme.ts
```
Expected: `SIN_RESTOS`, y cada línea de `C.lime` revisada a mano con la regla de Task 1 Step 6 (relleno sí; texto sobre ink = `C.limeOnInk`). Para cada línea de copy, decide:
- **"Back to Markets"** sólo se queda donde de verdad vuelve a Markets (Market sin contexto, orden fallida).
- **"My reads"** desaparece.
- **"from Markets"** pasa a "from Portfolio" donde se refiere a cerrar posiciones.

- [ ] **Step 2: Suite completa, tipos y commit**

```bash
npm test 2>&1 | tail -5
npx tsc --noEmit && echo TSC_OK
git add $(git diff --name-only -- apps/mobile)
git status --short
git commit -m "chore(mobile): barrido de colores oscuros y copy tras el rediseño light

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Revisa con `git status --short` que la lista sólo trae archivos de esta tarea antes del commit.)

---

### Task 15: Rebuild nativo, verificación en el simulador, README, overview y audit

**Files:**
- Modify: `apps/mobile/README.md`, `docs/overview/2026-09-28-mobile-light.html`, `docs/overview/data/manifest.js`
- Create: `docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md`

- [ ] **Step 1: Rebuild**

Desde `apps/mobile` (fondos nativos y fuente nueva: hace falta prebuild):
```bash
npx expo prebuild --clean --platform ios
npx expo run:ios --device 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0
```
Expected: la app abre en el simulador en Wallet, con fondo blanco y el splash blanco. Si el simulador perdió Face ID, usa los comandos `notifyutil` del README.

- [ ] **Step 2: Recorrido con capturas**

Captura cada estado con `xcrun simctl io 2B2A0BAD-7B14-4DAE-8652-C7E9472505E0 screenshot <scratch>/f1-<n>.png` y **ábrela con la herramienta de lectura de imágenes** junto a su pantalla del Handoff:
1. Wallet con saldo e IN TRADING. Pending y Activity. Deposit con QR. Withdraw en edición.
2. Markets con búsqueda "mon" y sin búsqueda. Una tarjeta con sparkline después de ~30 s.
3. Market en Trade it: con key, ticket y el book plegado y desplegado; sin key, Enable trading. Market en Ask an agent: matriz con banda MARK y puntos.
4. Agents: la lista. Tocar Ask de Drift abre Market en Ask con Drift elegido.
5. Portfolio: TOTAL con la cuenta #620, Positions en LIVE (sin haber pasado por Markets) y Reads. Tocar una read abre Read.
6. Read: pregunta, probabilidad y LIMITS; "Trade this market" abre Market en Trade con el nivel si la read sigue abierta.
7. Sign in: los tres estados (idle, waiting, done). Para llegar, Sign out desde Wallet.
8. Tab bar: el tinte de cada pestaña; Launchpad y Activity no aparecen.
9. Dynamic Type XXXL (el simulador compartido suele estar así): Markets y Portfolio sin texto cortado que impida leer cifras.

Expected: ningún texto lima ni ámbar sobre blanco; ninguna superficie navy. Cada desvío frente al Handoff queda listado en el audit como ruling o como residual.

- [ ] **Step 3: Recorrido de dinero real (mínimo)**

Con la cuenta #620: abre un long de 2 AUSD a 1× desde Market (Trade it) → "See it in Portfolio" → Close desde Portfolio. Anota el saldo antes y después en el audit, como en `mobile-hifi` F2.

- [ ] **Step 4: README, overview y audit**

- `apps/mobile/README.md`: la referencia de diseño pasa a `pickler-mobile@1808d5b` (`design/`, sistema light). También documenta las fuentes nuevas y `scripts/archivo-instance.sh`, las 4 pestañas, Launchpad y Activity ocultas, y la trampa "lima como texto no se lee sobre blanco".
- Overview `docs/overview/2026-09-28-mobile-light.html`: la phase-card F1 recibe su `<details class="tasks">` con las tareas 0–15, y su estado pasa a `completed` con evidencia. En `manifest.js`, la fase 1 pasa a `completed` y `types` a `['spec', 'plan']`.
- Audit `docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md`, con:
  - los rulings de este plan: sin `IF IT HITS`, "See it in Portfolio", ASKED en vez de DELIVERED, Agents → Ask en F1 y dependencias sin uso;
  - las capturas miradas;
  - la salida de `npm test` y `tsc`;
  - el recorrido de dinero;
  - los residuales para F2.
- Desde la raíz del worktree: `node scripts/docs-md-to-html.mjs docs/superpowers/plans/2026-09-28-mobile-light-f1.md`, `npm run docs:check`, `npm run agents:check`, y el render del overview con `node scripts/agent-infra/render-check.mjs <scratch> 2026-09-28-mobile-light`, mirando la captura de 390 px.

- [ ] **Step 5: Commit y checkpoint**

```bash
git add apps/mobile/README.md docs/overview/2026-09-28-mobile-light.html docs/overview/data/manifest.js docs/superpowers/audits/2026-09-28-mobile-light-f1-rulings.md docs/superpowers/plans/2026-09-28-mobile-light-f1.html
git commit -m "docs(mobile-light): F1 completada — README, overview y audit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
**Para aquí.** F2 (board, perfil y onboarding) y cualquier build de TestFlight esperan a que Jesús decida.
