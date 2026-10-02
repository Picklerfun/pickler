import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const PRF_OUTPUT_LENGTH = 32;

const HARDENED = 0x80000000;

// m/44'/60'/0'/0/<index>: BIP-44, coin type 60 (Ethereum), the MetaMask convention. Changing this
// changes every derived address. Written as child indexes, so every node on the way can be wiped.
const evmPath = (index: number): number[] => [44 + HARDENED, 60 + HARDENED, HARDENED, 0, index];

/** 32 bytes of PRF output as 256 bits of BIP-39 entropy (the rule of Mera's own demo). */
export function prfOutputToMnemonic(prfOutput: Uint8Array): string {
  if (prfOutput.length !== PRF_OUTPUT_LENGTH) {
    throw new Error("PRF output must be 32 bytes");
  }
  return entropyToMnemonic(prfOutput, wordlist);
}

/** The 64-byte BIP-39 seed (PBKDF2, empty passphrase). */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
}

/**
 * The secp256k1 private key of EVM account `index`, as bytes that are the caller's to zero.
 *
 * The nodes on the way — the master key included, from which every account of this passkey
 * follows — are wiped before this returns, with their chain codes. The library's own `derive`
 * leaves them holding their keys for the garbage collector to find.
 */
export function deriveEvmPrivateKey(seed: Uint8Array, index: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0 || index >= HARDENED) {
    throw new Error("The account index must be a whole number below 2^31");
  }
  const nodes: HDKey[] = [];
  try {
    let node = HDKey.fromMasterSeed(seed);
    nodes.push(node);
    for (const child of evmPath(index)) {
      node = node.deriveChild(child);
      nodes.push(node);
    }
    if (!node.privateKey) {
      throw new Error("BIP-32 derivation produced no private key");
    }
    return Uint8Array.from(node.privateKey);
  } finally {
    for (const node of nodes) {
      node.chainCode?.fill(0);
      node.wipePrivateData();
    }
  }
}
