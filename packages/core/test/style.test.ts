import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, policyForStyle, styleForPolicy } from "../src/features/research/style.js";

test("each style maps to its policy and back", () => {
  for (const style of STYLES) {
    assert.equal(styleForPolicy(policyForStyle(style)), style);
  }
});

test("the numbers are the ones the spec fixed", () => {
  assert.deepEqual(policyForStyle("careful"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.08,
    maxProbabilityRangeWidth: 0.15,
  });
  assert.deepEqual(policyForStyle("balanced"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.04,
    maxProbabilityRangeWidth: 0.2,
  });
  assert.deepEqual(policyForStyle("bold"), {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.02,
    maxProbabilityRangeWidth: 0.3,
  });
});

test("a hand-edited policy resolves to the closest style", () => {
  assert.equal(
    styleForPolicy({
      blockHighUncertainty: true,
      requireCompleteInformation: true,
      minProbabilityMargin: 0.07,
      maxProbabilityRangeWidth: 0.16,
    }),
    "careful",
  );
  assert.equal(
    styleForPolicy({
      blockHighUncertainty: true,
      requireCompleteInformation: true,
      minProbabilityMargin: 0.01,
      maxProbabilityRangeWidth: 0.2,
    }),
    "balanced",
    "the runtime default reads as balanced",
  );
});
