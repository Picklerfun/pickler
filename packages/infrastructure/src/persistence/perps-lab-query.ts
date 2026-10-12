import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import { connectionFailure, queryFailure } from "./evaluation-timing.js";

export interface PerpsLabQueryDiagnostic {
  version: 1;
  queryId: number;
  phase: "started" | "finished";
  operation: "connect" | "pool-query" | "client-query";
  statement: string;
  sqlHash: string | null;
  backendPid: number | null;
  at: number;
  durationMs: number | null;
  code: string | null;
  driverCode: string | null;
}
const failureCodes = new Set([
  "PERSISTENCE_QUERY_TIMEOUT",
  "PERSISTENCE_QUERY_CANCELLED",
  "PERSISTENCE_CONNECTION_TIMEOUT",
  "PERSISTENCE_CONNECTION_FAILED",
]);
const transportCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ERR_STREAM_PREMATURE_CLOSE",
]);
function driverCode(error: unknown): string | null {
  try {
    const code: unknown = error && typeof error === "object" ? Reflect.get(error, "code") : null;
    return typeof code === "string" && (/^[A-Z0-9]{5}$/.test(code) || transportCodes.has(code))
      ? code
      : null;
  } catch {
    return null;
  }
}
function backendPid(client?: PoolClient): number | null {
  if (!client) {
    return null;
  }
  const pid: unknown = Reflect.get(client, "processID");
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
function sqlIdentity(argument: unknown): Pick<PerpsLabQueryDiagnostic, "statement" | "sqlHash"> {
  let text: unknown;
  try {
    text =
      typeof argument === "string"
        ? argument
        : argument && typeof argument === "object"
          ? Reflect.get(argument, "text")
          : undefined;
  } catch {
    text = undefined;
  }
  if (typeof text !== "string") {
    return { statement: "OTHER", sqlHash: null };
  }
  return {
    statement:
      /^(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SET|WITH)\b/i
        .exec(text.trim())?.[1]
        ?.toUpperCase() ?? "OTHER",
    sqlHash: createHash("sha256").update(text).digest("hex"),
  };
}

/** Promise-based local pool observation. No SQL, values, results, driver text or retries. */
export function observePerpsLabPool(
  pool: Pool,
  diagnostic: (value: PerpsLabQueryDiagnostic) => void,
  clocks: { now: () => number; monotonic: () => number } = {
    now: () => Date.now(),
    monotonic: () => performance.now(),
  },
): Pool {
  let sequence = 0;
  const notify = (value: PerpsLabQueryDiagnostic) => {
    try {
      diagnostic({ ...value });
    } catch {
      // Observation must not change a query's result, primary failure or cleanup.
    }
  };
  async function observed<T>(
    operation: PerpsLabQueryDiagnostic["operation"],
    identity: Pick<PerpsLabQueryDiagnostic, "statement" | "sqlHash">,
    client: PoolClient | undefined,
    execute: () => Promise<T>,
    connected = false,
  ): Promise<T> {
    const started = clocks.monotonic();
    const base: PerpsLabQueryDiagnostic = {
      version: 1,
      queryId: ++sequence,
      phase: "started",
      operation,
      ...identity,
      backendPid: backendPid(client),
      at: clocks.now(),
      durationMs: null,
      code: null,
      driverCode: null,
    };
    notify(base);
    let code: string | null = null;
    let supplied: string | null = null;
    let resultClient = client;
    try {
      const result = await execute();
      if (connected) {
        resultClient = result as PoolClient;
      }
      return result;
    } catch (error) {
      supplied = driverCode(error);
      const failure = connectionFailure(queryFailure(error));
      code =
        failure instanceof PilotError && failureCodes.has(failure.code)
          ? failure.code
          : "PERSISTENCE_QUERY_FAILED";
      throw failure;
    } finally {
      notify({
        ...base,
        phase: "finished",
        at: clocks.now(),
        backendPid: backendPid(resultClient),
        durationMs: Math.max(0, clocks.monotonic() - started),
        code,
        driverCode: supplied,
      });
    }
  }
  function wrap<T extends Pool | PoolClient>(target: T): T {
    return new Proxy(target, {
      get(object, property) {
        if (property === "connect" && object === pool) {
          return async () =>
            wrap(
              await observed(
                "connect",
                { statement: "CONNECT", sqlHash: null },
                undefined,
                () => pool.connect(),
                true,
              ),
            );
        }
        if (property === "query") {
          return (...args: unknown[]) =>
            observed(
              object === pool ? "pool-query" : "client-query",
              sqlIdentity(args[0]),
              object === pool ? undefined : (object as PoolClient),
              () => Reflect.apply(object.query, object, args),
            );
        }
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  }
  return wrap(pool);
}
