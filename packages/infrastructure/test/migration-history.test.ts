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

for (const history of [
  "fresh",
  "research",
  "product",
  "pre-settlement",
  "main-before-launch",
  "launch-branch",
  "main-before-custody",
  "custody-branch",
] as const) {
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
        history === "main-before-custody"
          ? entry.idx <= 16
          : history === "custody-branch"
            ? // The custody branch published 0017–0021 on top of 0011; later migrations (0027
              // alters a 0012 table) were never part of it.
              entry.idx <= 11 || (entry.idx >= 17 && entry.idx <= 21)
            : history === "main-before-launch"
              ? entry.idx <= 14
              : history === "launch-branch"
                ? entry.idx <= 9 || (entry.idx >= 15 && entry.idx <= 16)
                : history === "pre-settlement"
                  ? entry.idx <= 10
                  : history === "research"
                    ? entry.idx <= 4
                    : [0, 5, 6].includes(entry.idx),
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
      "pickler.perps_paper_accounts",
      "launch.drafts",
      "wallets.agent_wallets",
      "identity.siwe_nonces",
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
