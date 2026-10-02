import { deriveEvmPrivateKey, mnemonicToSeed, prfOutputToMnemonic } from "@pickler/mera-account";
import frozen from "@pickler/mera-account/vectors.json";
import { type Hex, hexToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// The same file packages/mera-account tests itself against, resolved the way the app resolves it.
// A change that makes a vector fail moves every account: fix the change, never the file.
test.each(frozen.vectors)("PRF $prfOutput derives its recorded accounts", (vector) => {
  const mnemonic = prfOutputToMnemonic(hexToBytes(vector.prfOutput as Hex));
  expect(mnemonic).toBe(vector.mnemonic);
  const seed = mnemonicToSeed(mnemonic);
  for (const account of vector.accounts) {
    const privateKey = toHex(deriveEvmPrivateKey(seed, account.index));
    expect(privateKey).toBe(account.privateKey);
    expect(privateKeyToAccount(privateKey).address).toBe(account.address);
  }
});

test("rejects PRF output that is not 32 bytes", () => {
  expect(() => prfOutputToMnemonic(new Uint8Array(31))).toThrow("32 bytes");
});
