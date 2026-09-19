import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, copyFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { migrateDatabase, migrationsFolder } from "../src/persistence/migrate-database.js";

for (const history of ["fresh", "research", "product"] as const) {
  test(`merged migration history upgrades ${history} without losing data`, async (t) => {
    const url = new URL(
      process.env.TEST_DATABASE_URL ??
        "postgresql://pickler:pickler_local_only@127.0.0.1:55432/pickler",
    );
    const admin = new Pool({ connectionString: url.toString(), max: 1 });
    const name = `pickler_test_${randomUUID().replaceAll("-", "")}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    const pool = new Pool({ connectionString: url.toString(), max: 2 });
    const folder = await mkdtemp(join(tmpdir(), "pickler-migration-"));
    t.after(async () => {
      await pool.end();
      await admin.query(`DROP DATABASE "${name}"`);
      await admin.end();
      await rm(folder, { recursive: true, force: true });
    });
    if (history !== "fresh") {
      const journal = JSON.parse(
        await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8"),
      );
      journal.entries = journal.entries.filter((entry: { idx: number }) =>
        history === "research" ? entry.idx <= 4 : [0, 5, 6].includes(entry.idx),
      );
      await mkdir(join(folder, "meta"));
      await writeFile(join(folder, "meta/_journal.json"), JSON.stringify(journal));
      for (const entry of journal.entries) {
        await copyFile(
          join(migrationsFolder, `${entry.tag}.sql`),
          join(folder, `${entry.tag}.sql`),
        );
      }
      // Reproduce the original timestamp-based migrator and its published history.
      await migrate(drizzle(pool), {
        migrationsFolder: folder,
        migrationsSchema: "pickler_migrations",
      });
      await pool.query(`INSERT INTO pickler.metadata (key, value) VALUES ('preserved', 'Keep me')`);
    }
    await Promise.all([migrateDatabase(pool), migrateDatabase(pool)]);
    await migrateDatabase(pool);
    for (const table of [
      "pickler.execution_policy",
      "pickler.paper_orders",
      "identity.profiles",
      "growth.waitlist",
    ]) {
      const result = await pool.query("SELECT to_regclass($1) AS name", [table]);
      assert.ok(result.rows[0].name, table);
    }
    assert.equal(
      (await pool.query("SELECT count(*)::int AS n FROM pickler_migrations.__drizzle_migrations"))
        .rows[0].n,
      JSON.parse(await readFile(join(migrationsFolder, "meta/_journal.json"), "utf8")).entries
        .length,
    );
    if (history !== "fresh") {
      assert.equal(
        (await pool.query("SELECT value FROM pickler.metadata WHERE key = 'preserved'")).rows[0]
          .value,
        "Keep me",
      );
    }
    await pool.query(
      "INSERT INTO pickler_migrations.__drizzle_migrations (hash, created_at) VALUES ('unknown', 1)",
    );
    await assert.rejects(migrateDatabase(pool), /Unrecognized migration history/);
  });
}
