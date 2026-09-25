import assert from "node:assert/strict";
import { test } from "node:test";
import { passkeyPreviewFromSearch } from "../src/features/auth/lib/passkey-preview";

/* `/passkey?state=` opens a screen without an account behind it, so it must be shut in production. */

test("outside production ?state=create opens the create-your-wallet screen", () => {
  assert.equal(passkeyPreviewFromSearch("development", "create"), "create");
});

test("in production the same link reads the account as it always does", () => {
  assert.equal(passkeyPreviewFromSearch("production", "create"), undefined);
});

test("an unknown state is no preview", () => {
  assert.equal(passkeyPreviewFromSearch("development", "add"), undefined);
  // The screen this preview replaced is gone; its link opens nothing now.
  assert.equal(passkeyPreviewFromSearch("development", "none-yet"), undefined);
  assert.equal(passkeyPreviewFromSearch("development", undefined), undefined);
});

test("a repeated parameter reads its first value", () => {
  assert.equal(passkeyPreviewFromSearch("test", ["create", "x"]), "create");
});
