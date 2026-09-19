import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Pool } from "pg";

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** Apply Drizzle SQL by identity, including older missing migrations from a merged branch.
 * Drizzle's timestamp-only high-water mark cannot reconcile the two published histories.
 * Keep original SQL hashes and timestamps; never adopt an untracked schema implicitly.
 */
export async function migrateDatabase(pool: Pool, folder = migrationsFolder): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(761204, 2)");
    // Check BEFORE the lease migration touches legacy active work.
    const lock = await client.query<{ available: boolean }>(
      "SELECT pg_try_advisory_xact_lock(761204, 1) AS available",
    );
    if (!lock.rows[0]?.available) {
      throw new Error("Stop legacy Pickler executors before migrating");
    }
    await client.query('CREATE SCHEMA IF NOT EXISTS "pickler_migrations"');
    await client.query(`CREATE TABLE IF NOT EXISTS "pickler_migrations"."__drizzle_migrations" (
      id serial PRIMARY KEY, hash text NOT NULL, created_at bigint
    )`);
    const applied = await client.query<{ hash: string; created_at: string }>(
      'SELECT hash, created_at FROM "pickler_migrations"."__drizzle_migrations"',
    );
    for (const row of applied.rows) {
      if (
        !migrations.some((m) => m.hash === row.hash && m.folderMillis === Number(row.created_at))
      ) {
        throw new Error(
          "Unrecognized migration history; use the matching checkout before upgrading",
        );
      }
    }
    const hashes = new Set(applied.rows.map((row) => row.hash));
    for (const migration of migrations) {
      if (hashes.has(migration.hash)) {
        continue;
      }
      for (const statement of migration.sql) {
        await client.query(statement);
      }
      await client.query(
        'INSERT INTO "pickler_migrations"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)',
        [migration.hash, migration.folderMillis],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
