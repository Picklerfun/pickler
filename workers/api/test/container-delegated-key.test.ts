import assert from "node:assert/strict";
import test from "node:test";
import { delegatedPublicKeyFrom } from "../src/container";

test("the delegated public key is used only when it is a compressed P-256 key", () => {
  const logged: string[] = [];
  const log = (message: string) => logged.push(message);
  const valid = `02${"ab".repeat(32)}`;

  assert.equal(delegatedPublicKeyFrom({ TURNKEY_DELEGATED_API_PUBLIC_KEY: valid }, log), valid);
  assert.equal(delegatedPublicKeyFrom({}, log), null);
  assert.deepEqual(logged, []);

  const malformed = `04${"ab".repeat(64)}`;
  assert.equal(delegatedPublicKeyFrom({ TURNKEY_DELEGATED_API_PUBLIC_KEY: malformed }, log), null);
  assert.equal(logged.length, 1);
  assert.match(logged[0]!, /TURNKEY_DELEGATED_API_PUBLIC_KEY/);
  assert.equal(logged[0]!.includes(malformed), false, "the value is never logged");
});
