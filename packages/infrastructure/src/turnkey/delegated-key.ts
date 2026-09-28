// Pickler's delegated API key pair, in the format Turnkey API keys use: a compressed P-256 public
// key and the raw 32-byte private scalar, both hex — what @turnkey/api-key-stamper takes as
// `apiPublicKey` and `apiPrivateKey`. Node's crypto only: this runs from an operator's shell,
// never inside a Worker.

import { createECDH } from "node:crypto";

export interface DelegatedKeyPair {
  /** Compressed P-256 point, 33 bytes as 66 hex characters. */
  publicKey: string;
  /** Raw private scalar, 32 bytes as 64 hex characters. */
  privateKey: string;
}

export function generateDelegatedKeyPair(): DelegatedKeyPair {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    publicKey: ecdh.getPublicKey("hex", "compressed"),
    // getPrivateKey drops leading zero bytes; Turnkey expects the full 32.
    privateKey: ecdh.getPrivateKey("hex").padStart(64, "0"),
  };
}

/**
 * The two `.dev.vars` lines for a pair. Refuses a file that already names either variable, so a
 * second run cannot leave two keys where the worker reads only one of them.
 */
export function devVarsLines(existing: string, pair: DelegatedKeyPair): string {
  if (/^TURNKEY_DELEGATED_API_(PUBLIC|PRIVATE)_KEY=/m.test(existing)) {
    throw new Error("The file already sets a delegated key; remove it first to replace it");
  }
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  return (
    `${separator}TURNKEY_DELEGATED_API_PUBLIC_KEY=${pair.publicKey}\n` +
    `TURNKEY_DELEGATED_API_PRIVATE_KEY=${pair.privateKey}\n`
  );
}
