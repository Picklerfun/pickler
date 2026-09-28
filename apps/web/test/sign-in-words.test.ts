import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectError } from "../src/features/wallet/lib/connect";
import { PasskeyUnusableError } from "../src/features/wallet/lib/signer-adapters";
import { signInWords } from "../src/features/wallet/lib/sign-in-words";

test("a stale nonce asks for another go, because nothing is actually wrong", () => {
  const words = signInWords(new ConnectError("Ask for a new one", "nonce_invalid"));
  assert.ok(words);
  assert.match(words, /again/i);
});

test("a refused signature does not say the same thing as a stale nonce", () => {
  // They are different facts and they want different words: one is "try again", the other is
  // "something is wrong". A screen that says "try again" to a bad signature sends somebody round
  // a loop that cannot close.
  const stale = signInWords(new ConnectError("stale", "nonce_invalid"));
  const bad = signInWords(new ConnectError("bad signature", "401"));
  assert.ok(bad);
  assert.notEqual(stale, bad);
});

test("a passkey that cannot hold a wallet keeps its own words, whole", () => {
  // The shape the adapters actually throw: Mera's own error, recognised by its stable `code`. An
  // earlier version of this test passed a PasskeyUnusableError in directly, which proved nothing —
  // that object's message comes back whether or not anything converts it. This one fails if the
  // conversion is skipped, because a raw MeraError carries Mera's wording, not ours.
  const fromMera = Object.assign(new Error("prf unsupported"), {
    name: "MeraError",
    code: "PRF_UNAVAILABLE",
  });
  assert.equal(signInWords(fromMera), new PasskeyUnusableError().message);
});

test("closing the wallet prompt is an answer, not a failure", () => {
  assert.equal(signInWords({ code: 4001, message: "User rejected" }), null);
});

test("an unrecognised failure still says something a person can read", () => {
  const words = signInWords(new Error("socket hang up"));
  assert.ok(words);
  assert.ok(words.length > 0);
});
