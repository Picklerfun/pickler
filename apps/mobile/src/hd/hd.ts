import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const PRF_OUTPUT_LENGTH = 32;

// BIP-44, coin type 60 (Ethereum), convención MetaMask. Cambiar esto cambia
// todas las direcciones derivadas.
const evmPath = (index: number): string => `m/44'/60'/0'/0/${index}`;

/** 32 bytes de PRF como 256 bits de entropía BIP-39 (misma regla que el demo de mera). */
export function prfOutputToMnemonic(prfOutput: Uint8Array): string {
  if (prfOutput.length !== PRF_OUTPUT_LENGTH) {
    throw new Error("PRF output must be 32 bytes");
  }
  return entropyToMnemonic(prfOutput, wordlist);
}

/** Seed BIP-39 de 64 bytes (PBKDF2, passphrase vacía). */
export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic);
}

/** Llave privada secp256k1 de la cuenta EVM `index`. */
export function deriveEvmPrivateKey(seed: Uint8Array, index: number): Uint8Array {
  const node = HDKey.fromMasterSeed(seed).derive(evmPath(index));
  if (!node.privateKey) {
    throw new Error("BIP-32 derivation produced no private key");
  }
  return node.privateKey;
}
