import test from "node:test";
import assert from "node:assert/strict";
import { CONVICTION, marginFor, notionalFor, leverageFor } from "@pickler/trading/perps";

test("conviction thresholds follow R6/R7", () => {
  assert.deepEqual(CONVICTION, { min: 0.55, full: 0.65 });
});

const margins: Array<[number, number, number]> = [
  [0.5, 10, 0],
  [0.549, 10, 0],
  [0.55, 10, 5],
  [0.6, 10, 5],
  [0.649, 10, 5],
  [0.65, 10, 10],
  [0.9, 10, 10],
  [1, 7, 7],
  [0.6, 7, 3.5],
  [0.6, 1, 0.5],
  [0.6, 3.333333, 1.666667],
];
for (const [probability, perCall, expected] of margins) {
  test(`marginFor(${probability}, ${perCall}) = ${expected}`, () => {
    assert.equal(marginFor(probability, perCall), expected);
  });
}

test("notional is margin times leverage, rounded to micro-AUSD", () => {
  assert.equal(notionalFor(10, 3), 30);
  assert.equal(notionalFor(1.666667, 3), 5.000001);
  assert.equal(notionalFor(0, 5), 0);
});

const leverages: Array<[number | undefined, number]> = [
  [undefined, 1],
  [0, 1],
  [1, 1],
  [3, 3],
  [10, 10],
  [11, 10],
  [2.7, 2],
  [Number.NaN, 1],
];
for (const [value, expected] of leverages) {
  test(`leverageFor(${value}) = ${expected}`, () => {
    assert.equal(leverageFor(value), expected);
  });
}
