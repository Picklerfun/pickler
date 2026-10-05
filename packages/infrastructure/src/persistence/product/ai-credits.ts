import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./identity.js";
import { agents } from "./agents.js";
import { perpsChecks } from "./perps-checks.js";
import { perpsCheckCalls } from "./perps-check-costs.js";

export const billing = pgSchema("billing");
const amount = (name: string) => numeric(name, { precision: 30, scale: 0 });
const time = (name: string) => timestamp(name, { withTimezone: true }).notNull().defaultNow();

export const aiCreditAccounts = billing
  .table(
    "ai_credit_accounts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      balanceUnits: amount("balance_units").notNull().default("0"),
      reservedUnits: amount("reserved_units").notNull().default("0"),
      status: text("status").notNull().default("active"),
      version: integer("version").notNull().default(0),
      createdAt: time("created_at"),
      updatedAt: time("updated_at"),
    },
    (t) => [
      uniqueIndex("ai_credit_account_user").on(t.userId),
      check("ai_credit_account_status", sql`${t.status} in ('active','blocked')`),
      check(
        "ai_credit_account_projection",
        sql`${t.reservedUnits} >= 0 AND ${t.version} >= 0 AND (${t.balanceUnits} >= 0 OR ${t.status} = 'blocked')`,
      ),
    ],
  )
  .enableRLS();

export const aiCreditPricingVersions = billing
  .table(
    "ai_credit_pricing_versions",
    {
      id: uuid("id").primaryKey(),
      version: text("version").notNull(),
      reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull(),
      rates: jsonb("rates").notNull(),
      createdAt: time("created_at"),
    },
    (t) => [uniqueIndex("ai_credit_pricing_version").on(t.version)],
  )
  .enableRLS();

export const aiCreditPurchases = billing
  .table(
    "ai_credit_purchases",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      accountId: uuid("account_id")
        .notNull()
        .references(() => aiCreditAccounts.id),
      requestKey: text("request_key").notNull(),
      requestSha256: text("request_sha256").notNull(),
      creditUnits: amount("credit_units").notNull(),
      paymentAmount: amount("payment_amount").notNull(),
      paymentUnit: text("payment_unit").notNull(),
      paymentScale: integer("payment_scale").notNull(),
      paymentMethod: text("payment_method").notNull(),
      quoteVersion: text("quote_version").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      status: text("status").notNull().default("pending"),
      createdAt: time("created_at"),
    },
    (t) => [
      uniqueIndex("ai_credit_purchase_request").on(t.accountId, t.requestKey),
      uniqueIndex("ai_credit_purchase_account").on(t.id, t.accountId),
      check(
        "ai_credit_purchase_status",
        sql`${t.status} in ('pending','confirmed','failed','expired','review_required')`,
      ),
      check(
        "ai_credit_purchase_amounts",
        sql`${t.creditUnits} > 0 AND ${t.paymentAmount} > 0 AND ${t.paymentScale} between 0 and 30`,
      ),
    ],
  )
  .enableRLS();

export const aiCreditPaymentEvents = billing
  .table(
    "ai_credit_payment_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      purchaseId: uuid("purchase_id").notNull(),
      accountId: uuid("account_id").notNull(),
      provider: text("provider").notNull(),
      eventId: text("event_id").notNull(),
      paymentId: text("payment_id").notNull(),
      amount: amount("amount").notNull(),
      unit: text("unit").notNull(),
      scale: integer("scale").notNull(),
      recipient: text("recipient").notNull(),
      expectedRecipient: text("expected_recipient").notNull(),
      evidenceSha256: text("evidence_sha256").notNull(),
      proofSha256: text("proof_sha256").notNull(),
      verification: text("verification").notNull(),
      settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
      createdAt: time("created_at"),
    },
    (t) => [
      foreignKey({
        columns: [t.purchaseId, t.accountId],
        foreignColumns: [aiCreditPurchases.id, aiCreditPurchases.accountId],
      }),
      uniqueIndex("ai_credit_payment_event").on(t.provider, t.eventId),
      // paymentId includes chain/network and transfer-log identity for on-chain verifiers.
      uniqueIndex("ai_credit_payment_identity").on(t.provider, t.paymentId),
      check("ai_credit_payment_verification", sql`${t.verification} in ('verified','rejected')`),
      check("ai_credit_payment_amount", sql`${t.amount} >= 0 AND ${t.scale} between 0 and 30`),
    ],
  )
  .enableRLS();

export const aiCreditOperations = billing
  .table(
    "ai_credit_operations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      accountId: uuid("account_id")
        .notNull()
        .references(() => aiCreditAccounts.id),
      checkId: uuid("check_id")
        .notNull()
        .references(() => perpsChecks.id),
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => agents.id),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
      runtimeAgentId: text("runtime_agent_id").notNull(),
      configVersion: integer("config_version").notNull(),
      leaseOwner: uuid("lease_owner").notNull(),
      pricingId: uuid("pricing_id")
        .notNull()
        .references(() => aiCreditPricingVersions.id),
      maximumUnits: amount("maximum_units").notNull(),
      chargedUnits: amount("charged_units").notNull().default("0"),
      status: text("status").notNull().default("active"),
      admittedDay: text("admitted_day").notNull(),
      limitVersion: integer("limit_version").notNull(),
      dailyLimitUnits: amount("daily_limit_units"),
      createdAt: time("created_at"),
      finishedAt: timestamp("finished_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("ai_credit_operation_check").on(t.checkId),
      uniqueIndex("ai_credit_operation_account").on(t.id, t.accountId),
      uniqueIndex("ai_credit_operation_call_parent").on(t.id, t.checkId),
      index("ai_credit_operation_agent_day").on(t.accountId, t.productAgentId, t.admittedDay),
      check("ai_credit_operation_status", sql`${t.status} in ('active','settled','released')`),
      check(
        "ai_credit_operation_amount",
        sql`${t.maximumUnits} >= 0 AND ${t.chargedUnits} >= 0 AND ${t.chargedUnits} <= ${t.maximumUnits}`,
      ),
      check(
        "ai_credit_operation_terminal",
        sql`(${t.status} = 'active') = (${t.finishedAt} is null) AND (${t.status} <> 'released' OR ${t.chargedUnits} = 0)`,
      ),
    ],
  )
  .enableRLS();

