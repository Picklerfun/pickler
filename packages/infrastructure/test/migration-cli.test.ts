import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
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
