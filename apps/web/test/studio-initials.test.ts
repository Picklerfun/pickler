import assert from "node:assert/strict";
import { test } from "node:test";
import { agentInitials } from "../src/features/studio/lib/initials";

/* The agent's mark, everywhere it is drawn: the create flow's stack card and the studio home's
   mark and chip, all through this one rule. */

test("two or more words take the first letter of the first two", () => {
  assert.equal(agentInitials("Rate Desk"), "RD");
});

test("one word takes its first two letters", () => {
  assert.equal(agentInitials("Halftime"), "HA");
});

test("surrounding and repeated whitespace is trimmed and collapsed first", () => {
  assert.equal(agentInitials("  funding   flip "), "FF");
});

test("nothing gives the placeholder mark", () => {
  assert.equal(agentInitials(""), "?");
});

test("a single letter is its own mark, uppercased", () => {
  assert.equal(agentInitials("x"), "X");
});
