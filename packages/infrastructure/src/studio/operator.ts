import { PostgresStudioAccessRequests } from "./access-requests.js";
import { migrationPoolConfig } from "../persistence/migration-connection.js";
import { Pool } from "pg";

// Explicit operator command only. Never imported by a Worker or called during startup.
const [userId, state] = process.argv.slice(2);
if (
  userId !== "requests" &&
  (!userId || !/^[0-9a-f-]{36}$/i.test(userId) || !["enable", "disable"].includes(state ?? ""))
) {
  throw new Error("Usage: research-access requests | <user UUID> enable|disable");
}
const connectionString = process.env.DATABASE_MIGRATION_URL;
if (!connectionString) {
  throw new Error("DATABASE_MIGRATION_URL is required");
}
const pool = new Pool(
  migrationPoolConfig(connectionString, process.env.DATABASE_MIGRATION_CA_CERT),
);
try {
  if (userId === "requests") {
    console.log(JSON.stringify(await new PostgresStudioAccessRequests(pool).pending()));
  } else {
    const result = await pool.query(
      `UPDATE pickler.research_access SET enabled=$2,updated_at=clock_timestamp()
    WHERE user_id=$1 RETURNING user_id`,
      [userId, state === "enable"],
    );
    if (!result.rows.length) {
      throw new Error("User must complete onboarding before enabling research");
    }
    console.log(`Research ${state}d for ${userId}`);
  }
} finally {
  await pool.end();
}
