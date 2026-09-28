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
  expect(C.downOnInk).toBe("#FF8FB8");
  expect(C.vioOnInk).toBe("#B9A5FF");
  expect([C.lime, C.limeInk, C.vio, C.up, C.down, C.short, C.pending, C.warn, C.agentDot])
    .toEqual(["#C8F03A", "#3F6B00", "#5B3CE0", "#2E7D32", "#C62C62", "#FF5FA2", "#FFC93F", "#8A6200", "#9B7BFF"]);
  expect((C as Record<string, unknown>).bgBottom).toBeUndefined();
});

test("onVio is light text over the violet block (D14 THE QUESTION card)", () => {
  expect(C.onVio).toBe("#D9D0FF");
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
