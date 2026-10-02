import { privateKeyToAccount } from "viem/accounts";
import { toHex } from "viem";
import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "../src/hd/hd";

const prf = new Uint8Array(32).fill(7);

test("32 bytes of PRF become a 24-word mnemonic", () => {
  const words = prfOutputToMnemonic(prf).split(" ");
  expect(words).toHaveLength(24);
});

test("rejects PRF output that is not 32 bytes", () => {
  expect(() => prfOutputToMnemonic(new Uint8Array(31))).toThrow("32 bytes");
});

test("derivation is deterministic and yields a valid EVM account", () => {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prf));
  const k1 = deriveEvmPrivateKey(seed, 0);
  const k2 = deriveEvmPrivateKey(mnemonicToSeed(prfOutputToMnemonic(prf)), 0);
  expect(toHex(k1)).toBe(toHex(k2));
  expect(k1).toHaveLength(32);
  const account = privateKeyToAccount(toHex(k1));
  expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
});

test("index 1 differs from index 0", () => {
  const seed = mnemonicToSeed(prfOutputToMnemonic(prf));
  expect(toHex(deriveEvmPrivateKey(seed, 1))).not.toBe(toHex(deriveEvmPrivateKey(seed, 0)));
});
