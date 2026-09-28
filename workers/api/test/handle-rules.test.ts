import { test } from "node:test";
import assert from "node:assert/strict";
import { DISPLAY_NAME_MAX, HANDLE_RULES, RESERVED_HANDLES } from "@pickler/core";
import {
  DISPLAY_NAME_MAX as SCHEMA_DISPLAY_NAME_MAX,
  HANDLE_RULES as SCHEMA_HANDLE_RULES,
  RESERVED_HANDLES as SCHEMA_RESERVED_HANDLES,
} from "@pickler/api-schema";

// `packages/core` and `packages/api-schema` are forbidden from importing each other, so the handle
// rules the browser draws guidance from are a mirror of the ones the API enforces. Every other
// mirror in api-schema — `applications.ts`, `markets.ts` — is guarded by a comment and nothing
// else, because no package can see both sides. This one can: workers/api imports both, so the two
// copies are held equal by a test rather than by everyone remembering.
//
// If this goes red, core moved and the mirror did not. Update `packages/api-schema/src/profiles.ts`
// to match core, never the reverse: core is the authority and this file is the copy.

test("the handle rules the client draws match the ones the API enforces", () => {
  assert.deepEqual(SCHEMA_HANDLE_RULES, HANDLE_RULES);
});

test("the reserved list the client draws matches the one the API enforces", () => {
  assert.deepEqual([...SCHEMA_RESERVED_HANDLES].sort(), [...RESERVED_HANDLES].sort());
});

test("the display name limit matches too", () => {
  assert.equal(SCHEMA_DISPLAY_NAME_MAX, DISPLAY_NAME_MAX);
});
