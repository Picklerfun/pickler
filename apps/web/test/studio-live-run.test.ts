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
  nearestPriceSample,
  priceSamples,
  priceTime,
  rangeTrail,
  sparkPoints,
  sparkSamples,
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

test("the point inspector retains only actual finite prices and preserves flat trails", () => {
  assert.deepEqual(sparkSamples([10, Number.NaN, 20, Number.POSITIVE_INFINITY, 15]), [
    { value: 10, x: 0, y: 92 },
    { value: 20, x: 50, y: 8 },
    { value: 15, x: 100, y: 50 },
  ]);
  assert.deepEqual(sparkSamples([5, 5]), [
    { value: 5, x: 0, y: 50 },
    { value: 5, x: 100, y: 50 },
  ]);
  assert.deepEqual(sparkSamples([Number.NaN, 4]), []);
});

test("price inspection preserves source times through invalid prices and uneven intervals", () => {
  const samples = priceSamples(
    [10, Number.NaN, 20, 15],
    [
      "2026-10-08T08:00:00.000Z",
      "2026-10-08T08:30:00.000Z",
      "2026-10-08T09:00:00.000Z",
      "2026-10-08T12:00:00.000Z",
    ],
  );

  assert.deepEqual(
    samples.map(({ at }) => at),
    ["2026-10-08T08:00:00.000Z", "2026-10-08T09:00:00.000Z", "2026-10-08T12:00:00.000Z"],
  );
  assert.deepEqual(
    samples.map(({ x }) => x),
    [0, 25, 100],
  );
  assert.equal(nearestPriceSample(samples, 0.4), 1);
  assert.equal(nearestPriceSample(samples, 0.9), 2);
  assert.equal(nearestPriceSample(samples, -1), 0);
});

test("legacy or mismatched timestamps never acquire inferred dates", () => {
  assert.ok(priceSamples([10, 20], null).every(({ at }) => at === null));
  assert.ok(priceSamples([10, 20], ["2026-10-08T12:00:00.000Z"]).every(({ at }) => at === null));
  const partial = priceSamples([10, 20, 15], ["2026-10-08T08:00:00.000Z", null, "invalid"]);
  assert.deepEqual(
    partial.map(({ x }) => x),
    [0, 50, 100],
  );
  assert.equal(partial[1]?.at, null);
  assert.equal(partial[2]?.at, null);
  assert.deepEqual(priceSamples([10], null), []);
});

test("UTC labels are deterministic and refuse invalid or ambiguous dates", () => {
  assert.deepEqual(priceTime("2026-10-08T16:30:00.000Z"), {
    iso: "2026-10-08T16:30:00.000Z",
    clock: "16:30 UTC",
    label: "Oct 8, 16:30 UTC",
  });
  for (const value of [
    null,
    undefined,
    "",
    "invalid",
    "2026-10-08T16:30:00",
    "2026-02-30T12:00:00Z",
  ]) {
    assert.equal(priceTime(value), null);
  }
});

test("chart ranges slice timestamped history around its own observation, never the browser clock", () => {
  const end = Date.parse("2026-10-08T14:29:40.000Z");
  const hour = 3_600_000;
  const history = Array.from({ length: 720 }, (_, index) => ({
    price: index + 1,
    at: new Date(Math.floor(end / hour) * hour - (719 - index) * hour).toISOString(),
  }));
  history.push({ price: 721, at: new Date(end).toISOString() });

  const day = rangeTrail(history, null, null, "24H");
  const week = rangeTrail(history, null, null, "7D");
  const month = rangeTrail(history, null, null, "30D");

  assert.equal(day.trail?.length, 25);
  assert.equal(week.trail?.length, 169);
  assert.equal(month.trail?.length, 721);
  assert.equal(day.trail?.[0], 697);
  assert.equal(week.trail?.[0], 553);
  assert.equal(month.trail?.[0], 1);
  for (const view of [day, week, month]) {
    assert.equal(view.timestamps?.at(-1), new Date(end).toISOString());
    assert.equal(view.trail?.at(-1), 721);
    assert.equal(view.since, null);
  }
});

test("a short listing retains actual samples and reports where its available history starts", () => {
  const history = [
    { price: 10, at: "2026-10-06T12:00:00.000Z" },
    { price: 12, at: "2026-10-08T12:00:00.000Z" },
  ];
  const week = rangeTrail(history, null, null, "7D");

  assert.deepEqual(week.trail, [10, 12]);
  assert.equal(week.since, history[0]!.at);
  assert.deepEqual(
    week.timestamps,
    history.map(({ at }) => at),
  );
});

test("legacy trails remain 24h only and do not acquire invented longer histories", () => {
  const trail = [10, 12];
  const times = [null, null];

  assert.deepEqual(rangeTrail(undefined, trail, times, "24H"), {
    trail,
    timestamps: times,
    since: null,
  });
  assert.deepEqual(rangeTrail(undefined, trail, times, "7D"), {
    trail: null,
    timestamps: null,
    since: null,
  });
  assert.deepEqual(rangeTrail([], trail, times, "30D"), {
    trail: null,
    timestamps: null,
    since: null,
  });
  assert.match(trailText([10, 12], "7D"), /^Last 7d:/);
});

test("range filtering preserves source pairs and the last value at a duplicate closing instant", () => {
  const history = [
    { price: 13, at: "2026-10-08T12:00:00.000Z" },
    { price: 10, at: "2026-10-08T11:00:00.000Z" },
    { price: Number.NaN, at: "2026-10-08T10:00:00.000Z" },
    { price: 11, at: "not a date" },
    { price: 14, at: "2026-10-08T12:00:00.000Z" },
  ];
  const original = history.map((point) => ({ ...point }));

  const view = rangeTrail(history, null, null, "24H");

  assert.deepEqual(view.trail, [10, 14]);
  assert.deepEqual(view.timestamps, [history[1]!.at, history[4]!.at]);
  assert.deepEqual(history, original);
});
