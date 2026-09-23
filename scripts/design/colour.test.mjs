// The helper in lib/colour.mjs is about to judge every colour in the product, so it is checked
// against answers that are public knowledge before anything believes it about answers that are not.
// Run: node --test scripts/design/colour.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { composite, hex, parse, ratio } from "./lib/colour.mjs";

const WHITE = [255, 255, 255, 1];
const BLACK = [0, 0, 0, 1];
const round = (n) => Number(n.toFixed(2));

test("black on white is 21.00, the top of the scale", () => {
  assert.equal(round(ratio(BLACK, WHITE)), 21);
  assert.equal(round(ratio(WHITE, BLACK)), 21, "the ratio does not care which is the ink");
});

test("anything on itself is 1.00", () => {
  for (const colour of [WHITE, BLACK, [11, 13, 26, 1], [200, 240, 58, 1]]) {
    assert.equal(round(ratio(colour, colour)), 1);
  }
});

test("published pairs land on their published ratios", () => {
  // WebAIM's checker gives these to two decimals; they exercise the mid-range the two thresholds
  // actually live in, which 21.00 and 1.00 do not.
  assert.equal(round(ratio([119, 119, 119, 1], WHITE)), 4.48, "#777777 on white is just under 4.5");
  assert.equal(round(ratio([117, 117, 117, 1], WHITE)), 4.61, "#757575 on white clears it");
  assert.equal(round(ratio(WHITE, [11, 13, 26, 1])), 19.32, "white on Pickler's night blue");
});

test("parse reads rgb and rgba, and rejects what is not a colour", () => {
  assert.deepEqual(parse("rgb(11, 13, 26)"), [11, 13, 26, 1]);
  assert.deepEqual(parse("rgba(11, 13, 26, 0.5)"), [11, 13, 26, 0.5]);
  assert.equal(parse("none"), null);
  assert.equal(parse(""), null);
});

test("a translucent ink is measured as the eye sees it, not as it is written", () => {
  // Half-strength black over white is mid grey, which is 3.98 against white — not black's 21.
  const seen = composite([0, 0, 0, 0.5], WHITE);
  assert.deepEqual(seen, [127.5, 127.5, 127.5, 1]);
  assert.equal(round(ratio(seen, WHITE)), 3.98);
  // Opaque ink composites to itself, so the same code path serves both.
  assert.deepEqual(composite(BLACK, WHITE), [0, 0, 0, 1]);
});

test("hex prints what a person can paste into the token file", () => {
  assert.equal(hex([11, 13, 26]), "#0B0D1A");
  assert.equal(hex([255, 255, 255]), "#FFFFFF");
  assert.equal(hex([127.5, 127.5, 127.5]), "#808080", "composited channels are rounded, not cut");
});
