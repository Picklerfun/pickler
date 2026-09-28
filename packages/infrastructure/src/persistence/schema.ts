import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AgentConfig, Decision, RunRecord } from "@pickler/core";

export const pickler = pgSchema("pickler");
const milliseconds = (name: string) => bigint(name, { mode: "number" });

export const agents = pickler
  .table(
    "agents",
    {
      tenantId: text("tenant_id").notNull(),
      id: text("id").notNull(),
      version: integer("version").notNull().default(1),
      config: jsonb("config").$type<AgentConfig>().notNull(),
      paused: boolean("paused").notNull().default(false),
      scheduleEnabled: boolean("schedule_enabled").notNull().default(false),
      nextDueAt: milliseconds("next_due"),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      check("positive_version", sql`${t.version} > 0`),
    ],
  )
  .enableRLS();

export const runs = pickler
  .table(
    "runs",
    {
      id: text("id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      requestKey: text("request_key").notNull(),
      marketId: text("market_id"),
      trigger: text("trigger").$type<RunRecord["trigger"]>().notNull(),
      status: text("status").$type<RunRecord["status"]>().notNull(),
      createdAt: milliseconds("created_at").notNull(),
      startedAt: milliseconds("started_at"),
      leaseOwner: text("lease_owner"),
      leaseExpiresAt: milliseconds("lease_expires_at"),
      finishedAt: milliseconds("finished_at"),
      configVersion: integer("config_version").notNull(),
      config: jsonb("config").$type<AgentConfig>().notNull(),
      decision: jsonb("decision").$type<Decision>(),
      error: text("error"),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [agents.tenantId, agents.id],
      }),
      uniqueIndex("request_identity").on(t.tenantId, t.agentId, t.requestKey),
      uniqueIndex("one_running_agent")
        .on(t.tenantId, t.agentId)
        .where(sql`${t.status} = 'running'`),
      index("quota").on(t.tenantId, t.agentId, t.createdAt),
      index("queued_jobs")
        .on(t.createdAt, t.id)
        .where(sql`${t.status} = 'queued'`),
      check(
        "run_status",
        sql`${t.status} in ('queued','running','completed','failed','cancelled')`,
      ),
      index("expired_leases")
        .on(t.leaseExpiresAt)
        .where(sql`${t.status} = 'running'`),
      check(
        "running_requires_lease",
        sql`${t.status} <> 'running' OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
      ),
      check("run_trigger", sql`${t.trigger} in ('manual','schedule')`),
    ],
  )
  .enableRLS();

export const events = pickler
  .table(
    "events",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      type: text("type").notNull(),
      data: jsonb("data").$type<unknown>().notNull(),
      createdAt: milliseconds("created_at").notNull(),
    },
    (t) => [index("run_events").on(t.runId, t.id)],
  )
  .enableRLS();

export const metadata = pickler
  .table("metadata", {
    key: text("key").primaryKey(),
    value: text("value").notNull(),
  })
  .enableRLS();

export const executionPolicy = pickler
  .table(
    "execution_policy",
    {
      id: integer("id").primaryKey().default(1),
      globalLimit: integer("global_limit").notNull().default(5),
      tenantLimit: integer("tenant_limit").notNull().default(2),
    },
    (t) => [
      check("singleton_policy", sql`${t.id} = 1`),
      check(
        "valid_execution_limits",
        sql`${t.globalLimit} BETWEEN 1 AND 250 AND ${t.tenantLimit} BETWEEN 1 AND ${t.globalLimit}`,
      ),
    ],
  )
  .enableRLS();

// Public normalized data; never store credentials, tenant profiles or generated research here.
export const providerCache = pickler
  .table("provider_cache", {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<unknown>().notNull(),
    retrievedAt: text("retrieved_at").notNull(),
    expiresAt: milliseconds("expires_at").notNull(),
  })
  .enableRLS();
export const providerQuotas = pickler
  .table(
    "provider_quotas",
    {
      key: text("key").notNull(),
      windowStart: text("window_start").notNull(),
      used: integer("used").notNull(),
    },
    (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
  )
  .enableRLS();

export const paperOrders = pickler
  .table(
    "paper_orders",
    {
      id: text("id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      runId: text("run_id")
        .notNull()
        .references(() => runs.id),
      marketId: text("market_id").notNull(),
      outcomeId: text("outcome_id").notNull(),
      requestKey: text("request_key").notNull(),
      configVersion: integer("config_version").notNull(),
      status: text("status").notNull(),
      createdAt: milliseconds("created_at").notNull(),
      finishedAt: milliseconds("finished_at"),
      reason: text("reason"),
      fill: jsonb("fill").$type<import("@pickler/trading/polymarket").PaperFill>(),
      settlement:
        jsonb("settlement").$type<import("@pickler/trading/polymarket").PaperSettlement>(),
      snapshot: jsonb("snapshot").notNull(),
      leaseOwner: text("lease_owner"),
      leaseExpiresAt: milliseconds("lease_expires_at"),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [agents.tenantId, agents.id],
      }),
      uniqueIndex("one_paper_attempt_per_run").on(t.runId),
      uniqueIndex("paper_request_identity").on(t.tenantId, t.requestKey),
      uniqueIndex("one_open_paper_position")
        .on(t.tenantId, t.agentId, t.marketId)
        .where(
          sql`${t.status} = 'pending' OR (${t.status} = 'filled' AND ${t.settlement} IS NULL)`,
        ),
      check(
        "paper_settlement_requires_fill",
        sql`${t.settlement} IS NULL OR (${t.status} = 'filled' AND ${t.fill} IS NOT NULL)`,
      ),
      check(
        "paper_status",
        sql`${t.status} in ('pending','filled','not_filled','failed','interrupted')`,
      ),
      check(
        "paper_pending_lease",
        sql`${t.status} <> 'pending' OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
      ),
    ],
  )
  .enableRLS();

