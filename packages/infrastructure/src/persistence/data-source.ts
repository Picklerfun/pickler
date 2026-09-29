import type { Pool, QueryResultRow } from "pg";
import { DataSourceUnavailableError } from "@pickler/core";

/**
 * One query whose failure reaches the caller as DataSourceUnavailableError (503), the contract
 * the product-data ports carried when they went through PostgREST. `source` names the table and
 * operation, never the SQL or its parameters.
 */
export async function readRows<T extends QueryResultRow>(
  pool: Pool,
  source: string,
  text: string,
  values: unknown[],
): Promise<T[]> {
  try {
    return (await pool.query<T>(text, values)).rows;
  } catch (cause) {
    throw new DataSourceUnavailableError(`postgres.${source}`, { cause });
  }
}
