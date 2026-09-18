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
