import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Pool } from "pg";
import { migrationsFolder } from "./migrate-database.js";

/** Read-only journal audit. Never infer applied SQL from its filename or high-water timestamp. */
export async function migrationStatus(pool: Pool, folder = migrationsFolder) {
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const journal = JSON.parse(await readFile(join(folder, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const exists = await client.query(
      "SELECT to_regclass('pickler_migrations.__drizzle_migrations') IS NOT NULL AS present",
    );
    const applied = exists.rows[0].present
      ? (
          await client.query<{ hash: string; created_at: string }>(
            "SELECT hash, created_at::text FROM pickler_migrations.__drizzle_migrations",
          )
        ).rows
      : [];
    const matches = (row: { hash: string; created_at: string }, index: number) =>
      row.hash === migrations[index]!.hash &&
      Number(row.created_at) === migrations[index]!.folderMillis;
    const report = {
      applied: applied.length,
      pending: migrations.flatMap((_, index) =>
        applied.some((row) => matches(row, index)) ? [] : [journal.entries[index]!.tag],
      ),
      unknown: applied.filter((row) => !migrations.some((_, index) => matches(row, index))).length,
    };
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
