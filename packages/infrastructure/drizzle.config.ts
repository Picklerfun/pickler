import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/persistence/schema.ts", "./src/persistence/product/*.ts"],
  out: "./drizzle",
  // `auth` belongs to Supabase and `mastra` to Mastra: referenced, never migrated from here.
  schemaFilter: ["pickler", "identity", "agents", "budget", "audit", "growth", "market"],
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
  strict: true,
});
