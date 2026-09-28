import { verifyMessage } from "viem";
import { createSiweMessage, parseSiweMessage as parseSiwe, type SiweMessage } from "viem/siwe";
import type { SignatureVerifier, SignedMessage } from "@pickler/core";

export type SiweFields = Pick<
  SiweMessage,
  "domain" | "address" | "statement" | "uri" | "chainId" | "nonce" | "issuedAt"
>;

/** The exact string presented for signature. It is also the string verified, byte for byte. */
export function buildSiweMessage(fields: SiweFields): string {
  return createSiweMessage({ version: "1", ...fields });
}

export class MalformedMessageError extends Error {
  constructor() {
    super("That is not a Pickler sign-in message");
    this.name = "MalformedMessageError";
  }
}

/**
 * Reads a message this module built. It is the only reader: nothing trusts fields the client sends
 * alongside the string, because the signature covers the string and nothing else.
 *
 * Every field the caller will use is required, because viem's parser is two independent regexes
 * over the prefix and the suffix and returns whatever matched. A message whose prefix is
 * well-formed and whose suffix is truncated comes back with a `domain` and an `address` and no
 * `nonce` — and a partial read like that fails a nonce lookup somewhere far from here, where it
 * is indistinguishable from an expired nonce. Refusing it here is the only place the difference
 * is still visible.
 */
export function parseSiweMessage(raw: string): SignedMessage {
  const parsed = parseSiwe(raw);
  if (!parsed.domain || !parsed.address || !parsed.nonce || parsed.chainId === undefined) {
    throw new MalformedMessageError();
  }
  // viem answers an unparseable timestamp with `new Date(NaN)` rather than dropping the field, and
  // `toISOString()` on that throws a `RangeError`. Without this the caller has two different
  // failures to handle for one malformed string.
  if (!parsed.issuedAt || Number.isNaN(parsed.issuedAt.getTime())) {
    throw new MalformedMessageError();
  }
  return {
    domain: parsed.domain,
    address: parsed.address,
    namespace: "eip155",
    chainReference: parsed.chainId,
    nonce: parsed.nonce,
    statement: parsed.statement ?? "",
    issuedAt: parsed.issuedAt.toISOString(),
  };
}

/**
 * Mera accounts are ordinary EOAs and its `signMessage` is viem's own `hashMessage` under a
 * serialised signature, so the string is signed unchanged. Recovery is therefore the whole of the
 * check and there is no ERC-1271 path to fall back to.
 *
 * A malformed signature answers false rather than raising. A caller cannot tell "not signed by
 * that address" from "not a signature at all", and should not: both mean the request is refused.
 */
export function createSignatureVerifier(): SignatureVerifier {
  return {
    async verify({ message, signature, address }) {
      try {
        return await verifyMessage({
          address: address as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
      } catch {
        return false;
      }
    },
  };
}
