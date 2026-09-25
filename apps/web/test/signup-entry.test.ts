import assert from "node:assert/strict";
import { test } from "node:test";
import { resumesSignup, signupPreviewFromSearch } from "../src/features/auth/lib/signup-entry";

/* `/signup?state=` draws a step without an account behind it, so it must be shut in production. */

test("outside production ?state=passkey opens the signup on its passkey step", () => {
  assert.equal(signupPreviewFromSearch("development", "passkey"), "passkey");
});

test("in production the same link is an ordinary signup", () => {
  assert.equal(signupPreviewFromSearch("production", "passkey"), undefined);
});

test("an unknown state is no preview", () => {
  assert.equal(signupPreviewFromSearch("development", "create"), undefined);
  assert.equal(signupPreviewFromSearch("development", undefined), undefined);
});

test("a repeated parameter reads its first value", () => {
  assert.equal(signupPreviewFromSearch("test", ["passkey", "x"]), "passkey");
});

test("the passkey-step redirect and the studio's complete-your-profile link both resume", () => {
  assert.equal(resumesSignup({ step: "passkey" }), true);
  assert.equal(resumesSignup({ complete: "1" }), true);
  assert.equal(resumesSignup({}), false);
  assert.equal(resumesSignup({ step: "handle" }), false);
});
