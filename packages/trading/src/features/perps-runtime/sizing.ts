import { LEVERAGE_BOUNDS } from "@pickler/core";

/** Below `min` it holds (LOW_CONVICTION); from `full` it puts in the whole per-call amount. */
export const CONVICTION = { min: 0.55, full: 0.65 } as const;

/** AUSD amounts in the runtime's rules are kept to micro-AUSD. */
export function microAusd(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** R7: margin = per call × 1.0 from 0.65, × 0.5 from 0.55, nothing below. */
export function marginFor(probability: number, perCallAusd: number): number {
  if (probability >= CONVICTION.full) {
    return microAusd(perCallAusd);
  }
  if (probability >= CONVICTION.min) {
    return microAusd(perCallAusd * 0.5);
  }
  return 0;
}

/** The brief's MAX LEVERAGE as a whole number inside the core bounds; absent means 1×. */
export function leverageFor(maxLeverage: number | undefined): number {
  if (maxLeverage === undefined || !Number.isFinite(maxLeverage)) {
    return LEVERAGE_BOUNDS.min;
  }
  return Math.min(LEVERAGE_BOUNDS.max, Math.max(LEVERAGE_BOUNDS.min, Math.floor(maxLeverage)));
}

export function notionalFor(margin: number, leverage: number): number {
  return microAusd(margin * leverage);
}