export const tradingAttempts = pickler
  .table("trading_attempts", {
    runId: text("run_id")
      .primaryKey()
      .references(() => runs.id),
    tenantId: text("tenant_id").notNull(),
    agentId: text("agent_id").notNull(),
    reason: text("reason"),
    createdAt: milliseconds("created_at").notNull(),
  })
  .enableRLS();

export const tradingAccounts = pickler
  .table(
    "trading_accounts",
    {
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      enabled: boolean("enabled").notNull().default(false),
      wallet: text("wallet").notNull(),
      signer: text("signer").notNull(),
      createdAt: milliseconds("created_at").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.agentId] }),
      uniqueIndex("one_trading_wallet").on(t.wallet),
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [agents.tenantId, agents.id],
      }),
    ],
  )
  .enableRLS();

export const liveOrders = pickler
  .table(
    "live_orders",
    {
      id: text("id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      runId: text("run_id").references(() => runs.id),
      requestKey: text("request_key").notNull(),
      submitKey: text("submit_key"),
      origin: text("origin").notNull(),
      status: text("status").notNull(),
      marketId: text("market_id").notNull(),
      configVersion: integer("config_version").notNull(),
      preview: jsonb("preview")
        .$type<import("@pickler/trading/polymarket").LivePreview>()
        .notNull(),
      budgetMicros: integer("budget_micros").notNull(),
      createdAt: milliseconds("created_at").notNull(),
      expiresAt: milliseconds("expires_at").notNull(),
      orderHash: text("order_hash"),
      reason: text("reason"),
      fill: jsonb("fill").$type<import("@pickler/trading/polymarket").LiveFill>(),
      leaseOwner: text("lease_owner"),
      leaseExpiresAt: milliseconds("lease_expires_at"),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [tradingAccounts.tenantId, tradingAccounts.agentId],
      }),
      uniqueIndex("live_request_identity").on(t.tenantId, t.requestKey),
      uniqueIndex("live_run_identity").on(t.runId),
      uniqueIndex("live_hash_identity").on(t.orderHash),
      uniqueIndex("one_live_origin")
        .on(t.tenantId, t.agentId, t.origin)
        .where(sql`${t.status} in ('queued','submitting','unknown','settled')`),
      uniqueIndex("one_live_position")
        .on(t.tenantId, t.agentId, t.marketId)
        .where(sql`${t.status} in ('queued','submitting','unknown','settled')`),
      check("live_budget_bound", sql`${t.budgetMicros} > 0 AND ${t.budgetMicros} <= 5000000`),
      check("live_origin", sql`${t.origin} in ('manual','agent')`),
      check(
        "live_status",
        sql`${t.status} in ('prepared','queued','submitting','unknown','settled','not_filled','failed','expired')`,
      ),
    ],
  )
  .enableRLS();

