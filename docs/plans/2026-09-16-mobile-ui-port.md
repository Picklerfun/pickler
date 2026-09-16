# Port de la UI de `pickler-mobile` — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La app móvil adopta las 13 pantallas del prototipo `jjesusaf/pickler-mobile` en TypeScript, y el flujo real que ya funciona (passkey, saldos AUSD/MON, faucet, Lock, Sign out) queda inyectado en *Wallet access*, *Wallet* y *Deposit*. Solo UI: nada de funcionamiento nuevo.

**Architecture:** La UI del prototipo (tema, primitivas, datos de ejemplo, store de navegación por máquina de estados con back-stack, Shell y pantallas) se porta a `apps/mobile/src`. El estado de cuenta se extrae de `App.tsx` a `useAccount`; la lógica de saldos/faucet se extrae de `Home.tsx` a `useTreasury`. El store recibe `{ hasAccount, ausd }` y deriva `user`, `balance` y el gate `requireAccount`. Tres pantallas consumen lo real; las otras diez son idénticas al prototipo.

**Tech Stack:** Expo SDK 57 / React Native 0.86 / React 19.2 / TypeScript 6 (ya instalados). Nuevos: `expo-font` 57.0.4, `@expo-google-fonts/manrope` 0.4.2, `@expo-google-fonts/jetbrains-mono` 0.4.1. Tests con Jest (`jest-expo`).

**Spec:** `docs/specs/2026-09-16-mobile-ui-port-design.md`

## Global Constraints

- Prototipo de referencia: `https://github.com/jjesusaf/pickler-mobile.git` en el commit **`365585e90cece741a957c358ff7fcd7b9aa25799`**, clonado en `.superpowers/pickler-mobile/` (raíz del worktree; ese directorio está en `.gitignore`). Es la **única** fuente de verdad para copy, estilos y datos de ejemplo.
- Versiones **exactas** en `package.json` (sin `^` ni `~`).
- Copy idéntico al prototipo salvo la línea "Dependency: whether access is email, passkey or an external wallet is not decided. This screen is a placeholder for that decision." en *Wallet access*, que **se elimina**.
- Todo el código nuevo es `.ts`/`.tsx`, comillas dobles, sin `import React` (el transform JSX de Expo no lo necesita; el código actual tampoco lo importa). `npx tsc --noEmit` debe salir limpio en **cada** tarea. Sin `any` salvo que una tarea lo indique.
- Los módulos `config/`, `wallet/`, `storage/`, `hd/`, `store.ts`, `mock/` no importan `react-native`. `ui/` no importa viem ni mera.
- Ícono, `bundleIdentifier`, `associatedDomains`, `rpId`, `version` y `buildNumber` en `app.config.ts` **no cambian**.
- Trabajo en el worktree `.claude/worktrees/mobile-ui-port` (rama `feat/mobile-ui-port`). Comandos de `npm`/`npx` se corren desde `apps/mobile/` de ese worktree. **Nunca `git add -A`**; se agregan archivos por nombre. Los pasos "Commit" asumen la autorización de commit que Jesús dio al arrancar la ejecución; no hay push.
- Toolchain: Xcode 26.6 (`/Applications/Xcode-26.6.0.app`, `sudo xcodes select 26.6` si `xcodebuild -version` no dice 26.6), simulador "iPhone 17 Pro" iOS 26.5 con Face ID inscrito (ver `docs/05-handoff-fase1.md` §3). Node 22.

### Reglas de porte (aplican a las Tasks 6–9; cada una las incluye implícitamente)

1. Fuente: el archivo `.js` correspondiente en `.superpowers/pickler-mobile/src/`. Se copia **entero** al destino `.tsx` y se aplican **solo** los cambios de la tarea. Nada de "mejorar" estilos, copy ni estructura.
2. Imports: `'../theme'` → `"../ui/theme"`; `'../ui'` → `"../ui/primitives"`; `'../data'` → `"../mock/data"`; `'../helpers'` → `"../mock/helpers"`; se quita `import React from 'react'`; comillas simples → dobles.
3. Firma de pantalla: `export function XScreen({ …campos… }: AppCtx)`, donde `AppCtx` viene de `"../ctx"`. Los subcomponentes internos reciben props tipadas explícitas.
4. `S.user` deja de existir. Donde el prototipo lee `S.user` se usa `user` del contexto. Donde un `nav`/`set` lleva `user: 'holder'` se pone `mockHolder: true`; `user: 'funded'` y `user: 'new'` **se eliminan** del patch.
5. Objetos literales indexados por una clave de unión (`{...}[p]`) se tipan con `Record<…>` o `Partial<Record<…>>` (cada tarea indica cuál).
6. Arreglos de tuplas que alimentan `set({ tab: k })` o similares se escriben `as const` para que `k` tenga el tipo de la unión.

---

## Mapa de archivos

**Se crean** (`apps/mobile/`):

| Archivo | Responsabilidad |
|---|---|
| `src/ui/theme.ts` | Tokens `C`, fuentes `F`, `fam()`, `textStyle()`. (Reemplaza `palette`/`spacing`; se retiran en Task 10.) |
| `src/ui/primitives.tsx` | `T`, `Touch`, `Tag`, `Hair`, `StatGrid`, `KV`, `Avatar`, `Segmented`, `EmptyPanel`, `TouchCard`. |
| `src/mock/data.ts` | `AGENTS`, `POSTS`, `KINDS` y sus tipos. Datos de ejemplo. |
| `src/mock/helpers.ts` | `money`, `quoteFor`, `sellQuoteFor`, `pill`. |
| `src/store.ts` | Tipos de navegación, funciones puras (`navState`, `backState`, `requireAccountState`, `afterSigninState`, `resetState`, `deriveUser`, `headerFor`) y el hook `useAppStore`. |
| `src/hooks/useAccount.ts` | Estado de cuenta (`none`/`locked`/`unlocked`) y acciones. Extraído de `App.tsx`. |
| `src/hooks/useTreasury.ts` | Saldos, refresh, faucet. Extraído de `Home.tsx`. |
| `src/ctx.ts` | `AppCtx = AppStore & AccountActions & { account; treasury }`. |
| `src/Shell.tsx` | Header, cuerpo con scroll, barra Buy/Sell del agente, tab bar. |
| `src/DevControls.tsx` | Panel ⚙ (solo `__DEV__`). |
| `src/screens/discover.tsx` | Market, Search, Agent. |
| `src/screens/trade.tsx` | Trade, Wallet access. |
| `src/screens/follow.tsx` | Activity, Post, Ask. |
| `src/screens/own.tsx` | Portfolio, Position, Wallet, Deposit, Withdraw. |
| `assets/pickler-mark.png` | Copia del prototipo. |
| `__tests__/theme.test.ts`, `__tests__/helpers.test.ts`, `__tests__/store.test.ts` | Tests nuevos. |

**Se modifican:** `package.json`, `app.config.ts`, `App.tsx`, `src/config/chain.ts` (+`ausdToNumber`), `__tests__/chain.test.ts`, `README.md`.

**Se borran (Task 10):** `src/screens/Welcome.tsx`, `src/screens/Home.tsx`, `src/ui/Button.tsx`, `src/ui/Field.tsx`.

Notas respecto al spec (precisiones, no cambios de diseño):
- El spec decía `src/account/useAccount.ts` y `src/wallet/useTreasury.ts`. Como ya existe el archivo `src/account.ts`, un directorio `src/account/` haría ambiguo el import `"../account"`. Los dos hooks van en `src/hooks/`.
- El spec describía `useAppStore({ account, ausd })`. El store solo necesita saber si hay cuenta, así que recibe `{ hasAccount, ausd }`; `App.tsx` calcula `hasAccount` y las funciones puras se prueban con un booleano.
- `useTreasury` recibe `account` y `onUnlock` (no solo `address`) porque el faucet necesita la wallet desbloqueada y avisar a `useAccount`, igual que `Home.tsx` hoy.

---

### Task 1: Prototipo de referencia, dependencias y config

**Files:**
- Create: `.superpowers/pickler-mobile/` (clon, gitignored), `apps/mobile/assets/pickler-mark.png`
- Modify: `apps/mobile/package.json`, `apps/mobile/package-lock.json`, `apps/mobile/app.config.ts`

**Interfaces:**
- Produces: el clon en `.superpowers/pickler-mobile/src/*.js` que las Tasks 2–9 copian; las fuentes `Manrope_*` y `JetBrainsMono_*` disponibles para `useFonts`.

- [ ] **Step 1: Clonar el prototipo en el commit fijado**

Desde la raíz del worktree:

```bash
git clone https://github.com/jjesusaf/pickler-mobile.git .superpowers/pickler-mobile
git -C .superpowers/pickler-mobile checkout 365585e90cece741a957c358ff7fcd7b9aa25799
git -C .superpowers/pickler-mobile rev-parse HEAD
git status --short   # .superpowers/ no debe aparecer
```

Expected: la última línea imprime `365585e90cece741a957c358ff7fcd7b9aa25799` y `git status` no lista `.superpowers/`.

- [ ] **Step 2: Instalar dependencias base del worktree y las tres nuevas**

```bash
cd apps/mobile
npm ci
npm install --save-exact expo-font@57.0.4 @expo-google-fonts/manrope@0.4.2 @expo-google-fonts/jetbrains-mono@0.4.1
grep -E '"(expo-font|@expo-google-fonts/manrope|@expo-google-fonts/jetbrains-mono)"' package.json
```

Expected: las tres líneas con versión exacta, sin `^`.

- [ ] **Step 3: Copiar la marca**

```bash
cp ../../.superpowers/pickler-mobile/assets/pickler-mark.png assets/pickler-mark.png
ls -la assets/pickler-mark.png
```

- [ ] **Step 4: Ajustar `app.config.ts`**

Reemplazar el archivo completo por:

```ts
import type { ExpoConfig } from "expo/config";

const rpId = process.env.PICKLER_RP_ID ?? "pickler.fun";
const bundleIdentifier = "fun.pickler.app";

const config: ExpoConfig = {
  name: "Pickler",
  slug: "pickler-mobile",
  version: "0.1.0",
  orientation: "portrait",
  // 1024x1024 sin alfa (Apple lo exige). Fuente: PicklerProfile.png del equipo.
  icon: "./assets/icon.png",
  userInterfaceStyle: "dark",
  backgroundColor: "#08080A",
  ios: {
    bundleIdentifier,
    buildNumber: "1",
    supportsTablet: false,
    backgroundColor: "#08080A",
    associatedDomains: [`webcredentials:${rpId}`],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  plugins: [
    "expo-font",
    [
      "expo-secure-store",
      {
        faceIDPermission:
          "Pickler uses Face ID to unlock the account stored on this device.",
      },
    ],
  ],
  extra: { rpId },
};

export default config;
```

- [ ] **Step 5: Prebuild, build nativo y verificación de que la app vieja sigue arrancando**

```bash
xcodebuild -version            # debe decir Xcode 26.6; si no: sudo xcodes select 26.6
npx expo prebuild --platform ios --clean
npx expo run:ios --device "iPhone 17 Pro"
```

Expected: compila, instala y abre la pantalla *Welcome* actual (Pickler, "Create account"). Cerrar metro después.

