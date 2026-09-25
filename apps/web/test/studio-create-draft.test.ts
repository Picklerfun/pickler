import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addSite,
  emptyDraft,
  fromApiDraft,
  ready,
  readsText,
  reviewRows,
  soonRows,
  toCreate,
  toggleIn,
  SOON_VENUES,
  SOON_BEATS,
  SPORT_SUB_IDS,
  STYLE_POLICIES,
  SUGGESTED_SKILLS,
  type Draft,
} from "../src/features/studio/create/draft";
import type { Options } from "../src/features/studio/api";

/* One behaviour per test: an assert after a failing assert never runs, and these rules are the
   ones every step of the creation form is built out of. */

const draftWith = (patch: Partial<Draft>): Draft => ({ ...emptyDraft(), ...patch });

// A fixture standing in for what `GET /v1/studio/options` answers with; `toCreate` never sees a
// real one in this module's own tests, only in the screens that call it against a live session.
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
  tools: [
    "searchWeb",
    "readPage",
    "getMarketRules",
    "getOrderBook",
    "getSportsContext",
    "getExternalOdds",
  ],
  intervalHours: 4,
  uncertaintyPolicy: {
    blockHighUncertainty: true,
    requireCompleteInformation: true,
    minProbabilityMargin: 0.04,
    maxProbabilityRangeWidth: 0.2,
  },
  sources: { web: { mode: "anywhere", sites: [] }, books: [] },
  skills: [],
} as unknown as Options["defaults"];

test("each step is ready exactly when the canvas says", () => {
  const d = emptyDraft();

  assert.equal(ready("start", d), false);
  assert.equal(ready("start", draftWith({ prompt: "Calls NFL games." })), true);

  assert.equal(ready("name", draftWith({ name: "Halftime", handle: "ha" })), false);
  assert.equal(
    ready("name", draftWith({ name: "Halftime", handle: "halftime", handleAvailable: true })),
    true,
  );

  assert.equal(ready("trades", draftWith({ venues: [] })), false);
  assert.equal(
    ready("looks", draftWith({ venues: ["polymarket"], beat: "Sports", subs: ["NFL"] })),
    true,
  );

  assert.equal(ready("reads", draftWith({ webMode: "only", sites: [] })), false);
  assert.equal(ready("decides", draftWith({ edge: "" })), false);
});

test("looks needs perps chosen once perpl is a trades-on venue, even with polymarket satisfied", () => {
  const both = draftWith({
    venues: ["polymarket", "perpl"],
    beat: "Sports",
    subs: ["NFL"],
    perps: [],
  });

  assert.equal(ready("looks", both), false);
  assert.equal(ready("looks", { ...both, perps: ["BTC"] }), true);
});

test("review is ready only once every earlier step is, and no Soon choice is left standing", () => {
  const complete = draftWith({
    prompt: "Calls NFL games.",
    name: "Halftime",
    handle: "halftime",
    handleAvailable: true,
    venues: ["polymarket"],
    beat: "Sports",
    subs: ["NFL"],
    webMode: "anywhere",
    edge: "Reads injury reports before the market does.",
  });

  assert.equal(ready("review", complete), true);
  assert.equal(ready("review", { ...complete, beat: "Economics", subs: [] }), false);
});

test("a Soon choice shows up as a review row that blocks creation", () => {
  const rows = soonRows(draftWith({ venues: ["polymarket", "perpl"], beat: "Economics" }));

  assert.deepEqual(
    rows.map((r) => r.label),
    ["TRADES ON", "CALLS"],
  );
});

test("no Soon row for a draft that only ever chose what runs today", () => {
  const rows = soonRows(draftWith({ venues: ["polymarket"], beat: "Sports", subs: ["NFL"] }));

  assert.deepEqual(rows, []);
});

test("the api draft lands in the form with the sites in prefer mode", () => {
  const d = fromApiDraft({
    name: "Halftime",
    handle: "halftime",
    venues: ["polymarket"],
    beat: "Sports",
    subcategories: ["NFL"],
    sites: ["espn.com"],
    skills: ["Injury double-check"],
    edge: "E",
    style: "balanced",
    accent: "lime",
  });

  assert.equal(d.webMode, "prefer");
  assert.deepEqual(d.sites, ["espn.com"]);
  assert.equal(d.name, "Halftime");
  assert.equal(d.handleAvailable, null);
});

test("a draft with no sites lands in anywhere mode", () => {
  const d = fromApiDraft({
    name: "Halftime",
    handle: "halftime",
    venues: ["polymarket"],
    beat: "Sports",
    subcategories: ["NFL"],
    sites: [],
    skills: [],
    edge: "E",
    style: "balanced",
    accent: "lime",
  });

  assert.equal(d.webMode, "anywhere");
});

test("a site is normalised to a bare, lower-case host with its scheme and path stripped", () => {
  const d = addSite(emptyDraft(), "https://www.ESPN.com/nfl");

  assert.deepEqual(d.sites, ["www.espn.com"]);
});

test("an invalid host is not added, and neither is a duplicate", () => {
  const withOne = addSite(emptyDraft(), "espn.com");

  assert.deepEqual(addSite(withOne, "not a host"), withOne);
  assert.deepEqual(addSite(withOne, "espn.com"), withOne);
});