export const perpsPaperAccounts = pickler
  .table(
    "perps_paper_accounts",
    {
      id: text("id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      sessionId: text("session_id").notNull(),
      network: text("network").notNull(),
      document: jsonb("document")
        .$type<import("@pickler/trading/perps").PerpsPaperAccount>()
        .notNull(),
    },
    (t) => [
      uniqueIndex("perps_paper_account_scope").on(t.tenantId, t.agentId, t.sessionId, t.network),
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [agents.tenantId, agents.id],
      }),
      check("perps_paper_network", sql`${t.network} in ('mainnet','testnet')`),
    ],
  )
  .enableRLS();
export const perpsPaperAttempts = pickler
  .table(
    "perps_paper_attempts",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      key: text("key").notNull(),
      document: jsonb("document")
        .$type<import("@pickler/trading/perps").PerpsPaperAttempt>()
        .notNull(),
      owner: text("owner"),
      expiresAt: milliseconds("expires_at"),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.key] })],
  )
  .enableRLS();
export const perpsPaperPositions = pickler
  .table(
    "perps_paper_positions",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      id: text("id").notNull(),
      symbol: text("symbol").notNull(),
      closedAt: milliseconds("closed_at"),
      document: jsonb("document")
        .$type<import("@pickler/trading/perps").PerpsPaperPosition>()
        .notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.accountId, t.id] }),
      uniqueIndex("perps_paper_open_symbol")
        .on(t.accountId, t.symbol)
        .where(sql`${t.closedAt} is null`),
    ],
  )
  .enableRLS();
export const perpsPaperMovements = pickler
  .table(
    "perps_paper_movements",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      key: text("key").notNull(),
      document: jsonb("document")
        .$type<import("@pickler/trading/perps").PerpsPaperMovement>()
        .notNull(),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.key] })],
  )
  .enableRLS();

export const perpsPaperObservations = pickler
  .table(
    "perps_paper_observations",
    {
      accountId: text("account_id")
        .notNull()
        .references(() => perpsPaperAccounts.id),
      key: text("key").notNull(),
      document: jsonb("document").notNull(),
      result: jsonb("result").$type<import("@pickler/trading/perps").PerpsPaperView>().notNull(),
    },
    (t) => [primaryKey({ columns: [t.accountId, t.key] })],
  )
  .enableRLS();

export const perpsStudies = pickler
  .table(
    "perps_studies",
    {
      id: text("id").primaryKey(),
      tenantId: text("tenant_id").notNull(),
      sessionId: text("session_id").notNull(),
      network: text("network").notNull(),
      document: jsonb("document")
        .$type<import("@pickler/trading/evaluation").PerpsStudyRecord>()
        .notNull(),
      owner: text("owner"),
      expiresAt: milliseconds("expires_at"),
    },
    (t) => [uniqueIndex("perps_study_scope").on(t.tenantId, t.sessionId, t.network)],
  )
  .enableRLS();
export const perpsStudyRounds = pickler
  .table(
    "perps_study_rounds",
    {
      studyId: text("study_id")
        .notNull()
        .references(() => perpsStudies.id),
      key: text("key").notNull(),
      document: jsonb("document")
        .$type<import("@pickler/trading/evaluation").PerpsRound>()
        .notNull(),
    },
    (t) => [primaryKey({ columns: [t.studyId, t.key] })],
  )
  .enableRLS();
export const perpsStudyEvents = pickler
  .table(
    "perps_study_events",
    {
      studyId: text("study_id")
        .notNull()
        .references(() => perpsStudies.id),
      key: text("key").notNull(),
      at: milliseconds("at").notNull(),
      kind: text("kind").notNull(),
      data: jsonb("data").notNull(),
    },
    (t) => [primaryKey({ columns: [t.studyId, t.key] })],
  )
  .enableRLS();
