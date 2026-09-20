import {
  callOf, cellLabel, expiresAtFor, formatProbability, formatRemaining, HORIZONS_MIN, horizonLabel, isHorizon, isLevel, LEVELS_BPS,
  levelLabel, outcomeOf, questionFor, recordLabel, targetFor,
} from "../src/reads/matrix";

test("the matrix is 5 levels × 4 horizons, in the spec order (D2)", () => {
  expect(LEVELS_BPS).toEqual([250, 100, 50, -50, -100]);
  expect(HORIZONS_MIN).toEqual([60, 240, 720, 1440]);
  expect(isLevel(50)).toBe(true);
  expect(isLevel(75)).toBe(false);
  expect(isHorizon(1440)).toBe(true);
  expect(isHorizon(30)).toBe(false);
});

// Mismos números que el servidor (_shared/matrix.ts, audit F1 Task 6): BTC mark 762555 (pd 1) → +0.5 % = 766368.
test.each([
  [762555, 50, 766368],
  [762555, 100, 770181],
  [762555, 250, 781619],
  [762555, -50, 758742],
  [762555, -100, 754929],
  [2221, 250, 2277], // MON pd 5: 2221 × 1.025 = 2276.525 → 2277
])("targetFor(%i, %i) = %i (rounded, scaled like the mark)", (mark, bps, target) => {
  expect(targetFor(mark, bps)).toBe(target);
});

test("expiresAt is createdAt + horizon", () => {
  const t0 = new Date("2026-09-20T06:35:06.000Z");
  expect(expiresAtFor(t0, 60).toISOString()).toBe("2026-09-20T07:35:06.000Z");
  expect(expiresAtFor(t0, 1440).toISOString()).toBe("2026-09-21T06:35:06.000Z");
});

test("the question reads like the server's (D1)", () => {
  const exp = new Date("2026-09-20T07:35:06.000Z");
  expect(questionFor("BTC", 100, 812469, 1, exp)).toBe("Will the BTC mark be at or above 81246.9 at 2026-09-20 07:35 UTC?");
  expect(questionFor("MON", -50, 2210, 5, exp)).toBe("Will the MON mark be at or below 0.02210 at 2026-09-20 07:35 UTC?");
});

test("labels match the push copy of the server", () => {
  expect(levelLabel(250)).toBe("+2.5%");
  expect(levelLabel(-50)).toBe("−0.5%");
  expect(horizonLabel(60)).toBe("1H");
  expect(horizonLabel(1440)).toBe("24H");
  expect(cellLabel({ levelBps: 100, horizonMin: 240 })).toBe("+1.0% · 4H");
});

test("call and outcome follow D1/D3", () => {
  expect(callOf(0.5)).toBe(true);
  expect(callOf(0.49)).toBe(false);
  expect(outcomeOf(100, 770181, 770181)).toBe(true);
  expect(outcomeOf(100, 770181, 770180)).toBe(false);
  expect(outcomeOf(-50, 758742, 758742)).toBe(true);
  expect(outcomeOf(-50, 758742, 758743)).toBe(false);
});

test("formatRemaining rounds down to hours and minutes", () => {
  expect(formatRemaining(3 * 3_600_000 + 58 * 60_000 + 20_000)).toBe("3 h 58 m");
  expect(formatRemaining(12 * 60_000)).toBe("12 m");
  expect(formatRemaining(59_000)).toBe("< 1 m");
  expect(formatRemaining(0)).toBe("now");
  expect(formatRemaining(-5_000)).toBe("now");
});

test("probability and record labels", () => {
  expect(formatProbability(0.62)).toBe("62 %");
  expect(formatProbability(0.075)).toBe("8 %");
  expect(recordLabel({ reads: 0, resolved: 0, right: 0, brierAvg: null })).toBe("No resolved reads yet");
  expect(recordLabel({ reads: 12, resolved: 10, right: 7, brierAvg: 0.2144 })).toBe("7/10 right · Brier 0.21");
});
