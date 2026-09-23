export type Namespace = "eip155" | "solana";

export class InvalidAddressError extends Error {
  constructor(readonly address: string) {
    super("That does not look like an address for this chain");
    this.name = "InvalidAddressError";
  }
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * EVM addresses are lower-cased so that the checksummed and un-checksummed spellings of one
 * address are one row rather than two. Base58 is case-significant, so a Solana address is left
 * exactly as it was given.
 */
export function normalizeAddress(namespace: Namespace, address: string): string {
  if (namespace === "eip155") {
    if (!EVM.test(address)) {
      throw new InvalidAddressError(address);
    }
    return address.toLowerCase();
  }
  if (!SOLANA.test(address)) {
    throw new InvalidAddressError(address);
  }
  return address;
}

/** CAIP-2, which `wallet_links` checks against its own namespace column. */
export function caip2(namespace: Namespace, reference: number | string): string {
  return `${namespace}:${reference}`;
}
