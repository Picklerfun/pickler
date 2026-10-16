import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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
      storageMode: text("storage_mode").notNull().default("legacy"),
      operational: jsonb("operational"),
      revision: bigint("revision", { mode: "number" }).notNull().default(0),
      writerFence: integer("writer_fence").notNull().default(1),
      nextDue: bigint("next_due", { mode: "number" }),
      wakeGeneration: bigint("wake_generation", { mode: "number" }).notNull().default(0),
      wakeOwner: text("wake_owner"),
      wakeExpiresAt: bigint("wake_expires_at", { mode: "number" }),
      wakePublishedGeneration: bigint("wake_published_generation", { mode: "number" })
        .notNull()
        .default(0),
      normalization: jsonb("normalization"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check("perpl_live_document_version", sql`${t.document}->>'version' = '1'`),
      check("perpl_live_storage_mode", sql`${t.storageMode} in ('legacy','converting','split')`),
      index("perpl_live_due").on(t.nextDue, t.productAgentId),
    ],
  )
  .enableRLS();

export const perplLiveSessions = pickler
  .table(
    "perpl_live_sessions",
    {
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => perplLiveAccounts.productAgentId),
      id: text("id").notNull(),
      sequence: bigserial("sequence", { mode: "number" }).notNull(),
      requestKey: text("request_key").notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      marginMicros: text("margin_micros").notNull(),
      orderCount: bigint("order_count", { mode: "number" }).notNull().default(0),
      netFilled: bigint("net_filled", { mode: "number" }).notNull().default(0),
      openingRequestId: bigint("opening_request_id", { mode: "number" }).notNull().default(0),
      openingLeverage: integer("opening_leverage"),
      document: jsonb("document").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.productAgentId, t.id] }),
      uniqueIndex("perpl_live_session_key").on(t.productAgentId, t.requestKey),
      index("perpl_live_session_history").on(t.productAgentId, t.sequence),
      index("perpl_live_session_status").on(t.productAgentId, t.status, t.sequence),
    ],
  )
  .enableRLS();

export const perplLiveOrders = pickler
  .table(
    "perpl_live_orders",
    {
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => perplLiveAccounts.productAgentId),
      id: text("id").notNull(),
      sequence: bigserial("sequence", { mode: "number" }).notNull(),
      sessionId: text("session_id").notNull(),
      requestId: bigint("request_id", { mode: "number" }).notNull(),
      orderType: integer("order_type").notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      filledSize: bigint("filled_size", { mode: "number" }).notNull().default(0),
      leverage: integer("leverage").notNull(),
      document: jsonb("document").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.productAgentId, t.id] }),
      uniqueIndex("perpl_live_order_request").on(t.productAgentId, t.requestId),
      index("perpl_live_order_session").on(t.productAgentId, t.sessionId, t.sequence),
      index("perpl_live_order_status").on(t.productAgentId, t.status, t.sequence),
      index("perpl_live_order_history").on(t.productAgentId, t.sequence),
      index("perpl_live_order_day").on(t.productAgentId, t.createdAt),
    ],
  )
  .enableRLS();

export const perplLiveSetup = pickler
  .table(
    "perpl_live_setup",
    {
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => perplLiveAccounts.productAgentId),
      id: text("id").notNull(),
      sequence: bigserial("sequence", { mode: "number" }).notNull(),
      requestKey: text("request_key").notNull(),
      kind: text("kind").notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      amountMicros: text("amount_micros").notNull(),
      document: jsonb("document").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.productAgentId, t.id] }),
      uniqueIndex("perpl_live_setup_key").on(t.productAgentId, t.requestKey),
      index("perpl_live_setup_status").on(t.productAgentId, t.status, t.sequence),
      index("perpl_live_setup_history").on(t.productAgentId, t.sequence),
      index("perpl_live_setup_day").on(t.productAgentId, t.createdAt),
    ],
  )
  .enableRLS();
