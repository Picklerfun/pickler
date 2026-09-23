import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAddress,
  caip2,
  InvalidAddressError,
  InvalidChainError,
} from "../src/index.js";

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

test("a reference the chain column would refuse is refused here instead", () => {
  assert.throws(() => caip2("eip155", ""), InvalidChainError);
  assert.throws(() => caip2("eip155", "x".repeat(33)), InvalidChainError);
  assert.throws(() => caip2("eip155", "10143:extra"), InvalidChainError);
});

test("Solana's mainnet reference fits the chain column exactly and is allowed", () => {
  const mainnet = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  assert.equal(mainnet.length, 32);
  assert.equal(caip2("solana", mainnet), `solana:${mainnet}`);
});
