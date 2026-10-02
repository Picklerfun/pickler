import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { brierOf, callOf, expiresAtFor, formatScaled, HORIZONS_MIN, isCell, LEVELS_BPS, outcomeOf, questionFor, resolveRead, targetFor } from "./matrix.ts";

Deno.test("la matriz es 5 niveles × 4 horizontes", () => {
  assertEquals([...LEVELS_BPS], [250, 100, 50, -50, -100]);
  assertEquals([...HORIZONS_MIN], [60, 240, 720, 1440]);
  assertEquals(isCell(100, 240), true);
  assertEquals(isCell(0, 240), false);
  assertEquals(isCell(100, 30), false);
});

Deno.test("targetFor redondea sobre el mark escalado (BTC pd=1 del fixture)", () => {
  assertEquals(targetFor(762555, 100), 770181);   // 762555 × 1.01 = 770180.55
  assertEquals(targetFor(762555, -50), 758742);   // × 0.995 = 758742.225
  assertEquals(targetFor(2221, 250), 2277);       // MON pd=5: 2276.525
});

Deno.test("formatScaled pone el punto según price_decimals", () => {
  assertEquals(formatScaled(762555, 1), "76255.5");
  assertEquals(formatScaled(2221, 5), "0.02221");
  assertEquals(formatScaled(5, 0), "5");
});

Deno.test("questionFor: 'at or above' con nivel positivo, 'at or below' con negativo, hora UTC", () => {
  const at = new Date("2026-09-20T14:00:00.000Z");
  assertEquals(questionFor("BTC", 100, 770181, 1, at), "Will the BTC mark be at or above 77018.1 at 2026-09-20 14:00 UTC?");
  assertEquals(questionFor("MON", -100, 2199, 5, at), "Will the MON mark be at or below 0.02199 at 2026-09-20 14:00 UTC?");
});

Deno.test("expiresAtFor suma el horizonte", () => {
  assertEquals(expiresAtFor(new Date("2026-09-20T10:00:00.000Z"), 240).toISOString(), "2026-09-20T14:00:00.000Z");
});

Deno.test("callOf, outcomeOf, brierOf y resolveRead", () => {
  assertEquals(callOf(0.5), true);
  assertEquals(callOf(0.499), false);
  assertEquals(outcomeOf(100, 770181, 770181), true);
  assertEquals(outcomeOf(100, 770181, 770180), false);
  assertEquals(outcomeOf(-50, 758742, 758742), true);
  assertEquals(outcomeOf(-50, 758742, 758743), false);
  assertEquals(brierOf(0.7, true), 0.09);
  assertEquals(brierOf(0.7, false), 0.49);
  assertEquals(resolveRead({ level_bps: 100, target: 770181, probability: 0.62 }, 771000), { status: "right", outcome: true, brier: 0.1444 });
  assertEquals(resolveRead({ level_bps: 100, target: 770181, probability: 0.62 }, 760000), { status: "wrong", outcome: false, brier: 0.3844 });
  assertEquals(resolveRead({ level_bps: -100, target: 2199, probability: 0.2 }, 2300), { status: "right", outcome: false, brier: 0.04 });
  assertThrows(() => resolveRead({ level_bps: 100, target: 770181, probability: null }, 771000), Error, "no probability");
});
