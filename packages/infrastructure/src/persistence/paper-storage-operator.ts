import { Pool } from "pg";
import { migrationPoolConfig } from "./migration-connection.js";
import { migratePaperAccount } from "./paper-storage-migration.js";

// Explicit operator command: preflight is the default; --apply advances one bounded transaction.
const [accountId, mode, ...extra] = process.argv.slice(2);
if (!accountId || (mode !== undefined && mode !== "--apply") || extra.length) {
  throw new Error("Usage: paper-storage-operator.ts <account-id> [--apply]");
}
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}
const pool = new Pool(migrationPoolConfig(url, process.env.DATABASE_MIGRATION_CA_CERT));
try {
  console.log(JSON.stringify(await migratePaperAccount(pool, accountId, mode === "--apply")));
} finally {
  await pool.end();
}
