import { Pool } from "pg";
import { migrateDatabase } from "./migrate-database.js";

const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required (direct or session connection)");
}
const pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 10_000 });
try {
  await migrateDatabase(pool);
  console.log("Pickler migrations applied.");
} finally {
  await pool.end();
}
