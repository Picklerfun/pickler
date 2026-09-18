# Rediseño hi-fi — F1: tema, primitivas, Shell, Wallet, Sign in y coming soon — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app compila y corre en el simulador con el tema del hi-fi en todas las rutas; Wallet, Deposit, Withdraw y Sign in quedan re-vestidos con lógica intacta; Launchpad, Activity y Portfolio muestran el coming soon nuevo; el mock del wireframe desaparece; Markets/Market/Funds compilan con las primitivas nuevas (su re-maquetado es F2).

**Architecture:** Se reescriben tres cimientos (`ui/theme.ts`, `ui/primitives.tsx`, `store.ts`) con los nombres del diseño (`pickler-mobile/src/theme.js`, `ui.js`, `store.js`) y sobre ellos se portan las pantallas. El `Shell` dibuja el backdrop (gradiente + puntos SVG), header y tab bar del hi-fi. Toda la lógica de cuenta, tesorería y Perpl (`hooks/`, `wallet/`, `perpl/`) queda sin tocar.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / TypeScript 6 / Jest 29 (`jest-expo`). Nuevas: `expo-linear-gradient`, `react-native-svg`, `lucide-react-native 1.47.0`, `@expo-google-fonts/chakra-petch 0.4.1`. Sale `@expo/vector-icons`.

**Spec:** `docs/superpowers/specs/2026-09-18-mobile-hifi-design.md` (decisiones D4–D12, D16–D18, D22–D24). El plan argumenta desde ahí; léelo antes de empezar.

## Global Constraints

- Worktree `.claude/worktrees/mobile-hifi`, rama `feat/mobile-hifi`. Todo se corre desde `apps/mobile` dentro del worktree. Nunca `git add -A`; archivos por nombre. Commits con formato `feat(mobile): …` / `chore(mobile): …` y trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Tokens de color y familias tipográficas **tal cual** el diseño (D8, D9): `ink #F5F6FF`, `lime #C8F03A`, `onLime #0B1200`, `vio #B9A5FF`, `vioSolid #9B7BFF`, `down #FF5FA2`, `warn #FFC93F`, `bgTop #1B1F6B`, `bgMid #0A0B2E`, `bgBottom #05061A`. Manrope 400/500/600/700 (800 → 700), JetBrains Mono 400/500/700, Chakra Petch 600/700.
- Vocabulario de primitivas del diseño (D12): `Tag` = línea mono mayúscula; `Chip` = píldora. `Sparkline` y `SearchBox` **no** se portan.
- Tab bar (D4): `MARKETS · LAUNCHPAD · ACTIVITY · PORTFOLIO · WALLET`, iconos lucide `chart · rocket · activity · layers · wallet`.
- Pantallas (D5): `markets | market | perpsFunds | launchpad | activity | portfolio | wallet | deposit | withdraw | signin`. `COMING_SOON = ["launchpad","activity","portfolio"]`. `GATED = ["markets","market","perpsFunds","wallet","deposit","withdraw"]`. `CAN_BACK = ["market","perpsFunds","deposit","withdraw","signin"]`. `SHOW_TABS = ["markets","launchpad","activity","portfolio","wallet"]`.
- Copy de coming soon (D17): Launchpad → "Agents with a token"; Activity → "What the agents you follow are doing"; Portfolio → "Tokens · Perps · Reads". Subtítulo de header: "Coming soon".
- Sign in (D18): header `["Wallet access", "Passkey on this device"]`; copy "Reading and following never need an account. The wallet appears the first time money moves." y "Connecting is not signing. Every operation is confirmed on its own."
- Arranque en Wallet, swipe atrás y pull-to-refresh se conservan (D7). Sin react-navigation, gesture-handler ni reanimated.
- `assets/pickler-mark.png` sigue siendo el logo del header (D6).
- Al cerrar F1: `npm test` y `npx tsc --noEmit` en verde, app corriendo en simulador con capturas, README actualizado, overview con F1 `completed`, audit `docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md`. **Sin push ni TestFlight** (eso es F2).
- Entre tareas 1–9 `tsc` puede estar en rojo (renombres cruzados); los tests de módulos puros (`theme`, `store`, `comingSoon`, `chain`, `perpl-*`) deben pasar en cada tarea que los toque. `tsc` limpio es obligatorio al cerrar la Task 9.

---

## Mapa de archivos

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `apps/mobile/package.json`, `package-lock.json` | modificar | dependencias D11 |
| `apps/mobile/app.config.ts` | modificar | `backgroundColor #05061A` |
| `apps/mobile/App.tsx` | modificar | fuentes nuevas, `PERPL_SCREENS`, `ctx` sin `resume` |
| `src/ui/theme.ts` | reescribir | tokens, `fam`, `textStyle`, `pill` |
| `src/ui/primitives.tsx` | reescribir | primitivas del diseño |
| `src/store.ts` | reescribir | navegación, gates, header, `held` |
| `src/screens/comingSoonCopy.ts`, `comingSoon.tsx` | reescribir | pantalla y tarjeta coming soon |
| `src/screens/signin.tsx` | crear (desde `trade.tsx`) | gate de passkey |
| `src/screens/wallet.tsx` | crear (desde `own.tsx`) | Wallet, Deposit, Withdraw |
| `src/screens/markets.tsx` | renombrar desde `perps.tsx` | adaptación mecánica (re-maquetado en F2) |
| `src/screens/market.tsx` | renombrar desde `perpsMarket.tsx` | adaptación mecánica |
| `src/screens/perpsFunds.tsx` | modificar | adaptación mecánica |
| `src/Shell.tsx` | reescribir | backdrop, header, tabs |
| `src/DevControls.tsx` | reescribir | panel dev podado |
| `src/screens/discover.tsx`, `follow.tsx`, `trade.tsx`, `own.tsx`, `src/mock/data.ts`, `src/mock/helpers.ts`, `__tests__/helpers.test.ts` | borrar | mock del wireframe |
| `__tests__/theme.test.ts`, `store.test.ts`, `comingSoon.test.ts` | reescribir | pruebas de los cimientos |
| `apps/mobile/README.md` | modificar | referencia al hi-fi y dependencias |

---

### Task 0: Bootstrap del worktree y dependencias nuevas

**Files:**
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json`

**Interfaces:**
- Produces: `node_modules` con `expo-linear-gradient`, `react-native-svg`, `lucide-react-native`, `@expo-google-fonts/chakra-petch`; sin `@expo/vector-icons`.

- [ ] **Step 1: Instalar y medir la línea base**

Run (desde `.claude/worktrees/mobile-hifi/apps/mobile`):
```bash
npm install
npm test 2>&1 | tail -6
npx tsc --noEmit && echo TSC_OK
```
Expected: `Tests: 178 passed, 178 total` (24 suites) y `TSC_OK`. Si la línea base no está en verde, **para** y repórtalo: no se construye sobre rojo.

- [ ] **Step 2: Agregar las dependencias de D11**

```bash
npx expo install expo-linear-gradient react-native-svg
npm install --save-exact lucide-react-native@1.47.0 @expo-google-fonts/chakra-petch@0.4.1
npm uninstall @expo/vector-icons
```
Expected: `package.json` con `"expo-linear-gradient": "57.0.2"` (o la que resuelva `expo install` para SDK 57), `"react-native-svg": "15.15.x"`, `"lucide-react-native": "1.47.0"`, `"@expo-google-fonts/chakra-petch": "0.4.1"`, y sin `@expo/vector-icons`. Comprueba que los pines quedaron **exactos** (sin `^`/`~`); si `expo install` los dejó con rango, edítalos a mano a la versión instalada (`npm ls expo-linear-gradient react-native-svg`).

- [ ] **Step 3: Verificar que las fuentes existen en el paquete**

```bash
node -e "const f=require('@expo-google-fonts/chakra-petch');console.log(Object.keys(f).filter(k=>/600|700/.test(k)))"
node -e "const f=require('@expo-google-fonts/jetbrains-mono');console.log(Object.keys(f).filter(k=>/700/.test(k)))"
```
Expected: `[ 'ChakraPetch_600SemiBold', 'ChakraPetch_700Bold' ]` (más itálicas) y `JetBrainsMono_700Bold` presente.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(mobile): dependencias del hi-fi (linear-gradient, svg, lucide, Chakra Petch); sale vector-icons

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `ui/theme.ts` — tokens, fuentes, `pill` (D8, D9)

**Files:**
- Rewrite: `apps/mobile/src/ui/theme.ts`
- Test: `apps/mobile/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `C` (tokens), `F` (familias), `fam(weight, kind?)`, `textStyle(weight, size, opts)`, `pill(on)`, tipos `FontKind`, `TypeOpts`, `Pill`.

- [ ] **Step 1: Reescribir el test**

`apps/mobile/__tests__/theme.test.ts`:
```ts
import { C, fam, pill, textStyle } from "../src/ui/theme";

test("weights map to the loaded Manrope families; 800 collapses to 700", () => {
  expect(fam(400)).toBe("Manrope_400Regular");
  expect(fam(500)).toBe("Manrope_500Medium");
  expect(fam(600)).toBe("Manrope_600SemiBold");
  expect(fam(700)).toBe("Manrope_700Bold");
  expect(fam(800)).toBe("Manrope_700Bold");
});

test("mono has three cuts and display two", () => {
  expect(fam(400, "mono")).toBe("JetBrainsMono_400Regular");
  expect(fam(500, "mono")).toBe("JetBrainsMono_500Medium");
  expect(fam(700, "mono")).toBe("JetBrainsMono_700Bold");
  expect(fam(600, "display")).toBe("ChakraPetch_600SemiBold");
  expect(fam(700, "display")).toBe("ChakraPetch_700Bold");
});

test("textStyle converts lh ratio and ls em to pixels", () => {
  expect(textStyle(700, 20, { display: true, lh: 1.15, ls: -0.02 })).toEqual({
    fontFamily: "ChakraPetch_700Bold",
    fontSize: 20,
    color: C.ink,
    lineHeight: 23,
    letterSpacing: -0.4,
  });
  expect(textStyle(500, 10, { mono: true, color: C.faint })).toEqual({ fontFamily: "JetBrainsMono_500Medium", fontSize: 10, color: C.faint });
});

test("tokens come verbatim from the hi-fi design", () => {
  expect(C.ink).toBe("#F5F6FF");
  expect(C.lime).toBe("#C8F03A");
  expect(C.vio).toBe("#B9A5FF");
  expect(C.down).toBe("#FF5FA2");
  expect(C.warn).toBe("#FFC93F");
  expect([C.bgTop, C.bgMid, C.bgBottom]).toEqual(["#1B1F6B", "#0A0B2E", "#05061A"]);
});

test("pill(on) is the selected filter chip of the design", () => {
  expect(pill(true)).toEqual({ bd: C.limeBd, bg: C.limeBg14, fg: C.lime });
  expect(pill(false)).toEqual({ bd: C.hair18, bg: "transparent", fg: C.dim });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `npx jest __tests__/theme.test.ts`
Expected: FAIL (`fam(800)` devuelve `Manrope_800ExtraBold`, `C.bgTop` undefined, `pill` no exportado).

- [ ] **Step 3: Reescribir `theme.ts`**

```ts
import type { TextStyle } from "react-native";

