import type { Pool, PoolClient } from "pg";

export interface EvaluationDatabaseTiming {
  version: 1;
  cycle: string;
  operation: "database-query" | "database-transaction" | "database-connection";
  queryId: number;
  statement: string;
  at: number;
  durationMs: number;
  code: string | null;
}
/** Observational wrapper: no SQL, parameters, results, URLs or credentials enter diagnostics. */
export function timeEvaluationPool(
  pool: Pool,
  diagnostic: (value: EvaluationDatabaseTiming) => void,
  cycle: () => string,
  monotonic: () => number = () => performance.now(),
): Pool {
  let sequence = 0;
  function wrap<T extends Pool | PoolClient>(target: T): T {
    let transactionStart: number | undefined;
    return new Proxy(target, {
      get(object, property) {
        if (property === "connect" && object === pool) {
          return async () => {
            const started = monotonic();
            let code: string | null = null;
            try {
              return wrap(await pool.connect());
            } catch (error) {
              const supplied = (error as { code?: string }).code;
              code = supplied && /^[A-Z0-9_]{1,40}$/.test(supplied) ? supplied : "DATABASE_FAILED";
              throw error;
            } finally {
              diagnostic({
                version: 1,
                cycle: cycle(),
                operation: "database-connection",
                queryId: ++sequence,
                statement: "CONNECT",
                at: Date.now(),
                durationMs: monotonic() - started,
                code,
              });
            }
          };
        }
        if (property === "query") {
          return async (...args: unknown[]) => {
            const started = monotonic(),
              queryId = ++sequence;
            const text = typeof args[0] === "string" ? args[0] : "";
            const statement =
              /^(SELECT|INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK|SET)\b/i
                .exec(text.trim())?.[1]
                ?.toUpperCase() ?? "OTHER";
            if (statement === "BEGIN") {
              transactionStart = started;
            }
            let code: string | null = null;
            try {
              return await Reflect.apply(object.query, object, args);
            } catch (error) {
              const supplied = (error as { code?: string }).code;
              code = supplied && /^[A-Z0-9_]{1,40}$/.test(supplied) ? supplied : "DATABASE_FAILED";
              throw error;
            } finally {
              diagnostic({
                version: 1,
                cycle: cycle(),
                operation: "database-query",
                queryId,
                statement,
                at: Date.now(),
                durationMs: monotonic() - started,
                code,
              });
              if (["COMMIT", "ROLLBACK"].includes(statement) && transactionStart !== undefined) {
                diagnostic({
                  version: 1,
                  cycle: cycle(),
                  operation: "database-transaction",
                  queryId,
                  statement,
                  at: Date.now(),
                  durationMs: monotonic() - transactionStart,
                  code,
                });
                transactionStart = undefined;
              }
            }
          };
        }
        const value = Reflect.get(object, property, object);
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
  }
  return wrap(pool);
}
