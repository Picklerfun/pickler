import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callbackDestination,
  HANDLE_STEP,
  PASSKEY_STEP,
  readOf,
  SIGNUP_RESUME,
} from "../src/features/auth/lib/callback";

const STUDIO = "/studio";

test("a new account goes straight to the handle step, never through the studio", () => {
  assert.equal(callbackDestination({ profile: "missing", wallet: "missing" }, STUDIO), HANDLE_STEP);
  assert.equal(HANDLE_STEP, "/signup?step=handle");
});

test("a profile without a master wallet goes straight to the signup's passkey step", () => {
  assert.equal(callbackDestination({ profile: "found", wallet: "missing" }, STUDIO), PASSKEY_STEP);
  assert.equal(PASSKEY_STEP, "/signup?step=passkey");
});

test("only a complete account goes to the studio", () => {
  assert.equal(callbackDestination({ profile: "found", wallet: "found" }, STUDIO), STUDIO);
  assert.equal(callbackDestination({ profile: "found", wallet: "found" }, "/"), "/");
});

test("a failed read never reaches the studio: the signup reads again and offers a retry", () => {
  for (const account of [
    { profile: "failed", wallet: "found" },
    { profile: "failed", wallet: "missing" },
    { profile: "found", wallet: "failed" },
  ] as const) {
    assert.equal(callbackDestination(account, STUDIO), SIGNUP_RESUME, JSON.stringify(account));
  }
  // No profile decides the step on its own, whatever the wallet read did.
  assert.equal(callbackDestination({ profile: "missing", wallet: "failed" }, STUDIO), HANDLE_STEP);
});

test("statuses: 2xx found, 404 missing, anything else failed", () => {
  assert.equal(readOf(200), "found");
  assert.equal(readOf(404), "missing");
  for (const status of [400, 401, 403, 409, 500, 502, 503]) {
    assert.equal(readOf(status), "failed", String(status));
  }
});
