// Budget amounts are micro-USD (1 USD = 1_000_000), as in Relayer's agent.agent_budgets.
// They are bigint in the domain and decimal strings on the wire and in storage, so no
// value ever passes through a float.

export class InvalidAmountError extends Error {
  constructor(value: unknown) {
    super(`Invalid amount: ${String(value)}`);
    this.name = "InvalidAmountError";
  }
}

const DIGITS = /^\d{1,19}$/;
const MAX = 9_223_372_036_854_775_807n; // Postgres BIGINT

/** Parses a non-negative integer micro-USD string. Relayer accepted negatives, which credited budget. */
export function parseMicroUsd(value: string | bigint): bigint {
  const amount = typeof value === "bigint" ? value : DIGITS.test(value) ? BigInt(value) : -1n;
  if (amount < 0n || amount > MAX) {
    throw new InvalidAmountError(value);
  }
  return amount;
}

/** Strictly positive amount, for spend operations. */
export function parsePositiveMicroUsd(value: string | bigint): bigint {
  const amount = parseMicroUsd(value);
  if (amount === 0n) {
    throw new InvalidAmountError(value);
  }
  return amount;
}

/**
 * Exact USD decimal → micro-USD, rounding half up at the 6th decimal like Relayer's
 * Math.round(usd * 1e6), but without float error (e.g. "0.1234565" → 123457).
 */
export function usdToMicroUsd(usd: string | number): bigint {
  const text =
    typeof usd === "number" ? (Number.isFinite(usd) && usd >= 0 ? usd.toString() : "") : usd.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new InvalidAmountError(usd);
  }
  const whole = BigInt(match[1]!) * 1_000_000n;
  const fraction = (match[2] ?? "").padEnd(7, "0");
  const micro = BigInt(fraction.slice(0, 6));
  const roundUp = Number(fraction[6]) >= 5 ? 1n : 0n;
  return parseMicroUsd(whole + micro + roundUp);
}
