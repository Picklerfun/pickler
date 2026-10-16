import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  jsonb,
  numeric,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { pickler, perpsPaperAccounts } from "../schema.js";

/** Private migration/coverage control. Financial history is retained in its original tables. */
export const paperStorage = pickler
  .table(
    "paper_storage",
    {
      accountId: text("account_id")
        .primaryKey()
        .references(() => perpsPaperAccounts.id),
      mode: text("mode").notNull().default("legacy"),
      revision: bigint("revision", { mode: "number" }).notNull().default(0),
      phase: text("phase").notNull().default("positions"),
      auditAt: bigint("audit_at", { mode: "number" }).notNull().default(0),
      exitAt: bigint("exit_at", { mode: "number" }).notNull().default(0),
      cursor: text("cursor"),
      original: jsonb("original"),
      coverageRequired: bigint("coverage_required", { mode: "number" }).notNull().default(0),
      coverageComplete: bigint("coverage_complete", { mode: "number" }).notNull().default(0),
    },
    (t) => [check("paper_storage_mode", sql`${t.mode} IN ('legacy','frozen','operational')`)],
  )
  .enableRLS();

export const paperFundingEpochs = pickler
  .table(
    "paper_funding_epochs",
    {
      id: uuid("id").primaryKey(),
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      status: text("status").notNull().default("pending"),
      cutoffAt: bigint("cutoff_at", { mode: "number" }).notNull(),
      anchor: jsonb("anchor")
        .$type<{ number: number; hash: string; timestamp: number }>()
        .notNull(),
      maxSequence: bigint("max_sequence", { mode: "number" }).notNull(),
      cursor: bigint("cursor", { mode: "number" }).notNull().default(0),
      eventCursor: bigint("event_cursor", { mode: "number" }),
      owner: uuid("owner"),
      expiresAt: bigint("expires_at", { mode: "number" }),
      delta: numeric("delta", { precision: 38, scale: 18 }).notNull().default("0"),
      committedAt: bigint("committed_at", { mode: "number" }),
      error: text("error"),
    },
    (t) => [
      index("paper_funding_epoch_account").on(t.accountId, t.cutoffAt),
      check(
        "paper_funding_epoch_status",
        sql`${t.status} IN ('pending','running','committed','disputed')`,
      ),
    ],
  )
  .enableRLS();

export const paperFundingPostings = pickler
  .table(
    "paper_funding_postings",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      key: text("key").notNull(),
      epochId: uuid("epoch_id")
        .notNull()
        .references(() => paperFundingEpochs.id),
      delta: numeric("delta", { precision: 38, scale: 18 }).notNull(),
      document: jsonb("document").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.accountId, t.key] }),
      index("paper_funding_postings_epoch").on(t.epochId),
      index("paper_funding_postings_history").on(t.accountId, t.epochId, t.key),
    ],
  )
  .enableRLS();

/** Exact existing position P&L presentation, independent of historical row count. */
export const paperPositionTotals = pickler
  .table(
    "paper_position_totals",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      positionId: text("position_id").notNull(),
      sizeupMargin: numeric("sizeup_margin", { precision: 38, scale: 18 }).notNull().default("0"),
      pnl: numeric("pnl", { precision: 38, scale: 18 }).notNull().default("0"),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.positionId] })],
  )
  .enableRLS();

/** Exact UTC booking/day admission counters, maintained in the financial transaction. */
export const paperDailyTotals = pickler
  .table(
    "paper_daily_totals",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      day: bigint("day", { mode: "number" }).notNull(),
      realized: numeric("realized", { precision: 38, scale: 18 }).notNull().default("0"),
      margin: numeric("margin", { precision: 38, scale: 18 }).notNull().default("0"),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.day] })],
  )
  .enableRLS();

/** Size-up history is immutable and never part of an execution position document. */
export const paperPositionSizeups = pickler
  .table(
    "paper_position_sizeups",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      positionId: text("position_id").notNull(),
      key: text("key").notNull(),
      sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
      at: bigint("at", { mode: "number" }).notNull(),
      margin: numeric("margin", { precision: 38, scale: 18 }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.accountId, t.positionId, t.key] }),
      index("paper_sizeup_history_sequence").on(t.accountId, t.sequence),
    ],
  )
  .enableRLS();
