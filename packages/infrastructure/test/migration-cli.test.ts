import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { migrationStatus } from "../src/persistence/migration-status.js";
import { createTestStore } from "./database.js";

test("the operator CLI is idempotent and preserves data on a real isolated database", async (t) => {
  const store = await createTestStore(t);
  await store.pool.query("INSERT INTO pickler.metadata(key,value) VALUES ('cli-preserved','keep')");
  const before = await store.pool.query(
    "SELECT hash FROM pickler_migrations.__drizzle_migrations ORDER BY hash",
  );
  const url = store.pool.options.connectionString!;
  const execute = promisify(execFile);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await execute(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL("../src/persistence/migrate.ts", import.meta.url))],
      {
        env: { ...process.env, DATABASE_MIGRATION_URL: url },
      },
    );
    assert.match(result.stdout, /Pickler migrations applied/);
    assert.equal(result.stderr, "");
    const report = JSON.parse(result.stdout.split("\n")[0]!);
    assert.equal(report.event, "pickler_migration_status");
    assert.deepEqual(report.after.pending, []);
    assert.equal(report.after.unknown, 0);
    assert.equal(report.after.applied, before.rows.length);
  }
  const after = await store.pool.query(
    "SELECT hash FROM pickler_migrations.__drizzle_migrations ORDER BY hash",
  );
  assert.deepEqual(after.rows, before.rows);
  assert.equal(
    (await store.pool.query("SELECT value FROM pickler.metadata WHERE key='cli-preserved'")).rows[0]
      .value,
    "keep",
  );
});

test("journal audit detects missing and mismatched migrations without changing history", async (t) => {
  const store = await createTestStore(t);
  const complete = await migrationStatus(store.pool);
  assert.deepEqual(complete.pending, []);
  assert.equal(complete.unknown, 0);

  await store.pool.query(
    "DELETE FROM pickler_migrations.__drizzle_migrations WHERE id = (SELECT max(id) FROM pickler_migrations.__drizzle_migrations)",
  );
  const before = (
    await store.pool.query("SELECT * FROM pickler_migrations.__drizzle_migrations ORDER BY id")
  ).rows;
  const missing = await migrationStatus(store.pool);
  assert.equal(missing.pending.length, 1);
  assert.match(missing.pending[0]!, /^\d{4}_/);
  assert.equal(missing.applied, complete.applied - 1);
  assert.equal(missing.unknown, 0);
  assert.deepEqual(
    (await store.pool.query("SELECT * FROM pickler_migrations.__drizzle_migrations ORDER BY id"))
      .rows,
    before,
  );

  await store.pool.query(
    "UPDATE pickler_migrations.__drizzle_migrations SET created_at = 1 WHERE id = (SELECT min(id) FROM pickler_migrations.__drizzle_migrations)",
  );
  const mismatched = await migrationStatus(store.pool);
  assert.equal(mismatched.unknown, 1);
  assert.equal(mismatched.pending.length, 2);
});
