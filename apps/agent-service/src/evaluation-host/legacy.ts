/** Historical reports remain accessible; new evaluation execution has exactly one front door. */
export function assertLegacyRead(command: string | undefined, allowed: readonly string[]) {
  if (!command || !allowed.includes(command)) {
    throw new Error(
      "EVALUATION_ENTRY_RETIRED: use npm run evaluate -- --config FILE COMMAND; legacy entry points are historical-read/reconciliation only",
    );
  }
}
