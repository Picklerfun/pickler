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
  // A private draft from the brief (studio-brief-v1 §6): no wallet, off the marketplace.
  "draft",
]);
/**
 * Whether the marketplace shows the agent (studio-draft-dashboard-v1 D7). Apart from `status`,
 * which says whether it has a wallet and runs: an agent can run and still be private.
 */
export const agentVisibility = agentsSchema.enum("agent_visibility", ["private", "public"]);
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
      visibility: agentVisibility("visibility").notNull().default("private"),
      /** When Go Public made it public; set exactly when `visibility` is `public`. */
      publishedAt: timestamp("published_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agents_handle_key").on(t.handle),
      index("agents_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
      index("agents_created_by_idx").on(t.createdBy),
      index("agents_handle_owner_idx").on(t.handle, t.id),
      index("agents_active_config_idx").on(t.id, t.activeConfigVersion),
      index("agents_public_idx")
        .on(t.publishedAt.desc())
        .where(sql`${t.visibility} = 'public'`),
      check("agents_name_length", sql`char_length(${t.name}) between 1 and 40`),
      check("agents_chain_id_check", sql`${t.chainId} > 0`),
      check(
        "agents_killed_consistent",
        sql`(${t.status} = 'killed') = (${t.killedAt} is not null)`,
      ),
      check(
        "agents_published_consistent",
        sql`(${t.visibility} = 'public') = (${t.publishedAt} is not null)`,
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
      /** One of the six avatar patterns (core's `AVATAR_PATTERNS`), by index. */
      avatarPattern: smallint("avatar_pattern").notNull().default(0),
      xHandle: text("x_handle"),
      /** Which venue the agent trades on. Public; the runtime's config is not. */
      venue: text("venue").notNull().default("predictions"),
      /**
       * The persona's prose: how it sounds (vibe, voice), how it decides, and what it does when it
       * is wrong. Authored at creation.
       */
      vibe: text("vibe").notNull().default(""),
      voice: text("voice").notNull().default(""),
      decides: text("decides").notNull().default(""),
      wrong: text("wrong").notNull().default(""),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agent_profiles_x_handle_key")
        .on(sql`lower(${t.xHandle})`)
        .where(sql`${t.xHandle} is not null`),
      check("agent_profiles_blurb_length", sql`char_length(${t.blurb}) <= 280`),
      check("agent_profiles_beat_length", sql`char_length(${t.beat}) <= 40`),
      check("agent_profiles_x_handle_format", sql`${t.xHandle} ~ '^@[A-Za-z0-9_]{1,15}$'`),
      check("agent_profiles_venue", sql`${t.venue} in ('predictions', 'perps', 'both')`),
      check("agent_profiles_vibe_length", sql`char_length(${t.vibe}) <= 120`),
      check("agent_profiles_voice_length", sql`char_length(${t.voice}) <= 120`),
      check("agent_profiles_decides_length", sql`char_length(${t.decides}) <= 280`),
      check("agent_profiles_wrong_length", sql`char_length(${t.wrong}) <= 280`),
      check("agent_profiles_avatar_pattern", sql`${t.avatarPattern} between 0 and 5`),
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

/**
 * The one live Connect X challenge per agent (studio-draft-dashboard-v1 D4): the owner posts the
 * code from the handle, and a check finds it in a post made after `created_at`.
 */
export const xChallenges = agentsSchema
  .table(
    "x_challenges",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      handle: text("handle").notNull(),
      /** "pk-" and eight base32 characters. */
      code: text("code").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    },
    (t) => [check("x_challenges_handle_format", sql`${t.handle} ~ '^[A-Za-z0-9_]{1,15}$'`)],
  )
  .enableRLS();

/**
 * The verified X account (D6): one per agent, and an X account (by id and by handle, whatever its
 * case) verifies one agent.
 */
export const xAccounts = agentsSchema
  .table(
    "x_accounts",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      xUserId: text("x_user_id").notNull().unique("x_accounts_x_user_id_key"),
      handle: text("handle").notNull(),
      verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
      verificationPostId: text("verification_post_id"),
      verificationMethod: text("verification_method").notNull().default("post"),
    },
    (t) => [uniqueIndex("x_accounts_handle_key").on(sql`lower(${t.handle})`)],
  )
  .enableRLS();

/**
 * One row per saved setup (studio-live-v1 L10): the config version it produced and the one line
 * core built from what changed. Written by `updateConfig` in the transaction that bumps the
 * version, never from client text. A version from before this table has no row.
 */
export const setupVersions = agentsSchema
  .table(
    "setup_versions",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
      version: integer("version").notNull(),
      summary: text("summary").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.agentId, t.version] }),
      check("setup_versions_version_positive", sql`${t.version} > 0`),
      check("setup_versions_summary_length", sql`char_length(${t.summary}) BETWEEN 1 AND 200`),
    ],
  )
  .enableRLS();
