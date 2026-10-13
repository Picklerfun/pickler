import { PilotError } from "@pickler/core";
import { PostgresResearchStore } from "./research-store.js";
import { guardPerpsLabPool, type PerpsLabFailureDiagnostic } from "./perps-lab-pool.js";
import { observePerpsLabPool, type PerpsLabQueryDiagnostic } from "./perps-lab-query.js";
import type { PoolClient } from "pg";
import {
  observeLocalPerpsConnections,
  type PerpsLabConnectionDiagnostic,
} from "./perps-lab-connection.js";

const workloads = new WeakMap<PostgresResearchStore, "execution" | "report">();

export interface PerpsLabConnectionReadiness {
  version: 1;
  workload: "execution";
  readyConnections: 4;
  limit: 4;
  observedAt: number;
  durationMs: number;
}

/** Partition the existing local five-connection capacity; hosted pools are unchanged. */
export function createLocalPerpsLabStore(
  connectionString: string,
  workload: "execution" | "report",
  observers: {
    query?: (value: PerpsLabQueryDiagnostic) => void;
    connection?: (value: PerpsLabConnectionDiagnostic) => void;
    failed?: (error: PilotError, value: PerpsLabFailureDiagnostic) => void;
  } = {},
): PostgresResearchStore {
  if (workload !== "execution" && workload !== "report") {
    throw new PilotError("INVALID_INPUT", "Unknown local persistence workload");
  }
  const store = new PostgresResearchStore(
    connectionString,
    undefined,
    { environment: "local" },
    (pool) => {
      pool.options.max = workload === "execution" ? 4 : 1;
      if (observers.connection) {
        observeLocalPerpsConnections(pool, workload, observers.connection);
      }
      if (workload === "execution") {
        // Retain the already allocated capacity across minute-long observation gaps.
        pool.options.min = 4;
      }
      if (workload === "report") {
        pool.options.options = "-c default_transaction_read_only=on";
      }
      const observed = observers.query ? observePerpsLabPool(pool, observers.query) : pool;
      return guardPerpsLabPool(observed, observers.failed);
    },
  );
  workloads.set(store, workload);
  return store;
}

/** Read-only readiness before study claim; never retries or performs financial recovery. */
export async function warmLocalPerpsLabStore(
  store: PostgresResearchStore,
  signal?: AbortSignal,
): Promise<PerpsLabConnectionReadiness> {
  if (
    workloads.get(store) !== "execution" ||
    store.pool.options.max !== 4 ||
    store.pool.options.min !== 4
  ) {
    throw new PilotError(
      "INVALID_INPUT",
      "Connection readiness is restricted to local PTS execution",
    );
  }
  signal?.throwIfAborted();
  const started = performance.now();
  const acquired = await Promise.allSettled(Array.from({ length: 4 }, () => store.pool.connect()));
  const clients: PoolClient[] = [];
  let discard = true;
  try {
    for (const result of acquired) {
      if (result.status === "fulfilled") {
        clients.push(result.value);
      }
    }
    const rejected = acquired.find((result) => result.status === "rejected");
    if (rejected?.status === "rejected") {
      throw rejected.reason;
    }
    signal?.throwIfAborted();
    const checked = await Promise.allSettled(
      clients.map(async (client) => {
        try {
          await client.query("BEGIN READ ONLY");
          signal?.throwIfAborted();
          const readonly = await client.query("SHOW transaction_read_only");
          const ready = await client.query("SELECT 1 AS ready");
          if (readonly.rows[0]?.transaction_read_only !== "on" || ready.rows[0]?.ready !== 1) {
            throw new PilotError(
              "PERSISTENCE_CONNECTION_FAILED",
              "Local connection readiness was not verified",
            );
          }
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        }
      }),
    );
    const failed = checked.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      throw failed.reason;
    }
    signal?.throwIfAborted();
    discard = false;
    return {
      version: 1,
      workload: "execution",
      readyConnections: 4,
      limit: 4,
      observedAt: Date.now(),
      durationMs: performance.now() - started,
    };
  } finally {
    for (const client of clients) {
      client.release(discard);
    }
  }
}
