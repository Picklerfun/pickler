import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { jsonb, pgTable } from "drizzle-orm/pg-core";
import { sql, TransactionRollbackError } from "drizzle-orm";
import { databasePoolConfig } from "@pickler/infrastructure";

const payloadTable = pgTable("pickler_diagnostic_payload", { data: jsonb("data").notNull() });
const payload = Array.from({ length: 100 }, (_, id) => ({
  id,
  rules: "Complete resolution evidence é🟢".repeat(100),
}));

/** Explicit remote-preview diagnostic only. No providers, application rows or committed writes. */
const databaseProbe = {
  async fetch(_request: Request, env: { DATABASE: { connectionString: string } }) {
    const pool = new Pool(
      databasePoolConfig(env.DATABASE.connectionString, {
        environment: "staging",
        transport: "hyperdrive",
      }),
    );
    let preserved = false;
    try {
      const db = drizzle(pool);
      try {
        await db.transaction(async (tx) => {
          await tx.execute(
            sql`CREATE TEMP TABLE pickler_diagnostic_payload (data jsonb NOT NULL) ON COMMIT DROP`,
          );
          await tx.execute(sql`SELECT pg_advisory_xact_lock(761204, 98765)`);
          await tx.execute(sql`SELECT set_config('pickler.diagnostic', 'transaction-only', true)`);
          await tx.insert(payloadTable).values({ data: payload });
          const [saved] = await tx.select().from(payloadTable);
          const actual = saved?.data as typeof payload;
          preserved =
            actual.length === payload.length &&
            actual.every((row, i) => row.id === payload[i]!.id && row.rules === payload[i]!.rules);
          if (!preserved) {
            throw new Error("Payload mismatch");
          }
          tx.rollback();
        });
      } catch (error) {
        if (!(error instanceof TransactionRollbackError) || !preserved) {
          throw error;
        }
      }
      const result = await pool.query<{ removed: boolean; cleared: boolean }>(`
        SELECT to_regclass('pg_temp.pickler_diagnostic_payload') IS NULL AS removed,
          coalesce(current_setting('pickler.diagnostic', true), '') = '' AS cleared
      `);
      return Response.json({
        preserved,
        bytes: Buffer.byteLength(JSON.stringify(payload)),
        ...result.rows[0],
      });
    } catch {
      // Driver errors can contain SQL and credentials. Never return the raw exception.
      return Response.json({ error: "DATABASE_PROBE_FAILED" }, { status: 500 });
    } finally {
      await pool.end();
    }
  },
};

export default databaseProbe;
