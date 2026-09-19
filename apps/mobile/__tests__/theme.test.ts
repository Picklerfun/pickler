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
