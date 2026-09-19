// Identity: people, their public profile and handle, verified wallets, workspaces and API keys.
// A person is a Supabase Auth user. `auth.users` belongs to Supabase, so it is not modelled here:
// the foreign keys to it are added by the custom migration, which also keeps this schema usable
// on a plain PostgreSQL database where that table does not exist.
// Deferrable foreign keys, security-definer functions, triggers and grants live in the custom
// migration beside the generated one, because Drizzle does not model them.

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  cidr,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const identity = pgSchema("identity");

export const memberRole = identity.enum("member_role", [
  "admin",
  "manager",
  "developer",
  "auditor",
  "viewer",
]);

export const profiles = identity
  .table(
    "profiles",
    {
      userId: uuid("user_id").primaryKey(),
      displayName: text("display_name").notNull(),
      handle: text("handle").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("profiles_handle_key").on(t.handle),
      index("profiles_handle_owner_idx").on(t.handle, t.userId),
      check("profiles_display_name_length", sql`char_length(${t.displayName}) between 2 and 60`),
      check("profiles_handle_format", sql`${t.handle} ~ '^[a-z0-9_]{3,15}$'`),
    ],
  )
  .enableRLS();

/** One namespace for people and agents: a handle never names both. */
export const handles = identity
  .table(
    "handles",
    {
      handle: text("handle").primaryKey(),
      userId: uuid("user_id"),
      // The agent reference is added in the custom migration: it is deferrable, so an agent and
      // its handle can be inserted in the same transaction.
      agentId: uuid("agent_id"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("handles_user_key").on(t.userId),
      uniqueIndex("handles_agent_key").on(t.agentId),
      uniqueIndex("handles_handle_user_key").on(t.handle, t.userId),
      uniqueIndex("handles_handle_agent_key").on(t.handle, t.agentId),
      check("handles_format", sql`${t.handle} ~ '^[a-z0-9_]{3,15}$'`),
      check("handles_single_owner", sql`num_nonnulls(${t.userId}, ${t.agentId}) = 1`),
    ],
  )
  .enableRLS();

/** Released handles stay blocked for a cooldown; the record must outlive deleted users. */
export const handleHistory = identity
  .table(
    "handle_history",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      handle: text("handle").notNull(),
      ownerKind: text("owner_kind").notNull(),
      releasedAt: timestamp("released_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("handle_history_handle_idx").on(t.handle, t.releasedAt.desc()),
      check("handle_history_owner_kind", sql`${t.ownerKind} in ('user', 'agent')`),
    ],
  )
  .enableRLS();

/** Wallets a person proved control of. An EVM account is the same on every EVM chain. */
export const walletLinks = identity
  .table(
    "wallet_links",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      namespace: text("namespace").notNull(),
      verifiedChain: text("verified_chain").notNull(),
      address: text("address").notNull(),
      method: text("method").notNull(),
      kind: text("kind").notNull().default("external"),
      verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("wallet_links_address_key").on(t.namespace, t.address),
      index("wallet_links_user_idx").on(t.userId),
      check("wallet_links_namespace", sql`${t.namespace} in ('eip155', 'solana')`),
      check(
        "wallet_links_verified_chain",
        sql`${t.verifiedChain} ~ '^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$'`,
      ),
      check(
        "wallet_links_verified_chain_family",
        sql`split_part(${t.verifiedChain}, ':', 1) = ${t.namespace}`,
      ),
      check("wallet_links_method_check", sql`${t.method} in ('siwe', 'siws')`),
      check("wallet_links_kind", sql`${t.kind} in ('external', 'mera')`),
      check(
        "wallet_links_address_format",
        sql`(${t.namespace} = 'eip155' and ${t.address} ~ '^0x[0-9a-f]{40}$') or (${t.namespace} = 'solana' and ${t.address} ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')`,
      ),
    ],
  )
  .enableRLS();

/** The creator's space. A person owns at most one; they can be a member of others. */
export const workspaces = identity
  .table(
    "workspaces",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerUserId: uuid("owner_user_id").notNull(),
      name: text("name").notNull(),
      isActive: boolean("is_active").notNull().default(true),
      activeModules: text("active_modules")
        .array()
        .notNull()
        .default(sql`array['agent']::text[]`),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("workspaces_owner_key").on(t.ownerUserId),
      check("workspaces_name_length", sql`char_length(${t.name}) between 1 and 80`),
      check(
        "workspaces_modules",
        sql`${t.activeModules} <@ array['signing', 'payout', 'action', 'agent']::text[]`,
      ),
    ],
  )
  .enableRLS();

export const workspaceMembers = identity
  .table(
    "workspace_members",
    {
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
      userId: uuid("user_id").notNull(),
      role: memberRole("role").notNull().default("viewer"),
      invitedBy: uuid("invited_by"),
      /** Optimistic concurrency for role changes. */
      version: integer("version").notNull().default(0),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.workspaceId, t.userId] }),
      index("workspace_members_user_idx").on(t.userId, t.createdAt),
      index("workspace_members_invited_by_idx").on(t.invitedBy),
    ],
  )
  .enableRLS();

/** Only the SHA-256 hash of a key is stored. A revoked key is inactive. */
export const apiKeys = identity
  .table(
    "api_keys",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
      name: text("name").notNull(),
      hash: text("hash").notNull(),
      displayPrefix: text("display_prefix"),
      scopes: text("scopes")
        .array()
        .notNull()
        .default(sql`array[]::text[]`),
      allowedCidrs: cidr("allowed_cidrs").array(),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      revokedAt: timestamp("revoked_at", { withTimezone: true }),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
      createdBy: uuid("created_by"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("api_keys_hash_key").on(t.hash),
      index("api_keys_workspace_idx").on(t.workspaceId),
      index("api_keys_created_by_idx").on(t.createdBy),
      check("api_keys_name_length", sql`char_length(${t.name}) between 1 and 80`),
      check("api_keys_hash_format", sql`${t.hash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();