// Tokens portados de "Pickler Mobile App.dc.html" vía pickler-mobile@a0e353e (src/theme.js).
export const C = {
  ink: "#F5F6FF",
  dim: "#C3C9E4",
  faint: "#8891B5",

  hair: "rgba(245,246,255,0.16)",
  hair2: "rgba(245,246,255,0.3)",
  hair08: "rgba(245,246,255,0.08)",
  hair10: "rgba(245,246,255,0.10)",
  hair12: "rgba(245,246,255,0.12)",
  hair14: "rgba(245,246,255,0.14)",
  hair18: "rgba(245,246,255,0.18)",
  hair22: "rgba(245,246,255,0.22)",
  hair28: "rgba(245,246,255,0.28)",
  hair34: "rgba(245,246,255,0.34)",

  card: "rgba(245,246,255,0.05)",
  card04: "rgba(245,246,255,0.04)",
  card09: "rgba(245,246,255,0.09)",
  card10: "rgba(245,246,255,0.10)",
  deep: "rgba(5,6,26,0.65)",
  deep50: "rgba(5,6,26,0.5)",
  deep60: "rgba(5,6,26,0.6)",
  onDeep: "#05061A",
  slab: "#121216",

  vio: "#B9A5FF",
  vioSolid: "#9B7BFF",
  vioBd: "rgba(155,123,255,0.5)",
  vioBd45: "rgba(155,123,255,0.45)",
  vioBd40: "rgba(155,123,255,0.4)",
  vioBg: "rgba(155,123,255,0.12)",
  vioBg10: "rgba(155,123,255,0.1)",
  vioBg08: "rgba(155,123,255,0.08)",
  vioBg07: "rgba(155,123,255,0.07)",
  vioBg06: "rgba(155,123,255,0.06)",

  lime: "#C8F03A",
  onLime: "#0B1200",
  limeBd: "rgba(200,240,58,0.45)",
  limeBd40: "rgba(200,240,58,0.4)",
  limeBg: "rgba(200,240,58,0.1)",
  limeBg14: "rgba(200,240,58,0.14)",
  limeBg06: "rgba(200,240,58,0.06)",

  up: "#C8F03A",
  down: "#FF5FA2",
  downBd: "rgba(255,95,162,0.5)",
  downBd45: "rgba(255,95,162,0.45)",
  downBg: "rgba(255,95,162,0.07)",
  warn: "#FFC93F",
  warnBd: "rgba(255,201,63,0.45)",
  warnBg: "rgba(255,201,63,0.06)",
  cyan: "#7FE3FF",
  blue: "#5AD8FF",
  spark: "#A9B0D0",
  disabled: "#5C5C58",

  // Fondo del teléfono: radial-gradient(#1B1F6B → #0A0B2E → #05061A).
  bgTop: "#1B1F6B",
  bgMid: "#0A0B2E",
  bgBottom: "#05061A",
} as const;

// Nombres de familia que exportan @expo-google-fonts/*.
export const F = {
  r: "Manrope_400Regular",
  m: "Manrope_500Medium",
  sb: "Manrope_600SemiBold",
  b: "Manrope_700Bold",
  mono: "JetBrainsMono_400Regular",
  monoM: "JetBrainsMono_500Medium",
  monoB: "JetBrainsMono_700Bold",
  display: "ChakraPetch_700Bold",
  displaySb: "ChakraPetch_600SemiBold",
} as const;

export type FontKind = "mono" | "display";

/** Peso numérico del diseño → familia cargada. El hi-fi no usa ExtraBold: 800 cae en 700. */
export function fam(weight: number, kind?: FontKind): string {
  if (kind === "display") return weight >= 700 ? F.display : F.displaySb;
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

/** pill(on): seleccionado = borde lima .45 + relleno lima .14, como los filtros del diseño. */
export function pill(on: boolean): Pill {
  return on ? { bd: C.limeBd, bg: C.limeBg14, fg: C.lime } : { bd: C.hair18, bg: "transparent", fg: C.dim };
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `npx jest __tests__/theme.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/theme.ts __tests__/theme.test.ts
git commit -m "feat(mobile): tokens y tipografía del hi-fi (Chakra Petch, JetBrains 700, pill lima)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `ui/primitives.tsx` — primitivas del diseño (D12)

**Files:**
- Rewrite: `apps/mobile/src/ui/primitives.tsx`

**Interfaces:**
- Consumes: `C`, `textStyle`, `pill` de Task 1.
- Produces (todas exportadas): `T`, `Tag`, `Touch`, `Icon` + `IconName`, `Card`, `TouchCard`, `KV`, `KVList`, `Hair`, `Chip`, `Avatar`, `Btn` + `BtnVariant`, `Segmented`, `PillTabs`, `Bar`, `Warn`, `StatusCard`, `Screen`, `StatGrid`, `EmptyPanel`.

Sin test unitario (jest-expo no renderiza componentes con fuentes, límite conocido); la puerta es `tsc` al cerrar la Task 9 y la captura de la Task 10.

- [ ] **Step 1: Escribir el archivo completo**

```tsx
import type { ReactNode } from "react";
import { Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import {
  Activity, ArrowLeft, ArrowRight, ChartLine, CircleQuestionMark, Layers, Rocket, Search, Send, SlidersHorizontal, Wallet,
} from "lucide-react-native";
import { C, textStyle } from "./theme";

// ---------------------------------------------------------------------------
// Texto: w=peso, s=tamaño, lh=ratio, ls=em; mono (JetBrains) | display (Chakra Petch).
export type TProps = {
  w?: number; s?: number; lh?: number; ls?: number; mono?: boolean; display?: boolean; color?: string;
  style?: StyleProp<TextStyle>; numberOfLines?: number; children?: ReactNode;
};

export function T({ w = 400, s = 13, lh, ls, mono, display, color, style, numberOfLines, children }: TProps) {
  return (
    <Text numberOfLines={numberOfLines} style={[textStyle(w, s, { lh, ls, mono, display, color }), style]}>
      {children}
    </Text>
  );
}

/** Línea mono en mayúsculas: `font:500 9.5px/1 mono; letter-spacing:.1em`. */
export function Tag({ children, color = C.faint, s = 9.5, style }: { children: ReactNode; color?: string; s?: number; style?: StyleProp<TextStyle> }) {
  return <T w={500} s={s} lh={1} ls={0.1} mono color={color} style={style}>{children}</T>;
}

export type TouchProps = {
  onPress?: () => void; style?: StyleProp<ViewStyle>; children?: ReactNode; disabled?: boolean;
  hitSlop?: number; accessibilityLabel?: string;
};

export function Touch({ onPress, style, children, disabled, hitSlop, accessibilityLabel }: TouchProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.72 } : null]}
    >
      {children}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Iconos lucide (el diseño usa SVGs enmascarados con estos mismos glifos).
const ICONS = {
  back: ArrowLeft, arrow: ArrowRight, search: Search, send: Send, sliders: SlidersHorizontal, help: CircleQuestionMark,
  chart: ChartLine, rocket: Rocket, activity: Activity, layers: Layers, wallet: Wallet,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 15, color = C.ink, strokeWidth = 2 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const Cmp = ICONS[name];
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} />;
}

// ---------------------------------------------------------------------------
// Superficies.
export type CardProps = { children?: ReactNode; style?: StyleProp<ViewStyle>; bd?: string; bg?: string; radius?: number; pad?: number; gap?: number };

/** Superficie estándar: relleno .05 + hairline .14, radio 14. */
export function Card({ children, style, bd = C.hair14, bg = C.card, radius = 14, pad = 13, gap }: CardProps) {
  return (
    <View style={[{ padding: pad, borderRadius: radius, borderWidth: 1, borderColor: bd, backgroundColor: bg, gap }, style]}>
      {children}
    </View>
  );
}

export function TouchCard({ onPress, children, style, bd = C.hair14, bg = C.card, pad = 12, radius = 14, disabled, accessibilityLabel }: TouchProps & { bd?: string; bg?: string; pad?: number; radius?: number }) {
  return (
    <Touch onPress={onPress} disabled={disabled} accessibilityLabel={accessibilityLabel} style={[{ padding: pad, borderRadius: radius, borderWidth: 1, borderColor: bd, backgroundColor: bg }, style]}>
      {children}
    </Touch>
  );
}

/** Fila clave/valor mono: `font:500 10px/1.4 mono; color:#8891B5` con valor ink. */
export function KV({ k, v, vFg = C.ink, kFg = C.faint }: { k: string; v: string; vFg?: string; kFg?: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10 }}>
      <T w={500} s={10} lh={1.4} mono color={kFg}>{k}</T>
      <T w={500} s={10} lh={1.4} mono color={vFg} style={{ textAlign: "right", flexShrink: 1 }}>{v}</T>
    </View>
  );
}

export type KVRow = { label: string; value: string; fg?: string };

export function KVList({ rows, top, gap = 7, style }: { rows: KVRow[]; top?: boolean; gap?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap, paddingTop: top ? 9 : 0, borderTopWidth: top ? 1 : 0, borderTopColor: C.hair12 }, style]}>
      {rows.map((r, i) => <KV key={i} k={r.label} v={r.value} vFg={r.fg} />)}
    </View>
  );
}

export function Hair({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: C.hair12 }, style]} />;
}

/** Píldora con hairline: filtros, tabs y marcas pequeñas. */
export type ChipProps = {
  label: string; fg?: string; bd?: string; bg?: string; onPress?: () => void; mono?: boolean; dashed?: boolean;
  s?: number; py?: number; px?: number; w?: number; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
};

export function Chip({ label, fg = C.dim, bd = C.hair18, bg = "transparent", onPress, mono, dashed, s = 11, py = 7, px = 11, w = 600, style, accessibilityLabel }: ChipProps) {
  const inner = <T w={mono ? 500 : w} s={s} lh={1} mono={mono} color={fg}>{label}</T>;
  const box: ViewStyle = {
    paddingVertical: py, paddingHorizontal: px, borderRadius: 999, borderWidth: 1, borderColor: bd, backgroundColor: bg,
    alignItems: "center", justifyContent: "center", borderStyle: dashed ? "dashed" : "solid",
  };
  if (onPress) return <Touch onPress={onPress} accessibilityLabel={accessibilityLabel} style={[box, style]}>{inner}</Touch>;
  return <View style={[box, style]}>{inner}</View>;
}

/** Avatar cuadrado con iniciales: hairline .28, mono bold. */
export function Avatar({ initials, size = 36, radius = 11, s = 11 }: { initials: string; size?: number; radius?: number; s?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: radius, borderWidth: 1, borderColor: C.hair28, alignItems: "center", justifyContent: "center" }}>
      <T w={700} s={s} lh={1} mono color={C.dim}>{initials}</T>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Botones.
export type BtnVariant = "outline" | "outline2" | "outline20" | "lime" | "violet" | "violetSoft" | "violetSoft10" | "violetLine" | "violetLine45" | "ghost" | "dashed";

const VARIANTS: Record<BtnVariant, { bg: string; bd: string; fg: string; w: number }> = {
  outline: { bg: "transparent", bd: C.hair34, fg: C.ink, w: 600 },
  outline2: { bg: "transparent", bd: C.hair2, fg: C.ink, w: 600 },
  outline20: { bg: "transparent", bd: "rgba(245,246,255,0.2)", fg: C.ink, w: 600 },
  lime: { bg: C.lime, bd: C.lime, fg: C.onLime, w: 700 },
  violet: { bg: C.vioSolid, bd: C.vioSolid, fg: C.onDeep, w: 700 },
  violetSoft: { bg: C.vioBg, bd: C.vioBd, fg: C.vio, w: 700 },
  violetSoft10: { bg: C.vioBg10, bd: C.vioBd, fg: C.vio, w: 600 },
  violetLine: { bg: "transparent", bd: C.vioBd, fg: C.vio, w: 600 },
  violetLine45: { bg: "transparent", bd: C.vioBd45, fg: C.vio, w: 600 },
  ghost: { bg: "transparent", bd: "transparent", fg: C.faint, w: 600 },
  dashed: { bg: "transparent", bd: "rgba(245,246,255,0.2)", fg: C.faint, w: 500 },
};

export type BtnProps = {
  label: string; onPress?: () => void; variant?: BtnVariant; arrow?: boolean; icon?: IconName; s?: number; py?: number;
  style?: StyleProp<ViewStyle>; disabled?: boolean; fg?: string; bd?: string; flex?: number; busy?: boolean; accessibilityLabel?: string;
};

