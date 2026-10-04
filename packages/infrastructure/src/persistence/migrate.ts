import { Pool } from "pg";
import { migrateDatabase } from "./migrate-database.js";
import { migrationPoolConfig } from "./migration-connection.js";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required (direct or session connection)");
}
const pool = new Pool(migrationPoolConfig(url, process.env.DATABASE_MIGRATION_CA_CERT));
try {
  await migrateDatabase(pool);
  console.log("Pickler migrations applied.");
} catch (error) {
  // Provider error text can contain connection details. Retain only a machine-readable code.
  const code =
    error && typeof error === "object" && "code" in error ? String(error.code) : "MIGRATION_FAILED";
  console.error(`Pickler migrations failed (${code}); no deployment may proceed.`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
