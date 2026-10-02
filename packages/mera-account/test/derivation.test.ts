import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../src/index.js";
import frozen from "./vectors.json" with { type: "json" };

// These vectors were produced by the app's code before it moved here
// (docs/specs/mobile-monorepo-v1.md §6). A change that makes them fail moves every account.
// Fix the change, never the file.
for (const vector of frozen.vectors) {
  test(`PRF ${vector.prfOutput.slice(0, 10)}… derives its recorded accounts`, () => {
    const mnemonic = prfOutputToMnemonic(hexToBytes(vector.prfOutput as Hex));

    assert.equal(mnemonic, vector.mnemonic);

    const seed = mnemonicToSeed(mnemonic);
    for (const account of vector.accounts) {
      const privateKey = toHex(deriveEvmPrivateKey(seed, account.index));

      assert.equal(privateKey, account.privateKey);
      assert.equal(privateKeyToAccount(privateKey).address, account.address);
    }
  });
}

test("a PRF output that is not 32 bytes is refused", () => {
  assert.throws(() => prfOutputToMnemonic(new Uint8Array(31)), /32 bytes/);
});
