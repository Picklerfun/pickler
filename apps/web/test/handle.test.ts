import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HANDLE_MAX,
  HANDLE_MIN,
  handleNote,
  isHandleLongEnough,
  normalizeHandle,
} from "../src/features/auth/lib/handle";
import type { HandleAvailability } from "../src/features/auth/lib/pickler-api";

const free: HandleAvailability = { handle: "nightowl", available: true };
const taken: HandleAvailability = { handle: "nightowl", available: false, reason: "taken" };

test("a typed handle is lower-cased, stripped and cut to fifteen", () => {
  assert.equal(normalizeHandle("NightOwl"), "nightowl");
  assert.equal(normalizeHandle("night owl"), "nightowl");
  assert.equal(normalizeHandle("night-owl!"), "nightowl");
  assert.equal(normalizeHandle("night_owl_9"), "night_owl_9");
  assert.equal(normalizeHandle("a".repeat(30)), "a".repeat(HANDLE_MAX));
  assert.equal(normalizeHandle("@nightowl"), "nightowl", "the @ is the field's, not the name's");
});

test("three characters is long enough and two is not", () => {
  assert.equal(isHandleLongEnough("ab"), false);
  assert.equal(isHandleLongEnough("abc"), true);
  assert.equal(HANDLE_MIN, 3);
  assert.equal(HANDLE_MAX, 15);
});

test("an empty field is told the rule, not told off", () => {
  assert.deepEqual(handleNote("", null, true), {
    text: "3–15 · LETTERS, NUMBERS, _",
    tone: "quiet",
    ready: false,
  });
});

test("a half-typed name is quiet, because nothing is wrong yet", () => {
  assert.deepEqual(handleNote("ni", null, true), {
    text: "AT LEAST 3",
    tone: "quiet",
    ready: false,
  });
});

test("the wait for the server is said out loud, and is not a green light", () => {
  assert.deepEqual(handleNote("nightowl", null, true), {
    text: "CHECKING @NIGHTOWL…",
    tone: "quiet",
    ready: false,
  });
});

test("a free name is the one and only way through", () => {
  assert.deepEqual(handleNote("nightowl", free, true), {
    text: "@NIGHTOWL IS FREE · AGENTS SHARE THIS NAMESPACE",
    tone: "good",
    ready: true,
  });
});

test("a taken name names itself, so it is clear which one was refused", () => {
  assert.deepEqual(handleNote("nightowl", taken, true), {
    text: "@NIGHTOWL IS TAKEN",
    tone: "bad",
    ready: false,
  });
});

test("every reason the API can send has words of its own", () => {
  const reasons = ["too_short", "too_long", "invalid_characters", "reserved"] as const;
  const notes = reasons.map(
    (reason) => handleNote("nightowl", { handle: "nightowl", available: false, reason }, true).text,
  );
  assert.deepEqual(notes, [
    "AT LEAST 3",
    "15 CHARACTERS AT MOST",
    "LETTERS, NUMBERS AND _ ONLY",
    "THAT NAME IS RESERVED",
  ]);
  assert.equal(new Set(notes).size, notes.length, "two reasons must not read the same");
  for (const reason of reasons) {
    const note = handleNote("nightowl", { handle: "nightowl", available: false, reason }, true);
    assert.equal(note.tone, "bad", reason);
    assert.equal(note.ready, false, reason);
  }
});

test("a check that failed is a warning to retry, not a refusal of the name", () => {
  assert.deepEqual(handleNote("nightowl", "error", true), {
    text: "COULD NOT CHECK THAT NAME · TRY AGAIN",
    tone: "warn",
    ready: false,
  });
});

test("with no API connected nothing is claimed about the name", () => {
  const note = handleNote("nightowl", free, false);
  assert.equal(note.ready, false, "an unchecked name must never read as free");
  assert.equal(note.tone, "warn");
  assert.match(note.text, /NOT CONNECTED/);
});
