import { test } from "node:test";
import assert from "node:assert/strict";
import { addressFromPrf } from "../src/features/wallet/lib/mera-signer";

test("PRF address derivation is deterministic and clears caller-owned key bytes", () => {
  const first = new Uint8Array(32).fill(1);
  const second = new Uint8Array(32).fill(1);
  const address = addressFromPrf(first);
  assert.match(address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(addressFromPrf(second), address);
  assert.ok(first.every((value) => value === 0));
  assert.ok(second.every((value) => value === 0));
});

test("rejected PRF material is cleared too", () => {
  const invalid = new Uint8Array(3).fill(7);
  assert.throws(() => addressFromPrf(invalid));
  assert.ok(invalid.every((value) => value === 0));
});
