import { sql } from "drizzle-orm";
import { check, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import { pickler } from "../schema.js";
import { productAgents } from "../console-schema.js";

/** Private durable real-venue state; never mixed with the paper ledger or Supabase Data API. */
export const perplLiveAccounts = pickler
  .table(
    "perpl_live_accounts",
    {
      productAgentId: uuid("product_agent_id")
        .primaryKey()
        .references(() => productAgents.productAgentId),
      document: jsonb("document").notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("perpl_live_document_version", sql`${t.document}->>'version' = '1'`)],
  )
  .enableRLS();
