// The account screen's decisions, driven without a browser.
//
// Three things are worth pinning here and they are not the same kind of thing. `openingSection` and
// `previewAllowed` are gates, and a gate tested in one position is a gate that ships open — so each
// is driven from both sides rather than from whatever environment `node --test` happens to run in.
// `coverage` is the screen's one claim about somebody's money, and the case that matters is the one
// the canvas does not draw: not knowing.

import assert from "node:assert/strict";
import test from "node:test";
import { coverage, coverageCopy, EMAIL_RECOVERY_ON } from "../src/features/account/lib/coverage";
import { previewAllowed } from "../src/features/account/lib/preview";
import { joinedLabel, profileLink } from "../src/features/account/lib/profile";
import { openingSection, SECTIONS } from "../src/features/account/lib/sections";

test("a section named outside production opens that section", () => {
  assert.equal(openingSection("development", "security"), "security");
  assert.equal(openingSection("test", "profile"), "profile");
  assert.equal(openingSection("development", "wallet"), "wallet");
});

test("the section parameter is refused in a production build", () => {
  // The other half of the gate. Without this the guard could be gone and every assertion above
  // would still pass, which is the shape of a guard that never closes.
  assert.equal(openingSection("production", "security"), "wallet");
  assert.equal(openingSection("production", "profile"), "wallet");
});

test("anything that is not a section falls back to the wallet", () => {
  assert.equal(openingSection("development", undefined), "wallet");
  assert.equal(openingSection("development", ""), "wallet");
  assert.equal(openingSection("development", "billing"), "wallet");
  assert.equal(openingSection("development", "__proto__"), "wallet");
});

test("every section in the rail is reachable by name", () => {
  // The rail and the query parameter read the same list, so a section added to one is reachable
  // through the other. A section a check cannot open is a section that rots.
  for (const section of SECTIONS) {
    assert.equal(openingSection("development", section.key), section.key);
  }
});

test("the preview stands in only where nobody can sign in", () => {
  assert.equal(previewAllowed("development", false), true);
  assert.equal(previewAllowed("test", false), true);
});

test("the preview never stands in front of a real account", () => {
  // Both conditions on their own, because either one alone would let the fixture render over
  // somebody's actual wallet.
  assert.equal(previewAllowed("production", false), false);
  assert.equal(previewAllowed("development", true), false);
  assert.equal(previewAllowed("production", true), false);
});

test("an uncountable passkey list is neither covered nor one key away", () => {
  assert.equal(coverage(null), "unknown");
  const copy = coverageCopy("unknown", null);
  assert.equal(copy.tone, "caution");
  assert.match(copy.headline, /CAN'T TELL/);
  // The claim the screen must never make without a count.
  assert.doesNotMatch(copy.headline, /COVERED/);
  assert.doesNotMatch(copy.eyebrow, /\d/);
});

test("a counted account gets the canvas's two states", () => {
  assert.equal(coverage(1), "one");
  assert.equal(coverage(2), "covered");
  assert.equal(coverage(7), "covered");
  assert.equal(coverageCopy("one", 1).headline, "ONE KEY AWAY.");
  assert.equal(coverageCopy("one", 1).tone, "caution");
  assert.equal(coverageCopy("covered", 3).headline, "COVERED.");
  assert.equal(coverageCopy("covered", 3).tone, "good");
  assert.match(coverageCopy("covered", 3).eyebrow, /^3 PASSKEYS/);
});

test("every coverage state says email recovery is off", () => {
  assert.equal(EMAIL_RECOVERY_ON, false);
  for (const [state, count] of [
    ["covered", 2],
    ["one", 1],
    ["unknown", null],
  ] as const) {
    assert.match(coverageCopy(state, count).eyebrow, /EMAIL RECOVERY OFF/);
  }
});

test("the joined line is the same month whatever zone reads it", () => {
  // A stamp either side of midnight UTC. Read in local time one of these would name December.
  assert.equal(joinedLabel("2026-01-01T00:30:00.000Z"), "JOINED JANUARY 2026");
  assert.equal(joinedLabel("2026-03-14T23:59:59.000Z"), "JOINED MARCH 2026");
});

test("a stamp that is not a date produces no line rather than a bad one", () => {
  assert.equal(joinedLabel(null), null);
  assert.equal(joinedLabel(undefined), null);
  assert.equal(joinedLabel(""), null);
  assert.equal(joinedLabel("not a date"), null);
});

test("the profile link is built from the origin it is given", () => {
  assert.equal(profileLink("https://example.test", "nightowl"), "example.test/@nightowl");
  assert.equal(profileLink("http://localhost:3001", "nightowl"), "localhost:3001/@nightowl");
});
