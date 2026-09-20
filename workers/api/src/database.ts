import type { DatabaseConnectionOptions } from "@pickler/infrastructure";
import type { Env } from "./env";

/** Hosted requests require a trusted binding; direct URLs are local-only. */
export function apiDatabase(env: Env): { url: string; options: DatabaseConnectionOptions } {
  if (env.DATABASE) {
    return {
      url: env.DATABASE.connectionString,
      options: { environment: env.APP_ENV, transport: "hyperdrive" },
    };
  }
  if (env.APP_ENV !== "local") {
    throw new Error("API database binding unavailable");
  }
  if (!env.DATABASE_URL) {
    throw new Error("Missing local DATABASE_URL");
  }
  return { url: env.DATABASE_URL, options: { environment: "local" } };
}
