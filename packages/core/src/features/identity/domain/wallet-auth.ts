export type Namespace = "eip155" | "solana";

declare const normalized: unique symbol;

/**
 * An address in the one spelling the database accepts. The only way to obtain one is
 * `normalizeAddress`, which is the point: the guarantee is in this value, not in the fact that a
 * validation did not throw.
 *
 * The domain accepts `[0-9a-fA-F]` and `wallet_links_address_format` accepts `[0-9a-f]`, so a
 * caller holding a checksummed address that passed validation is holding a value the database
 * will refuse — at insert time, far from the mistake. Every EIP-55 address a wallet emits is in
 * that set, so this is the ordinary path rather than an edge case. The brand turns that runtime
 * violation into a compile error.
 */
export type NormalizedAddress = string & { readonly [normalized]: true };

export class InvalidAddressError extends Error {
  constructor(readonly address: string) {
    super("That does not look like an address for this chain");
    this.name = "InvalidAddressError";
  }
}

export class InvalidChainError extends Error {
  constructor(readonly reference: string) {
    super("That is not a chain reference this link could record");
    this.name = "InvalidChainError";
  }
}

const EVM = /^0x[0-9a-fA-F]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The reference half of `wallet_links_verified_chain`, which is where an unchecked one lands. */
const REFERENCE = /^[-_a-zA-Z0-9]{1,32}$/;

/**
 * EVM addresses are lower-cased so that the checksummed and un-checksummed spellings of one
 * address are one row rather than two. Base58 is case-significant, so a Solana address is left
 * exactly as it was given.
 */
export function normalizeAddress(namespace: Namespace, address: string): NormalizedAddress {
  if (namespace === "eip155") {
    if (!EVM.test(address)) {
      throw new InvalidAddressError(address);
    }
    return address.toLowerCase() as NormalizedAddress;
  }
  if (!SOLANA.test(address)) {
    throw new InvalidAddressError(address);
  }
  return address as NormalizedAddress;
}

/**
 * CAIP-2, which `wallet_links` checks against its own namespace column. The reference is checked
 * against the same pattern the column does, so a reference that is empty, over thirty-two
 * characters or carrying a second colon fails here rather than at the insert. Solana's mainnet
 * reference is exactly thirty-two characters, so the bound has no slack to spare.
 */
export function caip2(namespace: Namespace, reference: number | string): string {
  const text = String(reference);
  if (!REFERENCE.test(text)) {
    throw new InvalidChainError(text);
  }
  return `${namespace}:${text}`;
}

/**
 * Compile-time proof that the brand is load-bearing. `Assert<T extends true>` accepts only `true`,
 * so if `NormalizedAddress` ever collapses back to `string`, `string extends NormalizedAddress`
 * becomes true, the conditional yields `false`, and this line fails to compile.
 *
 * It lives in `src` rather than in the test because `packages/core/tsconfig.json` includes
 * `src/**` only and `tsx` strips types without checking them — so an assertion in `test/` is never
 * typechecked by anything and cannot fail. That was the original form of this pin and it was
 * silent when the brand was deleted outright.
 */
type Assert<T extends true> = T;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- tsc checks it; nothing reads it
type _BrandIsLoadBearing = Assert<string extends NormalizedAddress ? false : true>;

/**
 * Whether a verified token's email is a wallet sign-in account's synthetic one
 * (`<namespace>-<digest>@<walletEmailDomain>`, minted by infrastructure's wallet-accounts.ts).
 *
 * This is the reliable marker of a wallet sign-in account in the token. The email claim is signed
 * by Supabase, set once by the admin API when the account is created, and cannot be changed to
 * that domain by the person, because confirming an address there is impossible — the domain never
 * accepts mail. The alternatives are weaker: `user_metadata.wallet_namespace` is writable by the
 * person through `updateUser`, `app_metadata.provider` is "email" for these accounts exactly as for
 * an email-code one, and a row in `identity.wallet_links` also exists for an email account that
 * linked a wallet. With no domain configured wallet sign-in is off, and no such account can exist.
 */
export function isWalletAccountEmail(
  email: string | null | undefined,
  walletEmailDomain: string | null | undefined,
): boolean {
  if (!email || !walletEmailDomain) {
    return false;
  }
  return email.toLowerCase().endsWith(`@${walletEmailDomain.toLowerCase()}`);
}