- [ ] **Step 6: tsc y tests**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc sin salida; `Tests: 19 passed, 19 total`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json app.config.ts assets/pickler-mark.png
git commit -m "chore(mobile): fuentes Manrope/JetBrains Mono y config oscura para la UI nueva"
```

---

### Task 2: Tema y primitivas

**Files:**
- Modify: `apps/mobile/src/ui/theme.ts`
- Create: `apps/mobile/src/ui/primitives.tsx`
- Test: `apps/mobile/__tests__/theme.test.ts`

**Interfaces:**
- Produces: `C` (tokens de color, `as const`), `F`, `fam(weight: number, mono?: boolean): string`, `textStyle(weight: number, size: number, opts?: TypeOpts): TextStyle`; y los componentes `T`, `Touch`, `Tag`, `Hair`, `StatGrid`, `KV`, `Avatar`, `Segmented`, `EmptyPanel`, `TouchCard` con las props listadas abajo. `palette` y `spacing` siguen exportados hasta la Task 10.

- [ ] **Step 1: Test de `fam` y `textStyle`**

`apps/mobile/__tests__/theme.test.ts`:

```ts
import { C, fam, textStyle } from "../src/ui/theme";

test("weights map to the loaded Manrope families", () => {
  expect(fam(400)).toBe("Manrope_400Regular");
  expect(fam(500)).toBe("Manrope_500Medium");
  expect(fam(600)).toBe("Manrope_600SemiBold");
  expect(fam(700)).toBe("Manrope_700Bold");
  expect(fam(800)).toBe("Manrope_800ExtraBold");
});

test("mono ignores weight except the medium cut", () => {
  expect(fam(400, true)).toBe("JetBrainsMono_400Regular");
  expect(fam(800, true)).toBe("JetBrainsMono_500Medium");
});

test("textStyle converts lh ratio and ls em to pixels", () => {
  expect(textStyle(700, 14, { lh: 1.2, ls: -0.03 })).toEqual({
    fontFamily: "Manrope_700Bold",
    fontSize: 14,
    color: C.ink,
    lineHeight: 17,
    letterSpacing: -0.42,
  });
});

