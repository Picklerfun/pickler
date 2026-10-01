import assert from "node:assert/strict";
import { test } from "node:test";
import { PREVIEW_PASSKEYS, passkeyPreviewFromSearch } from "../src/features/auth/lib/passkey-entry";

/* `/passkey?state=` draws a screen without an account behind it, so it must be shut in production. */

test("outside production ?state=add opens the add-a-passkey screen", () => {
  assert.equal(passkeyPreviewFromSearch("development", "add"), "add");
});

test("in production the same link is the ordinary page", () => {
  assert.equal(passkeyPreviewFromSearch("production", "add"), undefined);
});

test("an unknown state is no preview", () => {
  assert.equal(passkeyPreviewFromSearch("development", "passkey"), undefined);
  assert.equal(passkeyPreviewFromSearch("development", undefined), undefined);
});

test("a repeated parameter reads its first value", () => {
  assert.equal(passkeyPreviewFromSearch("test", ["add", "x"]), "add");
});

test("the preview's account holds one passkey, which is what the list is drawn from", () => {
  assert.equal(PREVIEW_PASSKEYS.length, 1);
});
