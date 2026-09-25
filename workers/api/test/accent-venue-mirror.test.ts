import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCENTS as CORE_ACCENTS,
  VENUES as CORE_VENUES,
  STYLES as CORE_STYLES,
} from "@pickler/core";
import { ACCENTS, VENUES, STYLES } from "@pickler/api-schema";

/* api-schema may not import core, so it carries its own copy of each list. This is the one place
   that may hold both, so it is where a value added to one and not the other fails. */
test("the accent and venue lists in api-schema are core's lists", () => {
  assert.deepEqual(ACCENTS, CORE_ACCENTS);
  assert.deepEqual(VENUES, CORE_VENUES);
});
test("the decision style list in api-schema is core's list", () => {
  assert.deepEqual(STYLES, CORE_STYLES);
});
