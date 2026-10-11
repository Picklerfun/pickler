import { PilotError } from "@pickler/core";
import {
  paperUnits as units,
  paperDecimal as decimal,
  PAPER_SCALE,
} from "../perps-paper/decimal.js";
export { units, decimal, PAPER_SCALE };
export const abs = (n: bigint) => (n < 0n ? -n : n);
export const min = (...n: bigint[]) => n.reduce((a, b) => (a < b ? a : b));
export const max = (...n: bigint[]) => n.reduce((a, b) => (a > b ? a : b));
export function tick(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new PilotError("INVALID_MARKET_DATA", "PTS precision is unsupported");
  }
  return 10n ** BigInt(18 - decimals);
}
export function floorQuantity(q: bigint, decimals: number) {
  const step = tick(decimals);
  return (q / step) * step;
}
export function recoveryPrice(from: string, to: string, ratio: string) {
  return decimal(units(from) + ((units(to) - units(from)) * units(ratio)) / PAPER_SCALE);
}
/** Exact cross-products; mirrored shorts share the same ratio ordering. */
export function recoveryRatioCompare(price: string, from: string, to: string, ratio: string) {
  const span = units(to) - units(from);
  if (span === 0n) {
    throw new PilotError("INVALID_INPUT", "Zero recovery span");
  }
  const n = (units(price) - units(from)) * (span > 0n ? 1n : -1n) * PAPER_SCALE;
  const rhs = abs(span) * units(ratio);
  return n > rhs ? 1 : n < rhs ? -1 : 0;
}
