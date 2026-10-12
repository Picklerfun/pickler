import { PilotError } from "@pickler/core";
import { PostgresResearchStore } from "./research-store.js";
import { guardPerpsLabPool, type PerpsLabFailureDiagnostic } from "./perps-lab-pool.js";
import { observePerpsLabPool, type PerpsLabQueryDiagnostic } from "./perps-lab-query.js";

/** Partition the existing local five-connection capacity; hosted pools are unchanged. */
export function createLocalPerpsLabStore(
  connectionString: string,
  workload: "execution" | "report",
  observers: {
    query?: (value: PerpsLabQueryDiagnostic) => void;
    failed?: (error: PilotError, value: PerpsLabFailureDiagnostic) => void;
  } = {},
): PostgresResearchStore {
  if (workload !== "execution" && workload !== "report") {
    throw new PilotError("INVALID_INPUT", "Unknown local persistence workload");
  }
  return new PostgresResearchStore(
    connectionString,
    undefined,
    { environment: "local" },
    (pool) => {
      pool.options.max = workload === "execution" ? 4 : 1;
      if (workload === "report") {
        pool.options.options = "-c default_transaction_read_only=on";
      }
      const observed = observers.query ? observePerpsLabPool(pool, observers.query) : pool;
      return guardPerpsLabPool(observed, observers.failed);
    },
  );
}
