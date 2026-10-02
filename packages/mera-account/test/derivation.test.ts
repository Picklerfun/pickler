import { test } from "node:test";
import assert from "node:assert/strict";
import { hexToBytes, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { HDKey } from "@scure/bip32";
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

test("an account index that is not a whole number is refused", () => {
  const seed = mnemonicToSeed(frozen.vectors[0]!.mnemonic);

  assert.throws(() => deriveEvmPrivateKey(seed, 1.5), /whole number/);
  assert.throws(() => deriveEvmPrivateKey(seed, -1), /whole number/);
  assert.throws(() => deriveEvmPrivateKey(seed, 0x80000000), /whole number/);
});

test("no node on the way keeps its key or its chain code, and the key handed back is a copy", () => {
  const vector = frozen.vectors[1]!;
  const seed = mnemonicToSeed(vector.mnemonic);

  // Every node the derivation makes, collected through the library's own two ways of making one.
  const nodes: HDKey[] = [];
  const fromMasterSeed = HDKey.fromMasterSeed;
  const deriveChild = HDKey.prototype.deriveChild;
  HDKey.fromMasterSeed = (...args: Parameters<typeof fromMasterSeed>) => {
    const node = fromMasterSeed.apply(HDKey, args);
    nodes.push(node);
    return node;
  };
  HDKey.prototype.deriveChild = function (this: HDKey, index: number) {
    const node = deriveChild.call(this, index);
    nodes.push(node);
    return node;
  };

  let privateKey: Uint8Array;
  try {
    privateKey = deriveEvmPrivateKey(seed, 0);
  } finally {
    HDKey.fromMasterSeed = fromMasterSeed;
    HDKey.prototype.deriveChild = deriveChild;
  }

  // The master and the five nodes of m/44'/60'/0'/0/0.
  assert.equal(nodes.length, 6);
  for (const node of nodes) {
    assert.equal(node.privateKey, null);
    assert.ok(node.chainCode?.every((byte) => byte === 0));
  }
  assert.equal(toHex(privateKey), vector.accounts[0]!.privateKey);
});
