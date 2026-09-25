import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BEATS,
  EDGE_MAX,
  STEPS,
  UNBACKED,
  emptyDraft,
  guessFrom,
  handleOk,
  stepReachable,
  stepReady,
  suggestHandle,
  suggestTicker,
  tickerOf,
  toCreate,
  type Draft,
} from "../src/features/studio/empty/draft";
import type { Config } from "../src/features/studio/api";
import { DEFAULT_PROFILE } from "../src/features/studio/profile";

/* One behaviour per test: an assert after a failing assert never runs, and these rules are the ones
   a person's first agent is built out of. */

const draftWith = (patch: Partial<Draft>): Draft => ({ ...emptyDraft(), ...patch });

const defaults = {
  limits: {
    searches: 3,
    pageReads: 4,
    steps: 10,
    durationMs: 180_000,
    outputTokens: 8192,
    dailyRuns: 6,
  },
  profile: "a default the options endpoint supplies",
  tools: [],
  intervalHours: 6,
} as unknown as Config;

// `toCreate` never runs against a real wallet in this flow — its only caller throws before
// reaching it (see empty-studio.tsx) — so a fixture stands in to pin the pass-through.
const wallet = { walletId: "w1", policyIds: ["p1", "p2"] };

test("a handle comes from the name, lower case and stripped", () => {
  assert.equal(suggestHandle("Half Time!"), "halftime");
});

test("a handle is cut to the fifteen characters the API accepts", () => {
  assert.equal(suggestHandle("Abcdefghijklmnopqrstuvwxyz").length, 15);
});

test("a name of two letters cannot make a handle the API would take", () => {
  assert.equal(handleOk(suggestHandle("Hi")), false);
});

test("a name of only punctuation makes no handle at all", () => {
  assert.equal(suggestHandle("!!!"), "");
});

test("the suggested ticker is the first four letters of the name", () => {
  assert.equal(suggestTicker("Halftime"), "$HALF");
});

test("a name with no letters suggests no ticker rather than a lone dollar sign", () => {
  assert.equal(suggestTicker("123"), "");
});

test("a ticker typed by hand is not overwritten by the suggestion", () => {
  assert.equal(
    tickerOf(draftWith({ name: "Halftime", ticker: "$HT", tickerTouched: true })),
    "$HT",
  );
});

test("the suggestion follows the name until someone types a ticker", () => {
  assert.equal(tickerOf(draftWith({ name: "Overtime" })), "$OVER");
});

test("a line about injuries is guessed as sports", () => {
  assert.equal(guessFrom("Bets on NBA injury news").beat, "Sports");
});

test("a line matching nothing falls to a beat rather than to nothing", () => {
  assert.equal(guessFrom("something else entirely").beat, "Culture");
});

test("the guessed edge is cut to the length the edge step allows", () => {
  assert.equal(guessFrom("x".repeat(400)).why.length, EDGE_MAX);
});

test("the first step wants a line before it can fill anything in", () => {
  assert.equal(stepReady("start", emptyDraft()), false);
});

test("the name step wants a name that makes a usable handle", () => {
  assert.equal(stepReady("name", draftWith({ name: "Halftime" })), true);
});

test("the name step refuses a name too short to be a handle", () => {
  assert.equal(stepReady("name", draftWith({ name: "Hi" })), false);
});

test("the beat step refuses a beat with no market catalog behind it", () => {
  assert.equal(stepReady("beat", draftWith({ beat: "Crypto" })), false);
});

test("the beat step wants a market chosen inside the one beat that has them", () => {
  assert.equal(stepReady("beat", draftWith({ beat: "Sports" })), false);
});

test("sports with a market chosen is ready", () => {
  assert.equal(stepReady("beat", draftWith({ beat: "Sports", sports: ["tennis"] })), true);
});

test("the edge step refuses an edge over its limit", () => {
  assert.equal(stepReady("edge", draftWith({ why: "x".repeat(EDGE_MAX + 1) })), false);
});

test("an empty draft cannot jump to the last step", () => {
  assert.equal(stepReachable("run", emptyDraft()), false);
});

test("the first step is always reachable, because nothing comes before it", () => {
  assert.equal(stepReachable("start", emptyDraft()), true);
});

test("exactly one of the canvas's beats has a market catalog behind it", () => {
  assert.deepEqual(
    BEATS.filter((beat) => beat.category).map((beat) => beat.name),
    ["Sports"],
  );
});

test("every step in the flow has a readiness rule of its own", () => {
  const undecided = STEPS.filter((step) => typeof stepReady(step, emptyDraft()) !== "boolean");
  assert.deepEqual(undecided, []);
});

test("the ticker never reaches the API, because nothing stores one", () => {
  const draft = draftWith({ name: "Halftime", ticker: "$HALF", tickerTouched: true, why: "edge" });
  assert.equal(JSON.stringify(toCreate(draft, defaults, wallet)).includes("$HALF"), false);
});

test("the edge becomes the brief the agent carries into every run", () => {
  const created = toCreate(
    draftWith({ name: "Halftime", why: "  reads injuries  " }),
    defaults,
    wallet,
  );
  assert.equal(created.config.profile, "reads injuries");
});

test("the chosen markets become the scope the API enforces", () => {
  const created = toCreate(
    draftWith({ name: "Halftime", beat: "Sports", sports: ["tennis"], why: "edge" }),
    defaults,
    wallet,
  );
  assert.deepEqual(created.config.marketScope, {
    version: 1,
    category: "sports",
    subcategories: ["tennis"],
  });
});

test("the draft flow sends the profile the API requires, with the full form's defaults", () => {
  const created = toCreate(draftWith({ name: "Halftime", why: "edge" }), defaults, wallet);
  assert.equal(created.profile, DEFAULT_PROFILE);
  assert.deepEqual(created.profile, {
    accent: "lime",
    blurb: "",
    venue: "predictions",
    vibe: "",
    voice: "",
    decides: "",
    wrong: "",
    xHandle: null,
  });
});

test("the wallet the caller passes travels through untouched", () => {
  const created = toCreate(draftWith({ name: "Halftime", why: "edge" }), defaults, wallet);
  assert.deepEqual(created.wallet, wallet);
});

test("a name over forty characters is cut to what the API accepts", () => {
  assert.equal(toCreate(draftWith({ name: "N".repeat(60) }), defaults, wallet).name.length, 40);
});

test("every field the screen admits it cannot store says what it is waiting on", () => {
  const silent = Object.entries(UNBACKED).filter(([, why]) => why.length < 40);
  assert.deepEqual(silent, []);
});

/* The canvas's table matched anywhere in the line. These are the words that made it guess wrong. */

test("a word containing eth is not a line about crypto", () => {
  assert.equal(guessFrom("something else entirely").beat, "Culture");
});

test("a word containing ai is not a line about technology", () => {
  assert.equal(guessFrom("it said the same thing again").beat, "Culture");
});

test("a word containing rate is not a line about the economy", () => {
  assert.equal(guessFrom("an accurate and separate read").beat, "Culture");
});

test("a word containing rain is not a line about the weather", () => {
  assert.equal(guessFrom("training data for the model").beat, "Culture");
});

test("a word containing temp is not a line about the weather either", () => {
  assert.equal(guessFrom("an attempt at a template").beat, "Culture");
});

test("the words the table is actually for still match", () => {
  assert.equal(guessFrom("trades new token listings in the first hour").beat, "Crypto");
});
