import type { Signer } from "./connect";
import type { Eip1193Provider } from "./provider";

/**
 * Producing a {@link Signer} from either wallet the marketplace offers.
 *
 * The two arrive in different shapes and this is the only file that knows it. Mera has no EIP-1193
 * provider — it is an SDK whose adapter, `toViemAccount(session)`, returns a viem account — while
 * the wallet the person brought is raw EIP-1193 and has no viem account anywhere near it. Each gets
 * the adapter it needs, and `connect.ts` goes on not knowing which wallet it was handed.
 *
 * Nothing here builds a message. The server builds it, and both adapters sign the string they are
 * given, unchanged.
 */

/**
 * A passkey that exists and works for everything else, but produces no PRF output — so Mera cannot
 * derive a key from it.
 *
 * This is not an edge case to fold into a generic failure. Chrome creates a local-profile passkey
 * silently when "Offer to save passwords and passkeys" is off or an extension intercepts WebAuthn,
 * and local-profile passkeys, Bitwarden on desktop Chrome and Dashlane on desktop Chrome all had no
 * PRF support as of 2026-06-01. The person did nothing wrong, their passkey is fine everywhere
 * else, and "something went wrong" would send them to look for a problem that is not theirs.
 * iCloud Keychain, Google Password Manager, Windows Password Manager and hardware keys all work.
 */
export class PasskeyUnusableError extends Error {
  constructor() {
    super(
      "This passkey can't be used to hold a wallet. Your browser saved it somewhere that doesn't " +
        "support the feature Mera needs. Try again with iCloud Keychain, Google Password Manager, " +
        "Windows Hello or a security key — or connect an existing wallet instead.",
    );
    this.name = "PasskeyUnusableError";
  }
}

/**
 * Mera's errors carry a stable `code`; their message text does not promise to stay put. Its own
 * reference is explicit about which half is the contract — "The codes are the contract; the message
 * text is free to change between versions" — so this reads the code.
 *
 * It is read structurally rather than through the SDK's `isMeraError` guard so that this module
 * needs no import from the SDK at all: the error can be recognised wherever it was thrown, and a
 * second copy of the package in the bundle cannot make an `instanceof` check quietly answer false.
 * Verified against the published `@category-labs/mera@0.2.0`, where a thrown error carries
 * `name: "MeraError"` and `code` as own properties.
 */
function isPrfUnavailable(error: Error): boolean {
  return error.name === "MeraError" && (error as { code?: unknown }).code === "PRF_UNAVAILABLE";
}

/**
 * Turns whatever a wallet threw into something a screen can say.
 *
 * Wrap every SDK call that creates or reads a passkey in this. Matching on message text instead
 * would fail twice over: it goes silently generic the first time Mera rewords a string, and it
 * blames the passkey for a cancellation, because the call that failed is still the PRF one.
 */
export function describeSignerFailure(caught: unknown): Error {
  const error = caught instanceof Error ? caught : new Error(String(caught));
  return isPrfUnavailable(error) ? new PasskeyUnusableError() : error;
}

/** Anything viem-shaped — in practice Mera's `toViemAccount(session)`. */
export interface ViemAccountLike {
  address: string;
  signMessage(input: { message: string }): Promise<string>;
}

/**
 * Mera's path. `signMessage` here is viem's own `hashMessage` followed by a secp256k1 signature
 * over an ordinary EOA address, which is the plain EIP-191 signature the server already verifies —
 * there is no ERC-1271 path to add.
 */
export function fromViemAccount(account: ViemAccountLike, chainId: number): Signer {
  return {
    address: account.address,
    chainId,
    signMessage: (message) => account.signMessage({ message }),
  };
}

/**
 * UTF-8 to hex. `personal_sign` takes its data as hex, and its parameters are `[data, address]` —
 * the reverse of `eth_sign`'s `[address, data]`, which is where the order is usually misremembered.
 * Both match viem 2.56.8, already vendored here: `signMessage` hex-encodes with `stringToHex` and
 * requests `params: [message_, account.address]`.
 */
function toHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * The wallet the person brought. `address` and `chainId` are what the connection already read, so
 * signing is one call and never a round trip that could answer for a different account than the one
 * on screen.
 */
export function fromInjectedProvider(
  provider: Eip1193Provider,
  address: string,
  chainId: number,
): Signer {
  return {
    address,
    chainId,
    signMessage: async (message) => {
      const signature = await provider.request({
        method: "personal_sign",
        params: [toHex(message), address],
      });
      return signature as string;
    },
  };
}
