import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import { connectionFailure, queryFailure } from "./evaluation-timing.js";

export interface PerpsLabFailureDiagnostic {
  version: 1;
  code: string;
  operation: "pool-idle" | "borrowed-client" | "pool-query" | "client-query" | "connect";
  at: number;
  driverCode: string | null;
  backendPid: number | null;
}

const connectionCodes = new Set([
  "57P01",
  "57P02",
  "57P03",
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

// Exact messages emitted by the installed pg client when its connection is unusable.
const connectionMessages = new Set([
  "Connection terminated",
  "Connection terminated unexpectedly",
  "Client has encountered a connection error and is not queryable",
  "Client was closed and is not queryable",
]);

function driverCode(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return null;
  }
  try {
    const code = Reflect.get(error, "code");
    return typeof code === "string" && (/^[A-Z0-9]{5}$/.test(code) || connectionCodes.has(code))
      ? code
      : null;
  } catch {
    return null;
  }
}

function isConnectionFailure(error: unknown): boolean {
  if (error instanceof PilotError) {
    return ["PERSISTENCE_CONNECTION_FAILED", "PERSISTENCE_CONNECTION_TIMEOUT"].includes(error.code);
  }
  if (error instanceof Error && connectionMessages.has(error.message)) {
    return true;
  }
  const code = driverCode(error);
  return code !== null && (code.startsWith("08") || connectionCodes.has(code));
}

function backendPid(client?: PoolClient): number | null {
  if (!client) {
    return null;
  }
  const pid: unknown = Reflect.get(client, "processID");
  return typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** A connection failure ends this local financial scope; it never retries a write. */
export function guardPerpsLabPool(
  pool: Pool,
  failed: (error: PilotError, diagnostic: PerpsLabFailureDiagnostic) => void = () => {},
): Pool {
  let failure: PilotError | undefined;
  const clients = new Map<PoolClient, () => void>();

  const fail = (
    operation: PerpsLabFailureDiagnostic["operation"],
    original?: unknown,
    client?: PoolClient,
  ) => {
    if (!failure) {
      const normalized = connectionFailure(original);
      failure =
        normalized instanceof PilotError && normalized.code === "PERSISTENCE_CONNECTION_TIMEOUT"
          ? normalized
          : new PilotError(
              "PERSISTENCE_CONNECTION_FAILED",
              "PostgreSQL connection closed unexpectedly; the local study must stop",
            );
      const diagnostic: PerpsLabFailureDiagnostic = {
        version: 1,
        code: failure.code,
        operation,
        at: Date.now(),
        driverCode: driverCode(original),
        backendPid: backendPid(client),
      };
      try {
        failed(failure, diagnostic);
      } catch {
        // An observer cannot undo the latch or throw from a driver's error event.
      }
    }
    return failure;
  };
  const assertConnected = () => {
    if (failure) {
      throw failure;
    }
  };
  const poolError = (error: unknown, client?: PoolClient) => {
    fail("pool-idle", error, client);
  };
  pool.on("error", poolError);

  const normalize = (
    error: unknown,
    operation: "connect" | "client-query" | "pool-query",
    client?: PoolClient,
  ): unknown => {
    if (failure) {
      return failure;
    }
    const normalized = connectionFailure(queryFailure(error));
    if (normalized instanceof PilotError && !isConnectionFailure(normalized)) {
      return normalized;
    }
    if (operation === "connect" || isConnectionFailure(normalized)) {
      return fail(operation, error, client);
    }
    return normalized;
  };

  function wrapClient(client: PoolClient): PoolClient {
    const onError = (error: unknown) => {
      fail("borrowed-client", error, client);
    };
    client.on("error", onError);
    const detach = () => {
      client.removeListener("error", onError);
      clients.delete(client);
    };
    clients.set(client, detach);
    return new Proxy(client, {
      get(object, property) {
        if (property === "release") {
          return (error?: Error | boolean) => {
            if (failure) {
              client.once("end", detach);
              client.release(true);
            } else {
              client.release(error);
              detach();
            }
          };
        }
        if (property === "query") {
          return async (...args: unknown[]) => {
            assertConnected();
            try {
              const result = await Reflect.apply(object.query, object, args);
              assertConnected();
              return result;
            } catch (error) {
              throw normalize(error, "client-query", client);
            }
          };
        }
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  }

  return new Proxy(pool, {
    get(object, property) {
      if (property === "connect") {
        return async () => {
          assertConnected();
          let client: PoolClient;
          try {
            client = await object.connect();
          } catch (error) {
            throw normalize(error, "connect");
          }
          const guarded = wrapClient(client);
          if (failure) {
            guarded.release(true);
            throw failure;
          }
          return guarded;
        };
      }
      if (property === "query") {
        return async (...args: unknown[]) => {
          assertConnected();
          try {
            const result = await Reflect.apply(object.query, object, args);
            assertConnected();
            return result;
          } catch (error) {
            throw normalize(error, "pool-query");
          }
        };
      }
      if (property === "end") {
        return async () => {
          try {
            await object.end();
          } finally {
            pool.removeListener("error", poolError);
            for (const detach of clients.values()) {
              detach();
            }
          }
        };
      }
      const value = Reflect.get(object, property, object);
      return typeof value === "function" ? value.bind(object) : value;
    },
  });
}
