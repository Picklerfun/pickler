import { PilotError } from "@pickler/core";

/** v10 has independent discovery, native reservation and financial commit boundaries. */
export function rejectLegacyBreakout(record: unknown) {
  const value = record as { config?: { version?: unknown }; version?: unknown } | undefined;
  if (value?.config?.version === 10 || value?.version === 10 || value?.version === "10") {
    throw new PilotError(
      "VERSIONED_STORE_REQUIRED",
      "Hourly breakout records require their versioned persistence boundary",
    );
  }
}
