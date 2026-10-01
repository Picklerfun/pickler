import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PREVIEW_RATE,
  PREVIEW_TTL_MS,
  PreviewRateLimited,
  assertPreviewAdoptable,
  preparePreview,
  previewRetryAt,
  type AdoptablePreview,
} from "../src/features/studio/preview.js";
import { BriefError, assertConfig } from "../src/features/research/types.js";

const HOUR = 3_600_000;
const input = {
  brief: {
    thesis: "  Injury news moves the books first. ",
    reads: ["espn.com", " "],
    entersWhen: ["A starter is ruled out  "],
    exitsWhen: [],
    never: [],
  },
  spend: { perCallAusd: 5, perDayAusd: 20 },
  maxLeverage: 2,
};

test("five paper runs an hour, then the time the next one opens", () => {
  assert.equal(PREVIEW_RATE.perHour, 5);
  assert.equal(PREVIEW_TTL_MS, 24 * HOUR);
  const now = 10 * HOUR;
  const four = [now - 50 * 60_000, now - 40 * 60_000, now - 30 * 60_000, now - 1];
  assert.equal(previewRetryAt(four, now), null);
  const five = [now - 50 * 60_000, ...four.slice(1), now];
  assert.equal(previewRetryAt(five, now), now - 50 * 60_000 + HOUR);
  const old = [now - 2 * HOUR, ...four];
  assert.equal(previewRetryAt(old, now), null);
});

test("the rate limit error carries the time", () => {
  const error = new PreviewRateLimited(123);
  assert.equal(error.code, "PREVIEW_RATE_LIMITED");
  assert.equal(error.retryAt, 123);
});

test("a preview's input becomes a valid config and a fingerprint of the normalized brief", () => {
  const { config, fingerprint } = preparePreview(input);
  assert.doesNotThrow(() => assertConfig(config));
  assert.deepEqual(config.brief, {
    thesis: "Injury news moves the books first.",
    reads: ["espn.com"],
    entersWhen: ["A starter is ruled out"],
    exitsWhen: [],
    never: [],
  });
  const tidy = preparePreview({
    ...input,
    brief: { ...input.brief, thesis: "Injury news moves the books first." },
  });
  assert.equal(tidy.fingerprint, fingerprint);
});

test("an invalid brief names its section; invalid caps and leverage are INVALID_INPUT", () => {
  assert.throws(
    () => preparePreview({ ...input, brief: { ...input.brief, entersWhen: [" "] } }),
    (error: unknown) => error instanceof BriefError && error.field === "entersWhen",
  );
  assert.throws(() => preparePreview({ ...input, spend: { perCallAusd: 25, perDayAusd: 20 } }), {
    code: "INVALID_INPUT",
  });
  assert.throws(() => preparePreview({ ...input, maxLeverage: 0 }), { code: "INVALID_INPUT" });
});

const now = 1_000_000;
const caller = { userId: "u1", workspaceId: "w1" };
const usable: AdoptablePreview = {
  userId: "u1",
  workspaceId: "w1",
  status: "completed",
  expiresAt: now + 1,
  adopted: false,
  fingerprint: "f",
};

test("a completed, current, unadopted run of the caller's own can be adopted", () => {
  assert.doesNotThrow(() => assertPreviewAdoptable(usable, caller, "f", now));
});

test("missing, someone else's, unfinished, expired or adopted is PREVIEW_UNUSABLE", () => {
  for (const row of [
    null,
    { ...usable, userId: "u2" },
    { ...usable, workspaceId: "w2" },
    { ...usable, status: "running" as const },
    { ...usable, status: "failed" as const },
    { ...usable, expiresAt: now },
    { ...usable, adopted: true },
  ]) {
    assert.throws(() => assertPreviewAdoptable(row, caller, "f", now), {
      code: "PREVIEW_UNUSABLE",
    });
  }
});

test("a different brief is RUN_STALE, checked only once the run is usable", () => {
  assert.throws(() => assertPreviewAdoptable(usable, caller, "g", now), { code: "RUN_STALE" });
  assert.throws(() => assertPreviewAdoptable({ ...usable, adopted: true }, caller, "g", now), {
    code: "PREVIEW_UNUSABLE",
  });
});
