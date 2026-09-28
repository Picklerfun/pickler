// How an address is shown and copied, kept out of the wallet screen so node:test can drive it.

/** Enough of each end to recognise the address, and short enough to sit on a button. */
const HEAD = 6;
const TAIL = 4;
const SHORTEST = HEAD + TAIL + 1;

/**
 * "0x7f3ab1…c21e" becomes "0x7f3a…c21e", the shape the canvas draws.
 *
 * Anything too short to shorten is returned whole. Slicing both ends of a short string overlaps,
 * and the result reads as a perfectly plausible address that is not the one you have — the one
 * failure mode of this function that nobody would notice.
 */
export function shortenAddress(address: string): string {
  if (address.length <= SHORTEST) {
    return address;
  }
  return `${address.slice(0, HEAD)}…${address.slice(-TAIL)}`;
}

/** Whether the last copy worked. `failed` is a real state: see `addressButtonLabel`. */
export type CopyState = "idle" | "copied" | "failed";

/**
 * What the address button reads.
 *
 * A failed copy keeps the address on the button rather than saying so there: `navigator.clipboard`
 * is absent on an insecure origin and can be refused by permission, and the useful answer to that
 * is the full address somewhere it can be selected by hand, which the screen puts beside it.
 */
export function addressButtonLabel(address: string, state: CopyState): string {
  return state === "copied" ? "COPIED" : shortenAddress(address);
}
