import assert from "node:assert/strict";
import { test } from "node:test";
import { studioLanding } from "../src/features/studio/lib/landing";
import { stageFromSearch } from "../src/features/studio/home/stage";

/* What `/studio` shows: the board, the empty home, or nothing yet while the agents are read. */

test("any agent is the board, read or not", () => {
  assert.equal(studioLanding(true, [{ id: "a" }]), "board");
  assert.equal(studioLanding(false, [{ id: "a" }]), "board");
});

test("no agents, once read, is the empty home rather than a redirect", () => {
  assert.equal(studioLanding(true, []), "empty");
});

test("no agents before the read is still loading, not an empty studio", () => {
  assert.equal(studioLanding(false, []), "loading");
});

test("?stage=empty stages the empty home outside production only", () => {
  assert.equal(stageFromSearch("development", "empty"), "empty");
  assert.equal(stageFromSearch("production", "empty"), undefined);
});
