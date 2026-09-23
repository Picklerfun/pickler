// What a balance reads as, kept out of the welcome screen so node:test can drive it.
//
// Two things here are easy to get wrong and expensive when they are. The first is that `raw` is
// nullable and null does not mean zero: the API answers null when it could not read the chain, and
// a screen that prints 0.00 for that tells somebody their money is gone when the truth is that
// nobody looked. The second is that `raw` is base units as text and can be far larger than
// Number.MAX_SAFE_INTEGER, so nothing below goes near a double.

import type { BalanceDto } from "./custody-api";

/** How many digits after the point a balance shows, whatever precision the token itself has. */
const SHOWN = 2;

/** BigInt("0x1e") is 30n, and " 12 " parses too. A balance is decimal digits or it is nothing. */
const DIGITS = /^-?\d+$/;

/**
 * Base units to a decimal string — "1500000" at 6 decimals is "1.50" — or null when there is no
 * balance to show.
 *
 * Null covers three cases that all mean the same thing on screen: no balance in the response, a
 * `raw` the chain could not be read for, and a `raw` that is not a decimal integer. The last one
 * is deliberate rather than lax: a value this function cannot read is not a balance, and saying
 * so is the same honest answer as the chain being unreachable. Showing a number derived from it
 * would be worse than showing none.
 *
 * Truncated, never rounded. 1.999999 AUSD is not two dollars, and a balance that rounds up is a
 * balance you cannot spend all of.
 */
export function formatBalance(balance: BalanceDto | null | undefined): string | null {
  const raw = balance?.raw;
  if (raw === null || raw === undefined || !DIGITS.test(raw)) {
    return null;
  }
  const decimals = balance?.decimals ?? 0;
  if (!Number.isInteger(decimals) || decimals < 0) {
    return null;
  }

  const value = BigInt(raw);
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);
  const whole = magnitude / unit;
  const shown = Math.min(SHOWN, decimals);

  const sign = negative ? "-" : "";
  const grouped = whole.toLocaleString("en-US");
  if (shown === 0) {
    return `${sign}${grouped}`;
  }
  // The fraction is taken from the remainder rather than from a division, so the digits are the
  // ones the chain holds and not the ones a decimal expansion happened to produce.
  const fraction = ((magnitude % unit) * 10n ** BigInt(shown)) / unit;
  return `${sign}${grouped}.${fraction.toString().padStart(shown, "0")}`;
}
