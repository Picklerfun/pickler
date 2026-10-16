import { parseArgs } from "node:util";
import { Pool } from "pg";
import { migrationPoolConfig } from "./migration-connection.js";
import { PerplLiveMigration } from "./perpl-live-migration.js";

const { values } = parseArgs({
  options: {
    agent: { type: "string" },
    action: { type: "string", default: "inspect" },
    execute: { type: "boolean", default: false },
  },
});
if (!values.agent || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(values.agent)) {
  throw new Error("--agent UUID is required");
}
const actions = ["inspect", "begin", "page", "cutover", "abort", "rollback"] as const;
const action = actions.find((candidate) => candidate === values.action);
if (!action) {
  throw new Error("Unknown action");
}
if (action !== "inspect" && !values.execute) {
  throw new Error("Mutation requires --execute; inspect is the default preflight");
}
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}
const pool = new Pool(migrationPoolConfig(url, process.env.DATABASE_MIGRATION_CA_CERT));
try {
  const migration = new PerplLiveMigration(pool);
  console.log(
    JSON.stringify({
      event: "perpl_live_storage",
      action,
      result: await migration[action](values.agent),
    }),
  );
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "PERPL_MIGRATION_FAILED";
  console.error(JSON.stringify({ event: "perpl_live_storage_failed", code }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
