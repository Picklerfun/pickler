import test from "node:test";
import assert from "node:assert/strict";
import { xReturnTo, X_READ_SCOPES, X_OAUTH_TTL_MS } from "../src/features/studio/x-oauth.js";

test("OAuth uses read-only scopes, offline renewal and a ten-minute attempt", () => {
  assert.deepEqual(X_READ_SCOPES, ["users.read", "tweet.read", "offline.access"]);
  assert.equal(X_OAUTH_TTL_MS, 600000);
});
test("return paths retain only the selected agent and supported section", () => {
  assert.equal(
    xReturnTo("/studio?agent=attacker&resume=skills&token=private", "owned"),
    "/studio?agent=owned&resume=skills",
  );
  for (const path of [
    "https://evil.example/",
    "//evil.example",
    "/account",
    "/\\evil.example",
    "studio",
  ]) {
    assert.throws(() => xReturnTo(path, "owned"));
  }
});
