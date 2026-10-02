import { test } from "node:test";
import assert from "node:assert/strict";
import { ConnectError } from "../src/features/wallet/lib/connect";
import { joinWords, signInWords } from "../src/features/wallet/lib/sign-in-words";

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

test("closing the wallet prompt is an answer, not a failure", () => {
  assert.equal(signInWords({ code: 4001, message: "User rejected" }), null);
});

test("an unrecognised failure still says something a person can read", () => {
  const words = signInWords(new Error("socket hang up"));
  assert.ok(words);
  assert.ok(words.length > 0);
});

test("a request that ran out of time is said in words, not as the browser words it", () => {
  const timedOut = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });

  assert.equal(signInWords(timedOut), "That sign-in took too long to come back. Try again.");
});

test("each way a join is refused tells the person what to do instead", () => {
  const refused = (code: string) => joinWords(new ConnectError("from the API", code));

  assert.match(refused("no_account")!, /no Pickler account yet.*username/);
  assert.match(refused("same_account")!, /the wallet you are connected with/);
  assert.match(refused("join_has_profile")!, /already has a username/);
  assert.match(refused("join_not_wallet_account")!, /cannot be moved/);
});

test("anything else that stops a join is said as a sign-in would say it", () => {
  // The other wallet's prompt closed: an answer, with nothing to show.
  assert.equal(joinWords({ code: 4001 }), null);
  assert.equal(
    joinWords(new ConnectError("Ask for a new one", "nonce_invalid")),
    "That sign-in took too long to come back. Try again.",
  );
  assert.match(joinWords(new ConnectError("x", "401"))!, /did not match the wallet/);
});