/** `busy` muestra el label atenuado (el spinner lo pone la pantalla si quiere); `disabled` baja opacidad. */
export function Btn({ label, onPress, variant = "outline", arrow, icon, s = 12.5, py = 13, style, disabled, fg, bd, flex, busy, accessibilityLabel }: BtnProps) {
  const v = VARIANTS[variant];
  const color = fg ?? v.fg;
  return (
    <Touch
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel}
      style={[{
        flex, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
        paddingVertical: py, paddingHorizontal: 12, borderRadius: variant === "dashed" ? 999 : 12,
        borderWidth: 1, borderColor: bd ?? v.bd, backgroundColor: v.bg,
        borderStyle: variant === "dashed" ? "dashed" : "solid",
        opacity: disabled ? 0.55 : busy ? 0.8 : 1,
      }, style]}
    >
      {icon ? <Icon name={icon} size={15} color={color} /> : null}
      <T w={v.w} s={s} lh={1} mono={variant === "dashed"} color={color}>{label}</T>
      {arrow ? <Icon name="arrow" size={13} color={color} /> : null}
    </Touch>
  );
}

// ---------------------------------------------------------------------------
// Selectores.
export type SegmentedProps<K extends string> = {
  options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void;
  /** Colores del segmento activo por clave (Long lima / Short rosa). Sin `tone`, activo = card10 + ink. */
  tone?: (k: K) => { bg: string; fg: string };
};

/** Control segmentado con pulgar translúcido (tabs de portfolio, buy/sell, long/short). */
export function Segmented<K extends string>({ options, value, onChange, tone }: SegmentedProps<K>) {
  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: C.hair14, backgroundColor: C.deep }}>
      {options.map(([k, label]) => {
        const on = value === k;
        const t = on && tone ? tone(k) : { bg: on ? C.card10 : "transparent", fg: on ? C.ink : C.faint };
        return (
          <Touch key={k} onPress={() => onChange(k)} accessibilityLabel={`segment-${k}`} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 999, backgroundColor: t.bg, alignItems: "center" }}>
            <T w={on ? 700 : 600} s={11.5} lh={1} color={t.fg}>{label}</T>
          </Touch>
        );
      })}
    </View>
  );
}

/** Tabs píldora (tabs de mercado, de agente): lima al seleccionado. */
export function PillTabs<K extends string>({ options, value, onChange, flex = true, style }: { options: readonly (readonly [K, string])[]; value: K; onChange: (k: K) => void; flex?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: "row", gap: 4 }, style]}>
      {options.map(([k, label]) => {
        const on = value === k;
        return (
          <Chip
            key={k} label={label} onPress={() => onChange(k)} accessibilityLabel={`tab-${k}`}
            fg={on ? C.lime : C.dim} bd={on ? C.limeBd : C.hair18} bg={on ? C.limeBg14 : "transparent"}
            s={11.5} py={8} px={flex ? 6 : 12} style={flex ? { flex: 1 } : null}
          />
        );
      })}
    </View>
  );
}

