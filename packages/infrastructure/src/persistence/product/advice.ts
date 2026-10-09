import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { pickler, agents as runtimeAgents } from "../schema.js";
import { productAgents } from "../console-schema.js";
import { foreignKey } from "drizzle-orm/pg-core";
import type { AdvicePolicy, AgentConfig } from "@pickler/core";
export const adviceJobs = pickler
  .table(
    "advice_jobs",
    {
      id: uuid("id").primaryKey(),
      publicAgentId: uuid("public_agent_id")
        .notNull()
        .references(() => productAgents.productAgentId),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      userId: uuid("user_id").notNull(),
      requestKey: text("request_key").notNull(),
      symbol: text("symbol").notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      startedAt: bigint("started_at", { mode: "number" }),
      finishedAt: bigint("finished_at", { mode: "number" }),
      configVersion: integer("config_version").notNull(),
      config: jsonb("config").$type<AgentConfig>().notNull(),
      policy: jsonb("policy").$type<AdvicePolicy>().notNull(),
      result: jsonb("result"),
      error: text("error"),
      leaseOwner: uuid("lease_owner"),
      leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [runtimeAgents.tenantId, runtimeAgents.id],
      }),
      uniqueIndex("advice_request_identity").on(t.userId, t.publicAgentId, t.requestKey),
      uniqueIndex("advice_user_active")
        .on(t.userId)
        .where(sql`${t.status} in ('queued','running')`),
      uniqueIndex("advice_agent_active")
        .on(t.tenantId, t.agentId)
        .where(sql`${t.status} in ('queued','running')`),
      index("advice_pending")
        .on(t.createdAt)
        .where(sql`${t.status} = 'queued'`),
      index("advice_history")
        .on(t.publicAgentId, t.createdAt.desc(), t.id.desc())
        .where(sql`${t.status} = 'completed'`),
      check("advice_symbol", sql`${t.symbol} in ('BTC','ETH')`),
      check("advice_status", sql`${t.status} in ('queued','running','completed','failed')`),
      check("advice_completion", sql`(${t.status} = 'completed') = (${t.result} is not null)`),
      check(
        "advice_lease",
        sql`${t.status} <> 'running' OR (${t.leaseOwner} is not null AND ${t.leaseExpiresAt} is not null)`,
      ),
    ],
  )
  .enableRLS();
/** One x402 payment per (user, agent, idempotency key); settled before its job exists. */
export const advicePayments = pickler
  .table(
    "advice_payments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      jobId: uuid("job_id").references(() => adviceJobs.id),
      userId: uuid("user_id").notNull(),
      publicAgentId: uuid("public_agent_id")
        .notNull()
        .references(() => productAgents.productAgentId),
      requestKey: text("request_key").notNull(),
      payer: text("payer").notNull(),
      payTo: text("pay_to").notNull(),
      amountMicroAusd: bigint("amount_micro_ausd", { mode: "bigint" }).notNull(),
      nonce: text("nonce").notNull(),
      validBefore: timestamp("valid_before", { withTimezone: true }).notNull(),
      status: text("status").notNull(),
      txHash: text("tx_hash"),
      blockNumber: bigint("block_number", { mode: "bigint" }),
      error: text("error"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("advice_payments_nonce_key").on(t.nonce),
      uniqueIndex("advice_payments_tx_key").on(t.txHash),
      uniqueIndex("advice_payments_request_key").on(t.userId, t.publicAgentId, t.requestKey),
      check(
        "advice_payments_status",
        sql`${t.status} IN ('pending','settled','failed','refund_owed')`,
      ),
    ],
  )
  .enableRLS();
export const adviceCalls = pickler
  .table(
    "advice_calls",
    {
      jobId: uuid("job_id")
        .notNull()
        .references(() => adviceJobs.id),
      lane: text("lane").notNull(),
      model: text("model").notNull(),
      provider: text("provider").notNull(),
      status: text("status").notNull(),
      reservedMicros: numeric("reserved_micros", { precision: 30, scale: 0 }).notNull(),
      costMicros: numeric("cost_micros", { precision: 30, scale: 0 }),
      inputTokens: bigint("input_tokens", { mode: "number" }),
      outputTokens: bigint("output_tokens", { mode: "number" }),
      startedAt: bigint("started_at", { mode: "number" }),
      finishedAt: bigint("finished_at", { mode: "number" }),
      requestHash: text("request_hash"),
    },
    (t) => [
      primaryKey({ columns: [t.jobId, t.lane] }),
      check("advice_lane", sql`${t.lane} in ('jev','deepseek','web','web-fallback')`),
      check(
        "advice_call_status",
        sql`${t.status} in ('reserved','started','completed','released')`,
      ),
      check(
        "advice_amounts",
        sql`${t.reservedMicros} >= 0 AND (${t.costMicros} is null OR ${t.costMicros} >= 0)`,
      ),
    ],
  )
  .enableRLS();
export const adviceEvents = pickler
  .table(
    "advice_events",
    {
      jobId: uuid("job_id")
        .notNull()
        .references(() => adviceJobs.id),
      sequence: integer("sequence").notNull(),
      at: bigint("at", { mode: "number" }).notNull(),
      kind: text("kind").notNull(),
      data: jsonb("data").notNull(),
    },
    (t) => [primaryKey({ columns: [t.jobId, t.sequence] })],
  )
  .enableRLS();
