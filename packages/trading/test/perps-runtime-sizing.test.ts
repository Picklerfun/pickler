import test from "node:test";
import assert from "node:assert/strict";
import { notionalFor, leverageFor } from "@pickler/trading/perps";

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