export const aiCreditCallAllocations = billing
  .table(
    "ai_credit_call_allocations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      operationId: uuid("operation_id").notNull(),
      checkId: uuid("check_id").notNull(),
      callKey: text("call_key").notNull(),
      provider: text("provider").notNull(),
      model: text("model").notNull(),
      rate: jsonb("rate").notNull(),
      maximumUnits: amount("maximum_units").notNull(),
      chargedUnits: amount("charged_units"),
      requestSha256: text("request_sha256"),
      status: text("status").notNull().default("reserved"),
      startedAt: timestamp("started_at", { withTimezone: true }),
    },
    (t) => [
      foreignKey({
        columns: [t.operationId, t.checkId],
        foreignColumns: [aiCreditOperations.id, aiCreditOperations.checkId],
      }),
      foreignKey({
        columns: [t.checkId, t.callKey],
        foreignColumns: [perpsCheckCalls.checkId, perpsCheckCalls.key],
      }),
      uniqueIndex("ai_credit_call_identity").on(t.checkId, t.callKey),
      check(
        "ai_credit_call_status",
        sql`${t.status} in ('reserved','started','settled','released')`,
      ),
      check(
        "ai_credit_call_amount",
        sql`${t.maximumUnits} >= 0 AND (${t.chargedUnits} is null OR (${t.chargedUnits} >= 0 AND ${t.chargedUnits} <= ${t.maximumUnits}))`,
      ),
    ],
  )
  .enableRLS();

export const aiCreditLedger = billing
  .table(
    "ai_credit_ledger",
    {
      id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
      entryId: uuid("entry_id").defaultRandom().notNull(),
      accountId: uuid("account_id")
        .notNull()
        .references(() => aiCreditAccounts.id),
      key: text("key").notNull(),
      kind: text("kind").notNull(),
      balanceDeltaUnits: amount("balance_delta_units").notNull(),
      reservedDeltaUnits: amount("reserved_delta_units").notNull(),
      operationId: uuid("operation_id"),
      purchaseId: uuid("purchase_id"),
      reason: text("reason").notNull(),
      createdAt: time("created_at"),
    },
    (t) => [
      uniqueIndex("ai_credit_ledger_key").on(t.accountId, t.key),
      uniqueIndex("ai_credit_ledger_entry_id").on(t.entryId),
      index("ai_credit_ledger_history").on(t.accountId, t.id),
      foreignKey({
        columns: [t.operationId, t.accountId],
        foreignColumns: [aiCreditOperations.id, aiCreditOperations.accountId],
      }),
      foreignKey({
        columns: [t.purchaseId, t.accountId],
        foreignColumns: [aiCreditPurchases.id, aiCreditPurchases.accountId],
      }),
      check(
        "ai_credit_ledger_kind",
        sql`${t.kind} in ('purchase','reserve','settle','release','adjustment')`,
      ),
      check(
        "ai_credit_ledger_deltas",
        sql`
    (${t.kind} = 'purchase' AND ${t.balanceDeltaUnits} > 0 AND ${t.reservedDeltaUnits} = 0 AND ${t.purchaseId} is not null) OR
    (${t.kind} = 'reserve' AND ${t.balanceDeltaUnits} = 0 AND ${t.reservedDeltaUnits} >= 0 AND ${t.operationId} is not null) OR
    (${t.kind} = 'settle' AND ${t.balanceDeltaUnits} <= 0 AND ${t.reservedDeltaUnits} <= 0 AND ${t.operationId} is not null) OR
    (${t.kind} = 'release' AND ${t.balanceDeltaUnits} = 0 AND ${t.reservedDeltaUnits} <= 0 AND ${t.operationId} is not null) OR
    (${t.kind} = 'adjustment' AND ${t.reservedDeltaUnits} = 0 AND ${t.balanceDeltaUnits} <> 0)`,
      ),
    ],
  )
  .enableRLS();

export const aiCreditAgentLimits = billing
  .table(
    "ai_credit_agent_limits",
    {
      productAgentId: uuid("product_agent_id")
        .primaryKey()
        .references(() => agents.id),
      accountId: uuid("account_id")
        .notNull()
        .references(() => aiCreditAccounts.id),
      dailyUnits: amount("daily_units"),
      version: integer("version").notNull(),
      updatedAt: time("updated_at"),
    },
    (t) => [
      check(
        "ai_credit_limit_amount",
        sql`(${t.dailyUnits} is null OR ${t.dailyUnits} >= 0) AND ${t.version} > 0`,
      ),
    ],
  )
  .enableRLS();
