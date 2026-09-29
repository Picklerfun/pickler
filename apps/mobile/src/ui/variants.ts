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
