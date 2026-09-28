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
  /** Violeta claro del Handoff como texto **sobre `vio`** (card THE QUESTION de Read, D14). */
  onVio: "#D9D0FF",

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
  /** Pérdida como texto **sobre ink** (resumen de la orden): `down` no se lee sobre #0B0D1A. */
  downOnInk: "#FF8FB8",
  /** Violeta claro del Handoff **sobre ink** (baldosa BACKED de Portfolio): `vio` no se lee sobre #0B0D1A. */
  vioOnInk: "#B9A5FF",
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
