import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/persistence/schema.ts",
    "./src/persistence/console-schema.ts",
    // Schema modules only: read models in this directory import compiled business ESM.
    "./src/persistence/product/identity.ts",
    "./src/persistence/product/agents.ts",
    "./src/persistence/product/wallets.ts",
    "./src/persistence/product/budget.ts",
    "./src/persistence/product/audit.ts",
    "./src/persistence/product/growth.ts",
    "./src/persistence/product/market.ts",
    "./src/persistence/product/launch.ts",
    "./src/persistence/product/advice.ts",
    "./src/persistence/product/ai-credits.ts",
    "./src/persistence/product/x-oauth.ts",
    "./src/persistence/product/perps-checks.ts",
    "./src/persistence/product/perps-check-costs.ts",
    "./src/persistence/product/perpl-live.ts",
  ],
  out: "./drizzle",
  // `auth` belongs to Supabase and `mastra` to Mastra: referenced, never migrated from here.
  schemaFilter: [
    "pickler",
    "identity",
    "agents",
    "budget",
    "audit",
    "growth",
    "market",
    "wallets",
    "launch",
    "billing",
  ],
  dbCredentials: { url: process.env.DATABASE_MIGRATION_URL ?? "" },
  strict: true,
});
