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
