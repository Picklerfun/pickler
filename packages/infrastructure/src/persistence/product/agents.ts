// Agents: a workspace owns many agents. Public profile, versioned configuration, credentials and
// the activity log are separate tables so each can be granted and audited on its own. An agent
// with history is never deleted; it is killed. The ticker belongs to its token, not to the agent.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./identity";

export const agentsSchema = pgSchema("agents");

export const agentStatus = agentsSchema.enum("agent_status", [
  "pending_policies",
  "active",
  "paused",
  "suspended",
  "draining",
  "killed",
]);
export const accent = agentsSchema.enum("accent", [
  "lime",
  "cyan",
  "amber",
  "orange",
  "magenta",
  "violet",
  "blue",
]);

export const agents = agentsSchema
  .table(
    "agents",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "restrict" }),
      name: text("name").notNull(),
      handle: text("handle").notNull(),
      status: agentStatus("status").notNull().default("pending_policies"),
      chainId: integer("chain_id"),
      // The deferrable foreign key to the active config lives in the custom migration.
      activeConfigVersion: integer("active_config_version"),
      createdBy: uuid("created_by"),
      killedAt: timestamp("killed_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agents_handle_key").on(t.handle),
      index("agents_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
      index("agents_created_by_idx").on(t.createdBy),
      index("agents_handle_owner_idx").on(t.handle, t.id),
      index("agents_active_config_idx").on(t.id, t.activeConfigVersion),
      check("agents_name_length", sql`char_length(${t.name}) between 1 and 40`),
      check("agents_chain_id_check", sql`${t.chainId} > 0`),
      check(
        "agents_killed_consistent",
        sql`(${t.status} = 'killed') = (${t.killedAt} is not null)`,
      ),
    ],
  )
  .enableRLS();

export const agentProfiles = agentsSchema
  .table(
    "agent_profiles",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      blurb: text("blurb").notNull().default(""),
      beat: text("beat"),
      accent: accent("accent").notNull().default("lime"),
      xHandle: text("x_handle"),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agent_profiles_x_handle_key")
        .on(sql`lower(${t.xHandle})`)
        .where(sql`${t.xHandle} is not null`),
      check("agent_profiles_blurb_length", sql`char_length(${t.blurb}) <= 280`),
      check("agent_profiles_beat_length", sql`char_length(${t.beat}) <= 40`),
      check("agent_profiles_x_handle_format", sql`${t.xHandle} ~ '^@[A-Za-z0-9_]{1,15}$'`),
    ],
  )
  .enableRLS();

/** Every change to what the agent is told or allowed to research is a new version. */
export const agentConfigs = agentsSchema
  .table(
    "agent_configs",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
      version: integer("version").notNull(),
      personality: text("personality"),
      sources: jsonb("sources")
        .notNull()
        .default(sql`'[]'::jsonb`),
      strategy: jsonb("strategy")
        .notNull()
        .default(sql`'{}'::jsonb`),
      promptHash: text("prompt_hash"),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.agentId, t.version] }),
      index("agent_configs_created_by_idx").on(t.createdBy),
      check("agent_configs_version_positive", sql`${t.version} > 0`),
      check("agent_configs_sources_array", sql`jsonb_typeof(${t.sources}) = 'array'`),
      check("agent_configs_strategy_object", sql`jsonb_typeof(${t.strategy}) = 'object'`),
      check("agent_configs_prompt_hash", sql`${t.promptHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/** Secrets live apart from readable rows; the HMAC secret is AES-256-GCM encrypted by the API. */
export const agentCredentials = agentsSchema
  .table(
    "agent_credentials",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      encryptedHmacSecret: text("encrypted_hmac_secret").notNull(),
      keyVersion: smallint("key_version").notNull().default(1),
      rotatedAt: timestamp("rotated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("agent_credentials_key_version", sql`${t.keyVersion} > 0`)],
  )
  .enableRLS();

export const agentEvents = agentsSchema
  .table(
    "agent_events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id").references(() => agents.id, { onDelete: "restrict" }),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "restrict" }),
      eventType: text("event_type").notNull(),
      payload: jsonb("payload"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("agent_events_agent_idx").on(t.agentId, t.createdAt.desc()),
      index("agent_events_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
      check("agent_events_type_length", sql`char_length(${t.eventType}) between 1 and 100`),
    ],
  )
  .enableRLS();