test("textStyle omits lineHeight and letterSpacing when not given", () => {
  expect(textStyle(400, 13)).toEqual({ fontFamily: "Manrope_400Regular", fontSize: 13, color: C.ink });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

```bash
npx jest __tests__/theme.test.ts
```

Expected: FAIL, `fam` / `textStyle` no exportados.

- [ ] **Step 3: Escribir `src/ui/theme.ts`**

Reemplazar el archivo completo por (los valores de `C` y `F` se copian **exactos** de `.superpowers/pickler-mobile/src/theme.js`):

```ts
import type { TextStyle } from "react-native";

// Tokens de diseño portados de "Pickler Mobile Wireframes.dc.html" vía pickler-mobile@365585e.
export const C = {
  lime: "#C8F03A",
  violet: "#7A5CFF",
  ink: "#F3F1EC",
  dim: "#B9B9B4",
  mute: "#8C8C88",
  up: "#7BE38A",
  down: "#F2777A",
  warn: "#F5C35B",
  violetInk: "#B7A8FF",
  blue: "#5AD8FF",
  blueBd: "rgba(90,216,255,0.5)",
  blueBg: "rgba(90,216,255,0.1)",

  hair: "rgba(243,241,236,0.14)",
  hair2: "rgba(243,241,236,0.22)",
  hairSoft: "rgba(243,241,236,0.12)",
  hairFaint: "rgba(243,241,236,0.10)",

  bg: "#08080A",
  phone: "#0B0B0E",
  panel: "#0D0D10",
  surf: "#0F0F13",
  surf2: "#121216",
  chip: "#17171B",
  tile: "#1C1C22",

  onLime: "#0B0F00",
  onInk: "#08080A",
  disabled: "#55555C",
} as const;

// Nombres de familia que exportan @expo-google-fonts/*.
export const F = {
  r: "Manrope_400Regular",
  m: "Manrope_500Medium",
  sb: "Manrope_600SemiBold",
  b: "Manrope_700Bold",
  xb: "Manrope_800ExtraBold",
  mono: "JetBrainsMono_400Regular",
  monoM: "JetBrainsMono_500Medium",
} as const;

/** Peso numérico de Manrope (como en el wireframe) → familia cargada. */
export function fam(weight: number, mono?: boolean): string {
  if (mono) return weight >= 500 ? F.monoM : F.mono;
  if (weight >= 800) return F.xb;
  if (weight >= 700) return F.b;
  if (weight >= 600) return F.sb;
  if (weight >= 500) return F.m;
  return F.r;
}

export type TypeOpts = { lh?: number; ls?: number; mono?: boolean; color?: string };

/** `font: <weight> <size>/<lh> <family>` del wireframe. `ls` en em, convertido a px. */
export function textStyle(weight: number, size: number, { lh, ls = 0, mono = false, color }: TypeOpts = {}): TextStyle {
  const style: TextStyle = { fontFamily: fam(weight, mono), fontSize: size, color: color ?? C.ink };
  if (lh) style.lineHeight = Math.round(size * lh);
  if (ls) style.letterSpacing = +(size * ls).toFixed(2);
  return style;
}

// --- Paleta de la fase 1. La usan Welcome/Home/Button/Field; se retira en la Task 10. ---
export const palette = {
  bg: "#0B0B0F",
  card: "#16161D",
  text: "#F4F4F5",
  muted: "#9A9AA6",
  accent: "#8B5CF6",
  danger: "#F87171",
  success: "#4ADE80",
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };
```

- [ ] **Step 4: Correr el test y verlo pasar**

```bash
npx jest __tests__/theme.test.ts
```

Expected: 4 passed.

- [ ] **Step 5: Escribir `src/ui/primitives.tsx`**

Port tipado de `.superpowers/pickler-mobile/src/ui.js`. Los estilos se copian exactos; solo se agregan tipos:

```tsx
import type { ReactNode } from "react";
import { Pressable, type StyleProp, Text, type TextStyle, View, type ViewStyle } from "react-native";
import { C, textStyle } from "./theme";

export type TProps = {
  w?: number;
  s?: number;
  lh?: number;
  ls?: number;
  mono?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children?: ReactNode;
};

/** Texto con el shorthand `font:` del wireframe: w=peso, s=tamaño, lh=ratio, ls=em. */
export function T({ w = 400, s = 13, lh, ls, mono, color, style, numberOfLines, children }: TProps) {
  return (
    <Text numberOfLines={numberOfLines} style={[textStyle(w, s, { lh, ls, mono, color }), style]}>
      {children}
    </Text>
  );
}

export type TouchProps = {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  disabled?: boolean;
};

export function Touch({ onPress, style, children, disabled }: TouchProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [style, pressed && !disabled ? { opacity: 0.72 } : null]}
    >
      {children}
    </Pressable>
  );
}

export type TagProps = {
  label: string;
  fg?: string;
  bd?: string;
  bg?: string;
  dashed?: boolean;
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  size?: number;
};

export function Tag({ label, fg = C.mute, bd = C.hair, bg = "transparent", dashed, dot, style, size = 10.5 }: TagProps) {
  return (
    <View
      style={[
        {
          flexDirection: "row", alignItems: "center", gap: 6,
          paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999,
          borderWidth: 1, borderColor: bd, backgroundColor: bg,
          borderStyle: dashed ? "dashed" : "solid",
        },
        style,
      ]}
    >
      {dot ? <View style={{ width: 6, height: 6, borderRadius: 999, backgroundColor: fg }} /> : null}
      <T w={600} s={size} color={fg}>{label}</T>
    </View>
  );
}

export function Hair({ color = C.hairSoft, style }: { color?: string; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: color }, style]} />;
}

export type StatItem = { label: string; value: string; fg?: string };

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.hairSoft, borderRadius: 14, overflow: "hidden" }}>
      {items.map((it, i) => (
        <View
          key={i}
          style={{
            width: "50%", backgroundColor: C.surf, padding: 12, paddingHorizontal: 13,
            borderColor: C.hairSoft,
            borderTopWidth: i >= 2 ? 1 : 0,
            borderLeftWidth: i % 2 === 1 ? 1 : 0,
          }}
        >
          <T w={400} s={11} color={C.mute}>{it.label}</T>
          <T w={500} s={13.5} mono color={it.fg ?? C.ink} style={{ marginTop: 5 }}>{it.value}</T>
        </View>
      ))}
    </View>
  );
}

export function KV({ label, value, fg = C.ink, top = true }: { label: string; value: string; fg?: string; top?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline",
        borderTopWidth: top ? 1 : 0, borderTopColor: "rgba(243,241,236,0.08)", paddingTop: top ? 8 : 0,
      }}
    >
      <T w={400} s={12.5} lh={1.3} color={C.dim} style={{ flex: 1 }}>{label}</T>
      <T w={500} s={12.5} lh={1.3} mono color={fg} style={{ textAlign: "right" }}>{value}</T>
    </View>
  );
}

export function Avatar({ initial, size = 38, radius = 11, fontSize = 14 }: { initial: string; size?: number; radius?: number; fontSize?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: radius, backgroundColor: C.tile,
        borderWidth: 1, borderColor: C.hair, alignItems: "center", justifyContent: "center",
      }}
    >
      <T w={800} s={fontSize} color={C.dim}>{initial}</T>
    </View>
  );
}

export type SegmentOption = {
  label: string;
  bg: string;
  fg: string;
  onPress?: () => void;
  disabled?: boolean;
  strong?: boolean;
};

export function Segmented({ options }: { options: SegmentOption[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 3, borderRadius: 999, borderWidth: 1, borderColor: C.hair, backgroundColor: C.surf2 }}>
      {options.map((o, i) => (
        <Touch
          key={i}
          onPress={o.onPress}
          disabled={o.disabled}
          style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 999, backgroundColor: o.bg, alignItems: "center" }}
        >
          <T w={o.strong ? 700 : 600} s={o.strong ? 13 : 12.5} color={o.fg}>{o.label}</T>
        </Touch>
      ))}
    </View>
  );
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <View style={{ padding: 26, paddingHorizontal: 18, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", borderRadius: 16, alignItems: "center" }}>
      {children}
    </View>
  );
}

export function TouchCard({ onPress, children, style }: TouchProps) {
  return (
    <Touch onPress={onPress} style={[{ borderWidth: 1, borderColor: C.hair, borderRadius: 14, backgroundColor: C.surf, padding: 13, paddingHorizontal: 14 }, style]}>
      {children}
    </Touch>
  );
}
```

- [ ] **Step 6: tsc y suite completa**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc limpio; `Tests: 23 passed`.

- [ ] **Step 7: Commit**

```bash
git add src/ui/theme.ts src/ui/primitives.tsx __tests__/theme.test.ts
git commit -m "feat(mobile): tokens y primitivas de la UI de pickler-mobile"
```

---

### Task 3: Datos de ejemplo y helpers

**Files:**
- Create: `apps/mobile/src/mock/data.ts`, `apps/mobile/src/mock/helpers.ts`
- Test: `apps/mobile/__tests__/helpers.test.ts`

**Interfaces:**
- Produces: tipos `AgentId`, `Stage`, `Op`, `Agent`, `PostKind`, `Post`; constantes `AGENTS: Record<AgentId, Agent>`, `POSTS: Post[]`, `KINDS: Record<PostKind, { label; fg; bd }>`; funciones `money(n: number, d?: number): string`, `quoteFor(agent: Agent, amount: number): Quote`, `sellQuoteFor(agent: Agent, sellPct: number): SellQuote`, `pill(active: boolean, activeBg?: string): Pill`.

- [ ] **Step 1: Test de helpers**

`apps/mobile/__tests__/helpers.test.ts`:

```ts
import { AGENTS } from "../src/mock/data";
import { money, pill, quoteFor, sellQuoteFor } from "../src/mock/helpers";
import { C } from "../src/ui/theme";

test("money formats with two decimals by default and thousands separators", () => {
  expect(money(1240)).toBe("1,240.00");
  expect(money(318.4)).toBe("318.40");
  expect(money(5998.2, 1)).toBe("5,998.2");
});

test("buy quote takes 1% fee and 0.15 network from the gross", () => {
  const q = quoteFor(AGENTS.pkl, 250);
  expect(q.gross).toBe(250);
  expect(q.fee).toBeCloseTo(2.5);
  expect(q.network).toBe(0.15);
  expect(q.tokens).toBeCloseTo((250 - 2.5 - 0.15) / 0.0412, 3);
});

test("sell quote sells a percentage of the example 4,820 holding", () => {
  const sq = sellQuoteFor(AGENTS.pkl, 50);
  expect(sq.qty).toBe(2410);
  expect(sq.gross).toBeCloseTo(2410 * 0.0412);
  expect(sq.net).toBeCloseTo(sq.gross - sq.fee - 0.15);
});

test("pill returns the wireframe's active/inactive colours", () => {
  expect(pill(false)).toEqual({ bg: "transparent", fg: C.dim, bd: C.hair2 });
  expect(pill(true)).toEqual({ bg: C.ink, fg: C.onInk, bd: C.ink });
  expect(pill(true, C.lime)).toEqual({ bg: C.lime, fg: C.onLime, bd: C.lime });
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

```bash
npx jest __tests__/helpers.test.ts
```

Expected: FAIL, módulos `../src/mock/data` / `../src/mock/helpers` no existen.

- [ ] **Step 3: Escribir `src/mock/data.ts`**

Encabezado con tipos, y después `AGENTS`, `KINDS`, `POSTS` copiados **verbatim** de `.superpowers/pickler-mobile/src/data.js` (mismos valores, mismo orden, comillas dobles; el `import { C } from './theme'` pasa a `"../ui/theme"`):

```ts
// Datos de ejemplo portados verbatim de pickler-mobile@365585e (src/data.js).
// Cada cifra es ejemplo, nunca una condición del producto.
import { C } from "../ui/theme";

export type AgentId = "pkl" | "hld" | "kite" | "moss" | "roon";
export type Stage = "Pre-grad" | "Post-grad";
export type Op = "Active" | "Paused" | "No budget";

export type Agent = {
  id: AgentId;
  initial: string;
  name: string;
  ticker: string;
  tickerBare: string;
  what: string;
  bio: string;
  creator: string;
  price: string;
  change: string;
  up: boolean;
  stage: Stage;
  op: Op;
  market?: string;
  liquidity?: string;
  gradPct?: `${number}%`;
  gradText?: string;
  signal: string;
  noHistory: boolean;
  stats: { label: string; value: string }[];
  about: { label: string; value: string }[];
};

export const AGENTS: Record<AgentId, Agent> = {
  // … los cinco agentes (pkl, hld, kite, moss, roon) exactamente como en data.js …
};

export const KINDS = {
  prediction: { label: "Prediction", fg: C.violetInk, bd: "rgba(122,92,255,0.55)" },
  update: { label: "Update", fg: C.dim, bd: "rgba(243,241,236,0.28)" },
  opened: { label: "Trade opened", fg: C.lime, bd: "rgba(200,240,58,0.5)" },
  closed: { label: "Trade closed", fg: C.lime, bd: "rgba(200,240,58,0.5)" },
  result: { label: "Result", fg: C.up, bd: "rgba(123,227,138,0.5)" },
  change: { label: "Strategy change", fg: C.warn, bd: "rgba(245,195,91,0.5)" },
} as const;

export type PostKind = keyof typeof KINDS;

export type Post = {
  id: string;
  agent: AgentId;
  kind: PostKind;
  when: string;
  date: string;
  claim: string;
  why: string;
  status: string;
  money: string;
};

export const POSTS: Post[] = [
  // … los seis posts (p1–p6) exactamente como en data.js …
];
```

Comprobación de fidelidad, desde `apps/mobile/`:

```bash
grep -c "label:" ../../.superpowers/pickler-mobile/src/data.js; grep -c "label:" src/mock/data.ts
grep -c "id: 'p" ../../.superpowers/pickler-mobile/src/data.js; grep -c 'id: "p' src/mock/data.ts
```

Expected: las dos parejas de conteos coinciden (mismo número de `label:` y de posts).

- [ ] **Step 4: Escribir `src/mock/helpers.ts`**

```ts
import { C } from "../ui/theme";
import type { Agent } from "./data";

export function money(n: number, d?: number): string {
  const digits = d === undefined ? 2 : d;
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export type Quote = { price: number; gross: number; fee: number; network: number; tokens: number };

export function quoteFor(agent: Agent, amount: number): Quote {
  const price = parseFloat(agent.price);
  const gross = amount;
  const fee = gross * 0.01;
  const net = gross - fee - 0.15;
  return { price, gross, fee, network: 0.15, tokens: net / price };
}

export type SellQuote = { price: number; qty: number; gross: number; fee: number; network: number; net: number };

export function sellQuoteFor(agent: Agent, sellPct: number): SellQuote {
  const price = parseFloat(agent.price);
  const qty = 4820 * (sellPct / 100);
  const gross = qty * price;
  const fee = gross * 0.01;
  return { price, qty, gross, fee, network: 0.15, net: gross - fee - 0.15 };
}

export type Pill = { bg: string; fg: string; bd: string };

/** pill(active, activeBg) → { bg, fg, bd } exactamente como el wireframe. */
export function pill(active: boolean, activeBg?: string): Pill {
  return active
    ? { bg: activeBg ?? C.ink, fg: activeBg ? C.onLime : C.onInk, bd: activeBg ?? C.ink }
    : { bg: "transparent", fg: C.dim, bd: C.hair2 };
}
```

`balanceFor` y `agentById` del prototipo **no** se portan: el saldo es real y `agentById` no se usa.

- [ ] **Step 5: Correr el test y verlo pasar; tsc**

```bash
npx jest __tests__/helpers.test.ts && npx tsc --noEmit
```

Expected: 4 passed; tsc limpio.

- [ ] **Step 6: Commit**

```bash
git add src/mock/data.ts src/mock/helpers.ts __tests__/helpers.test.ts
git commit -m "feat(mobile): datos de ejemplo y helpers de cotización del prototipo"
```

---

### Task 4: Store de navegación con gate de cuenta

**Files:**
- Create: `apps/mobile/src/store.ts`
- Test: `apps/mobile/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `AGENTS`, `POSTS`, `Agent`, `AgentId`, `Post` de `./mock/data`; `money` de `./mock/helpers`.
- Produces (todo exportado de `src/store.ts`):
  - Tipos `Screen`, `Phase`, `Mode`, `UserKind`, `DataCase`, `Sort`, `AgentTab`, `StoreState`, `Patch`, `StoreInput`, `AppStore`.
  - `INITIAL: StoreState`.
  - Puras: `navState(s, screen, patch?)`, `backState(s)`, `requireAccountState(s, hasAccount, target, patch?)`, `afterSigninState(s)`, `resetState(s, screen)`, `deriveUser(hasAccount, mockHolder)`, `headerFor(screen, agent, post, mode, balance): [string, string]`.
  - Hook `useAppStore({ hasAccount, ausd }): AppStore`.

- [ ] **Step 1: Tests del store**

`apps/mobile/__tests__/store.test.ts`:

```ts
import {
  afterSigninState,
  backState,
  deriveUser,
  INITIAL,
  navState,
  requireAccountState,
  resetState,
} from "../src/store";

test("nav pushes the current screen and applies the patch", () => {
  const s = navState(INITIAL, "agent", { agentId: "hld", tab: "about" });
  expect(s.screen).toBe("agent");
  expect(s.stack).toEqual(["market"]);
  expect(s.agentId).toBe("hld");
  expect(s.tab).toBe("about");
});

test("the back-stack keeps only the last 8 screens", () => {
  let s = INITIAL;
  for (let i = 0; i < 10; i++) s = navState(s, i % 2 ? "market" : "activity");
  expect(s.stack).toHaveLength(8);
});

test("back pops the stack and falls back to market when empty", () => {
  const s = navState(navState(INITIAL, "agent"), "trade");
  expect(backState(s).screen).toBe("agent");
  expect(backState(INITIAL).screen).toBe("market");
  expect(backState(INITIAL).stack).toEqual([]);
});

test("without an account, Wallet asks for access and remembers where to go", () => {
  const s = requireAccountState(INITIAL, false, "wallet");
  expect(s.screen).toBe("signin");
  expect(s.resume).toBe(false);
  expect(s.next).toBe("wallet");
  expect(s.nextPatch).toEqual({});
});

test("without an account, Buy holds the purchase and resumes in Deposit", () => {
  const s = requireAccountState(INITIAL, false, "trade", { mode: "buy", phase: "insufficient" });
  expect(s.screen).toBe("signin");
  expect(s.resume).toBe(true);
  expect(s.next).toBe("deposit");
  expect(s.nextPatch).toEqual({ mode: "buy", phase: "insufficient", resume: true });
});

test("with an account the gate navigates straight to the target", () => {
  const s = requireAccountState(INITIAL, true, "wallet");
  expect(s.screen).toBe("wallet");
  expect(s.next).toBeUndefined();
});

test("reading screens never ask for an account", () => {
  for (const target of ["market", "search", "agent", "activity", "post", "ask"] as const) {
    expect(requireAccountState(INITIAL, false, target).screen).toBe(target);
  }
});

test("after sign-in the app lands on next without leaving signin in the stack", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "wallet"));
  expect(s.screen).toBe("wallet");
  expect(s.stack).toEqual(["market"]);
  expect(s.next).toBeUndefined();
  expect(s.nextPatch).toBeUndefined();
});

test("after sign-in from Buy the deposit screen resumes the purchase", () => {
  const s = afterSigninState(requireAccountState(INITIAL, false, "trade", { mode: "buy", phase: "insufficient" }));
  expect(s.screen).toBe("deposit");
  expect(s.resume).toBe(true);
  expect(s.phase).toBe("insufficient");
});

test("user is new without an account even when the dev panel marks holder", () => {
  expect(deriveUser(false, true)).toBe("new");
  expect(deriveUser(true, false)).toBe("funded");
  expect(deriveUser(true, true)).toBe("holder");
});

test("reset clears the stack, resume and the mock holder flag", () => {
  const dirty = { ...navState(INITIAL, "agent"), resume: true, mockHolder: true };
  const s = resetState(dirty, "market");
  expect(s).toMatchObject({ screen: "market", stack: [], resume: false, mockHolder: false });
});
```

- [ ] **Step 2: Correrlos y verlos fallar**

```bash
npx jest __tests__/store.test.ts
```

Expected: FAIL, `../src/store` no existe.

- [ ] **Step 3: Escribir `src/store.ts`**

```ts
import { useCallback, useState } from "react";
import { AGENTS, type Agent, type AgentId, POSTS, type Post } from "./mock/data";
import { money } from "./mock/helpers";

export type Screen =
  | "market" | "search" | "agent"
  | "trade" | "signin"
  | "activity" | "post" | "ask"
  | "portfolio" | "position" | "wallet" | "deposit" | "withdraw";
export type Phase = "quoting" | "quote" | "insufficient" | "expired" | "confirm" | "sent" | "done" | "failed" | "unknown";
export type Mode = "buy" | "sell";
export type UserKind = "new" | "funded" | "holder";
export type DataCase = "normal" | "loading" | "empty" | "stale";
export type Sort = "trending" | "volume" | "new";
export type AgentTab = "token" | "activity" | "about";

export type StoreState = {
  screen: Screen;
  stack: Screen[];
  agentId: AgentId;
  tab: AgentTab;
  postId: string;
  mode: Mode;
  phase: Phase;
  amount: number;
  sort: Sort;
  sellPct: number;
  following: boolean;
  resume: boolean;
  askCtx: string;
  dataCase: DataCase;
  /** Solo el panel de dev lo enciende: activa las posiciones de ejemplo. Nunca gobierna cuenta ni saldo. */
  mockHolder: boolean;
  /** A dónde ir al terminar Wallet access, y con qué patch. */
  next?: Screen;
  nextPatch?: Patch;
};

export type Patch = Partial<Omit<StoreState, "stack">>;

export const INITIAL: StoreState = {
  screen: "market", stack: [], dataCase: "normal",
  agentId: "pkl", tab: "token", postId: "p1",
  mode: "buy", phase: "quote", amount: 250, sort: "trending", sellPct: 50,
  following: true, resume: false, askCtx: "Pickle", mockHolder: false,
};

const STACK_MAX = 8;

export function navState(s: StoreState, screen: Screen, patch: Patch = {}): StoreState {
  return { ...s, ...patch, stack: [...s.stack, s.screen].slice(-STACK_MAX), screen };
}

export function backState(s: StoreState): StoreState {
  const stack = [...s.stack];
  const prev = stack.pop() ?? "market";
  return { ...s, stack, screen: prev };
}

/** Pantallas que exigen cuenta. Leer, seguir y preguntar nunca la piden. */
export const GATED: readonly Screen[] = ["wallet", "portfolio", "position", "deposit", "withdraw", "trade"];

export function requireAccountState(s: StoreState, hasAccount: boolean, target: Screen, patch: Patch = {}): StoreState {
  if (hasAccount || !GATED.includes(target)) return navState(s, target, patch);
  const buying = target === "trade";
  return navState(s, "signin", {
    resume: buying,
    next: buying ? "deposit" : target,
    nextPatch: buying ? { ...patch, resume: true } : patch,
  });
}

/** Tras el login aterriza en `next` sin dejar `signin` en el stack (como si se hubiera navegado directo). */
export function afterSigninState(s: StoreState): StoreState {
  const { next, nextPatch, ...rest } = s;
  return { ...rest, ...(nextPatch ?? {}), screen: next ?? "wallet" };
}

export function resetState(s: StoreState, screen: Screen): StoreState {
  return { ...s, screen, stack: [], resume: false, mockHolder: false, next: undefined, nextPatch: undefined };
}

export function deriveUser(hasAccount: boolean, mockHolder: boolean): UserKind {
  if (!hasAccount) return "new";
  return mockHolder ? "holder" : "funded";
}

const CAN_BACK: readonly Screen[] = ["agent", "trade", "post", "ask", "position", "deposit", "withdraw", "search", "signin"];
const SHOW_TABS: readonly Screen[] = ["market", "activity", "portfolio", "wallet", "search", "position"];

export function headerFor(screen: Screen, agent: Agent, post: Post, mode: Mode, balance: number): [string, string] {
  switch (screen) {
    case "market": return ["Market", "Discover agents and their tokens"];
    case "search": return ["Search", "Name, ticker, specialty"];
    case "agent": return [agent.name, agent.ticker + " · " + agent.what.split(" — ")[0]];
    case "trade": return [(mode === "buy" ? "Buy " : "Sell ") + agent.tickerBare, "Balance " + money(balance) + " AUSD"];
    case "signin": return ["Wallet access", "One step, then back to your purchase"];
    case "activity": return ["Activity", "What the agents you follow are doing"];
    case "post": return ["Activity", AGENTS[post.agent].name];
    case "ask": return ["Ask " + agent.name, "Questions only — never trades"];
    case "portfolio": return ["Portfolio", "Your token positions"];
    case "position": return ["Your " + agent.tickerBare, "Position detail"];
    case "wallet": return ["Wallet", "AUSD available and movements"];
    case "deposit": return ["Deposit AUSD", "Monad network"];
    case "withdraw": return ["Withdraw AUSD", "To an external address"];
  }
}

export type StoreInput = {
  /** `account.status !== "none"`. */
  hasAccount: boolean;
  /** AUSD real como número; 0 si no cargó. */
  ausd: number;
};

export type AppStore = {
  S: StoreState;
  set: (patch: Patch) => void;
  nav: (screen: Screen, patch?: Patch) => void;
  back: () => void;
  requireAccount: (target: Screen, patch?: Patch) => void;
  finishSignin: () => void;
  resetTo: (screen: Screen) => void;
  hasAccount: boolean;
  user: UserKind;
  agent: Agent;
  balance: number;
  holds: boolean;
  tradeHolds: boolean;
  scr: Screen;
  buying: boolean;
  post: Post;
  headerTitle: string;
  headerSub: string;
  canBack: boolean;
  showTabs: boolean;
  showAgentBar: boolean;
};

export function useAppStore({ hasAccount, ausd }: StoreInput): AppStore {
  const [S, setS] = useState<StoreState>(INITIAL);

  const set = useCallback((patch: Patch) => setS((s) => ({ ...s, ...patch })), []);
  const nav = useCallback((screen: Screen, patch?: Patch) => setS((s) => navState(s, screen, patch)), []);
  const back = useCallback(() => setS(backState), []);
  const requireAccount = useCallback(
    (target: Screen, patch?: Patch) => setS((s) => requireAccountState(s, hasAccount, target, patch)),
    [hasAccount],
  );
  const finishSignin = useCallback(() => setS(afterSigninState), []);
  const resetTo = useCallback((screen: Screen) => setS((s) => resetState(s, screen)), []);

  const agent = AGENTS[S.agentId];
  const user = deriveUser(hasAccount, S.mockHolder);
  const balance = hasAccount ? ausd : 0;
  const holds = user === "holder";
  // El wireframe trata una compra recién completada como tenencia (para Sell / posición).
  const tradeHolds = holds || (S.phase === "done" && S.mode === "buy");
  const post = POSTS.find((p) => p.id === S.postId) ?? POSTS[0];
  const [headerTitle, headerSub] = headerFor(S.screen, agent, post, S.mode, balance);

  return {
    S, set, nav, back, requireAccount, finishSignin, resetTo,
    hasAccount, user, agent, balance, holds, tradeHolds,
    scr: S.screen, buying: S.mode === "buy", post, headerTitle, headerSub,
    canBack: CAN_BACK.includes(S.screen),
    showTabs: SHOW_TABS.includes(S.screen),
    showAgentBar: S.screen === "agent",
  };
}
```

- [ ] **Step 4: Correr los tests y verlos pasar; tsc**

```bash
npx jest __tests__/store.test.ts && npx tsc --noEmit
```

Expected: 11 passed; tsc limpio.

- [ ] **Step 5: Probar contra el defecto**

Cambiar temporalmente en `requireAccountState` la línea `if (hasAccount || !GATED.includes(target))` por `if (true)` y correr `npx jest __tests__/store.test.ts`. Expected: fallan los tests "without an account…" (2) y "after sign-in…" (2). Revertir el cambio y confirmar 11 passed.

- [ ] **Step 6: Commit**

```bash
git add src/store.ts __tests__/store.test.ts
git commit -m "feat(mobile): store de navegación del prototipo con gate de cuenta real"
```

---

### Task 5: Hooks de cuenta y tesorería, y `AppCtx`

**Files:**
- Create: `apps/mobile/src/hooks/useAccount.ts`, `apps/mobile/src/hooks/useTreasury.ts`, `apps/mobile/src/ctx.ts`
- Modify: `apps/mobile/src/config/chain.ts`, `apps/mobile/__tests__/chain.test.ts`

**Interfaces:**
- Consumes: `AccountState`, `accountAddress` de `../account`; `loadStoredAccount`, `clearStoredAccount` de `../storage/storage`; `readBalances`, `requestAusdFromFaucet`, `waitForReceipt` de `../wallet/chain`; `describeError`, `unlockStoredWallet`, `Wallet` de `../wallet/wallet`; `AppStore` de `../store`.
- Produces:
  - `ausdToNumber(raw: bigint): number` en `config/chain.ts`.
  - `useAccount(): { account: AccountState | null } & AccountActions` con `AccountActions = { onWallet(wallet: Wallet): void; lock(): void; signOut(): Promise<void> }`.
  - `useTreasury(account: AccountState, onUnlock: (w: Wallet) => void): Treasury` con `Treasury = { balances: { ausd: bigint; mon: bigint } | null; rpcError: string; busy: boolean; notice: string; error: string; refresh(): Promise<void>; getTestAusd(): Promise<void> }`.
  - `AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury }`.

- [ ] **Step 1: Test de `ausdToNumber`**

Agregar al final de `apps/mobile/__tests__/chain.test.ts` (y `ausdToNumber` al import de `../src/config/chain` que ya existe en ese archivo):

```ts
test("ausdToNumber turns 6-decimal units into a plain number", () => {
  expect(ausdToNumber(1_240_000_000n)).toBe(1240);
  expect(ausdToNumber(318_400_000n)).toBe(318.4);
  expect(ausdToNumber(0n)).toBe(0);
});
```

- [ ] **Step 2: Correrlo y verlo fallar**

```bash
npx jest __tests__/chain.test.ts
```

Expected: FAIL, `ausdToNumber` no exportado.

- [ ] **Step 3: Agregar `ausdToNumber` a `src/config/chain.ts`**

Después de `formatMon`:

```ts
/** AUSD como número para la UI (saldo "available", umbral de compra). */
export function ausdToNumber(raw: bigint): number {
  return Number(formatUnits(raw, AUSD_DECIMALS));
}
```

- [ ] **Step 4: Correr el test y verlo pasar**

```bash
npx jest __tests__/chain.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Escribir `src/hooks/useAccount.ts`** (lógica movida de `App.tsx`, sin cambios)

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountState } from "../account";
import { clearStoredAccount, loadStoredAccount } from "../storage/storage";
import type { Wallet } from "../wallet/wallet";

export type AccountActions = {
  onWallet: (wallet: Wallet) => void;
  lock: () => void;
  signOut: () => Promise<void>;
};

/** Cuenta guardada en el dispositivo. `null` mientras carga; después `none` / `locked` / `unlocked`. */
export function useAccount(): { account: AccountState | null } & AccountActions {
  const [account, setAccount] = useState<AccountState | null>(null);
  const ref = useRef(account);
  ref.current = account;

  // Termina la sesión de firma saliente cuando la wallet deja el estado.
  const replace = useCallback((next: AccountState) => {
    const cur = ref.current;
    if (cur?.status === "unlocked" && (next.status !== "unlocked" || next.wallet !== cur.wallet)) {
      cur.wallet.session.end();
    }
    ref.current = next;
    setAccount(next);
  }, []);

  // Arranque: solo la dirección (sin gate). Nada de Face ID aquí.
  useEffect(() => {
    let stale = false;
    loadStoredAccount()
      .then((s) => !stale && setAccount(s ? { status: "locked", ...s } : { status: "none" }))
      .catch(() => !stale && setAccount({ status: "none" }));
    return () => {
      stale = true;
    };
  }, []);

  const onWallet = useCallback((wallet: Wallet) => replace({ status: "unlocked", wallet }), [replace]);

  const lock = useCallback(() => {
    const cur = ref.current;
    if (cur?.status === "unlocked") {
      replace({ status: "locked", address: cur.wallet.address, credentialId: cur.wallet.credentialId });
    }
  }, [replace]);

  const signOut = useCallback(async () => {
    await clearStoredAccount();
    replace({ status: "none" });
  }, [replace]);

  return { account, onWallet, lock, signOut };
}
```

- [ ] **Step 6: Escribir `src/hooks/useTreasury.ts`** (lógica movida de `Home.tsx`; único añadido: sin dirección no consulta nada, y al cambiar de dirección se limpian aviso y error)

```ts
import { useCallback, useEffect, useState } from "react";
import { accountAddress, type AccountState } from "../account";
import { readBalances, requestAusdFromFaucet, waitForReceipt } from "../wallet/chain";
import { describeError, unlockStoredWallet, type Wallet } from "../wallet/wallet";

export type Balances = { ausd: bigint; mon: bigint };

export type Treasury = {
  balances: Balances | null;
  rpcError: string;
  busy: boolean;
  notice: string;
  error: string;
  refresh: () => Promise<void>;
  getTestAusd: () => Promise<void>;
};

export function useTreasury(account: AccountState, onUnlock: (w: Wallet) => void): Treasury {
  const address = accountAddress(account);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [rpcError, setRpcError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setRpcError("");
    if (!address) {
      setBalances(null);
      return;
    }
    try {
      setBalances(await readBalances(address));
    } catch (e) {
      setBalances(null);
      setRpcError(describeError(e));
    }
  }, [address]);

  useEffect(() => {
    setNotice("");
    setError("");
    refresh();
  }, [refresh]);

  const getTestAusd = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const fresh = await readBalances(address);
      setBalances(fresh);
      if (fresh.mon === 0n) {
        throw new Error("You need test MON for gas. Get some at the Monad faucet and try again.");
      }
      let wallet: Wallet;
      if (account.status === "unlocked") {
        wallet = account.wallet;
      } else {
        const unlocked = await unlockStoredWallet();
        if (!unlocked) throw new Error("No stored account. Sign out and sign in again.");
        wallet = unlocked;
        onUnlock(wallet);
      }
      const hash = await requestAusdFromFaucet(wallet);
      setNotice(`Sent: ${hash}`);
      const status = await waitForReceipt(hash);
      setNotice(status === "success" ? `Confirmed: ${hash}` : `Reverted: ${hash}`);
      await refresh();
    } catch (e) {
      const msg = describeError(e);
      if (msg) setError(msg);
    } finally {
      setBusy(false);
    }
  }, [address, account, onUnlock, refresh]);

  return { balances, rpcError, busy, notice, error, refresh, getTestAusd };
}
```

- [ ] **Step 7: Escribir `src/ctx.ts`**

```ts
import type { AccountState } from "./account";
import type { AccountActions } from "./hooks/useAccount";
import type { Treasury } from "./hooks/useTreasury";
import type { AppStore } from "./store";

/** Todo lo que reciben Shell, DevControls y las pantallas. */
export type AppCtx = AppStore & AccountActions & { account: AccountState; treasury: Treasury };
```

- [ ] **Step 8: tsc y suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc limpio; `Tests: 39 passed`.

- [ ] **Step 9: Commit**

```bash
git add src/hooks/useAccount.ts src/hooks/useTreasury.ts src/ctx.ts src/config/chain.ts __tests__/chain.test.ts
git commit -m "feat(mobile): hooks de cuenta y tesorería extraídos de App y Home"
```

---

### Task 6: Pantallas Discover y Follow (port idéntico)

**Files:**
- Create: `apps/mobile/src/screens/discover.tsx`, `apps/mobile/src/screens/follow.tsx`

**Interfaces:**
- Consumes: `AppCtx` de `../ctx`; `Agent`, `Stage`, `AGENTS`, `POSTS`, `KINDS` de `../mock/data`; `pill`, `money` de `../mock/helpers`; primitivas de `../ui/primitives`; `C` de `../ui/theme`; tipos `Sort`, `AgentTab` de `../store`.
- Produces: `MarketScreen`, `SearchScreen`, `AgentScreen` (discover); `ActivityScreen`, `PostScreen`, `AskScreen` (follow). Todos `(ctx: AppCtx) => ReactElement`.

- [ ] **Step 1: Copiar `discover.js` a `src/screens/discover.tsx`** y aplicar las Reglas de porte más estos cambios de tipado (solo tipos; el JSX no cambia):

```ts
import { ScrollView, View } from "react-native";
import type { AppCtx } from "../ctx";
import { AGENTS, type Agent, KINDS, POSTS, type Stage } from "../mock/data";
import { money, pill } from "../mock/helpers";
import type { AgentTab, Sort } from "../store";
import { Avatar, EmptyPanel, Hair, Segmented, StatGrid, T, Tag, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";

const SORT_NOTES: Record<Sort, string> = { /* igual */ };

const stageStyle = (stage: Stage) => ({ /* igual */ });

export function MarketScreen({ S, set, nav }: AppCtx) {
  const ready = S.dataCase === "normal" || S.dataCase === "stale";
  const sorts = (["trending", "volume", "new"] as const).map((k) => { /* igual */ });
  // …
}

export function SearchScreen({ set, nav }: AppCtx) { /* igual */ }

export function AgentScreen(ctx: AppCtx) {
  const { S, set, nav, agent: a, tradeHolds } = ctx;
  // …
  const tabs = [["token", "Token"], ["activity", "Activity"], ["about", "About"]] as const;
  // … en el map: set({ tab: k }) con k: AgentTab
}

function AgentToken({ ctx, a, hasPosition }: { ctx: AppCtx; a: Agent; hasPosition: boolean }) { /* igual */ }

function AgentActivity({ ctx, a }: { ctx: AppCtx; a: Agent }) { /* igual */ }
```

Notas de tipado que van a aparecer:
- `width: a.gradPct` compila porque `gradPct` es `` `${number}%` `` (Task 3).
- `nav("agent", { agentId: "pkl" })` en Recent de Search: igual.
- Si `Hair` o `money` quedan sin usar en `discover.tsx`, quitar ese import (tsc no lo exige, pero no dejamos imports muertos).

- [ ] **Step 2: Copiar `follow.js` a `src/screens/follow.tsx`** con las Reglas de porte y estos cambios:

```ts
import { View } from "react-native";
import type { AppCtx } from "../ctx";
import { AGENTS, KINDS, POSTS } from "../mock/data";
import { EmptyPanel, Segmented, StatGrid, T, Tag, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";

export function ActivityScreen({ user, nav }: AppCtx) {
  const empty = user === "new";            // antes: S.user === 'new'
  // … resto igual
}

export function PostScreen({ S, nav }: AppCtx) { /* igual */ }

export function AskScreen({ S, agent: a }: AppCtx) { /* igual */ }
```

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: limpio. Si aparece un error de tipos, la causa esperada es una tupla sin `as const` o una clave de `Record` faltante; se corrige el tipo, **no** el JSX.

- [ ] **Step 4: Comprobación de fidelidad de copy**

```bash
for f in discover follow; do
  a=$(grep -o "'[^']*'" ../../.superpowers/pickler-mobile/src/screens/$f.js | wc -l)
  b=$(grep -o '"[^"]*"' src/screens/$f.tsx | wc -l)
  echo "$f: prototipo $a literales, port $b literales"
done
```

Expected: los conteos difieren como mucho en los imports cambiados (±6). Cualquier diferencia mayor se explica antes de seguir.

- [ ] **Step 5: Commit**

```bash
git add src/screens/discover.tsx src/screens/follow.tsx
git commit -m "feat(mobile): pantallas Market, Search, Agent, Activity, Post y Ask del prototipo"
```

---

### Task 7: Pantallas Trade y Wallet access (passkey real)

**Files:**
- Create: `apps/mobile/src/screens/trade.tsx`

**Interfaces:**
- Consumes: `AppCtx`; `createAccount`, `signIn`, `describeError` de `../wallet/wallet`; `Phase`, `Mode` de `../store`; `money`, `quoteFor`, `sellQuoteFor`, `pill`; `KV`, `Segmented`, `T`, `Touch`; `C`.
- Produces: `TradeScreen(ctx: AppCtx)`, `SigninScreen(ctx: AppCtx)`.

- [ ] **Step 1: Copiar `trade.js` a `src/screens/trade.tsx`** (Reglas de porte) y tipar `TradeScreen` así:

```ts
import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import type { AppCtx } from "../ctx";
import { money, pill, quoteFor, sellQuoteFor } from "../mock/helpers";
import type { Phase } from "../store";
import { KV, Segmented, T, Touch } from "../ui/primitives";
import { C } from "../ui/theme";
import { createAccount, describeError, signIn } from "../wallet/wallet";

type Notice = { title: string; body: string; bd: string; bg: string; fg: string };
type Result = { title: string; glyph: string; fg: string; bd: string; bg: string; body: string; rows: { label: string; value: string }[] };
type Action = { label: string; bg: string; fg: string; bd: string; disabled?: boolean; go: () => void };
type Row = { label: string; value: string; fg: string };

export function TradeScreen(ctx: AppCtx) {
  const { S, set, nav, agent: a, balance } = ctx;
  // …
  const notice: Notice | undefined = ({ /* igual */ } as Partial<Record<Phase, Notice>>)[p];
  const result: Result | null = /* igual */;
  const actions: Action[] = ({ /* igual */ } as Record<Phase, Action[]>)[p];
  const quoteRows: Row[] = /* igual */;
  // …
  <Segmented options={([["buy", "Buy"], ["sell", "Sell"]] as const).map(([k, label]) => { /* igual */ })} />
```

Único cambio semántico en `TradeScreen` (Regla 4):

```ts
// antes:  { label: 'See your position', …, go: () => nav('position', { user: 'holder' }) },
// ahora:
{ label: "See your position", bg: C.lime, fg: C.onLime, bd: C.lime, go: () => nav("position", { mockHolder: true }) },
```

- [ ] **Step 2: Reemplazar `SigninScreen` por la versión real**

```tsx
export function SigninScreen({ S, agent: a, onWallet, finishSignin }: AppCtx) {
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
    <View style={{ padding: 20, paddingHorizontal: 16, gap: 14 }}>
      {S.resume ? (
        <View style={{ padding: 13, borderWidth: 1, borderColor: "rgba(122,92,255,0.5)", backgroundColor: "rgba(122,92,255,0.12)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4}>Your purchase is being held</T>
          <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 3 }}>250.00 AUSD of {a.tickerBare} ({a.name}) — you come straight back here after this step.</T>
        </View>
      ) : null}
      <T w={400} s={13.5} lh={1.5} color={C.dim}>You need a wallet to hold AUSD and agent tokens. Reading the market, following agents and asking questions never require one.</T>
      <Touch onPress={() => run("create")} disabled={off} style={{ paddingVertical: 15, borderRadius: 14, backgroundColor: C.lime, alignItems: "center", opacity: off && busy !== "create" ? 0.5 : 1 }}>
        {busy === "create" ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={14.5} color={C.onLime}>Create a wallet</T>}
      </Touch>
      <Touch onPress={() => run("signin")} disabled={off} style={{ paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: C.hair2, alignItems: "center", opacity: off && busy !== "signin" ? 0.5 : 1 }}>
        {busy === "signin" ? <ActivityIndicator color={C.ink} /> : <T w={700} s={14.5}>I already have one</T>}
      </Touch>
      {error ? <T w={400} s={12.5} lh={1.4} color={C.down}>{error}</T> : null}
    </View>
  );
}
```

Cambios respecto al prototipo, y solo estos: la tarjeta violeta se muestra solo con `S.resume` (§3.1 del spec); los botones llaman a passkey real y muestran spinner; hay línea de error; se elimina el párrafo "Dependency: …".

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: limpio.

- [ ] **Step 4: Commit**

```bash
git add src/screens/trade.tsx
git commit -m "feat(mobile): pantalla Trade del prototipo y Wallet access con passkey real"
```

---

### Task 8: Pantallas Own (Wallet y Deposit con datos reales)

**Files:**
- Create: `apps/mobile/src/screens/own.tsx`

**Interfaces:**
- Consumes: `AppCtx`; `accountAddress` de `../account`; `EXPLORER_TX_URL`, `MON_FAUCET_URL`, `formatMon` de `../config/chain`; `money`; `AgentId`; `KV`, `StatGrid`, `EmptyPanel`, `TouchCard`, `T`, `Touch`; `C`; `expo-clipboard`.
- Produces: `PortfolioScreen`, `PositionScreen`, `WalletScreen`, `DepositScreen`, `WithdrawScreen`, todos `(ctx: AppCtx)`.

- [ ] **Step 1: Copiar `own.js` a `src/screens/own.tsx`** (Reglas de porte). Encabezado e imports:

```ts
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Linking, View } from "react-native";
import { accountAddress } from "../account";
import { EXPLORER_TX_URL, formatMon, MON_FAUCET_URL } from "../config/chain";
import type { AppCtx } from "../ctx";
import type { AgentId } from "../mock/data";
import { money } from "../mock/helpers";
import { EmptyPanel, KV, StatGrid, T, Touch, TouchCard } from "../ui/primitives";
import { C } from "../ui/theme";
```

`PortfolioScreen({ holds, balance, nav }: AppCtx)`, `PositionScreen({ agent: a, nav }: AppCtx)` y `WithdrawScreen({ balance, nav }: AppCtx)` quedan **idénticos**; en Portfolio el arreglo `positions` se tipa con `agentId: AgentId` (declarar `type PositionRow = { initial: string; name: string; ticker: string; qty: string; avg: string; value: string; pl: string; plFg: string; agentId: AgentId }` y `const positions: PositionRow[] = empty ? [] : [ /* igual */ ]`).

- [ ] **Step 2: Reemplazar `WalletScreen`**

```tsx
type Move = { kind: string; amount: string; fg: string; when: string; ref: string; status: string; stFg: string };

const secondaryBtn = { flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" } as const;
const chipBtn = { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.hair2 } as const;

export function WalletScreen({ balance, nav, account, treasury, lock, signOut, resetTo }: AppCtx) {
  const available = treasury.balances ? money(balance) + " AUSD" : "—";
  const pending = balance === 0
    ? "Nothing pending. Nothing has ever arrived in this wallet."
    : "50.00 AUSD pending · a deposit is still confirming";
  const moves: Move[] = [
    { kind: "Deposit", amount: "+500.00 AUSD", fg: C.up, when: "Sep 15, 09:20", ref: "0x7ac4…e0b3", status: "Confirming", stFg: C.warn },
    { kind: "Bought PKL", amount: "−250.00 AUSD", fg: C.ink, when: "Sep 15, 09:42", ref: "0x4d1a…77c", status: "Complete", stFg: C.up },
    { kind: "Sold MOSS", amount: "+58.20 AUSD", fg: C.up, when: "Aug 02, 16:10", ref: "0x88fd…1a4", status: "Complete", stFg: C.up },
    { kind: "Withdrawal", amount: "−120.00 AUSD", fg: C.ink, when: "Jul 28, 10:02", ref: "0x12cc…903", status: "Complete", stFg: C.up },
  ];
  const txHash = treasury.notice.split(": ")[1];
  const unlocked = account.status === "unlocked";

  return (
    <View style={{ padding: 14, paddingHorizontal: 16, paddingBottom: 20, gap: 13 }}>
      <View style={{ padding: 16, borderWidth: 1, borderColor: C.hair, borderRadius: 16, backgroundColor: C.surf }}>
        <T w={400} s={11.5} color={C.mute}>Available to spend</T>
        <T w={800} s={30} lh={1} ls={-0.04} style={{ marginTop: 8 }}>{available}</T>
        <T w={400} s={12} lh={1.4} color={C.mute} style={{ marginTop: 8 }}>{pending}</T>
      </View>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => nav("deposit")} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
          <T w={700} s={13.5} color={C.onLime}>Deposit</T>
        </Touch>
        <Touch onPress={() => nav("withdraw")} style={secondaryBtn}>
          <T w={700} s={13.5}>Withdraw</T>
        </Touch>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>TESTNET</T>
        <View style={{ gap: 8 }}>
          <View style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf, flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
            <T w={600} s={13}>MON (gas)</T>
            <T w={500} s={13} mono>{treasury.balances ? formatMon(treasury.balances.mon) : "—"}</T>
          </View>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Touch onPress={() => { void treasury.getTestAusd(); }} disabled={treasury.busy} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center", opacity: treasury.busy ? 0.6 : 1 }}>
              {treasury.busy ? <ActivityIndicator color={C.onLime} /> : <T w={700} s={13.5} color={C.onLime}>Get test AUSD</T>}
            </Touch>
            <Touch onPress={() => { void Linking.openURL(MON_FAUCET_URL); }} style={secondaryBtn}>
              <T w={700} s={13.5}>Get test MON</T>
            </Touch>
          </View>
          <Touch onPress={() => { void treasury.refresh(); }} style={secondaryBtn}>
            <T w={600} s={13}>Refresh</T>
          </Touch>
          {treasury.rpcError ? (
            <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(245,195,91,0.5)", backgroundColor: "rgba(245,195,91,0.1)", borderRadius: 12, gap: 8 }}>
              <T w={400} s={12} lh={1.4} color={C.warn}>{treasury.rpcError}</T>
              <Touch onPress={() => { void treasury.refresh(); }} style={{ alignSelf: "flex-start", ...chipBtn }}>
                <T w={600} s={12}>Retry</T>
              </Touch>
            </View>
          ) : null}
          {treasury.notice ? (
            <Touch onPress={() => { if (txHash) void Linking.openURL(EXPLORER_TX_URL(txHash)); }}>
              <T w={400} s={11.5} lh={1.4} mono color={C.up}>{treasury.notice}</T>
            </Touch>
          ) : null}
          {treasury.error ? <T w={400} s={12} lh={1.4} color={C.down}>{treasury.error}</T> : null}
        </View>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>MOVEMENTS</T>
        <View style={{ gap: 6 }}>
          {moves.map((m, i) => (
            <View key={i} style={{ padding: 12, borderWidth: 1, borderColor: C.hairSoft, borderRadius: 11, backgroundColor: C.surf }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <T w={600} s={13} lh={1.2}>{m.kind}</T>
                <T w={500} s={13} lh={1.2} mono color={m.fg}>{m.amount}</T>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 10, marginTop: 5 }}>
                <T w={400} s={11} lh={1.3} mono color={C.mute}>{m.when} · {m.ref}</T>
                <T w={500} s={11} lh={1.3} color={m.stFg}>{m.status}</T>
              </View>
            </View>
          ))}
        </View>
      </View>

      <View>
        <T w={500} s={11} mono color={C.mute} style={{ marginBottom: 7 }}>SESSION</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <T w={400} s={12.5} color={C.mute} style={{ flex: 1 }}>{unlocked ? "Unlocked" : "Locked"}</T>
          {unlocked ? (
            <Touch onPress={lock} style={chipBtn}>
              <T w={600} s={12.5}>Lock</T>
            </Touch>
          ) : null}
          <Touch onPress={() => { void signOut().then(() => resetTo("market")); }} style={chipBtn}>
            <T w={600} s={12.5}>Sign out</T>
          </Touch>
        </View>
      </View>
    </View>
  );
}
```

- [ ] **Step 3: Reemplazar `DepositScreen`**

```tsx
export function DepositScreen({ S, nav, account }: AppCtx) {
  const address = accountAddress(account) ?? "";
  const [copied, setCopied] = useState(false);

  return (
    <View style={{ padding: 16, gap: 13 }}>
      {S.resume ? (
        <View style={{ paddingVertical: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: "rgba(122,92,255,0.5)", backgroundColor: "rgba(122,92,255,0.12)", borderRadius: 12 }}>
          <T w={600} s={12.5} lh={1.4}>Deposit to finish your purchase</T>
          <T w={400} s={12} lh={1.4} color={C.dim} style={{ marginTop: 3 }}>250.00 AUSD of PKL (Pickle) — we keep it for you.</T>
        </View>
      ) : null}
      <StatGrid items={[{ label: "Asset", value: "AUSD", fg: C.ink }, { label: "Network", value: "Monad", fg: C.ink }]} />
      <View style={{ height: 150, borderWidth: 1, borderColor: C.hair2, borderStyle: "dashed", borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.surf }}>
        <T w={500} s={11.5} mono color={C.mute}>QR code · deposit address</T>
      </View>
      <View style={{ padding: 13, borderWidth: 1, borderColor: C.hair, borderRadius: 13, backgroundColor: C.surf }}>
        <T w={400} s={11} color={C.mute}>Your deposit address</T>
        <T w={500} s={12.5} lh={1.45} mono style={{ marginTop: 6 }}>{address}</T>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Touch onPress={() => { void Clipboard.setStringAsync(address).then(() => setCopied(true)); }} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
          <T w={700} s={13.5} color={C.onLime}>{copied ? "Copied" : "Copy address"}</T>
        </Touch>
        <Touch onPress={() => nav("trade", { phase: "quote", resume: true })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: C.hair2, alignItems: "center" }}>
          <T w={700} s={13.5}>I've sent it</T>
        </Touch>
      </View>
      <T w={400} s={11.5} lh={1.45} color={C.mute}>Only AUSD on Monad arrives here. Card and bank transfer are not assumed to exist. Whether a gas asset is also needed is still open.</T>
    </View>
  );
}
```

Cambios respecto al prototipo, y solo estos: dirección real; "Copy address" copia y se queda (muestra "Copied"); "I've sent it" pierde `user: 'funded'` (Regla 4).

- [ ] **Step 4: tsc**

```bash
npx tsc --noEmit
```

Expected: limpio.

- [ ] **Step 5: Commit**

```bash
git add src/screens/own.tsx
git commit -m "feat(mobile): pantallas Own del prototipo; Wallet y Deposit con saldo, faucet y dirección reales"
```

---

### Task 9: Shell y panel de dev

**Files:**
- Create: `apps/mobile/src/Shell.tsx`, `apps/mobile/src/DevControls.tsx`

**Interfaces:**
- Consumes: `AppCtx`; las 13 pantallas de las Tasks 6–8; `pill`; `T`, `Touch`, `Hair`; `C`; tipos `Screen`, `Phase`, `Patch` de `../store`.
- Produces: `Shell({ ctx }: { ctx: AppCtx })`, `DevControls({ visible, onClose, ctx })`.

- [ ] **Step 1: Escribir `src/Shell.tsx`**

Port de la parte superior de `Shell.js`. Cambios respecto al prototipo: sin barra falsa "9:41"; el ⚙ pasa al header como acción solo en `__DEV__`; Wallet/Portfolio de la tab bar y el botón Buy usan `requireAccount`; `ControlsModal` vive en `DevControls.tsx`.

```tsx
import { type ReactElement, useState } from "react";
import { Image, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppCtx } from "./ctx";
import { DevControls } from "./DevControls";
import { pill } from "./mock/helpers";
import { AgentScreen, MarketScreen, SearchScreen } from "./screens/discover";
import { ActivityScreen, AskScreen, PostScreen } from "./screens/follow";
import { DepositScreen, PortfolioScreen, PositionScreen, WalletScreen, WithdrawScreen } from "./screens/own";
import { SigninScreen, TradeScreen } from "./screens/trade";
import type { Screen } from "./store";
import { T, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREENS: Record<Screen, (ctx: AppCtx) => ReactElement> = {
  market: MarketScreen, search: SearchScreen, agent: AgentScreen,
  trade: TradeScreen, signin: SigninScreen,
  activity: ActivityScreen, post: PostScreen, ask: AskScreen,
  portfolio: PortfolioScreen, position: PositionScreen, wallet: WalletScreen,
  deposit: DepositScreen, withdraw: WithdrawScreen,
};

const BOTTOM_TABS: readonly [Screen, string][] = [["market", "Market"], ["activity", "Activity"], ["portfolio", "Portfolio"], ["wallet", "Wallet"]];

type HeaderAction = { label: string; active?: boolean; go: () => void };

export function Shell({ ctx }: { ctx: AppCtx }) {
  const { S, set, nav, back, requireAccount, agent, balance, tradeHolds: holds } = ctx;
  const [controls, setControls] = useState(false);
  const Current = SCREENS[ctx.scr];

  const headerActions: HeaderAction[] = S.screen === "market"
    ? [{ label: "★", go: () => nav("search") }, { label: "Alerts", go: () => nav("activity") }]
    : S.screen === "agent"
      ? [{ label: "★", active: S.following, go: () => set({ following: !S.following }) }]
      : [];
  if (__DEV__) headerActions.push({ label: "⚙", go: () => setControls(true) });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.phone }}>
      {/* app header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.hairSoft }}>
        {ctx.canBack ? (
          <Touch onPress={back} style={{ width: 32, height: 32, borderRadius: 999, borderWidth: 1, borderColor: C.hair2, alignItems: "center", justifyContent: "center" }}>
            <T w={500} s={14}>←</T>
          </Touch>
        ) : null}
        {S.screen === "market" ? (
          <Image source={require("../assets/pickler-mark.png")} style={{ width: 26, height: 26 }} resizeMode="contain" />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <T w={800} s={17} lh={1.15} ls={-0.03} numberOfLines={1}>{ctx.headerTitle}</T>
          <T w={400} s={11.5} lh={1.2} color={C.mute} numberOfLines={1} style={{ marginTop: 2 }}>{ctx.headerSub}</T>
        </View>
        {headerActions.map((a, i) => {
          const p = pill(!!a.active, a.active ? C.lime : undefined);
          return (
            <Touch key={i} onPress={a.go} style={{ height: 30, paddingHorizontal: 11, borderRadius: 999, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, alignItems: "center", justifyContent: "center" }}>
              <T w={600} s={12} color={p.fg}>{a.label}</T>
            </Touch>
          );
        })}
      </View>

      {/* scroll body */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <Current {...ctx} />
      </ScrollView>

      {/* agent sticky buy bar */}
      {ctx.showAgentBar ? (
        <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, backgroundColor: "rgba(11,11,14,0.98)", borderTopWidth: 1, borderTopColor: C.hair }}>
          <Touch onPress={() => requireAccount("trade", { mode: "buy", phase: balance === 0 ? "insufficient" : "quote" })} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, backgroundColor: C.lime, alignItems: "center" }}>
            <T w={700} s={14} color={C.onLime}>Buy {agent.tickerBare}</T>
          </Touch>
          <Touch onPress={holds ? () => nav("trade", { mode: "sell", phase: "quote" }) : undefined} disabled={!holds} style={{ flex: 1, paddingVertical: 14, borderRadius: 13, borderWidth: 1, borderColor: holds ? C.hair2 : "rgba(243,241,236,0.12)", alignItems: "center" }}>
            <T w={700} s={14} color={holds ? C.ink : C.disabled}>Sell</T>
          </Touch>
        </View>
      ) : null}

      {/* bottom tab bar */}
      {ctx.showTabs ? (
        <View style={{ flexDirection: "row", borderTopWidth: 1, borderTopColor: C.hairSoft, backgroundColor: C.phone, paddingTop: 8, paddingBottom: 6, paddingHorizontal: 6 }}>
          {BOTTOM_TABS.map(([k, label]) => {
            const on = S.screen === k || (k === "portfolio" && S.screen === "position") || (k === "market" && S.screen === "search");
            const fg = on ? C.lime : C.mute;
            return (
              <Touch key={k} onPress={() => requireAccount(k)} style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 6 }}>
                <View style={{ width: 18, height: 18, borderRadius: 6, borderWidth: 1.5, borderColor: fg, backgroundColor: on ? C.lime : "transparent" }} />
                <T w={600} s={11} color={fg}>{label}</T>
              </Touch>
            );
          })}
        </View>
      ) : null}

      {__DEV__ ? <DevControls visible={controls} onClose={() => setControls(false)} ctx={ctx} /> : null}
    </SafeAreaView>
  );
}
```

(`requireAccount("market")` y `requireAccount("activity")` navegan directo porque no están en `GATED`; así la tab bar usa una sola función.)

- [ ] **Step 2: Escribir `src/DevControls.tsx`**

Port de `ControlsModal` y sus constantes. Cambios: los botones de *user state* se reducen a dos (funded/holder) que solo tocan `mockHolder`, con una línea que aclara que cuenta y saldo son reales; los saltos a pantallas con cuenta pasan por `requireAccount`; los patches `user:` de las journeys se convierten según la Regla 4; "Kite" y "dataCase" usan `nav` en vez de `set` con `stack`.

```tsx
import { Modal, ScrollView, View } from "react-native";
import type { AppCtx } from "./ctx";
import { pill } from "./mock/helpers";
import type { Patch, Phase, Screen } from "./store";
import { Hair, T, Touch } from "./ui/primitives";
import { C } from "./ui/theme";

const SCREEN_GROUPS: readonly [string, readonly [Screen, string][]][] = [
  ["Discover", [["market", "Market"], ["search", "Search & filters"], ["agent", "Agent"]]],
  ["Trade", [["trade", "Buy / Sell"], ["signin", "Wallet access"]]],
  ["Follow", [["activity", "Activity"], ["post", "Activity detail"], ["ask", "Ask agent"]]],
  ["Own", [["portfolio", "Portfolio"], ["position", "Position"], ["wallet", "Wallet"], ["deposit", "Deposit"], ["withdraw", "Withdraw"]]],
];

const PHASES: readonly [Phase, string][] = [
  ["quoting", "Quoting"], ["quote", "Quote ready"], ["insufficient", "No balance"], ["expired", "Quote expired"],
  ["confirm", "Confirm"], ["sent", "Processing"], ["done", "Completed"], ["failed", "Failed"], ["unknown", "Unknown"],
];

type Step = { label: string; screen: Screen; patch: Patch };
type Journey = { title: string; note: string; steps: Step[] };
const J = (label: string, screen: Screen, patch: Patch = {}): Step => ({ label, screen, patch });

const JOURNEYS: Journey[] = [
  { title: "New user buys", note: "Agent and amount survive wallet access and a deposit.", steps: [
    J("Market", "market"), J("Agent", "agent", { agentId: "pkl", tab: "token" }),
    J("Buy", "trade", { mode: "buy", phase: "insufficient" }), J("Wallet access", "signin", { resume: true }),
    J("Deposit", "deposit", { resume: true }), J("Quote", "trade", { phase: "quote", resume: true }),
    J("Complete", "trade", { phase: "done" }), J("Position", "position", { mockHolder: true, agentId: "pkl" })] },
  { title: "User with balance buys", note: "The short path. Four taps from market to portfolio.", steps: [
    J("Market", "market"), J("Agent", "agent", { agentId: "pkl", tab: "token" }),
    J("Quote", "trade", { phase: "quote", mode: "buy" }), J("Confirm", "trade", { phase: "confirm" }),
    J("Portfolio", "portfolio", { mockHolder: true })] },
  { title: "User follows activity", note: "Following and asking never require buying.", steps: [
    J("Activity", "activity"), J("Detail", "post", { postId: "p1" }), J("Ask agent", "ask", { agentId: "pkl" }),
    J("Agent", "agent", { agentId: "pkl", tab: "activity" }), J("Buy · optional", "trade", { phase: "quote", mode: "buy" })] },
  { title: "User sells", note: "Ends in the wallet, where the AUSD actually lands.", steps: [
    J("Portfolio", "portfolio", { mockHolder: true }), J("Position", "position", { mockHolder: true, agentId: "pkl" }),
    J("Sell", "trade", { mode: "sell", phase: "quote", mockHolder: true }), J("Confirm", "trade", { mode: "sell", phase: "confirm", mockHolder: true }),
    J("Wallet", "wallet", { mockHolder: true })] },
  { title: "User audits an agent", note: "From a notification to the evidence behind one call.", steps: [
    J("Notification", "activity"), J("The activity", "post", { postId: "p4" }),
    J("Outcome", "post", { postId: "p4" }), J("Track record", "agent", { agentId: "pkl", tab: "activity" })] },
];

function RailLabel({ children, style }: { children: string; style?: { marginBottom?: number } }) {
  return <T w={500} s={10.5} mono color={C.mute} style={[{ marginBottom: 9 }, style]}>{children}</T>;
}

function Chip({ label, on, onLime, onPress }: { label: string; on: boolean; onLime?: boolean; onPress: () => void }) {
  const p = pill(on, onLime ? C.lime : undefined);
  return (
    <Touch onPress={onPress} style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg }}>
      <T w={600} s={11.5} color={p.fg}>{label}</T>
    </Touch>
  );
}

export function DevControls({ visible, onClose, ctx }: { visible: boolean; onClose: () => void; ctx: AppCtx }) {
  const { S, set, nav, requireAccount, hasAccount } = ctx;
  const go = (screen: Screen, patch?: Patch) => { requireAccount(screen, patch); onClose(); };
  const holderBtn = (on: boolean, label: string) => {
    const p = pill(S.mockHolder === on);
    return (
      <Touch key={label} onPress={() => set({ mockHolder: on })} style={{ borderWidth: 1, borderColor: p.bd, backgroundColor: p.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 5 }}>
        <T w={600} s={12.5} lh={1.3} color={p.fg}>{label}</T>
      </Touch>
    );
  };
  const kiteOn = pill(S.agentId === "kite");
  const caseOn = pill(S.dataCase !== "normal");
  const nextCase = S.dataCase === "normal" ? "loading" : S.dataCase === "loading" ? "empty" : S.dataCase === "empty" ? "stale" : "normal";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
        <Touch onPress={onClose} style={{ flex: 1 }}><View /></Touch>
        <View style={{ backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, borderColor: C.hair, padding: 18, paddingBottom: 28, maxHeight: "85%" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <T w={800} s={18} ls={-0.03}>Prototype controls</T>
            <Touch onPress={onClose}><T w={600} s={13} color={C.mute}>Close</T></Touch>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <RailLabel>USER STATE</RailLabel>
            <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginBottom: 9 }}>
              {hasAccount ? "Account and AUSD balance are real. Positions below are example data." : "No account yet: Wallet, Portfolio and Buy will ask for access."}
            </T>
            {holderBtn(false, "Funded · no positions")}
            {holderBtn(true, "Holder · 4,820 PKL example position")}
            <Touch onPress={() => { nav("agent", { agentId: "kite", tab: "activity" }); onClose(); }} style={{ borderWidth: 1, borderColor: kiteOn.bd, backgroundColor: kiteOn.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11, marginBottom: 5 }}>
              <T w={600} s={12.5} color={kiteOn.fg}>Agent with no history (Kite)</T>
            </Touch>
            <Touch onPress={() => { nav("market", { dataCase: nextCase }); onClose(); }} style={{ borderWidth: 1, borderColor: caseOn.bd, backgroundColor: caseOn.bg, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 }}>
              <T w={600} s={12.5} color={caseOn.fg}>Market: no results / loading / stale (now: {S.dataCase})</T>
            </Touch>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel>SCREENS</RailLabel>
            <View style={{ gap: 11 }}>
              {SCREEN_GROUPS.map(([title, items]) => (
                <View key={title}>
                  <T w={700} s={11} color={C.mute} style={{ marginBottom: 6 }}>{title}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {items.map(([k, label]) => <Chip key={k} label={label} on={S.screen === k} onPress={() => go(k)} />)}
                  </View>
                </View>
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel style={{ marginBottom: 4 }}>TRANSACTION STATES</RailLabel>
            <T w={400} s={11.5} lh={1.4} color={C.mute} style={{ marginBottom: 9 }}>The nine required states of one shared buy/sell flow.</T>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
              {PHASES.map(([k, label]) => (
                <Chip key={k} label={label} on={S.screen === "trade" && S.phase === k} onLime={k === "done"}
                  onPress={() => go("trade", { phase: k, mode: k === "insufficient" ? "buy" : S.mode })} />
              ))}
            </View>

            <Hair style={{ marginVertical: 16 }} />
            <RailLabel>THE FIVE JOURNEYS · tap any step</RailLabel>
            <View style={{ gap: 8 }}>
              {JOURNEYS.map((j) => (
                <View key={j.title} style={{ padding: 12, borderWidth: 1, borderColor: C.hair, borderRadius: 12, backgroundColor: C.surf }}>
                  <T w={700} s={13} lh={1.2}>{j.title}</T>
                  <T w={400} s={11.5} lh={1.45} color={C.mute} style={{ marginTop: 3, marginBottom: 8 }}>{j.note}</T>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
                    {j.steps.map((st, i) => (
                      <Touch key={i} onPress={() => go(st.screen, st.patch)} style={{ paddingVertical: 7, paddingHorizontal: 11, borderRadius: 9, borderWidth: 1, borderColor: C.hair, backgroundColor: C.chip }}>
                        <T w={600} s={12}>{st.label}</T>
                      </Touch>
                    ))}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 3: tsc**

```bash
npx tsc --noEmit
```

Expected: limpio. (`__DEV__` viene de los tipos de React Native.)

- [ ] **Step 4: Commit**

```bash
git add src/Shell.tsx src/DevControls.tsx
git commit -m "feat(mobile): Shell del prototipo con gate de cuenta y panel de dev solo en __DEV__"
```

---

### Task 10: Conectar `App.tsx`, borrar la UI vieja y verificar en simulador

**Files:**
- Modify: `apps/mobile/App.tsx`, `apps/mobile/src/ui/theme.ts`, `apps/mobile/README.md`
- Delete: `apps/mobile/src/screens/Welcome.tsx`, `apps/mobile/src/screens/Home.tsx`, `apps/mobile/src/ui/Button.tsx`, `apps/mobile/src/ui/Field.tsx`

**Interfaces:**
- Consumes: `useFonts` de `expo-font`; fuentes de `@expo-google-fonts/manrope` y `@expo-google-fonts/jetbrains-mono`; `useAccount`, `useTreasury`, `useAppStore`, `ausdToNumber`, `Shell`, `AppCtx`, `C`.

- [ ] **Step 1: Reemplazar `App.tsx`**

```tsx
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from "@expo-google-fonts/manrope";
import { useFonts } from "expo-font";
import { ActivityIndicator, StatusBar, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ausdToNumber } from "./src/config/chain";
import type { AppCtx } from "./src/ctx";
import { useAccount } from "./src/hooks/useAccount";
import { useTreasury } from "./src/hooks/useTreasury";
import { Shell } from "./src/Shell";
import { useAppStore } from "./src/store";
import { C } from "./src/ui/theme";

const NONE = { status: "none" } as const;

export default function App() {
  const [fontsLoaded] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium,
  });
  const { account, onWallet, lock, signOut } = useAccount();
  const treasury = useTreasury(account ?? NONE, onWallet);
  const store = useAppStore({
    hasAccount: account !== null && account.status !== "none",
    ausd: treasury.balances ? ausdToNumber(treasury.balances.ausd) : 0,
  });

  if (!fontsLoaded || account === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={C.lime} />
      </View>
    );
  }

  const ctx: AppCtx = { ...store, account, treasury, onWallet, lock, signOut };

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <Shell ctx={ctx} />
      </View>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 2: Borrar la UI vieja y la paleta de fase 1**

```bash
git rm src/screens/Welcome.tsx src/screens/Home.tsx src/ui/Button.tsx src/ui/Field.tsx
```

En `src/ui/theme.ts` eliminar el bloque final que empieza en el comentario `// --- Paleta de la fase 1 …` (exports `palette` y `spacing`).

```bash
grep -rn "palette\|spacing\|screens/Home\|screens/Welcome\|ui/Button\|ui/Field" App.tsx src | grep -v "^src/ui/theme.ts" ; echo "exit=$?"
```

Expected: sin coincidencias (`exit=1`).

- [ ] **Step 3: tsc y suite**

```bash
npx tsc --noEmit && npm test 2>&1 | tail -5
```

Expected: tsc limpio; `Tests: 39 passed`.

- [ ] **Step 4: Correr en simulador y hacer la prueba manual con capturas**

```bash
npx expo run:ios --device "iPhone 17 Pro"
```

Capturas con `xcrun simctl io booted screenshot <ruta>.png` en el scratchpad de la sesión (no en el repo). Lista de comprobación, en orden, partiendo **sin cuenta** (si el simulador tiene una guardada de la fase 1: Wallet → SESSION → Sign out primero):

1. Abre en **Market** con la marca, tipografía Manrope, tres chips de agentes. Captura `01-market.png`.
2. Tocar un agente → **Agent** con tabs Token/Activity/About y barra Buy/Sell. Tab **Activity** de la tab bar no pide cuenta.
3. Tab **Wallet** → **Wallet access** (sin tarjeta violeta). Captura `02-signin.png`.
4. "Create a wallet" → Face ID → aterriza en **Wallet**: "Available to spend" con el AUSD real, bloque **TESTNET** con MON y botones, **MOVEMENTS**, fila **SESSION** en "Unlocked". Captura `03-wallet.png`. El botón ← no aparece y la tab bar sí.
5. **Deposit** muestra la dirección real completa; "Copy address" cambia a "Copied"; `xcrun simctl pbpaste booted` (o pegar en Notes) devuelve la dirección.
6. Volver a Wallet. Si MON = 0: "Get test AUSD" muestra el mensaje "You need test MON for gas…" sin abrir Face ID. Si MON > 0: pide Face ID (si estaba Locked) y muestra "Sent: 0x…" y luego "Confirmed: 0x…"; el AUSD sube tras el refresh. Captura `04-faucet.png`.
7. **Lock** → fila dice "Locked" y el botón Lock desaparece.
8. Ir a **Market** → **Agent** → **Buy** con cuenta: entra directo a **Trade** (quote o insufficient según el saldo real). Captura `05-trade.png`.
9. **Sign out** desde Wallet → regresa a **Market**; tocar **Wallet** vuelve a pedir acceso. "I already have one" → Face ID → Wallet otra vez.
10. Sign out; sin cuenta: **Agent → Buy** → Wallet access **con** tarjeta violeta "Your purchase is being held" → crear/entrar → aterriza en **Deposit** con "Deposit to finish your purchase" → "I've sent it" → **Trade** con "Picking up where you left off".
11. ⚙ en el header (solo dev): los nueve estados de compra y las cinco journeys navegan; "Holder" enciende las posiciones de ejemplo en Portfolio. Captura `06-devpanel.png`.

Anotar en el handoff cualquier paso que no se cumpla, con la captura.

- [ ] **Step 5: Actualizar `README.md` de la app**

Reemplazar el primer párrafo (el que empieza "Fase 1: cuenta EVM…") por:

```markdown
App Expo/iOS de Pickler. UI portada del prototipo
[`jjesusaf/pickler-mobile`](https://github.com/jjesusaf/pickler-mobile) (commit `365585e`):
13 pantallas en TypeScript con datos de ejemplo, salvo lo que ya es real: cuenta EVM
derivada de una passkey (mera + PRF) guardada con gate biométrico, saldos de AUSD/MON en
Monad Testnet y faucet de AUSD, todo dentro de *Wallet access*, *Wallet* y *Deposit*.
El panel ⚙ del header (solo en dev) salta a cualquier pantalla o estado del prototipo.
```

En la sección "Tests" cambiar `19/19 esperado` por `39/39 esperado`. En "Conseguir MON de testnet" cambiar "desde la pantalla *Treasury* (botón "Copy address")" por "desde *Wallet → Deposit* (botón "Copy address")" y "Refrescar el balance en la app (botón "Refresh balances"…" por "Refrescar en *Wallet → TESTNET* (botón "Refresh"…".

- [ ] **Step 6: Commit**

```bash
git add App.tsx src/ui/theme.ts README.md
git commit -m "feat(mobile): la app arranca en la UI del prototipo; se retiran Welcome, Home y la paleta de fase 1"
```

(`git rm` del Step 2 ya dejó los borrados en el índice; entran en este mismo commit.)

---

### Task 11: Revisión independiente y handoff

**Files:**
- Create: `docs/06-handoff-ui-port.md`

- [ ] **Step 1: Pedir revisión independiente a un subagente**

Entregarle: el spec, este plan, `git diff main...feat/mobile-ui-port --stat` y el diff completo, la salida de `npx tsc --noEmit` y `npm test`, y las capturas. Pedirle que verifique explícitamente: (a) que ninguna pantalla del prototipo cambió copy o estilos fuera de lo listado en el spec; (b) que sin cuenta no hay forma de llegar a wallet/portfolio/position/deposit/withdraw/trade sin pasar por `signin`; (c) que el panel de dev no se monta fuera de `__DEV__`; (d) que `useAccount`/`useTreasury` conservan la lógica de `App.tsx`/`Home.tsx` de `main` (comparar contra `git show main:apps/mobile/App.tsx` y `main:apps/mobile/src/screens/Home.tsx`); (e) que `session.end()` sigue llamándose al hacer Lock y Sign out.

- [ ] **Step 2: Corregir lo que salga con severidad Critical/Important**, con su test cuando aplique, y volver a correr `npx tsc --noEmit && npm test`. Commit por corrección: `fix(mobile): <qué>`.

- [ ] **Step 3: Escribir `docs/06-handoff-ui-port.md`**

Contenido: tabla "Qué quedó hecho y verificado" (commits, tsc, tests 39/39, capturas 01–06 con qué muestra cada una), "Lo aprendido", "Pendientes" (menores diferidos de la revisión; build 2 a TestFlight sigue pendiente y ahora llevaría esta UI) y "Siguiente punto de decisión" (fase 2: Perpl y venue, sin cambios respecto a `docs/05-handoff-fase1.md`).

```bash
git add docs/06-handoff-ui-port.md
git commit -m "docs: handoff del port de la UI de pickler-mobile"
```

- [ ] **Step 4: Checkpoint con Jesús**

Reportar: rama, commits, evidencia, hallazgos de la revisión y qué quedó fuera. **No** hacer merge ni push: esa decisión es de Jesús.
