import type { Movement } from "./explorer";

/** Segmentado Activity / Pending de Wallet (spec mobile-light D18). */
export function splitMovements(rows: readonly Movement[]): { activity: Movement[]; pending: Movement[] } {
  return { activity: rows.filter((r) => r.status !== "Confirming"), pending: rows.filter((r) => r.status === "Confirming") };
}
