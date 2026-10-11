import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";

/** A connection failure ends this local financial scope; it never retries a write. */
export function guardPerpsLabPool(
  pool: Pool,
  failed: (error: PilotError) => void = () => {},
): Pool {
  let failure: PilotError | undefined;
  const clients = new Map<PoolClient, () => void>();

  const fail = () => {
    if (!failure) {
      failure = new PilotError(
        "PERSISTENCE_CONNECTION_FAILED",
        "PostgreSQL connection closed unexpectedly; the local study must stop",
      );
      failed(failure);
    }
    return failure;
  };
  const assertConnected = () => {
    if (failure) {
      throw failure;
    }
  };
  pool.on("error", fail);

  function wrapClient(client: PoolClient): PoolClient {
    const onError = () => {
      fail();
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
              throw failure ?? error;
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
          const client = await object.connect();
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
            throw failure ?? error;
          }
        };
      }
      if (property === "end") {
        return async () => {
          try {
            await object.end();
          } finally {
            pool.removeListener("error", fail);
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