/** Barra de progreso fina (graduación). `pct` en 0..1. */
export function Bar({ pct, h = 5, color = C.blue }: { pct: number; h?: number; color?: string }) {
  return (
    <View style={{ flex: 1, height: h, borderRadius: 999, backgroundColor: C.hair12, overflow: "hidden" }}>
      <View style={{ width: `${Math.max(0, Math.min(1, pct)) * 100}%`, height: "100%", backgroundColor: color }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Avisos y estados.
export function Warn({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <Card bd={C.warnBd} bg={C.warnBg} pad={11} style={{ paddingHorizontal: 13 }} gap={6}>
      <T w={700} s={12} lh={1.3} color={C.warn}>{title}</T>
      {body ? <T w={400} s={11.5} lh={1.45} color={C.dim}>{body}</T> : null}
      {children}
    </Card>
  );
}

export type Tone = { bd: string; bg: string; fg: string };

/** Tarjeta de estado (fases de read / de orden): borde tintado + tag + título + cuerpo. */
export function StatusCard({ tag, title, body, tone, big, children }: { tag: string; title: string; body?: string; tone: Tone; big?: boolean; children?: ReactNode }) {
  return (
    <Card bd={tone.bd} bg={tone.bg} pad={big ? 15 : 13} gap={big ? 7 : 6}>
      <Tag color={tone.fg}>{tag}</Tag>
      {big
        ? <T w={700} s={20} lh={1.15} ls={-0.02} display>{title}</T>
        : <T w={700} s={13.5} lh={1.3}>{title}</T>}
      {body ? <T w={400} s={11.5} lh={1.45} color={C.dim}>{body}</T> : null}
      {children}
    </Card>
  );
}

export function Screen({ children, style, gap = 11, top = 14 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; gap?: number; top?: number }) {
  return <View style={[{ paddingTop: top, paddingHorizontal: 15, paddingBottom: 20, gap }, style]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Conservadas de la app (no existen en el diseño), re-vestidas.
export type StatItem = { label: string; value: string; fg?: string };

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.hair14, borderRadius: 14, overflow: "hidden" }}>
      {items.map((it, i) => (
        <View key={i} style={{ width: "50%", backgroundColor: C.card, padding: 12, paddingHorizontal: 13, borderColor: C.hair12, borderTopWidth: i >= 2 ? 1 : 0, borderLeftWidth: i % 2 === 1 ? 1 : 0 }}>
          <Tag>{it.label.toUpperCase()}</Tag>
          <T w={500} s={13} mono color={it.fg ?? C.ink} style={{ marginTop: 6 }}>{it.value}</T>
        </View>
      ))}
    </View>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <View style={{ padding: 26, paddingHorizontal: 18, borderWidth: 1, borderColor: "rgba(245,246,255,0.24)", borderStyle: "dashed", borderRadius: 14, alignItems: "center" }}>
      {children}
    </View>
  );
}
```

- [ ] **Step 2: Comprobar que el archivo tipa por sí solo**

Run: `npx tsc --noEmit 2>&1 | grep 'src/ui/primitives.tsx' || echo PRIMITIVES_OK`
Expected: `PRIMITIVES_OK` (el resto del proyecto puede fallar por `Tag`/`C.mute`; sólo importa que este archivo no tenga errores propios). Si `CircleQuestionMark` no existe en `lucide-react-native` instalado, usa `CircleHelp` y anótalo en el audit.

- [ ] **Step 3: Commit**

```bash
git add src/ui/primitives.tsx
git commit -m "feat(mobile): primitivas del hi-fi (Tag mono, Chip, Btn, Segmented, StatusCard, Icon lucide)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `store.ts` — navegación del hi-fi (D5, D6, D7, D22)

**Files:**
- Rewrite: `apps/mobile/src/store.ts`
- Rewrite: `apps/mobile/src/screens/comingSoonCopy.ts`
- Test: `apps/mobile/__tests__/store.test.ts`, `apps/mobile/__tests__/comingSoon.test.ts`

**Interfaces:**
- Consumes: `IconName` de Task 2.
- Produces: tipos `Screen`, `MarketTab`, `StoreState`, `Patch`, `StoreInput`, `AppStore`; constantes `INITIAL`, `COMING_SOON`, `GATED`, `CAN_BACK`, `SHOW_TABS`, `ROOT_OF`; funciones puras `navState`, `backState`, `requireAccountState`, `afterSigninState`, `bootState`, `resetState`, `signedOutState`, `canBackFor`, `headerFor`, `heldActionFor`; hook `useAppStore`. De `comingSoonCopy.ts`: `ComingSoonTab`, `ComingSoonCopy`, `COMING_SOON_COPY`, `MarketComingSoon`, `MARKET_COMING_SOON`.

- [ ] **Step 1: Reescribir `comingSoonCopy.ts`**

```ts
import type { IconName } from "../ui/primitives";

export type ComingSoonTab = "launchpad" | "activity" | "portfolio";
export type ComingSoonCopy = { icon: IconName; title: string; copy: string };

/** Mismo icono que la tab bar (Shell.TABS). Copy fijado en el spec D17. */
export const COMING_SOON_COPY: Record<ComingSoonTab, ComingSoonCopy> = {
  launchpad: { icon: "rocket", title: "Launchpad", copy: "Agents with a token" },
  activity: { icon: "activity", title: "Activity", copy: "What the agents you follow are doing" },
  portfolio: { icon: "layers", title: "Portfolio", copy: "Tokens · Perps · Reads" },
};

export type MarketComingSoon = { title: string; copy: string };

/** Pills Ask y Agents de Market (D14/D17): tarjeta inline, no pantalla completa. */
export const MARKET_COMING_SOON: Record<"ask" | "agents", MarketComingSoon> = {
  ask: { title: "Ask", copy: "Ask an agent for a read on this market" },
  agents: { title: "Agents", copy: "Who trades and who reads this market" },
};
```

- [ ] **Step 2: Reescribir `comingSoon.test.ts`**

```ts
import { COMING_SOON_COPY, MARKET_COMING_SOON } from "../src/screens/comingSoonCopy";
import { COMING_SOON } from "../src/store";

test("every coming-soon tab has its lucide icon, title and one-line copy", () => {
  expect(Object.keys(COMING_SOON_COPY).sort()).toEqual([...COMING_SOON].sort());
  expect(COMING_SOON_COPY.launchpad).toEqual({ icon: "rocket", title: "Launchpad", copy: "Agents with a token" });
  expect(COMING_SOON_COPY.activity).toEqual({ icon: "activity", title: "Activity", copy: "What the agents you follow are doing" });
  expect(COMING_SOON_COPY.portfolio).toEqual({ icon: "layers", title: "Portfolio", copy: "Tokens · Perps · Reads" });
});

test("the Ask and Agents pills of Market have their inline copy", () => {
  expect(MARKET_COMING_SOON.ask.copy).toBe("Ask an agent for a read on this market");
  expect(MARKET_COMING_SOON.agents.copy).toBe("Who trades and who reads this market");
});
```

- [ ] **Step 3: Reescribir `store.test.ts`**

```ts
import {
  afterSigninState, backState, bootState, CAN_BACK, canBackFor, COMING_SOON, GATED, headerFor, heldActionFor, INITIAL,
  navState, requireAccountState, resetState, ROOT_OF, SHOW_TABS, signedOutState,
} from "../src/store";

test("nav pushes the current screen and applies the patch", () => {
  const s = navState(INITIAL, "market", { perpsMarketId: 64, perpsSide: "short" });
  expect(s.screen).toBe("market");
  expect(s.stack).toEqual(["wallet"]);
  expect(s).toMatchObject({ perpsMarketId: 64, perpsSide: "short" });
  expect(navState(INITIAL, "perpsFunds", { fundsMode: "withdraw" }).fundsMode).toBe("withdraw");
});

test("the back-stack keeps only the last 8 screens", () => {
  let s = INITIAL;
  for (let i = 0; i < 10; i++) s = navState(s, i % 2 ? "markets" : "activity");
  expect(s.stack).toHaveLength(8);
});

test("back pops the stack and falls back to wallet when empty", () => {
  const s = navState(navState(INITIAL, "markets"), "market");
  expect(backState(s).screen).toBe("markets");
  expect(backState(INITIAL).screen).toBe("wallet");
  expect(backState(INITIAL).stack).toEqual([]);
});

test("without an account, gated screens ask for access and remember where to go", () => {
  for (const target of GATED) {
    const s = requireAccountState(INITIAL, false, target, { fundsMode: "add" });
    expect(s.screen).toBe("signin");
    expect(s.next).toBe(target);
    expect(s.nextPatch).toEqual({ fundsMode: "add" });
  }
});

test("with an account the gate navigates straight to the target", () => {
  const s = requireAccountState(INITIAL, true, "markets");
  expect(s.screen).toBe("markets");
  expect(s.next).toBeUndefined();
});

test("coming-soon tabs never ask for an account", () => {
  for (const target of COMING_SOON) expect(requireAccountState(INITIAL, false, target).screen).toBe(target);
});

test("after sign-in the app lands on next without leaving signin in the stack", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "markets"));
  expect(s.screen).toBe("markets");
  expect(s.stack).toEqual(["wallet"]);
  expect(s.next).toBeUndefined();
  expect(s.nextPatch).toBeUndefined();
});

test("the held action names what the gate kept, and is null when it kept nothing", () => {
  expect(heldActionFor(undefined)).toBeNull();
  expect(heldActionFor("wallet")).toBeNull();
  expect(heldActionFor("markets")).toBe("Trading on Perpl");
  expect(heldActionFor("market")).toBe("Trading on Perpl");
  expect(heldActionFor("perpsFunds")).toBe("Moving trading funds");
  expect(heldActionFor("deposit")).toBe("A deposit");
  expect(heldActionFor("withdraw")).toBe("A withdrawal");
});

test("the screen sets of D5 are exactly the spec's", () => {
  expect([...COMING_SOON]).toEqual(["launchpad", "activity", "portfolio"]);
  expect([...GATED]).toEqual(["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw"]);
  expect([...CAN_BACK]).toEqual(["market", "perpsFunds", "deposit", "withdraw", "signin"]);
  expect([...SHOW_TABS]).toEqual(["markets", "launchpad", "activity", "portfolio", "wallet"]);
});

test("every screen maps to the tab it lights up", () => {
  expect(ROOT_OF.market).toBe("markets");
  expect(ROOT_OF.perpsFunds).toBe("markets");
  expect(ROOT_OF.deposit).toBe("wallet");
  expect(ROOT_OF.withdraw).toBe("wallet");
  expect(ROOT_OF.signin).toBe("wallet");
  for (const tab of SHOW_TABS) expect(ROOT_OF[tab]).toBe(tab);
});

test("headers", () => {
  expect(headerFor("markets")).toEqual(["Markets", "Perps on Perpl · Monad"]);
  expect(headerFor("market", "MON")).toEqual(["MON Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("market")).toEqual(["Perp", "Perpl · isolated margin · market order"]);
  expect(headerFor("perpsFunds")).toEqual(["Trading funds", "Between wallet and trading"]);
  expect(headerFor("wallet")).toEqual(["Wallet", "AUSD available and movements"]);
  expect(headerFor("deposit")).toEqual(["Deposit AUSD", "Monad network"]);
  expect(headerFor("withdraw")).toEqual(["Withdraw AUSD", "To an external address"]);
  expect(headerFor("signin")).toEqual(["Wallet access", "Passkey on this device"]);
  for (const screen of COMING_SOON) expect(headerFor(screen)[1]).toBe("Coming soon");
  expect(headerFor("launchpad")[0]).toBe("Launchpad");
});

test("the app starts on Wallet; boot keeps it with an account and goes through Sign in without one", () => {
  expect(INITIAL.screen).toBe("wallet");
  expect(bootState(INITIAL, true)).toBe(INITIAL);
  const s = bootState(INITIAL, false);
  expect(s).toMatchObject({ screen: "signin", stack: [], next: "wallet" });
  expect(s.nextPatch).toBeUndefined();
  expect(afterSigninState(s).screen).toBe("wallet");
});

test("canBackFor requires both a CAN_BACK screen and a non-empty stack", () => {
  expect(canBackFor("signin", [])).toBe(false);
  expect(canBackFor("signin", ["wallet"])).toBe(true);
  expect(canBackFor("wallet", ["markets"])).toBe(false);
  const booted = bootState(INITIAL, false);
  expect(canBackFor(booted.screen, booted.stack)).toBe(false);
});

test("reset clears the stack and any pending gate", () => {
  const dirty = { ...navState(INITIAL, "market"), next: "markets" as const };
  expect(resetState(dirty, "markets")).toMatchObject({ screen: "markets", stack: [], next: undefined, nextPatch: undefined });
});

test("sign out lands on Sign in and comes back to Wallet after logging in", () => {
  const dirty = navState(navState(INITIAL, "markets"), "market", { perpsMarketId: 64 });
  const s = signedOutState(dirty);
  expect(s).toMatchObject({ screen: "signin", stack: [], next: "wallet" });
  expect(canBackFor(s.screen, s.stack)).toBe(false);
  expect(afterSigninState(s).screen).toBe("wallet");
});
```

- [ ] **Step 4: Correr ambos tests y verlos fallar**

Run: `npx jest __tests__/store.test.ts __tests__/comingSoon.test.ts`
Expected: FAIL (exports inexistentes: `ROOT_OF`, `heldActionFor`, `MARKET_COMING_SOON`; `COMING_SOON` viejo).

- [ ] **Step 5: Reescribir `store.ts`**

```ts
import { useCallback, useState } from "react";
import { COMING_SOON_COPY, type ComingSoonTab } from "./screens/comingSoonCopy";

export type Screen =
  | "markets" | "market" | "perpsFunds"
  | "launchpad" | "activity" | "portfolio"
  | "wallet" | "deposit" | "withdraw" | "signin";
export type MarketTab = "ask" | "trade" | "agents";

export type StoreState = {
  screen: Screen;
  stack: Screen[];
  /** A dónde ir al terminar Wallet access, y con qué patch. */
  next?: Screen;
  nextPatch?: Patch;
  /** Trading en Perpl: mercado y lado elegidos, pill activo de Market y modo de la pantalla de fondos. */
  perpsMarketId?: number;
  perpsSide?: "long" | "short";
  marketTab: MarketTab;
  fundsMode?: "add" | "withdraw";
};

export type Patch = Partial<Omit<StoreState, "stack">>;

export const INITIAL: StoreState = { screen: "wallet", stack: [], marketTab: "trade" };

const STACK_MAX = 8;

export function navState(s: StoreState, screen: Screen, patch: Patch = {}): StoreState {
  return { ...s, ...patch, stack: [...s.stack, s.screen].slice(-STACK_MAX), screen };
}

export function backState(s: StoreState): StoreState {
  const stack = [...s.stack];
  const prev = stack.pop() ?? "wallet";
  return { ...s, stack, screen: prev };
}

/** Tabs que todavía no hacen nada real: el Shell renderiza "Coming soon" (D5, D17). */
export const COMING_SOON: readonly ComingSoonTab[] = ["launchpad", "activity", "portfolio"];
/** Pantallas que exigen cuenta. Los coming soon nunca la piden. */
export const GATED: readonly Screen[] = ["markets", "market", "perpsFunds", "wallet", "deposit", "withdraw"];
export const CAN_BACK: readonly Screen[] = ["market", "perpsFunds", "deposit", "withdraw", "signin"];
export const SHOW_TABS: readonly Screen[] = ["markets", "launchpad", "activity", "portfolio", "wallet"];
/** Qué tab se ilumina en cada pantalla (D4). */
export const ROOT_OF: Record<Screen, Screen> = {
  markets: "markets", market: "markets", perpsFunds: "markets",
  launchpad: "launchpad", activity: "activity", portfolio: "portfolio",
  wallet: "wallet", deposit: "wallet", withdraw: "wallet", signin: "wallet",
};

export function requireAccountState(s: StoreState, hasAccount: boolean, target: Screen, patch: Patch = {}): StoreState {
  if (hasAccount || !GATED.includes(target)) return navState(s, target, patch);
  return navState(s, "signin", { next: target, nextPatch: patch });
}

/** Tras el login aterriza en `next` sin dejar `signin` en el stack (como si se hubiera navegado directo). */
export function afterSigninState(s: StoreState): StoreState {
  const { next, nextPatch, ...rest } = s;
  return { ...rest, ...(nextPatch ?? {}), screen: next ?? "wallet" };
}

/** Al resolver la cuenta por primera vez: con cuenta se queda en Wallet; sin cuenta pasa por Sign in y aterriza en Wallet (D7). */
export function bootState(s: StoreState, hasAccount: boolean): StoreState {
  if (hasAccount) return s;
  return { ...s, screen: "signin", stack: [], next: "wallet", nextPatch: undefined };
}

export function resetState(s: StoreState, screen: Screen): StoreState {
  return { ...s, screen, stack: [], next: undefined, nextPatch: undefined };
}

/** Sign out: limpia todo y vuelve a Sign in, que aterriza en Wallet al entrar. */
export function signedOutState(s: StoreState): StoreState {
  return bootState(resetState(s, "signin"), false);
}

/** `←` sólo si la pantalla lo permite Y hay algo en el stack al que volver. */
export function canBackFor(screen: Screen, stack: readonly Screen[]): boolean {
  return CAN_BACK.includes(screen) && stack.length > 0;
}

/** Texto de la tarjeta "We kept what you were about to do" de Sign in (D18); null si el gate no retuvo nada. */
export function heldActionFor(next: Screen | undefined): string | null {
  switch (next) {
    case "markets": case "market": return "Trading on Perpl";
    case "perpsFunds": return "Moving trading funds";
    case "deposit": return "A deposit";
    case "withdraw": return "A withdrawal";
    default: return null;
  }
}

export function headerFor(screen: Screen, perpsSymbol?: string): [string, string] {
  switch (screen) {
    case "markets": return ["Markets", "Perps on Perpl · Monad"];
    case "market": return [perpsSymbol ? `${perpsSymbol} Perp` : "Perp", "Perpl · isolated margin · market order"];
    case "perpsFunds": return ["Trading funds", "Between wallet and trading"];
    case "wallet": return ["Wallet", "AUSD available and movements"];
    case "deposit": return ["Deposit AUSD", "Monad network"];
    case "withdraw": return ["Withdraw AUSD", "To an external address"];
    case "signin": return ["Wallet access", "Passkey on this device"];
    case "launchpad": case "activity": case "portfolio": return [COMING_SOON_COPY[screen].title, "Coming soon"];
  }
}

export type StoreInput = {
  /** `account.status !== "none"`. */
  hasAccount: boolean;
  /** Mercados de Perpl disponibles para resolver el símbolo del header. */
  perpsMarkets?: { id: number; symbol: string }[];
};

export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  finishSignin: () => void;
  signedOut: () => void;
  boot: (hasAccount: boolean) => void;
  hasAccount: boolean;
  scr: Screen;
  headerTitle: string;
  headerSub: string;
  canBack: boolean;
  showTabs: boolean;
  comingSoon: boolean;
  /** Acción retenida por el gate, para la tarjeta de Sign in. */
  held: string | null;
};

export function useAppStore({ hasAccount, perpsMarkets }: StoreInput): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);

  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => setS((s) => navState(s, screen, patch)), []);
  const back = useCallback(() => setS(backState), []);
  const requireAccount = useCallback(
    (target: Screen, patch?: Patch) => setS((s) => requireAccountState(s, hasAccount, target, patch)),
    [hasAccount],
  );
  const finishSignin = useCallback(() => setS(afterSigninState), []);
  const signedOut = useCallback(() => setS(signedOutState), []);
  const boot = useCallback((has: boolean) => setS((s) => bootState(s, has)), []);

  const perpsSymbol = (perpsMarkets ?? []).find((m) => m.id === S.perpsMarketId)?.symbol;
  const [headerTitle, headerSub] = headerFor(S.screen, perpsSymbol);

  return {
    S, set, nav, back, requireAccount, finishSignin, signedOut, boot,
    hasAccount, scr: S.screen, headerTitle, headerSub,
    canBack: canBackFor(S.screen, S.stack),
    showTabs: SHOW_TABS.includes(S.screen),
    comingSoon: (COMING_SOON as readonly Screen[]).includes(S.screen),
    held: heldActionFor(S.next),
  };
}
```

- [ ] **Step 6: Correr los tests y verlos pasar**

Run: `npx jest __tests__/store.test.ts __tests__/comingSoon.test.ts`
Expected: PASS (15 + 2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/store.ts src/screens/comingSoonCopy.ts __tests__/store.test.ts __tests__/comingSoon.test.ts
git commit -m "feat(mobile): store con la navegación del hi-fi (MARKETS absorbe Perpl, coming soon en Launchpad/Activity/Portfolio)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `comingSoon.tsx` — pantalla y tarjeta inline (D17)

**Files:**
- Rewrite: `apps/mobile/src/screens/comingSoon.tsx`

**Interfaces:**
- Consumes: `COMING_SOON_COPY`, `MARKET_COMING_SOON`, `ComingSoonTab` (Task 3); `T`, `Chip`, `Btn`, `Icon`, `Card`, `Tag` (Task 2).
- Produces: `ComingSoonScreen({ screen, requireAccount })`, `ComingSoonCard({ which })`.

- [ ] **Step 1: Escribir el archivo**

```tsx
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import type { Screen } from "../store";
import { Btn, Card, Chip, Icon, T, Tag } from "../ui/primitives";
import { C } from "../ui/theme";
import { COMING_SOON_COPY, MARKET_COMING_SOON, type ComingSoonTab } from "./comingSoonCopy";

export { COMING_SOON_COPY } from "./comingSoonCopy";

function isTab(screen: Screen): screen is ComingSoonTab {
  return screen === "launchpad" || screen === "activity" || screen === "portfolio";
}

/** Pantalla completa de los tabs sin función (D17). */
export function ComingSoonScreen({ screen, requireAccount }: { screen: Screen; requireAccount: AppCtx["requireAccount"] }) {
  if (!isTab(screen)) throw new Error(`ComingSoonScreen: ${screen} is not a coming-soon tab`);
  const c = COMING_SOON_COPY[screen];
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 16, gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 999, backgroundColor: C.card, borderWidth: 1, borderColor: C.vioBd40, alignItems: "center", justifyContent: "center" }}>
        <Icon name={c.icon} size={30} color={C.vio} />
      </View>
      <T w={700} s={22} lh={1.1} ls={-0.02} display>{c.title}</T>
      <Chip label="COMING SOON" mono s={10} fg={C.lime} bd={C.limeBd} dashed />
      <T w={400} s={13} lh={1.45} color={C.dim} style={{ textAlign: "center", maxWidth: 260 }}>{c.copy}</T>
      <Btn label="Go to Wallet" onPress={() => requireAccount("wallet")} variant="outline" py={14} style={{ marginTop: 6, paddingHorizontal: 22 }} accessibilityLabel="go-to-wallet" />
    </View>
  );
}

/** Tarjeta inline para los pills Ask y Agents de Market (D14). */
export function ComingSoonCard({ which }: { which: "ask" | "agents" }) {
  const c = MARKET_COMING_SOON[which];
  return (
    <Card bd={C.vioBd40} bg={C.vioBg06} gap={8}>
      <Tag color={C.vio}>COMING SOON</Tag>
      <T w={700} s={14} lh={1.3}>{c.title}</T>
      <T w={400} s={11.5} lh={1.45} color={C.dim}>{c.copy}</T>
    </Card>
  );
}
```

- [ ] **Step 2: Comprobar que tipa**

Run: `npx tsc --noEmit 2>&1 | grep 'screens/comingSoon' || echo COMING_SOON_OK`
Expected: `COMING_SOON_OK`.

- [ ] **Step 3: Commit**

```bash
git add src/screens/comingSoon.tsx
git commit -m "feat(mobile): coming soon con la estética del hi-fi y tarjeta inline para Ask/Agents

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `screens/signin.tsx` — gate de passkey (D18)

**Files:**
- Create: `apps/mobile/src/screens/signin.tsx` (a partir de `SigninScreen` de `src/screens/trade.tsx`; `trade.tsx` se borra en Task 8)

**Interfaces:**
- Consumes: `ctx.held`, `ctx.onWallet`, `ctx.finishSignin` (Task 3 / `ctx.ts`); `createAccount`, `signIn`, `describeError` de `wallet/wallet.ts`.
- Produces: `SigninScreen(ctx: AppCtx)`.

- [ ] **Step 1: Escribir el archivo**

```tsx
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import { Btn, Card, Screen, T } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

export function SigninScreen({ held, onWallet, finishSignin }: AppCtx) {
  const [busy, setBusy] = useState<"create" | "signin" | null>(null);
  const [error, setError] = useState("");
  const off = busy !== null;

  async function run(kind: "create" | "signin") {
    setBusy(kind);
    setError("");
    try {
      const wallet = kind === "create" ? await createAccount() : await signIn();
      onWallet(wallet);
      finishSignin();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Screen top={18} gap={12}>
      {held ? (
        <Card bd={C.vioBd45} bg={C.vioBg08} pad={12} radius={12}>
          <T w={700} s={12.5} lh={1.3}>We kept what you were about to do</T>
          <T w={400} s={11.5} lh={1.45} color={C.dim} style={{ marginTop: 4 }}>{held}. You come straight back after this step.</T>
        </Card>
      ) : null}
      <T w={400} s={12.5} lh={1.5} color={C.dim}>Reading and following never need an account. The wallet appears the first time money moves.</T>
      <View style={{ gap: 8 }}>
        <View style={{ position: "relative" }}>
          <Btn label={busy === "create" ? " " : "Create a wallet"} onPress={() => run("create")} variant="lime" s={13.5} py={15} disabled={off && busy !== "create"} busy={busy === "create"} accessibilityLabel="create-wallet" />
          {busy === "create" ? <ActivityIndicator color={C.onLime} style={{ position: "absolute", alignSelf: "center", top: 13 }} /> : null}
        </View>
        <View style={{ position: "relative" }}>
          <Btn label={busy === "signin" ? " " : "I already have one"} onPress={() => run("signin")} variant="outline" s={13.5} py={15} disabled={off && busy !== "signin"} busy={busy === "signin"} accessibilityLabel="sign-in" />
          {busy === "signin" ? <ActivityIndicator color={C.ink} style={{ position: "absolute", alignSelf: "center", top: 13 }} /> : null}
        </View>
      </View>
      {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
      <T w={400} s={11} lh={1.4} color={C.faint}>Connecting is not signing. Every operation is confirmed on its own.</T>
    </Screen>
  );
}
```

- [ ] **Step 2: Comprobar que tipa**

Run: `npx tsc --noEmit 2>&1 | grep 'screens/signin' || echo SIGNIN_OK`
Expected: `SIGNIN_OK` (`ctx.held` existe desde Task 3; `AppCtx` sigue siendo `AppStore & AccountActions & {...}`).

- [ ] **Step 3: Commit**

```bash
git add src/screens/signin.tsx
git commit -m "feat(mobile): Sign in con el gate del hi-fi (acción retenida, copy nuevo)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `screens/wallet.tsx` — Wallet, Deposit y Withdraw re-vestidos (D16)

**Files:**
- Create: `apps/mobile/src/screens/wallet.tsx` (lógica de `WalletScreen`, `DepositScreen`, `WithdrawScreen` de `src/screens/own.tsx`; `own.tsx` se borra en Task 8)

**Interfaces:**
- Consumes: `Treasury` (`hooks/useTreasury.ts`), `Perpl` (`hooks/usePerpl.ts`), `accountAddress`, `formatAusd`, `formatMon`, `shortHash`, `EXPLORER_TX_URL`, `MON_FAUCET_URL`, `AUSD_DECIMALS`, `validateWithdraw`, `describeError`; primitivas de Task 2.
- Produces: `WalletScreen`, `DepositScreen`, `WithdrawScreen` (todas `(ctx: AppCtx) => ReactElement`).

Reglas al portar: **ninguna llamada a `treasury.*` cambia**; sólo cambian primitivas, copy y orden de bloques. El botón "I've sent it" de Deposit ya no vuelve a una compra: navega a `wallet`.

- [ ] **Step 1: Escribir el archivo**

```tsx
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, TextInput, View } from "react-native";
import { formatUnits, type Address, type Hex } from "viem";
import { accountAddress } from "../account";
import { AUSD_DECIMALS, EXPLORER_TX_URL, formatAusd, formatMon, MON_FAUCET_URL, shortHash } from "../config/chain";
import type { AppCtx } from "../ctx";
import { Btn, Card, Chip, KV, Screen, StatGrid, StatusCard, T, Tag, Touch, Warn, type Tone } from "../ui/primitives";
import { C, textStyle } from "../ui/theme";
import type { Movement } from "../wallet/explorer";
import { describeError } from "../wallet/wallet";
import { validateWithdraw } from "../wallet/withdraw";

const TONES = {
  done: { bd: C.limeBd, bg: C.limeBg06, fg: C.lime },
  failed: { bd: C.downBd, bg: C.downBg, fg: C.down },
  pending: { bd: C.warnBd, bg: C.warnBg, fg: C.warn },
} as const satisfies Record<string, Tone>;

function movementDate(when: number): string {
  return new Date(when * 1000).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).toUpperCase();
}

const STATUS_FG: Record<Movement["status"], string> = { Complete: C.up, Confirming: C.warn, Reverted: C.down };

function MovementRow({ m }: { m: Movement }) {
  return (
    <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(m.hash)); }} accessibilityLabel={`movement-${shortHash(m.hash)}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.hair12, backgroundColor: C.card }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T w={600} s={12.5} lh={1.25}>{m.kind}</T>
        <T w={500} s={9.5} lh={1} mono color={C.faint} style={{ marginTop: 3 }}>{movementDate(m.when)} · {shortHash(m.hash).toUpperCase()}</T>
      </View>
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <T w={700} s={12} lh={1} mono color={m.sign === "+" ? C.up : C.ink}>{m.sign === "+" ? "+" : "−"}{formatAusd(m.amount)}</T>
        <T w={500} s={9} lh={1} mono color={STATUS_FG[m.status]}>{m.status.toUpperCase()}</T>
      </View>
    </Touch>
  );
}

export function WalletScreen({ nav, account, treasury, perpl, lock, signOut, signedOut }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const available = treasury.balances ? formatAusd(treasury.balances.ausd) : "—";
  const confirming = treasury.pending.filter((m) => m.status === "Confirming").length;
  const pending = confirming === 0 ? "Nothing pending." : `${confirming} transfer${confirming === 1 ? "" : "s"} confirming`;
  const seen = new Set(treasury.pending.map((m) => m.hash));
  const rows = [...treasury.pending, ...(treasury.movements ?? []).filter((m) => !seen.has(m.hash))];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";

  return (
    <Screen gap={11}>
      <Card pad={15}>
        <Tag>AVAILABLE · AUSD</Tag>
        <T w={700} s={30} lh={1} ls={-0.02} display style={{ marginTop: 6 }}>{available}</T>
        <T w={500} s={10} lh={1} mono color={C.faint} style={{ marginTop: 6 }}>{address ? shortHash(address) : "—"} · CONNECTED</T>
        <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 8 }}>{pending}</T>
        {perpl.state.status === "ready" ? (
          <Touch onPress={() => nav("markets")} accessibilityLabel="in-trading">
            <T w={400} s={11} lh={1.4} color={C.faint} style={{ marginTop: 2 }}>
              {formatAusd(perpl.live?.account?.b ?? perpl.lastBalance ?? 0n)} AUSD in trading{perpl.live?.account ? "" : perpl.lastBalance !== null ? " · last seen" : ""} · Markets
            </T>
          </Touch>
        ) : null}
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label="Deposit" onPress={() => nav("deposit")} variant="outline2" flex={1} accessibilityLabel="deposit" />
        <Btn label="Withdraw" onPress={() => nav("withdraw")} variant="outline2" flex={1} accessibilityLabel="withdraw" />
      </View>

      <Tag s={10}>MOVEMENTS</Tag>
      {treasury.movementsError ? (
        <Warn title="Couldn't load movements" body={treasury.movementsError}>
          <Chip label="Retry" onPress={() => { void treasury.refreshMovements(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {treasury.movements === null && !treasury.movementsError ? <T w={400} s={12} lh={1.4} color={C.faint}>Loading movements…</T> : null}
      {treasury.movements !== null && rows.length === 0 ? <T w={400} s={12} lh={1.4} color={C.faint}>Nothing has ever arrived in this wallet.</T> : null}
      {rows.map((m) => <MovementRow key={m.hash} m={m} />)}

      <Tag s={10} style={{ marginTop: 6 }}>TESTNET</Tag>
      <Card gap={7} bg="transparent">
        <KV k="MON (GAS)" v={treasury.balances ? formatMon(treasury.balances.mon) : "—"} />
        <KV k="YOUR ADDRESS" v={address ? shortHash(address) : "—"} />
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={treasury.busy ? "Requesting…" : "Get test AUSD"} onPress={() => { void treasury.getTestAusd(); }} variant="lime" flex={1} busy={treasury.busy} accessibilityLabel="get-test-ausd" />
        <Btn label="Get test MON · copies address" onPress={() => { void Clipboard.setStringAsync(address).catch(() => {}); void Linking.openURL(MON_FAUCET_URL); }} variant="outline2" flex={1} s={11.5} accessibilityLabel="get-test-mon" />
      </View>
      {treasury.rpcError ? (
        <Warn title="RPC error" body={treasury.rpcError}>
          <Chip label="Retry" onPress={() => { void treasury.refresh(); }} bd={C.hair22} fg={C.ink} style={{ alignSelf: "flex-start" }} />
        </Warn>
      ) : null}
      {treasury.notice ? (
        <Touch onPress={() => { if (txHash) void Linking.openURL(EXPLORER_TX_URL(txHash)); }}>
          <T w={500} s={10.5} lh={1.4} mono color={C.up}>{treasury.notice}</T>
        </Touch>
      ) : null}
      {treasury.error ? <T w={400} s={12} lh={1.4} color={C.down}>{treasury.error}</T> : null}

      <Tag s={10} style={{ marginTop: 6 }}>SESSION</Tag>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <T w={400} s={12} color={C.faint} style={{ flex: 1 }}>{unlocked ? "Unlocked" : "Locked"}</T>
        {unlocked ? <Chip label="Lock" onPress={lock} bd={C.hair22} fg={C.ink} accessibilityLabel="lock" /> : null}
        <Chip label="Sign out" onPress={() => { void signOut().then(signedOut); }} bd={C.hair22} fg={C.ink} accessibilityLabel="sign-out" />
      </View>
    </Screen>
  );
}

export function DepositScreen({ nav, account }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const [copied, setCopied] = useState(false);

  return (
    <Screen gap={11}>
      <StatGrid items={[{ label: "Asset", value: "AUSD" }, { label: "Network", value: "Monad" }]} />
      <View style={{ height: 150, borderWidth: 1, borderColor: C.hair22, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.card04 }}>
        <Tag>QR CODE · DEPOSIT ADDRESS</Tag>
      </View>
      <Card>
        <Tag>YOUR DEPOSIT ADDRESS</Tag>
        <T w={500} s={12} lh={1.45} mono style={{ marginTop: 6 }}>{address}</T>
      </Card>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Btn label={copied ? "Copied" : "Copy address"} onPress={() => { void Clipboard.setStringAsync(address).then(() => setCopied(true)); }} variant="lime" flex={1} py={14} accessibilityLabel="copy-address" />
        <Btn label="I've sent it" onPress={() => nav("wallet")} variant="outline2" flex={1} py={14} />
      </View>
      <T w={400} s={11.5} lh={1.45} color={C.faint}>Only AUSD on Monad arrives here. Card and bank transfer are not assumed to exist. Gas is paid in MON.</T>
    </Screen>
  );
}

type WithdrawStep = { step: "edit" } | { step: "review"; to: Address; amount: bigint; fee: bigint | null } | { step: "sent"; hash: Hex } | { step: "done"; hash: Hex } | { step: "failed"; hash: Hex } | { step: "unknown"; hash: Hex };

const inputBox = { paddingVertical: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: C.hair, borderRadius: 12, backgroundColor: C.deep } as const;

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
      setSt((s) => s.step === "sent" ? { step: "unknown", hash: s.hash } : s);
    } finally {
      setBusy(false);
    }
  };

  if (st.step === "sent" || st.step === "done" || st.step === "failed" || st.step === "unknown") {
    const card = st.step === "done" ? { tag: "COMPLETED", title: "Withdrawal complete", body: "The AUSD left this wallet. It shows in Movements.", tone: TONES.done }
      : st.step === "failed" ? { tag: "FAILED", title: "Withdrawal reverted", body: "Nothing left your balance.", tone: TONES.failed }
      : st.step === "unknown" ? { tag: "VERIFYING", title: "Sent · confirmation not received", body: "Check the movements list — it may still confirm.", tone: TONES.pending }
      : { tag: "SENT · WAITING ON THE NETWORK", title: "Sent · waiting for confirmation", body: "You can leave this screen.", tone: TONES.pending };
    return (
      <Screen gap={12}>
        <StatusCard tag={card.tag} title={card.title} body={card.body} tone={card.tone}>
          <Touch onPress={() => { void Linking.openURL(EXPLORER_TX_URL(st.hash)); }}>
            <T w={500} s={10} lh={1.4} mono color={C.dim}>{st.hash}</T>
          </Touch>
          {st.step === "unknown" && error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        </StatusCard>
        {st.step !== "sent" ? <Btn label="Back to wallet" onPress={() => nav("wallet")} variant="lime" s={13.5} py={15} /> : <ActivityIndicator color={C.lime} />}
      </Screen>
    );
  }

  if (st.step === "review") {
    return (
      <Screen gap={11}>
        <Card>
          <Tag>DESTINATION ADDRESS</Tag>
          <T w={500} s={12} lh={1.45} mono style={{ marginTop: 6 }}>{st.to}</T>
        </Card>
        <Card pad={15} gap={9}>
          <Tag>YOU WITHDRAW · AUSD</Tag>
          <T w={700} s={30} lh={1} ls={-0.02} display>{formatAusd(st.amount)}</T>
          <View style={{ gap: 7, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.hair12 }}>
            <KV k="NETWORK" v="MONAD" />
            <KV k="NETWORK FEE" v={st.fee !== null ? `~${formatMon(st.fee)} MON` : error ? "UNAVAILABLE" : "ESTIMATING…"} vFg={C.dim} />
            <KV k="PLATFORM FEE" v="0.00 AUSD" vFg={C.dim} />
            <KV k="YOU RECEIVE" v={`${formatAusd(st.amount)} AUSD`} vFg={C.lime} />
          </View>
        </Card>
        {error ? <T w={400} s={12} lh={1.4} color={C.down}>{error}</T> : null}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Edit" onPress={() => { setError(""); setSt({ step: "edit" }); }} variant="outline2" disabled={busy} style={{ width: 96 }} py={14} />
          <Btn label={busy ? "Confirming…" : "Confirm withdrawal"} onPress={() => { void confirm(); }} variant="lime" flex={1} busy={busy} s={13.5} py={14} accessibilityLabel="confirm-withdrawal" />
        </View>
        <T w={400} s={11.5} lh={1.45} color={C.faint}>Gas is paid in MON from this wallet. The AUSD amount arrives in full.</T>
      </Screen>
    );
  }

  return (
    <Screen gap={11}>
      <View style={inputBox}>
        <Tag>DESTINATION ADDRESS</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="Paste a Monad address"
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            autoCorrect={false}
            style={[textStyle(500, 12.5, { mono: true, color: C.ink }), { flex: 1, paddingVertical: 6 }]}
          />
          <Chip label="Paste" onPress={() => { void Clipboard.getStringAsync().then((s) => setTo(s.trim())).catch(() => {}); }} bd={C.hair22} fg={C.ink} />
        </View>
      </View>
      <Card pad={15} gap={9}>
        <Tag>AMOUNT · AUSD</Tag>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            placeholderTextColor={C.faint}
            keyboardType="decimal-pad"
            style={[textStyle(700, 30, { lh: 1, ls: -0.02, display: true, color: C.ink }), { flex: 1, paddingVertical: 0 }]}
          />
          <Chip label="MAX" mono s={10} py={6} px={10} onPress={() => setAmount(formatUnits(ausd, AUSD_DECIMALS))} />
        </View>
        <T w={500} s={9.5} lh={1} ls={0.06} mono color={C.faint}>AVAILABLE {formatAusd(ausd)} AUSD</T>
      </Card>
      {!check.ok && (to !== "" || amount !== "") ? <T w={400} s={12} lh={1.4} color={C.warn}>{check.error}</T> : null}
      <Btn label="Review withdrawal" onPress={() => { void review(); }} disabled={!check.ok} variant="lime" arrow s={13} py={15} accessibilityLabel="review-withdrawal" />
      <T w={400} s={11.5} lh={1.45} color={C.faint}>Only AUSD on Monad. Gas is paid in MON from this wallet.</T>
    </Screen>
  );
}
```

- [ ] **Step 2: Comprobar que tipa**

Run: `npx tsc --noEmit 2>&1 | grep 'screens/wallet' || echo WALLET_OK`
Expected: `WALLET_OK`. Si `satisfies` no está disponible en el TS del proyecto (lo está desde 4.9), cambia a `as const` con el tipo `Record<"done"|"failed"|"pending", Tone>`.

- [ ] **Step 3: Commit**

```bash
git add src/screens/wallet.tsx
git commit -m "feat(mobile): Wallet, Deposit y Withdraw re-vestidos con el hi-fi (testnet y sesión conservados)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `Shell.tsx`, `DevControls.tsx`, `App.tsx`, `app.config.ts` (D4, D10, D23)

**Files:**
- Rewrite: `apps/mobile/src/Shell.tsx`, `apps/mobile/src/DevControls.tsx`
- Modify: `apps/mobile/App.tsx`, `apps/mobile/app.config.ts`

**Interfaces:**
- Consumes: `ROOT_OF`, `SHOW_TABS` (Task 3); primitivas (Task 2); pantallas `MarketsScreen`, `MarketScreen`, `PerpsFundsScreen` (Task 8, mismos nombres que exportará), `WalletScreen`, `DepositScreen`, `WithdrawScreen` (Task 6), `SigninScreen` (Task 5), `ComingSoonScreen` (Task 4); `shouldCaptureEdgeSwipe`, `shouldGoBack` (`ui/gestures.ts`, sin cambios).

- [ ] **Step 1: Reescribir `Shell.tsx`**

```tsx
import { type ReactElement, useCallback, useMemo, useState } from "react";
import { Image, PanResponder, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, Pattern, Rect } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppCtx } from "./ctx";
import { DevControls } from "./DevControls";
import { ComingSoonScreen } from "./screens/comingSoon";
import { MarketScreen } from "./screens/market";
import { MarketsScreen } from "./screens/markets";
import { PerpsFundsScreen } from "./screens/perpsFunds";
import { SigninScreen } from "./screens/signin";
import { DepositScreen, WalletScreen, WithdrawScreen } from "./screens/wallet";
import { ROOT_OF, type Screen } from "./store";
import { shouldCaptureEdgeSwipe, shouldGoBack } from "./ui/gestures";
import { Icon, type IconName, T, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREENS: Record<Screen, (ctx: AppCtx) => ReactElement> = {
  markets: MarketsScreen, market: MarketScreen, perpsFunds: PerpsFundsScreen,
  launchpad: (ctx) => <ComingSoonScreen screen="launchpad" requireAccount={ctx.requireAccount} />,
  activity: (ctx) => <ComingSoonScreen screen="activity" requireAccount={ctx.requireAccount} />,
  portfolio: (ctx) => <ComingSoonScreen screen="portfolio" requireAccount={ctx.requireAccount} />,
  wallet: WalletScreen, deposit: DepositScreen, withdraw: WithdrawScreen, signin: SigninScreen,
};

/** Tab bar del hi-fi (D4): clave de pantalla, etiqueta mono, icono lucide. */
export const TABS: readonly [Screen, string, IconName][] = [
  ["markets", "MARKETS", "chart"],
  ["launchpad", "LAUNCHPAD", "rocket"],
  ["activity", "ACTIVITY", "activity"],
  ["portfolio", "PORTFOLIO", "layers"],
  ["wallet", "WALLET", "wallet"],
];

/** Fondo del teléfono: gradiente + campo de puntos, como el marco del diseño (D10). */
function Backdrop() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={[C.bgTop, C.bgMid, C.bgBottom]} locations={[0, 0.48, 1]} style={StyleSheet.absoluteFill} />
      <Svg width="100%" height="100%" style={[StyleSheet.absoluteFill, { opacity: 0.4 }]}>
        <Defs>
          <Pattern id="dots" patternUnits="userSpaceOnUse" width="130" height="130">
            <Circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.7)" />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#dots)" />
      </Svg>
    </View>
  );
}

export function Shell({ ctx }: { ctx: AppCtx }) {
  const { S, back, requireAccount, treasury, perpl } = ctx;
  const [controls, setControls] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const Current = SCREENS[ctx.scr];

  const refreshable = S.screen === "wallet" || S.screen === "markets";
  // Wallet = saldos + movimientos; Markets = contexto de Perpl. allSettled: un fallo no deja el spinner colgado.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled(S.screen === "wallet" ? [treasury.refresh(), treasury.refreshMovements()] : [perpl.refreshContext()]);
    } finally {
      setRefreshing(false);
    }
  }, [S.screen, treasury, perpl]);

  // Captura en fase *Capture* para ganarle al ScrollView; sólo desde el borde y sólo horizontal.
  const pan = useMemo(() => PanResponder.create({
    // g.x0 sólo vale a partir de onResponderGrant; en capture siempre es 0, así que la x inicial real es moveX - dx.
    onMoveShouldSetPanResponderCapture: (_e, g) => shouldCaptureEdgeSwipe(g.moveX - g.dx, g.dx, g.dy),
    onPanResponderRelease: (_e, g) => { if (shouldGoBack(g.dx)) back(); },
  }), [back]);

  const isRoot = ROOT_OF[S.screen] === S.screen;

  return (
    <View style={{ flex: 1, backgroundColor: C.bgBottom }}>
      <Backdrop />
      <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
        {/* header */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 9, paddingHorizontal: 15, paddingBottom: 11, borderBottomWidth: 1, borderBottomColor: C.hair, backgroundColor: C.deep50 }}>
          {ctx.canBack ? (
            <Touch onPress={back} accessibilityLabel="back" style={{ width: 31, height: 31, borderRadius: 999, borderWidth: 1, borderColor: C.hair22, alignItems: "center", justifyContent: "center" }}>
              <Icon name="back" size={16} color={C.ink} />
            </Touch>
          ) : null}
          {isRoot ? <Image source={require("../assets/pickler-mark.png")} style={{ width: 24, height: 24 }} resizeMode="contain" /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <T w={700} s={16.5} lh={1.15} ls={-0.01} display numberOfLines={1}>{ctx.headerTitle}</T>
            <T w={400} s={11} lh={1.2} color={C.faint} numberOfLines={1} style={{ marginTop: 2 }}>{ctx.headerSub}</T>
          </View>
          {__DEV__ ? (
            <Touch onPress={() => setControls(true)} hitSlop={12} accessibilityLabel="dev-controls">
              <T w={500} s={13} lh={1} mono color={C.faint}>⚙</T>
            </Touch>
          ) : null}
        </View>

        {/* cuerpo */}
        <View style={{ flex: 1 }} {...(ctx.canBack ? pan.panHandlers : {})}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flexGrow: 1 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshable ? <RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor={C.lime} /> : undefined}
          >
            <Current {...ctx} />
          </ScrollView>
        </View>

        {/* tab bar */}
        {ctx.showTabs ? (
          <View style={{ flexDirection: "row", paddingTop: 8, paddingHorizontal: 6, paddingBottom: 12, borderTopWidth: 1, borderTopColor: C.hair, backgroundColor: C.deep50 }}>
            {TABS.map(([k, label, icon]) => {
              const fg = ROOT_OF[S.screen] === k ? C.lime : C.faint;
              return (
                <Touch key={k} onPress={() => requireAccount(k)} accessibilityLabel={`tab-${k}`} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6, paddingHorizontal: 2 }}>
                  <Icon name={icon} size={19} color={fg} />
                  <T w={500} s={9} lh={1} ls={0.04} mono color={fg}>{label}</T>
                </Touch>
              );
            })}
          </View>
        ) : null}
      </SafeAreaView>

      {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
    </View>
  );
}
```

- [ ] **Step 2: Reescribir `DevControls.tsx`**

```tsx
import { Modal, ScrollView, View } from "react-native";
import type { AppCtx } from "./ctx";
import type { Screen } from "./store";
import { Chip, Hair, T, Tag, Touch } from "./ui/primitives";
import { C, pill } from "./ui/theme";

const GROUPS: readonly [string, readonly [Screen, string][]][] = [
  ["Perpl", [["markets", "Markets"], ["market", "Market · ticket"], ["perpsFunds", "Trading funds"]]],
  ["Wallet", [["wallet", "Wallet"], ["deposit", "Deposit"], ["withdraw", "Withdraw"], ["signin", "Wallet access"]]],
  ["Coming soon", [["launchpad", "Launchpad"], ["activity", "Activity"], ["portfolio", "Portfolio"]]],
];

function PChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const p = pill(on);
  return <Chip label={label} fg={p.fg} bd={p.bd} bg={p.bg} onPress={onPress} s={11.5} py={6} px={10} />;
}

export function DevControls({ visible, onClose, ctx }: { visible: boolean; onClose: () => void; ctx: AppCtx }) {
  const { S, requireAccount, hasAccount, account, perpl, lock, signOut, signedOut } = ctx;
  const firstMarket = perpl.context?.markets[0]?.id;
  const go = (screen: Screen) => {
    requireAccount(screen, screen === "market" && firstMarket !== undefined ? { perpsMarketId: firstMarket, perpsSide: "long" } : undefined);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Touch onPress={onClose} style={{ flex: 1 }}><View /></Touch>
        <View style={{ backgroundColor: C.bgMid, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.hair, padding: 18, paddingBottom: 28, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <T w={700} s={18} ls={-0.01} display>Dev controls</T>
            <Touch onPress={onClose}><T w={600} s={13} color={C.faint}>Close</T></Touch>
          </View>
          <T w={500} s={10} lh={1.4} mono color={C.faint} style={{ marginBottom: 14 }}>
            screen: {S.screen} · account: {account.status} · perpl: {perpl.state.status}
          </T>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Tag s={10} style={{ marginBottom: 9 }}>SCREENS</Tag>
            <View style={{ gap: 11 }}>
              {GROUPS.map(([title, items]) => (
                <View key={title}>
                  <T w={700} s={11} color={C.faint} style={{ marginBottom: 6 }}>{title}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {items.map(([k, label]) => <PChip key={k} label={label} on={S.screen === k} onPress={() => go(k)} />)}
                  </View>
                </View>
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <Tag s={10} style={{ marginBottom: 9 }}>SESSION</Tag>
            <T w={400} s={11.5} lh={1.4} color={C.faint} style={{ marginBottom: 9 }}>
              {hasAccount ? "Account, balances and Perpl are real; nothing here is mocked." : "No account yet: gated screens will ask for access."}
            </T>
            <View style={{ flexDirection: "row", gap: 5 }}>
              {account.status === "unlocked" ? <PChip label="Lock" on={false} onPress={() => { lock(); onClose(); }} /> : null}
              {hasAccount ? <PChip label="Sign out" on={false} onPress={() => { void signOut().then(() => { signedOut(); onClose(); }); }} /> : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 3: Actualizar `App.tsx`**

Reemplaza las importaciones de fuentes y el `useFonts` por:
```tsx
import { ChakraPetch_600SemiBold, ChakraPetch_700Bold } from "@expo-google-fonts/chakra-petch";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold } from "@expo-google-fonts/jetbrains-mono";
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold } from "@expo-google-fonts/manrope";
```
```tsx
  const [fontsLoaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium, JetBrainsMono_700Bold,
    ChakraPetch_600SemiBold, ChakraPetch_700Bold,
  });
