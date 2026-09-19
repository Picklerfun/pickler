// Budget: per-agent spend limits. The AgentLedger Durable Object is the authority for live spend;
// these tables are its durable projection and history. Amounts are micro-USD (1 USD = 1_000_000).

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const budget = pgSchema("budget");

export const budgetCategory = budget.enum("category", ["infra", "tokens", "payments"]);
export const ledgerAction = budget.enum("ledger_action", [
  "reserve",
  "commit",
  "release",
  "record",
  "configure",
  "reset",
]);

export const budgets = budget
  .table(
    "budgets",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
      category: budgetCategory("category").notNull(),
      limitMicroUsd: bigint("limit_micro_usd", { mode: "bigint" }).notNull(),
      /** May exceed the limit after post-hoc telemetry; enforcement happens on reserve. */
      spentMicroUsd: bigint("spent_micro_usd", { mode: "bigint" })
        .notNull()
        .default(sql`0`),
      reservedMicroUsd: bigint("reserved_micro_usd", { mode: "bigint" })
        .notNull()
        .default(sql`0`),
      periodKey: text("period_key").notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.agentId, t.category] }),
      check("budgets_limit_positive", sql`${t.limitMicroUsd} >= 0`),
      check("budgets_spent_positive", sql`${t.spentMicroUsd} >= 0`),
      check("budgets_reserved_positive", sql`${t.reservedMicroUsd} >= 0`),
      check("budgets_period_key", sql`${t.periodKey} ~ '^\\d{4}-(0[1-9]|1[0-2])$'`),
    ],
  )
  .enableRLS();

export const ledgerEntries = budget
  .table(
    "ledger_entries",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "restrict" }),
      category: budgetCategory("category").notNull(),
      action: ledgerAction("action").notNull(),
      amountMicroUsd: bigint("amount_micro_usd", { mode: "bigint" }).notNull(),
      reservationId: text("reservation_id"),
      eventId: text("event_id"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("ledger_entries_agent_idx").on(t.agentId, t.createdAt.desc()),
      uniqueIndex("ledger_entries_reservation_action_key")
        .on(t.reservationId, t.action)
        .where(sql`${t.reservationId} is not null`),
      check("ledger_entries_amount_positive", sql`${t.amountMicroUsd} >= 0`),
    ],
  )
  .enableRLS();
