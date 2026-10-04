import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { pickler, agents } from "../schema.js";
import { perpsChecks } from "./perps-checks.js";

export const perpsCheckReservations = pickler
  .table(
    "perps_check_reservations",
    {
      checkId: uuid("check_id")
        .primaryKey()
        .references(() => perpsChecks.id),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      configVersion: integer("config_version").notNull(),
      day: text("day").notNull(),
      strategy: jsonb("strategy").notNull(),
      policy: jsonb("policy").notNull(),
      reservedMicros: numeric("reserved_micros", { precision: 30, scale: 0 }).notNull(),
      accountedMicros: numeric("accounted_micros", { precision: 30, scale: 0 }).notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [agents.tenantId, agents.id],
      }),
      index("perps_check_reservations_day").on(t.tenantId, t.agentId, t.day),
      check("perps_check_reservations_status", sql`${t.status} in ('active','closed','unknown')`),
      check(
        "perps_check_reservations_amounts",
        sql`${t.reservedMicros} >= 0 AND ${t.accountedMicros} >= 0 AND ${t.accountedMicros} <= ${t.reservedMicros}`,
      ),
    ],
  )
  .enableRLS();
export const perpsCheckCalls = pickler
  .table(
    "perps_check_calls",
    {
      checkId: uuid("check_id")
        .notNull()
        .references(() => perpsCheckReservations.checkId),
      key: text("key").notNull(),
      plan: jsonb("plan").notNull(),
      status: text("status").notNull(),
      reservedMicros: numeric("reserved_micros", { precision: 30, scale: 0 }).notNull(),
      costMicros: numeric("cost_micros", { precision: 30, scale: 0 }),
      requestSha256: text("request_sha256"),
      requestBytes: integer("request_bytes"),
      inputTokens: integer("input_tokens"),
      outputTokens: integer("output_tokens"),
      startedAt: bigint("started_at", { mode: "number" }),
      finishedAt: bigint("finished_at", { mode: "number" }),
    },
    (t) => [
      uniqueIndex("perps_check_calls_identity").on(t.checkId, t.key),
      check(
        "perps_check_calls_status",
        sql`${t.status} in ('reserved','started','completed','unknown','skipped')`,
      ),
      check(
        "perps_check_calls_amounts",
        sql`${t.reservedMicros} >= 0 AND (${t.costMicros} IS NULL OR (${t.costMicros} >= 0 AND ${t.costMicros} <= ${t.reservedMicros}))`,
      ),
    ],
  )
  .enableRLS();
export const perpsCheckEvidence = pickler
  .table(
    "perps_check_evidence",
    {
      checkId: uuid("check_id")
        .notNull()
        .references(() => perpsCheckReservations.checkId),
      key: text("key").notNull(),
      sha256: text("sha256").notNull(),
      document: jsonb("document").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
    },
    (t) => [uniqueIndex("perps_check_evidence_identity").on(t.checkId, t.key)],
  )
  .enableRLS();
