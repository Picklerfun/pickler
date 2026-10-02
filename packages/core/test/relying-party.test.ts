import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MERA_RELYING_PARTY,
  turnkeyRelyingPartyProblem,
} from "../src/features/wallets/domain/relying-party.js";

test("Mera's relying party is the apex", () => {
  assert.equal(MERA_RELYING_PARTY, "pickler.fun");
});

test("the studio host is accepted in a deployed environment", () => {
  assert.equal(turnkeyRelyingPartyProblem("app.pickler.fun", "production"), null);
  assert.equal(turnkeyRelyingPartyProblem("app.pickler.fun", "staging"), null);
});

test("Mera's relying party is refused everywhere, in any spelling", () => {
  for (const appEnv of ["local", "development", "staging", "production"]) {
    assert.equal(turnkeyRelyingPartyProblem("pickler.fun", appEnv), "shared_with_mera");
    assert.equal(turnkeyRelyingPartyProblem(" Pickler.Fun. ", appEnv), "shared_with_mera");
  }
});

test("localhost is for local development only", () => {
  assert.equal(turnkeyRelyingPartyProblem("localhost", "local"), null);
  assert.equal(turnkeyRelyingPartyProblem("localhost", "development"), null);
  assert.equal(turnkeyRelyingPartyProblem("localhost", "staging"), "localhost_deployed");
  assert.equal(turnkeyRelyingPartyProblem("localhost", "production"), "localhost_deployed");
});