```
Cambia `const PERPL_SCREENS: readonly Screen[] = ["perps", "perpsMarket", "perpsFunds"];` por `["markets", "market", "perpsFunds"]`. Quita `ausd`/`ausdToNumber` del `useAppStore` (el store ya no recibe `ausd`): `const store = useAppStore({ hasAccount, perpsMarkets: perpl.context?.markets ?? [] });` y borra el import de `ausdToNumber`. Los dos `backgroundColor: C.bg` pasan a `C.bgBottom`.

- [ ] **Step 4: Actualizar `app.config.ts`**

`backgroundColor: "#08080A"` → `"#05061A"` en la raíz y en `ios`. `buildNumber` **no** cambia (eso es F2).

- [ ] **Step 5: Comprobar que tipan Shell, DevControls y App (salvo imports de Task 8)**

Run: `npx tsc --noEmit 2>&1 | grep -E 'src/Shell.tsx|src/DevControls.tsx|App.tsx' | grep -v "screens/market" || echo SHELL_OK`
Expected: `SHELL_OK` (los únicos errores permitidos son los módulos `./screens/markets` y `./screens/market` que crea la Task 8).

- [ ] **Step 6: Commit**

```bash
git add src/Shell.tsx src/DevControls.tsx App.tsx app.config.ts
git commit -m "feat(mobile): Shell con backdrop, header y tab bar del hi-fi; DevControls podado; fuentes nuevas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Markets / Market / Funds — adaptación mecánica y borrado del mock (D6, D24)

