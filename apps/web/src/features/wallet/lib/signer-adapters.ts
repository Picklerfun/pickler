import type { Signer } from "./connect";
import type { Eip1193Provider } from "./provider";

/**
 * Producing a {@link Signer} from the wallet the person brought.
 *
 * The browser wallet is raw EIP-1193 and this is the only file that knows it, so `connect.ts` goes
 * on not knowing which wallet it was handed. The person's own Pickler wallet is not a signer here:
 * it is custodied, and the site reaches it through the signing API.
 *
 * Nothing here builds a message. The server builds it, and the adapter signs the string it is
 * given, unchanged.
 */

/** Turns whatever a wallet threw into an Error a screen can read a message from. */
export function describeSignerFailure(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
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
