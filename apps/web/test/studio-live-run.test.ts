// apps/web/test/studio-live-run.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONSOLE_STARTERS,
  DECISIONS_EMPTY,
  FLAT_LINE,
  POSTS_NOTE,
  RECORD_EMPTY,
  consoleIntro,
  decisionFilters,
  sparkPoints,
  trailText,
  watchLoading,
} from "../src/features/studio/live/run-model";

test("the empty lines are spec L7's", () => {
  assert.equal(FLAT_LINE, "Flat. It opens positions once the Perpl runtime runs.");
  assert.equal(RECORD_EMPTY, "Its record starts with its first closed position.");
  assert.equal(
    DECISIONS_EMPTY,
    "No decisions yet. Once it runs, every check lands here with what it did and why. Nothing here is edited after the fact.",
  );
});

test("Posts' note promises nothing the runtime does (D19)", () => {
  assert.doesNotMatch(POSTS_NOTE, /the moment they fill/);
  assert.match(POSTS_NOTE, /Identity & voice/);
});

test("Decisions has the canvas's six filters, each at zero, the chosen one on", () => {
  const filters = decisionFilters("held");

  assert.deepEqual(
    filters.map((filter) => filter.label),
    ["All", "Entered", "Held", "Exited", "Blocked", "Posted"],
  );
  assert.ok(filters.every((filter) => filter.count === 0));
  assert.deepEqual(
    filters.filter((filter) => filter.on).map((filter) => filter.key),
    ["held"],
  );
});

test("Console's intro names the agent; its four starters are the canvas's", () => {
  assert.match(consoleIntro("Halftime"), /^Everything you and Halftime have said/);
  assert.match(consoleIntro(undefined), /^Everything you and it have said/);
  assert.equal(CONSOLE_STARTERS.length, 4);
});

test("a sparkline spans the box, oldest left, high at the top", () => {
  const points = sparkPoints([10, 20, 15]).split(" ");

  assert.deepEqual(points, ["0.0,92.0", "50.0,8.0", "100.0,50.0"]);
});

test("a flat trail is a line across the middle; under two marks draws nothing", () => {
  assert.equal(sparkPoints([5, 5]), "0.0,50.0 100.0,50.0");
  assert.equal(sparkPoints([5]), "");
  assert.equal(sparkPoints([]), "");
  assert.equal(sparkPoints([Number.NaN, 4]), "");
});

test("the trail in words gives first, last, low and high", () => {
  assert.equal(
    trailText([100, 120, 90, 110]),
    "Last 24 h: from 100.00 to 110.00, low 90.00, high 120.00.",
  );
  assert.equal(trailText(null), "No 24 h trail read.");
  assert.equal(trailText([3]), "No 24 h trail read.");
});

test("an unread board waits, except in a preview, which reads nothing", () => {
  assert.equal(watchLoading(false), "Reading Perpl…");
  assert.equal(watchLoading(true), "Nothing is read in a preview.");
});
