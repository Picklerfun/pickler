import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
import type { AgentConfig, Decision, RunRecord } from "@pickler/core";
import { pickler, agents as runtimeAgents } from "./schema.js";
import { workspaces } from "./product/identity.js";
import { agents } from "./product/agents.js";

export const researchAccess = pickler
  .table("research_access", {
    userId: uuid("user_id").primaryKey(),
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
export const workspaceTenants = pickler
  .table(
    "workspace_tenants",
    {
      workspaceId: uuid("workspace_id")
        .primaryKey()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
    },
    (t) => [
      uniqueIndex("workspace_tenant_unique").on(t.tenantId),
      uniqueIndex("workspace_tenant_pair").on(t.workspaceId, t.tenantId),
    ],
  )
  .enableRLS();
export const productAgents = pickler
  .table(
    "product_agents",
    {
      productAgentId: uuid("product_agent_id")
        .primaryKey()
        .references(() => agents.id),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
      runtimeAgentId: text("runtime_agent_id").notNull(),
      requestKey: text("request_key").notNull(),
      request: jsonb("request").notNull(),
    },
    (t) => [
      uniqueIndex("product_runtime_unique").on(t.tenantId, t.runtimeAgentId),
      uniqueIndex("product_agent_request_unique").on(t.workspaceId, t.requestKey),
      foreignKey({
        columns: [t.workspaceId, t.tenantId],
        foreignColumns: [workspaceTenants.workspaceId, workspaceTenants.tenantId],
      }),
      foreignKey({
        columns: [t.tenantId, t.runtimeAgentId],
        foreignColumns: [runtimeAgents.tenantId, runtimeAgents.id],
      }),
    ],
  )
  .enableRLS();

// Private operational budget state. Amounts and timestamps use lossless tagged JSON.
export const budgetState = pickler
  .table("budget_state", {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id),
    state: jsonb("state")
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
export const budgetReservations = pickler
  .table(
    "budget_reservations",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
      id: text("id").notNull(),
      state: text("state").notNull(),
      expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
      payload: jsonb("payload").notNull(),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.id] })],
  )
  .enableRLS();
export const budgetProcessed = pickler
  .table(
    "budget_processed",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
      key: text("key").notNull(),
    },
    (t) => [primaryKey({ columns: [t.agentId, t.key] })],
  )
  .enableRLS();

const milliseconds = (name: string) => bigint(name, { mode: "number" });

/**
 * A paper run of a brief that is not an agent yet (docs/specs/studio-brief-v1.md §4). The runner
 * executes it through `PostgresPreviewStore` with no `pickler.agents` row: the config snapshot is
 * its agent. Owner-only, gone after `expires_at` unless adopted, when the draft create copies it in
 * as the new agent's first run.
 */
export const previewRuns = pickler
  .table(
    "preview_runs",
    {
      id: text("id").primaryKey(),
      userId: uuid("user_id").notNull(),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
      status: text("status").$type<RunRecord["status"]>().notNull(),
      createdAt: milliseconds("created_at").notNull(),
      startedAt: milliseconds("started_at"),
      finishedAt: milliseconds("finished_at"),
      expiresAt: milliseconds("expires_at").notNull(),
      leaseOwner: text("lease_owner"),
      leaseExpiresAt: milliseconds("lease_expires_at"),
      config: jsonb("config").$type<AgentConfig>().notNull(),
      fingerprint: text("fingerprint").notNull(),
      decision: jsonb("decision").$type<Decision>(),
      error: text("error"),
      adoptedAt: milliseconds("adopted_at"),
      adoptedAgentId: text("adopted_agent_id"),
    },
    (t) => [
      index("preview_runs_user_created").on(t.userId, t.createdAt),
      index("preview_runs_queued")
        .on(t.createdAt, t.id)
        .where(sql`${t.status} = 'queued'`),
      check(
        "preview_run_status",
        sql`${t.status} in ('queued','running','completed','failed','cancelled')`,
      ),
      check(
        "preview_running_requires_lease",
        sql`${t.status} <> 'running' OR (${t.leaseOwner} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL)`,
      ),
      check(
        "preview_adoption_consistent",
        sql`(${t.adoptedAt} IS NULL) = (${t.adoptedAgentId} IS NULL)`,
      ),
    ],
  )
  .enableRLS();

/** A preview run's trace, in a run's event shape so the first-run trace code reads it unchanged. */
export const previewEvents = pickler
  .table(
    "preview_events",
    {
      id: bigserial("id", { mode: "number" }).primaryKey(),
      previewRunId: text("preview_run_id")
        .notNull()
        .references(() => previewRuns.id, { onDelete: "cascade" }),
      type: text("type").notNull(),
      data: jsonb("data").$type<unknown>().notNull(),
      createdAt: milliseconds("created_at").notNull(),
    },
    (t) => [index("preview_run_events").on(t.previewRunId, t.id)],
  )
  .enableRLS();