**Files:**
- Rename: `src/screens/perps.tsx` → `src/screens/markets.tsx`; `src/screens/perpsMarket.tsx` → `src/screens/market.tsx`
- Modify: `src/screens/markets.tsx`, `src/screens/market.tsx`, `src/screens/perpsFunds.tsx`
- Delete: `src/screens/discover.tsx`, `src/screens/follow.tsx`, `src/screens/trade.tsx`, `src/screens/own.tsx`, `src/mock/data.ts`, `src/mock/helpers.ts`, `__tests__/helpers.test.ts`

**Interfaces:**
- Produces: `MarketsScreen`, `MarketScreen`, `PerpsFundsScreen`, `OrderResultCard` (misma firma que hoy, en `market.tsx`).

El re-maquetado real de estas tres pantallas es F2 (D13–D15). Aquí sólo se cambian nombres para que compilen con los cimientos nuevos. **No** añadas pills, ni cambies copy, ni toques `perpl.*`.

- [ ] **Step 1: Renombrar y borrar**

```bash
git mv src/screens/perps.tsx src/screens/markets.tsx
git mv src/screens/perpsMarket.tsx src/screens/market.tsx
git rm src/screens/discover.tsx src/screens/follow.tsx src/screens/trade.tsx src/screens/own.tsx src/mock/data.ts src/mock/helpers.ts __tests__/helpers.test.ts
rmdir src/mock
```

