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
