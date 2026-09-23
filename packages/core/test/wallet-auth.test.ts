import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAddress, caip2, InvalidAddressError } from "../src/index.js";

test("an EVM address is stored lower-case, so two spellings are one link", () => {
  assert.equal(
    normalizeAddress("eip155", "0xAbC0000000000000000000000000000000000001"),
    "0xabc0000000000000000000000000000000000001",
  );
});

test("an address that is not twenty bytes is refused", () => {
  assert.throws(() => normalizeAddress("eip155", "0xabc"), InvalidAddressError);
  assert.throws(() => normalizeAddress("eip155", "not-an-address"), InvalidAddressError);
});

test("a Solana address keeps its case, because base58 is case-significant", () => {
  const address = "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK";
  assert.equal(normalizeAddress("solana", address), address);
});

test("the chain reference is CAIP-2 and names its own family", () => {
  assert.equal(caip2("eip155", 10143), "eip155:10143");
});