- [ ] **Step 2: Sustituciones en los tres archivos**

En `markets.tsx`, `market.tsx` y `perpsFunds.tsx` aplica, en este orden:

| Antes | Después |
|---|---|
| `export function PerpsScreen(` | `export function MarketsScreen(` |
| `export function PerpsMarketScreen(` | `export function MarketScreen(` |
| `from "./perpsMarket"` | `from "./market"` |
| `nav("perps")` | `nav("markets")` |
| `nav("perpsMarket", ` | `nav("market", ` |
| `C.mute` | `C.faint` |
| `C.surf2` | `C.deep` |
| `C.surf` | `C.card` |
| `C.tile` | `C.card10` |
| `C.chip` | `C.card09` |
| `C.hairSoft` | `C.hair12` |
| `C.hair2` | `C.hair22` |
| `C.onInk` | `C.onDeep` |
| `"rgba(245,195,91,0.5)"` | `C.warnBd` |
| `"rgba(245,195,91,0.1)"` | `C.warnBg` |
| `"rgba(242,119,122,0.5)"` | `C.downBd` |
| `"rgba(242,119,122,0.08)"` | `C.downBg` |
| `"rgba(200,240,58,0.45)"` | `C.limeBd` |
| `"rgba(200,240,58,0.07)"` | `C.limeBg06` |
| `textStyle(800, ` | `textStyle(700, ` |

