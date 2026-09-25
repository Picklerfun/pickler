import assert from "node:assert/strict";
import { test } from "node:test";
import { passkeyPreviewFromSearch } from "../src/features/auth/lib/passkey-preview";

/* `/passkey?state=` opens a screen without an account behind it, so it must be shut in production. */

test("outside production ?state=none-yet opens the none-yet screen", () => {
  assert.equal(passkeyPreviewFromSearch("development", "none-yet"), "none-yet");
});

test("in production the same link reads the account as it always does", () => {
  assert.equal(passkeyPreviewFromSearch("production", "none-yet"), undefined);
});

test("an unknown state is no preview", () => {
  assert.equal(passkeyPreviewFromSearch("development", "add"), undefined);
  assert.equal(passkeyPreviewFromSearch("development", undefined), undefined);
});

test("a repeated parameter reads its first value", () => {
  assert.equal(passkeyPreviewFromSearch("test", ["none-yet", "x"]), "none-yet");
});
