import assert from "node:assert/strict";
import { test } from "node:test";
import { formatBalance } from "../src/features/auth/lib/balance";
import type { BalanceDto } from "../src/features/auth/lib/custody-api";

const ausd = (raw: string | null): BalanceDto => ({ symbol: "AUSD", decimals: 6, raw });

test("a balance the chain could not be read for is not a zero", () => {
  // The whole reason `raw` is nullable. A screen that prints 0.00 here tells somebody their money
  // is gone when the truth is that nobody looked.
  assert.equal(formatBalance(ausd(null)), null);
  assert.equal(formatBalance(null), null);
  assert.equal(formatBalance(undefined), null);
});

test("a zero balance is a fact and prints as one", () => {
  const zero = formatBalance(ausd("0"));
  assert.equal(zero, "0.00");
  assert.notEqual(zero, null, "an empty wallet is readable, and reading it succeeded");
});

test("base units divide by the token's decimals", () => {
  assert.equal(formatBalance(ausd("1500000")), "1.50");
  assert.equal(formatBalance(ausd("1")), "0.00");
  assert.equal(formatBalance(ausd("1234567890123")), "1,234,567.89");
  assert.equal(formatBalance({ symbol: "MON", decimals: 18, raw: "2500000000000000000" }), "2.50");
});

test("what is shown is never more than what is held", () => {
  // Truncated, not rounded: 1.999999 AUSD is not two dollars, and a balance that rounds up is a
  // balance you cannot spend all of.
  assert.equal(formatBalance(ausd("1999999")), "1.99");
  assert.equal(formatBalance(ausd("999999")), "0.99");
});

test("a token with no decimals gets no invented ones", () => {
  assert.equal(formatBalance({ symbol: "PTS", decimals: 0, raw: "42" }), "42");
  assert.equal(formatBalance({ symbol: "DIME", decimals: 1, raw: "425" }), "42.5");
});

test("a balance larger than a double can hold survives intact", () => {
  const raw = "90071992547409931234567";
  const shown = formatBalance(ausd(raw));
  assert.equal(shown, "90,071,992,547,409,931.23");

  // The assertion that matters: the same sum through a double loses digits, so this proves the
  // arithmetic above never went near one.
  const throughADouble = (Number(raw) / 1e6).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  assert.notEqual(shown, throughADouble);
  assert.ok(Number(raw) > Number.MAX_SAFE_INTEGER);
});

test("a raw value that is not a decimal integer is unreadable, not reinterpreted", () => {
  // BigInt("0x1e") is 30n. A hex string on the wire must not quietly become a balance.
  assert.equal(formatBalance(ausd("0x1e")), null);
  assert.equal(formatBalance(ausd("")), null);
  assert.equal(formatBalance(ausd("1.5")), null);
  assert.equal(formatBalance(ausd("  12 ")), null);
  assert.equal(formatBalance({ symbol: "AUSD", decimals: -1, raw: "10" }), null);
});

test("a negative balance keeps its sign on the whole number, not inside it", () => {
  // Balances are not negative today. A formatter that prints "-0.-50" for one is a trap left for
  // whoever first subtracts a fee here.
  assert.equal(formatBalance(ausd("-1500000")), "-1.50");
  assert.equal(formatBalance(ausd("-1")), "-0.00");
});
