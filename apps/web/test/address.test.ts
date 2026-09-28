import assert from "node:assert/strict";
import { test } from "node:test";
import { addressButtonLabel, shortenAddress } from "../src/features/auth/lib/address";

const ADDRESS = "0x7f3ab1c4e5d6f708192a3b4c5d6e7f8091a2c21e";

test("an address is shortened to the canvas's own shape", () => {
  assert.equal(shortenAddress(ADDRESS), "0x7f3a…c21e");
  assert.equal(shortenAddress(ADDRESS).length, 11);
});

test("the two halves come from the two ends, and never from each other", () => {
  assert.ok(ADDRESS.startsWith(shortenAddress(ADDRESS).slice(0, 6)));
  assert.ok(ADDRESS.endsWith(shortenAddress(ADDRESS).slice(-4)));
});

test("something too short to shorten is shown whole rather than folded over itself", () => {
  // slice(0, 6) + slice(-4) on a short string overlaps and prints characters twice, which reads
  // as an address that is not the one you have.
  assert.equal(shortenAddress("0x1234"), "0x1234");
  assert.equal(shortenAddress("0x123456789"), "0x123456789");
  assert.equal(shortenAddress(""), "");
  // The boundary: eleven characters is exactly what the short form costs, so it is not worth it.
  assert.equal(shortenAddress("0x123456789"), "0x123456789");
  assert.equal(shortenAddress("0x1234567890ab"), "0x1234…90ab");
});

test("the copy button says what it did, and goes back to the address afterwards", () => {
  assert.equal(addressButtonLabel(ADDRESS, "idle"), "0x7f3a…c21e");
  assert.equal(addressButtonLabel(ADDRESS, "copied"), "COPIED");
  // A failed copy keeps the address on the button; the full one is shown beside it to select.
  assert.equal(addressButtonLabel(ADDRESS, "failed"), "0x7f3a…c21e");
});
