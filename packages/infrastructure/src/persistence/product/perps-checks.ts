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
import { pickler, agents as runtimeAgents } from "../schema.js";
import { productAgents } from "../console-schema.js";

/** Trading's `PERPS_CHECK_TRIGGERS` and `CHECK_OUTCOMES`, spelled out for drizzle-kit (see schema.ts). */
export const PERPS_CHECK_TRIGGER_VALUES = [
  "hourly",
  "manual",
  "exits",
  "owner",
  "system",
] as const satisfies readonly import("@pickler/trading/perps").PerpsCheckTrigger[];
export const PERPS_CHECK_OUTCOME_VALUES = [
  "entered",
  "exited",
  "held",
  "blocked",
  "proposed",
  "skipped",
  "failed",
  "system",
] as const satisfies readonly import("@pickler/trading/perps").PerpsCheckOutcome[];
const listed = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(","));

/** One row per Perpl paper check (perpl-paper-runtime-v1 R1, R14), with its lease (R15). */
export const perpsChecks = pickler
  .table(
    "perps_checks",
    {
      id: uuid("id").primaryKey(),
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => productAgents.productAgentId),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      trigger: text("trigger").notNull(),
      requestKey: text("request_key"),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      startedAt: bigint("started_at", { mode: "number" }),
      finishedAt: bigint("finished_at", { mode: "number" }),
      configVersion: integer("config_version"),
      inputs: jsonb("inputs"),
      decision: jsonb("decision"),
      outcome: text("outcome"),
      outcomeText: text("outcome_text"),
      steps: jsonb("steps").notNull().default([]),
      costMicros: numeric("cost_micros", { precision: 30, scale: 0 }),
      error: text("error"),
      leaseOwner: uuid("lease_owner"),
      leaseExpiresAt: bigint("lease_expires_at", { mode: "number" }),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [runtimeAgents.tenantId, runtimeAgents.id],
      }),
      index("perps_checks_feed").on(t.productAgentId, t.createdAt.desc(), t.id.desc()),
      index("perps_checks_day").on(t.createdAt),
      uniqueIndex("perps_checks_request")
        .on(t.productAgentId, t.requestKey)
        .where(sql`${t.requestKey} is not null`),
      uniqueIndex("perps_checks_agent_active")
        .on(t.tenantId, t.agentId)
        .where(sql`${t.status} in ('queued','running')`),
      check("perps_checks_trigger", sql`${t.trigger} in (${listed(PERPS_CHECK_TRIGGER_VALUES)})`),
      check("perps_checks_status", sql`${t.status} in ('queued','running','finished')`),
      check(
        "perps_checks_outcome",
        sql`${t.outcome} is null OR ${t.outcome} in (${listed(PERPS_CHECK_OUTCOME_VALUES)})`,
      ),
      check("perps_checks_finished", sql`(${t.status} = 'finished') = (${t.outcome} is not null)`),
      check(
        "perps_checks_lease",
        sql`${t.status} <> 'running' OR (${t.leaseOwner} is not null AND ${t.leaseExpiresAt} is not null)`,
      ),
      check("perps_checks_cost", sql`${t.costMicros} is null OR ${t.costMicros} >= 0`),
    ],
  )
  .enableRLS();

/** What an approve-mode check asks the owner to enter (R8). */
export const perpsProposals = pickler
  .table(
    "perps_proposals",
    {
      id: uuid("id").primaryKey(),
      checkId: uuid("check_id")
        .notNull()
        .references(() => perpsChecks.id),
      productAgentId: uuid("product_agent_id")
        .notNull()
        .references(() => productAgents.productAgentId),
      tenantId: text("tenant_id").notNull(),
      agentId: text("agent_id").notNull(),
      instrument: text("instrument").notNull(),
      side: text("side").notNull(),
      margin: numeric("margin", { precision: 38, scale: 18 }).notNull(),
      leverage: integer("leverage").notNull(),
      kind: text("kind").notNull(),
      status: text("status").notNull(),
      createdAt: bigint("created_at", { mode: "number" }).notNull(),
      expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
      decidedAt: bigint("decided_at", { mode: "number" }),
      positionId: text("position_id"),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.agentId],
        foreignColumns: [runtimeAgents.tenantId, runtimeAgents.id],
      }),
      index("perps_proposals_expiry").on(t.status, t.expiresAt),
      index("perps_proposals_agent").on(t.productAgentId, t.createdAt.desc()),
      check("perps_proposals_instrument", sql`${t.instrument} in ('BTC','ETH')`),
      check("perps_proposals_side", sql`${t.side} in ('long','short')`),
      check("perps_proposals_kind", sql`${t.kind} in ('enter','size_up')`),
      check(
        "perps_proposals_status",
        sql`${t.status} in ('pending','approved','skipped','expired')`,
      ),
      check("perps_proposals_amounts", sql`${t.margin} > 0 AND ${t.leverage} >= 1`),
    ],
  )
  .enableRLS();
