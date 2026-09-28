import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callbackDestination,
  SIGNUP_HANDLE_STEP,
  SIGNUP_PASSKEY_STEP,
  readOf,
  SIGNUP_RESUME,
} from "../src/features/auth/lib/callback";

const STUDIO = "/studio";

test("a new account goes straight to the passkey step, never through the studio", () => {
  assert.equal(
    callbackDestination({ profile: "missing", wallet: "missing" }, STUDIO),
    SIGNUP_PASSKEY_STEP,
  );
  assert.equal(SIGNUP_PASSKEY_STEP, "/signup?step=passkey");
});

test("no master wallet goes to the passkey step first, whatever the profile", () => {
  for (const profile of ["found", "missing", "failed"] as const) {
    assert.equal(
      callbackDestination({ profile, wallet: "missing" }, STUDIO),
      SIGNUP_PASSKEY_STEP,
      profile,
    );
  }
});

test("a master wallet without a profile goes straight to the handle step", () => {
  assert.equal(
    callbackDestination({ profile: "missing", wallet: "found" }, STUDIO),
    SIGNUP_HANDLE_STEP,
  );
  assert.equal(SIGNUP_HANDLE_STEP, "/signup?step=handle");
});

test("only a complete account goes to the studio", () => {
  assert.equal(callbackDestination({ profile: "found", wallet: "found" }, STUDIO), STUDIO);
  assert.equal(callbackDestination({ profile: "found", wallet: "found" }, "/"), "/");
});

test("a failed read never reaches the studio: the signup reads again and offers a retry", () => {
  for (const account of [
    { profile: "found", wallet: "failed" },
    { profile: "missing", wallet: "failed" },
    { profile: "failed", wallet: "failed" },
    { profile: "failed", wallet: "found" },
  ] as const) {
    assert.equal(callbackDestination(account, STUDIO), SIGNUP_RESUME, JSON.stringify(account));
  }
});

test("statuses: 2xx found, 404 missing, anything else failed", () => {
  assert.equal(readOf(200), "found");
  assert.equal(readOf(404), "missing");
  for (const status of [400, 401, 403, 409, 500, 502, 503]) {
    assert.equal(readOf(status), "failed", String(status));
  }
});
