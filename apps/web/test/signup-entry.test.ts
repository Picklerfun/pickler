import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivalFor, signupPreviewFromSearch } from "../src/features/auth/lib/signup-entry";

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

test("a session is resumed on arrival, whatever the URL; the email form is only for no session", () => {
  // Plain /signup, /signin, /signup?step=passkey and /signup?complete=1 all arrive the same way:
  // the URL's parameters are not an input.
  assert.equal(arrivalFor({ preview: undefined, signedIn: true }), "resume");
  assert.equal(arrivalFor({ preview: undefined, signedIn: false }), "form");
});

test("a design preview draws its step and resumes nothing", () => {
  assert.equal(arrivalFor({ preview: "passkey", signedIn: true }), "preview");
  assert.equal(arrivalFor({ preview: "passkey", signedIn: false }), "preview");
});
