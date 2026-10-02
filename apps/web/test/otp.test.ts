import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CODE_LENGTH,
  MAX_ATTEMPTS,
  codeCells,
  isComplete,
  normalizeCode,
  resendLabel,
  triesLeft,
} from "../src/features/auth/lib/otp";
import type { CodeCell } from "../src/features/auth/lib/otp";

const cell = (char: string, at: "caret" | "wrong" | "plain"): CodeCell => ({
  char,
  filled: char !== "",
  caret: at === "caret",
  wrong: at === "wrong",
});

test("a code is digits only, eight at most, whatever arrives", () => {
  assert.equal(CODE_LENGTH, 8);
  assert.equal(normalizeCode("48291375"), "48291375");
  assert.equal(normalizeCode("4829 1375"), "48291375");
  assert.equal(normalizeCode("Your code is 48291375"), "48291375");
  assert.equal(normalizeCode("48-29-13-75"), "48291375");
  assert.equal(normalizeCode("482913750"), "48291375", "a ninth digit has no cell to sit in");
  assert.equal(normalizeCode("abc"), "");
  assert.equal(normalizeCode(""), "");
  // Digits that are not ASCII would reach the server as something it cannot parse.
  assert.equal(normalizeCode("٤٨٢٩١٣"), "");
});

test("there are always eight cells, however much has been typed", () => {
  for (const code of ["", "4", "48291375"]) {
    assert.equal(codeCells(code, false).length, CODE_LENGTH, code);
  }
});

/** Empty cells: the first marked `first`, the rest `rest`. */
const blanks = (count: number, first: "caret" | "wrong" | "plain", rest = first) =>
  Array.from({ length: count }, (_, index) => cell("", index === 0 ? first : rest));

test("the cells show what was typed and mark the one being typed into", () => {
  assert.deepEqual(codeCells("", false), blanks(8, "caret", "plain"));
  assert.deepEqual(codeCells("482", false), [
    cell("4", "plain"),
    cell("8", "plain"),
    cell("2", "plain"),
    ...blanks(5, "caret", "plain"),
  ]);
  // Full: there is no ninth cell for the caret to move to, so nothing is lit.
  assert.deepEqual(
    codeCells("48291375", false),
    [..."48291375"].map((char) => cell(char, "plain")),
  );
});

test("a rejected code marks every cell and drops the caret", () => {
  assert.deepEqual(codeCells("482", true), [
    cell("4", "wrong"),
    cell("8", "wrong"),
    cell("2", "wrong"),
    ...blanks(5, "wrong"),
  ]);
});

test("a code is complete at eight and not before", () => {
  assert.equal(isComplete("482913"), false, "six digits is the old length, not a whole code");
  assert.equal(isComplete("4829137"), false);
  assert.equal(isComplete("48291375"), true);
});

test("tries run down to zero and stop there", () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(triesLeft), [
    MAX_ATTEMPTS,
    MAX_ATTEMPTS - 1,
    MAX_ATTEMPTS - 2,
    0,
    0,
  ]);
  assert.equal(MAX_ATTEMPTS, 3);
});

test("the resend button counts down in whole seconds and opens at zero", () => {
  assert.equal(resendLabel(60), "RESEND IN 60S");
  assert.equal(resendLabel(24), "RESEND IN 24S");
  assert.equal(resendLabel(0.4), "RESEND IN 1S", "a fraction of a second is still shut");
  assert.equal(resendLabel(0), "RESEND");
  assert.equal(resendLabel(-3), "RESEND");
});
