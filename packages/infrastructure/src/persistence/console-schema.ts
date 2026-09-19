import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  jsonb,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
} from "drizzle-orm/pg-core";
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
