import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS as CORE_ACCENTS,
  VENUES as CORE_VENUES,
  STYLES as CORE_STYLES,
  BEATS as CORE_BEATS,
  SOON_BEATS as CORE_SOON_BEATS,
  SOON_VENUES as CORE_SOON_VENUES,
  VENUES_ON_MAP as CORE_VENUES_ON_MAP,
  SPORTSBOOKS as CORE_SPORTSBOOKS,
  SUGGESTED_SKILLS as CORE_SUGGESTED_SKILLS,
  policyForStyle,
} from "@pickler/core";
import {
  ACCENTS,
  VENUES,
  STYLES,
  BEAT_NAMES,
  BEAT_SUBS,
  SOON_BEATS,
  SOON_VENUES,
  VENUES_ON_MAP,
  SPORTSBOOKS,
  SPORT_SUB_IDS,
  SUGGESTED_SKILLS,
  STYLE_POLICIES,
  sourcesSchema,
} from "@pickler/api-schema";

/* api-schema may not import core, so it carries its own copy of each list. This is the one place
   that may hold both, so it is where a value added to one and not the other fails. */
test("the accent and venue lists in api-schema are core's lists", () => {
  assert.deepEqual(ACCENTS, CORE_ACCENTS);
  assert.deepEqual(VENUES, CORE_VENUES);
});
test("the decision style list in api-schema is core's list", () => {
  assert.deepEqual(STYLES, CORE_STYLES);
});
test("the draft's beats, subcategory labels and soon lists in api-schema are core's", () => {
  const coreSubs = Object.fromEntries(
    CORE_BEATS.map((beat) => [beat.name, beat.subs.map((sub) => sub.label)]),
  );

  assert.deepEqual(
    BEAT_NAMES,
    CORE_BEATS.map((beat) => beat.name),
  );
  assert.deepEqual(BEAT_SUBS, coreSubs);
  assert.deepEqual(SOON_BEATS, CORE_SOON_BEATS);
  assert.deepEqual(SOON_VENUES, CORE_SOON_VENUES);
  assert.deepEqual(VENUES_ON_MAP, CORE_VENUES_ON_MAP);
});
test("the sportsbooks in api-schema are core's, and the schema accepts exactly their keys", () => {
  const anywhere = { mode: "anywhere", sites: [] };

  assert.deepEqual(SPORTSBOOKS, CORE_SPORTSBOOKS);
  for (const book of CORE_SPORTSBOOKS) {
    assert.doesNotThrow(() => sourcesSchema.parse({ web: anywhere, books: [book.key] }));
  }
  assert.throws(() => sourcesSchema.parse({ web: anywhere, books: ["DraftKings"] }));
  assert.throws(() => sourcesSchema.parse({ web: anywhere, books: ["bovada"] }));
});
test("the sport subcategory ids in api-schema are core's Sports beat's ids", () => {
  const sports = CORE_BEATS.find((beat) => beat.name === "Sports");
  assert.ok(sports);
  const coreIds = Object.fromEntries(
    sports.subs.filter((sub) => sub.id !== null).map((sub) => [sub.label, sub.id]),
  );

  assert.deepEqual(SPORT_SUB_IDS, coreIds);
});
test("the suggested skills in api-schema are core's", () => {
  assert.deepEqual(SUGGESTED_SKILLS, CORE_SUGGESTED_SKILLS);
});
test("the style policies in api-schema match core's policyForStyle", () => {
  for (const style of CORE_STYLES) {
    assert.deepEqual(STYLE_POLICIES[style], policyForStyle(style));
  }
});