Comando de ayuda (macOS `sed -i ''`, sin `\b` porque BSD sed no lo soporta; el orden importa: `surf2` antes que `surf`, y `hair2` sólo cuando no le sigue un dígito. Revisa el diff después, no lo confíes a ciegas):
```bash
for f in src/screens/markets.tsx src/screens/market.tsx src/screens/perpsFunds.tsx; do
  sed -i '' -e 's/export function PerpsScreen(/export function MarketsScreen(/' \
    -e 's/export function PerpsMarketScreen(/export function MarketScreen(/' \
    -e 's#from "./perpsMarket"#from "./market"#' \
    -e 's/nav("perps")/nav("markets")/g' -e 's/nav("perpsMarket", /nav("market", /g' \
    -e 's/C\.mute/C.faint/g' -e 's/C\.surf2/C.deep/g' -e 's/C\.surf/C.card/g' -e 's/C\.tile/C.card10/g' -e 's/C\.chip/C.card09/g' \
    -e 's/C\.hairSoft/C.hair12/g' -e 's/C\.hair2\([^0-9]\)/C.hair22\1/g' -e 's/C\.onInk/C.onDeep/g' \
    -e 's/"rgba(245,195,91,0.5)"/C.warnBd/g' -e 's/"rgba(245,195,91,0.1)"/C.warnBg/g' \
    -e 's/"rgba(242,119,122,0.5)"/C.downBd/g' -e 's/"rgba(242,119,122,0.08)"/C.downBg/g' \
    -e 's/"rgba(200,240,58,0.45)"/C.limeBd/g' -e 's/"rgba(200,240,58,0.07)"/C.limeBg06/g' \
    -e 's/textStyle(800, /textStyle(700, /g' "$f"
done
```

- [ ] **Step 3: Cambios a mano que `sed` no cubre**

1. **`Tag` (píldora) → `Chip`** en `markets.tsx`: `import { EmptyPanel, T, Tag, Touch, TouchCard }` → `import { Chip, EmptyPanel, T, Touch, TouchCard }`. Las dos llamadas:
   - `<Tag label={long ? "LONG" : "SHORT"} fg={…} bd={…} />` → `<Chip label={long ? "LONG" : "SHORT"} mono s={9.5} py={4} px={8} fg={long ? C.lime : C.down} bd={long ? C.limeBd : C.downBd} />`
   - `<Tag label={conn.label} fg={conn.fg} bd={conn.fg} dot />` → `<Chip label={conn.label} s={10} py={4} px={9} fg={conn.fg} bd={conn.fg} />` (el punto se pierde; F2 lo re-maqueta).
2. **`KV`** (`label/value/fg` → `k/v/vFg`) en `market.tsx` y `perpsFunds.tsx`:
   - `summary.map((r, i) => <KV key={i} label={r.label} value={r.value} fg={r.fg} />)` → `summary.map((r, i) => <KV key={i} k={r.label.toUpperCase()} v={r.value} vFg={r.fg} />)` (dos veces en `market.tsx`).
   - En `perpsFunds.tsx`: `<KV label="From" value={…} />` → `<KV k="FROM" v={…} />`; `<KV label="To" value={…} />` → `<KV k="TO" v={…} />`; `<KV label="Network" value="Monad · gas in MON" fg={C.dim} />` → `<KV k="NETWORK" v="Monad · gas in MON" vFg={C.dim} />`.
3. **`Segmented`** (nueva firma `options/value/onChange/tone`):
   - `market.tsx` Long/Short:
     ```tsx
     <Segmented
       options={[["long", "Long"], ["short", "Short"]] as const}
       value={side}
       onChange={(k) => set({ perpsSide: k })}
       tone={(k) => ({ bg: k === "long" ? C.lime : C.down, fg: C.onLime })}
     />
     ```
   - `market.tsx` apalancamiento:
     ```tsx
     <Segmented
       options={leverages.map((l) => [String(l), `${l}x`] as const)}
       value={String(lvUsed)}
       onChange={(k) => setLv(Number(k))}
       tone={() => ({ bg: C.ink, fg: C.onDeep })}
     />
     ```
   - `perpsFunds.tsx` Add/Withdraw:
     ```tsx
     <Segmented
       options={[["add", "Add funds"], ["withdraw", "Withdraw"]] as const}
       value={mode}
       onChange={(k) => { set({ fundsMode: k }); setAmount(""); }}
       tone={() => ({ bg: C.ink, fg: C.onDeep })}
     />
     ```
4. `StatGrid` conserva `{ label, value, fg }` — sin cambios.

- [ ] **Step 4: `tsc` limpio en todo el proyecto**

Run: `npx tsc --noEmit && echo TSC_OK`
Expected: `TSC_OK`. Errores típicos que quedan: un `C.hair2` al final de línea que el `sed` no alcanzó (revisa `git diff`), imports de `Tag` sobrantes. Corrige hasta verde; no dejes `// @ts-ignore`.

- [ ] **Step 5: Tests en verde**

Run: `npm test 2>&1 | tail -6`
Expected: 23 suites (se fue `helpers.test.ts`), todos en verde. Anota el número total de tests en el audit (el spec no lo fija; será menor que 178 por los tests de `helpers` y `store` viejos).

- [ ] **Step 6: Commit**

```bash
git add -u src/screens src/mock __tests__/helpers.test.ts
git add src/screens/markets.tsx src/screens/market.tsx src/screens/perpsFunds.tsx
git commit -m "refactor(mobile): Markets/Market/Funds sobre las primitivas nuevas; fuera el mock del wireframe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
(`git add -u` sobre rutas concretas registra los borrados y renombres de esas rutas; no es `git add -A`.)

---

### Task 9: Revisión de tipos y de copy cruzado

**Files:**
- Verify: todo `src/`

- [ ] **Step 1: Buscar restos del wireframe**

```bash
grep -rn 'mock/\|Ionicons\|@expo/vector-icons\|C\.mute\|C\.surf\|C\.tile\|C\.phone\|C\.panel\|C\.bg\b\|hairSoft\|resume\|tradeHolds\|mockHolder\|pickler-mobile@365585e' src App.tsx || echo CLEAN
```
Expected: `CLEAN`. Cada coincidencia es un residuo: elimínalo.

- [ ] **Step 2: Confirmar la ausencia del reloj falso y de `Sparkline`/`SearchBox`**

```bash
grep -rn '9:41\|Sparkline\|SearchBox' src || echo NO_PROTOTYPE_LEFTOVERS
```
Expected: `NO_PROTOTYPE_LEFTOVERS`.

- [ ] **Step 3: `tsc` y tests una vez más**

Run: `npx tsc --noEmit && npm test 2>&1 | tail -4`
Expected: limpio y en verde. Si hubo correcciones, commit:
```bash
git add <archivos corregidos>
git commit -m "chore(mobile): limpieza de residuos del wireframe

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Rebuild nativo, verificación en simulador, README, overview y audit

**Files:**
- Modify: `apps/mobile/README.md`, `docs/overview/2026-09-18-mobile-hifi.html`, `docs/overview/data/manifest.js`
- Create: `docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md`

- [ ] **Step 1: Prebuild y correr en el simulador**

```bash
npx expo prebuild --platform ios --clean
npx expo run:ios 2>&1 | tail -20
```
Expected: pods instalados (`RNSVG`, `ExpoLinearGradient` en la salida de `pod install`), build OK, app abierta en el simulador por defecto. Pega las últimas líneas en el audit. Si la app arranca con fondo negro sin gradiente, `expo-linear-gradient` no quedó enlazado: repite el prebuild.

- [ ] **Step 2: Recorrido con capturas (respeta el lock global de tests/simulador)**

Con `xcrun simctl io booted screenshot <ruta>` (usa el udid explícito si hay más de un simulador arrancado; `booted` es ambiguo) guarda en el scratchpad de la sesión:
1. `01-signin.png` — sin cuenta (Sign out desde SESSION si hace falta): título Chakra Petch, copy de D18, dos botones.
2. `02-signin-held.png` — toca la tab MARKETS sin cuenta: aparece "We kept what you were about to do · Trading on Perpl".
3. `03-wallet.png` — con cuenta: card AVAILABLE, address · CONNECTED, MOVEMENTS, TESTNET, SESSION.
4. `04-deposit.png`, `05-withdraw-edit.png`, `06-withdraw-review.png` (con una dirección válida y 0.01 AUSD; **no confirmes** el retiro).
5. `07-launchpad.png`, `08-activity.png`, `09-portfolio.png` — coming soon con icono lucide violeta y chip COMING SOON.
6. `10-markets.png`, `11-market.png` — sólo para constatar que compilan y muestran datos reales con el tema nuevo (su look final es F2).
7. Pull-to-refresh en Wallet y swipe desde el borde en Deposit → vuelve a Wallet (anótalo, sin captura).

Mira cada captura con la herramienta de lectura de imágenes antes de darla por buena: gradiente visible, sin texto en Manrope 800 (ya no se carga: si algo se ve en fuente del sistema, hay un `w={800}` que `fam` no cubre — no puede pasar, `fam(800)` → 700 — pero verifica).

- [ ] **Step 3: README**

En `apps/mobile/README.md`: primer párrafo → "UI portada del diseño hi-fi `Pickler Mobile App.dc.html` vía `jjesusaf/pickler-mobile` (commit `a0e353e`): tema azul con Chakra Petch, tab bar MARKETS · LAUNCHPAD · ACTIVITY · PORTFOLIO · WALLET. Reales: Wallet (passkey, AUSD/MON, deposit, withdraw, movimientos) y Markets (Perpl). Launchpad, Activity y Portfolio son *coming soon*." Sección Tests: sustituye "178/178 esperado (24 suites)" por el número real de la Task 8. Añade una línea en "Correr en simulador": "`react-native-svg` y `expo-linear-gradient` son módulos nativos: tras cambiar dependencias, `npx expo prebuild --platform ios --clean` antes de `run:ios`."

- [ ] **Step 4: Overview y manifest**

En `docs/overview/2026-09-18-mobile-hifi.html`: la `phase-card` F1 pasa a `data-status="completed"` (y `<option value="completed" selected>`), sus `<li>` (una por Task 0–10 de este plan, ya cargadas al escribir el plan) quedan `checked`. Añade `<details class="followups">` con los residuales del audit. En `docs/overview/data/manifest.js`: `phases: [{ num: 1, status: 'completed' }, { num: 2, status: 'pending' }]`, `types: ['spec', 'plan']`. Luego:
```bash
cd ../.. && npm run agents:check 2>&1 | grep -A2 '"errors"' && npm run docs:check 2>&1 | tail -2
```
Expected: `"errors": []` y `errors=0`.

- [ ] **Step 5: Audit**

Crea `docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md` con las secciones del audit de `mobile-polish`: *Qué quedó hecho y verificado* (salida de `npm test`, `tsc`, `pod install`, lista de capturas), *Decisiones tomadas durante la ejecución (rulings)* (p. ej. `CircleHelp` vs `CircleQuestionMark`, versión que resolvió `expo install`, cualquier desviación del plan), *Lo aprendido*, *Estado de las cuentas de testnet al cierre* (saldos de la wallet del simulador re-medidos por RPC, cuenta Perpl #620), *Pendientes* (residuales no bloqueantes) y *Siguiente punto de decisión* (F2: re-maquetado de Perpl + fixes → build 5).

- [ ] **Step 6: Revisión independiente y commit final**

Pide una revisión independiente a un subagente con: el spec, este plan, `git diff main...feat/mobile-hifi -- apps/mobile`, la salida de tests/tsc y las capturas. Aplica lo que proceda (con su propio commit) y registra en el audit qué se aceptó y qué se difirió.

```bash
git add README.md ../../docs/overview/2026-09-18-mobile-hifi.html ../../docs/overview/data/manifest.js ../../docs/superpowers/audits/2026-09-18-mobile-hifi-f1-rulings.md
git commit -m "docs(mobile-hifi): F1 completada — README, overview y audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

**Checkpoint.** F1 termina aquí: sin merge a `main`, sin push, sin TestFlight. Jesús decide si se abre el plan de F2.
