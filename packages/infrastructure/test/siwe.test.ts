import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { normalizeAddress } from "@pickler/core";
import { buildSiweMessage, createSignatureVerifier, parseSiweMessage } from "../src/index.js";

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const verifier = createSignatureVerifier();

/** The address in the one spelling the verifier's port accepts, which is what the ceremony holds. */
const signer = normalizeAddress("eip155", account.address);

/**
 * EIP-4361 constrains the nonce to `[a-zA-Z0-9]{8,}`, and viem enforces it in both directions:
 * `createSiweMessage` throws on anything else, and the parser's `Nonce:` group stops at the first
 * character outside that set. A hyphenated nonce would therefore not round-trip — it would be
 * silently truncated on the way back. This is the shape the container actually issues,
 * `crypto.randomUUID().replace(/-/g, "")`.
 */
const nonce = "b1c93a5f4e2d47a8b0c6e9f1a2d3b4c5";

const fields = {
  domain: "pickler.fun",
  address: account.address,
  statement: "Sign in to Pickler",
  uri: "https://pickler.fun",
  chainId: 10143,
  nonce,
  issuedAt: new Date("2026-09-23T12:00:00Z"),
};

test("a signature over the built message verifies", async () => {
  const raw = buildSiweMessage(fields);
  const signature = await account.signMessage({ message: raw });
  assert.equal(await verifier.verify({ message: raw, signature, address: signer }), true);
});

test("a signature over a different message does not verify", async () => {
  const signature = await account.signMessage({ message: buildSiweMessage(fields) });
  const tampered = buildSiweMessage({ ...fields, nonce: "c2d04b6a5f3e58b9c1d7f0a2b3e4c5d6" });
  assert.equal(await verifier.verify({ message: tampered, signature, address: signer }), false);
});

test("a signature from another key does not verify", async () => {
  const other = privateKeyToAccount(
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  );
  const raw = buildSiweMessage(fields);
  const signature = await other.signMessage({ message: raw });
  assert.equal(await verifier.verify({ message: raw, signature, address: signer }), false);
});

test("the built message carries the domain and the nonce, because both are checked", () => {
  const raw = buildSiweMessage(fields);
  assert.match(raw, /^pickler\.fun wants you to sign in/);
  assert.match(raw, new RegExp(`Nonce: ${nonce}`));
});

test("what was built can be read back, so one module owns both directions", () => {
  const raw = buildSiweMessage(fields);
  const parsed = parseSiweMessage(raw);
  assert.equal(parsed.domain, "pickler.fun");
  assert.equal(parsed.nonce, nonce);
  assert.equal(parsed.chainReference, 10143);
  assert.equal(parsed.address.toLowerCase(), account.address.toLowerCase());
  assert.equal(parsed.issuedAt, "2026-09-23T12:00:00.000Z");
});

test("a string that is not a sign-in message is refused, not half-read", () => {
  const raw = buildSiweMessage(fields);

  // Nothing at all matches: the easy case, and the only one a bare `throw` would catch.
  assert.throws(() => parseSiweMessage("hello"), /not a Pickler sign-in message/);

  // The hard case. viem's parser is two independent regexes, so a message whose prefix is
  // well-formed and whose suffix is cut off yields `domain` and `address` and nothing else. A
  // parser that returned that would hand the ceremony a `nonce` of `undefined`, which fails a
  // lookup far from here and looks like an expired nonce rather than a malformed message.
  const truncated = raw.split("\nChain ID:")[0]!;
  assert.match(truncated, /^pickler\.fun wants you to sign in/);
  assert.throws(() => parseSiweMessage(truncated), /not a Pickler sign-in message/);

  // The other half, and the one that matters most: a well-formed suffix under a prefix that is
  // not a sign-in request. Everything after `URI:` matches, so `nonce`, `chainId` and `issuedAt`
  // all come back — and `domain` does not. That is the `undefined` domain that would otherwise be
  // compared against the configured one and simply fail, as if the wrong site had asked.
  const unaddressed = raw.replace(
    "wants you to sign in with your Ethereum account:",
    "wants you to do something else:",
  );
  assert.match(unaddressed, /Nonce: /);
  assert.throws(() => parseSiweMessage(unaddressed), /not a Pickler sign-in message/);

  // An unparseable timestamp gives viem a `Date` of `NaN`, and `toISOString()` on one throws a
  // `RangeError`, not this. The caller must see one refusal, not two.
  const undated = raw.replace(/Issued At: .*/, "Issued At: tomorrow");
  assert.throws(() => parseSiweMessage(undated), /not a Pickler sign-in message/);
});

test("a malformed signature is false rather than an exception", async () => {
  assert.equal(
    await verifier.verify({ message: "x", signature: "not-a-signature", address: signer }),
    false,
  );
});
