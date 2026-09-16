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
