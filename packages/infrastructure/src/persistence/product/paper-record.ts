import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, index, jsonb, primaryKey, text } from "drizzle-orm/pg-core";
import { pickler, perpsPaperAccounts } from "../schema.js";

export const paperRecordFacts = pickler
  .table(
    "paper_record_facts",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      key: text("key").notNull(),
      sequence: bigserial("sequence", { mode: "bigint" }).notNull(),
      at: bigint("at", { mode: "number" }).notNull(),
      kind: text("kind").notNull(),
      delta: text("delta").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.accountId, t.key] }),
      index("paper_record_sequence").on(t.accountId, t.sequence),
      index("paper_record_chronology").on(t.accountId, t.at, t.key),
    ],
  )
  .enableRLS();

export const paperRecordState = pickler
  .table("paper_record_state", {
    accountId: text("account_id")
      .primaryKey()
      .references(() => perpsPaperAccounts.id),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    document: jsonb("document").$type<Record<string, unknown>>().notNull(),
    complete: boolean("complete").notNull().default(false),
  })
  .enableRLS();

export const paperRecordCloses = pickler
  .table(
    "paper_record_closes",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      positionId: text("position_id").notNull(),
      pnl: text("pnl").notNull(),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.positionId] })],
  )
  .enableRLS();
