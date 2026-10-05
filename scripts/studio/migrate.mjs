import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { migrateDatabase } from "@pickler/infrastructure/migrations";
import {
  assertControlledDatabase,
  assertControlledDatabaseUrl,
} from "@pickler/infrastructure/testing/controlled-worker";

const directory = process.argv[2];
const status = JSON.parse(await readFile(join(directory, "status.json"), "utf8"));
const { identity } = JSON.parse(await readFile(join(directory, "controlled-stack.json"), "utf8"));
assertControlledDatabaseUrl(status.DB_URL);
const pool = new Pool({ connectionString: status.DB_URL, max: 1 });
try {
  await assertControlledDatabase(pool, identity);
  await migrateDatabase(pool);
  console.log("Existing migrations applied to the marked disposable Studio database");
} finally {
  await pool.end();
}
