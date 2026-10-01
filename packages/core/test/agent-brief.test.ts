import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIEF_LIMITS,
  BriefError,
  DEFAULT_CONFIG,
  LEVERAGE_BOUNDS,
  assertBrief,
  assertConfig,
  assertMaxLeverage,
  briefFingerprint,
  briefLines,
  normalizeBrief,
  type AgentBrief,
  type AgentConfig,
} from "../src/features/research/types.js";

const brief: AgentBrief = {
  thesis: "Injury news moves the books before this market.",
  reads: ["espn.com", "@AdamSchefter"],
  entersWhen: ["A starter is ruled out", "The market has not moved 3 points"],
  exitsWhen: ["The line moves back"],
  never: ["Trade within an hour of kickoff"],
};

function withBrief(patch: Partial<AgentConfig>): AgentConfig {
  const config: AgentConfig = {
    ...DEFAULT_CONFIG,
    marketScope: { version: 1, category: "sports", subcategories: "all" },
    ...patch,
  };
  delete config.categoryIds;
  return config;
}

test("lines are trimmed and blank lines dropped, as the canvas splits them", () => {
  assert.deepEqual(briefLines("  one \n\n two\n   \n"), ["one", "two"]);
  assert.deepEqual(briefLines([" a ", "", "b\nc"]), ["a", "b", "c"]);
});

test("normalizing trims the thesis and every section", () => {
  const raw = { ...brief, thesis: "  Edge.  ", entersWhen: ["  A  ", " "], never: [] };
  assert.deepEqual(normalizeBrief(raw), {
    ...brief,
    thesis: "Edge.",
    entersWhen: ["A"],
    never: [],
  });
});

test("a normalized brief within the limits passes", () => {
  assert.doesNotThrow(() => assertBrief(brief));
  assert.doesNotThrow(() =>
    assertBrief({ thesis: "", reads: [], entersWhen: ["x"], exitsWhen: [], never: [] }),
  );
});

test("the entry rule is the one required section", () => {
  assert.throws(
    () => assertBrief({ ...brief, entersWhen: [] }),
    (error: unknown) =>
      error instanceof BriefError &&
      error.code === "INVALID_BRIEF" &&
      error.field === "entersWhen" &&
      error.reason === "required",
  );
});

test("a thesis over 600 characters is too long", () => {
  assert.throws(() => assertBrief({ ...brief, thesis: "x".repeat(BRIEF_LIMITS.thesis + 1) }), {
    code: "INVALID_BRIEF",
    field: "thesis",
    reason: "too_long",
  });
  assert.doesNotThrow(() => assertBrief({ ...brief, thesis: "x".repeat(BRIEF_LIMITS.thesis) }));
});

test("a line over 200 characters is too long", () => {
  assert.throws(() => assertBrief({ ...brief, never: ["x".repeat(BRIEF_LIMITS.line + 1)] }), {
    code: "INVALID_BRIEF",
    field: "never",
    reason: "too_long",
  });
});

test("each section has a line count", () => {
  assert.throws(
    () => assertBrief({ ...brief, reads: Array.from({ length: 13 }, (_, i) => `site${i}.com`) }),
    { code: "INVALID_BRIEF", field: "reads", reason: "too_many" },
  );
  assert.throws(
    () => assertBrief({ ...brief, entersWhen: Array.from({ length: 9 }, (_, i) => `rule ${i}`) }),
    { code: "INVALID_BRIEF", field: "entersWhen", reason: "too_many" },
  );
});

test("an un-normalized line is refused rather than silently fixed", () => {
  assert.throws(() => assertBrief({ ...brief, exitsWhen: [" padded "] }), {
    code: "INVALID_BRIEF",
    field: "exitsWhen",
    reason: "not_trimmed",
  });
  assert.throws(() => assertBrief({ ...brief, exitsWhen: [""] }), {
    field: "exitsWhen",
    reason: "not_trimmed",
  });
});

test("leverage is a whole number from 1 to 10", () => {
  assert.equal(LEVERAGE_BOUNDS.min, 1);
  assert.equal(LEVERAGE_BOUNDS.max, 10);
  for (const ok of [1, 2, 10]) {
    assert.doesNotThrow(() => assertMaxLeverage(ok));
  }
  for (const bad of [0, 11, 2.5, Number.NaN]) {
    assert.throws(() => assertMaxLeverage(bad), { code: "INVALID_INPUT" });
  }
});

test("assertConfig validates the brief and the leverage when they are there", () => {
  assert.doesNotThrow(() => assertConfig(withBrief({ brief, maxLeverage: 2 })));
  assert.doesNotThrow(() => assertConfig(withBrief({})));
  assert.throws(() => assertConfig(withBrief({ brief: { ...brief, entersWhen: [] } })), {
    code: "INVALID_BRIEF",
  });
  assert.throws(() => assertConfig(withBrief({ maxLeverage: 11 })), { code: "INVALID_INPUT" });
});

test("the caps keep the day ≥ trade rule", () => {
  assert.throws(
    () => assertConfig(withBrief({ brief, spend: { perCallAusd: 25, perDayAusd: 20 } })),
    { code: "INVALID_INPUT" },
  );
  assert.doesNotThrow(() =>
    assertConfig(withBrief({ brief, spend: { perCallAusd: 5, perDayAusd: 20 } })),
  );
});

test("the fingerprint is equal for equal inputs and changes with any of the eight", () => {
  const spend = { perCallAusd: 5, perDayAusd: 20 };
  const base = briefFingerprint({ brief, spend, maxLeverage: 2 });
  assert.equal(base, briefFingerprint({ brief: structuredClone(brief), spend, maxLeverage: 2 }));
  assert.notEqual(base, briefFingerprint({ brief, spend, maxLeverage: 3 }));
  assert.notEqual(
    base,
    briefFingerprint({ brief, spend: { perCallAusd: 5, perDayAusd: 30 }, maxLeverage: 2 }),
  );
  assert.notEqual(
    base,
    briefFingerprint({ brief: { ...brief, never: [] }, spend, maxLeverage: 2 }),
  );
});
