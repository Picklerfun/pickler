import type { DatabaseConnectionOptions } from "@pickler/infrastructure";
import type { Env } from "./index.js";

/** Queue and Cron use the same trusted binding; never fall back to a hosted secret. */
export function researchDatabase(env: Env): { url: string; options: DatabaseConnectionOptions } {
  if (env.DATABASE) {
    return {
      url: env.DATABASE.connectionString,
      options: { environment: env.APP_ENV, transport: "hyperdrive" },
    };
  }
  if (env.APP_ENV !== "local") {
    throw new Error("Research database binding unavailable");
  }
  return { url: env.DATABASE_URL, options: { environment: "local" } };
}