test("toggleIn adds an absent value and removes a present one", () => {
  assert.deepEqual(toggleIn(["a", "b"], "c"), ["a", "b", "c"]);
  assert.deepEqual(toggleIn(["a", "b"], "b"), ["a"]);
});

test("the reads row names market data, the web mode and site count, sports data and the books", () => {
  const d = draftWith({
    beat: "Sports",
    subs: ["NFL"],
    webMode: "prefer",
    sites: ["espn.com", "nfl.com", "pff.com"],
    books: ["draftkings", "fanduel", "pinnacle"],
  });

  assert.equal(readsText(d), "Market data, Web · prefer 3 sites, Sports data, 3 books");
});

test("the books do not show up in the reads row for a non-NFL subcategory", () => {
  const d = draftWith({ beat: "Sports", subs: ["NBA"], books: ["draftkings"] });

  assert.equal(readsText(d), "Market data, Web · anywhere, Sports data");
});

test("the six review rows read what the draft holds", () => {
  const d = draftWith({
    name: "Halftime",
    handle: "halftime",
    venues: ["polymarket"],
    beat: "Sports",
    subs: ["NFL"],
    webMode: "anywhere",
    skills: [],
    custom: [],
    edge: "Reads injury reports before the market does.",
    style: "balanced",
  });

  const rows = reviewRows(d);

  assert.deepEqual(
    rows.map((row) => row.label),
    ["NAME", "TRADES ON", "CALLS", "READS", "SKILLS", "DECIDES"],
  );
  assert.equal(rows[0]?.value, "Halftime · @halftime");
  assert.equal(rows[4]?.value, "None yet");
  assert.equal(rows[5]?.value, "Balanced · Reads injury reports before the market does.");
});

test("a ready NFL draft with books and a custom skill becomes a body the create schema accepts", async () => {
  // `apps/web` is CommonJS to node's module resolver, and `@pickler/api-schema` publishes only an
  // "import" condition, so a static `import { createAgentSchema } from "@pickler/api-schema"`
  // cannot be required here (see the note atop `draft.ts`). A dynamic `import()` still resolves
  // through node's ESM loader even from a CommonJS file, so it is the one place in this test that
  // reaches the real schema rather than asserting the shape by hand.
  const { createAgentSchema } = await import("@pickler/api-schema");
  const d = draftWith({
    name: "Halftime",
    handle: "halftime",
    handleAvailable: true,
    venues: ["polymarket"],
    beat: "Sports",
    subs: ["NFL"],
    webMode: "prefer",
    sites: ["espn.com"],
    books: ["draftkings"],
    skills: ["Injury double-check"],
    custom: [
      { name: "Late scratch check", prompt: "Check the inactive list an hour before kickoff." },
    ],
    edge: "Reads injury reports before the market does.",
    style: "bold",
    accent: "lime",
  });

  assert.equal(ready("review", d), true);

  const body = toCreate(d, "wallet-123", defaults);
  const parsed = createAgentSchema.parse(body);

  assert.equal(parsed.name, "Halftime");
  assert.equal(parsed.handle, "halftime");
  assert.equal(parsed.wallet.walletId, "wallet-123");
  assert.deepEqual(parsed.config.marketScope, {
    version: 1,
    category: "sports",
    subcategories: ["american-football"],
  });
  assert.deepEqual(parsed.config.sources, {
    web: { mode: "prefer", sites: ["espn.com"] },
    books: ["draftkings"],
  });
  assert.equal(parsed.config.skills?.length, 2);
  assert.equal(parsed.config.intervalHours, 6);
  assert.equal(parsed.profile.venue, "predictions");
  assert.equal(parsed.profile.blurb, "Reads injury reports before the market does.");
  assert.equal(parsed.profile.xHandle, null);
});

// Prove bite: `ready("reads")` ignoring `sites.length` should make this fail.
test("reads is not ready in prefer or only mode without at least one site", () => {
  assert.equal(ready("reads", draftWith({ webMode: "prefer", sites: [] })), false);
});

// `draft.ts` cannot statically `import` values from `@pickler/api-schema` (see the module
// comment): `apps/web` is CommonJS to node's module resolver and the package publishes only an
// "import" condition. A dynamic `import()` still resolves through node's ESM loader even from a
// CommonJS file, so it is what pins this file's literal copies to api-schema's own values — a
// drift here fails `npm test` instead of relying on the comment alone.
test("draft.ts's literal copies of the Soon lists, sport ids, style policies and suggested skills match api-schema's", async () => {
  const schema = await import("@pickler/api-schema");

  assert.deepEqual(SOON_VENUES, schema.SOON_VENUES);
  assert.deepEqual(SOON_BEATS, schema.SOON_BEATS);
  assert.deepEqual(SPORT_SUB_IDS, schema.SPORT_SUB_IDS);
  assert.deepEqual(STYLE_POLICIES, schema.STYLE_POLICIES);
  assert.deepEqual(SUGGESTED_SKILLS, schema.SUGGESTED_SKILLS);
});
