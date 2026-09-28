import { PilotError } from "../research/types.js";
export const PAPER_SCALE = 10n ** 18n;
/** Fixed-point values retain 18 places internally; cash postings use collateral micros. */
export function paperUnits(value: string): bigint {
  if (!/^-?(0|[1-9]\d{0,35})(\.\d{1,18})?$/.test(value)) {
    throw new PilotError("INVALID_INPUT", "Invalid paper decimal");
  }
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole!) * PAPER_SCALE + BigInt(fraction.padEnd(18, "0"));
  return negative ? -units : units;
}
export function paperDecimal(value: bigint): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(19, "0");
  const fraction = digits.slice(-18).replace(/0+$/, "");
  return `${negative ? "-" : ""}${digits.slice(0, -18)}${fraction ? `.${fraction}` : ""}`;
}
export function paperProduct(a: string, b: string): string {
  return paperDecimal((paperUnits(a) * paperUnits(b)) / PAPER_SCALE);
}
/** Round account changes downward to six decimals: never over-credit or undercharge. */
export function paperCash(value: string): string {
  const n = paperUnits(value);
  const step = 10n ** 12n;
  return paperDecimal((n / step - (n < 0n && n % step !== 0n ? 1n : 0n)) * step);
}
