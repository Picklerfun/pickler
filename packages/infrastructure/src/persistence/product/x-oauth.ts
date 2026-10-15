import { sql } from "drizzle-orm";
import { integer, text, timestamp, uuid, jsonb, check, primaryKey } from "drizzle-orm/pg-core";
import { agents, agentsSchema } from "./agents.js";
import { profiles, workspaces } from "./identity.js";

export const xOAuthAttempts = agentsSchema
  .table(
    "x_oauth_attempts",
    {
      id: uuid("id").primaryKey(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.userId),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
      stateHash: text("state_hash").notNull().unique(),
      browserHash: text("browser_hash").notNull(),
      verifier: text("verifier").notNull(),
      keyVersion: integer("key_version").notNull(),
      returnTo: text("return_to").notNull(),
      status: text("status").notNull().default("pending"),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [check("x_attempt_status", sql`${t.status} in ('pending','processing','finished')`)],
  )
  .enableRLS();
export const xOAuthGrants = agentsSchema
  .table(
    "x_oauth_grants",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id),
      userId: uuid("user_id")
        .notNull()
        .references(() => profiles.userId),
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id),
      tenantId: text("tenant_id").notNull(),
      status: text("status").notNull(),
      displayName: text("display_name"),
      profileImageUrl: text("profile_image_url"),
      tokens: text("tokens"),
      keyVersion: integer("key_version").notNull(),
      scopes: jsonb("scopes").$type<string[]>().notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      version: integer("version").notNull().default(1),
      refreshClaim: text("refresh_claim"),
      refreshStartedAt: timestamp("refresh_started_at", { withTimezone: true }),
      validatedAt: timestamp("validated_at", { withTimezone: true }),
    },
    (t) => [
      check(
        "x_grant_status",
        sql`${t.status} in ('connected','reconnect_required','revocation_pending')`,
      ),
      check("x_grant_version", sql`${t.version}>0 and ${t.keyVersion}>0`),
    ],
  )
  .enableRLS();
export const xApiUsage = agentsSchema
  .table(
    "x_api_usage",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
      day: text("day").notNull(),
      identityRequests: integer("identity_requests").notNull().default(0),
      postRequests: integer("post_requests").notNull().default(0),
      postResources: integer("post_resources").notNull().default(0),
      policyVersion: integer("policy_version").notNull(),
      retryAt: timestamp("retry_at", { withTimezone: true }),
    },
    (t) => [
      primaryKey({ columns: [t.agentId, t.day] }),
      check(
        "x_usage_nonnegative",
        sql`${t.identityRequests}>=0 and ${t.postRequests}>=0 and ${t.postResources}>=0`,
      ),
    ],
  )
  .enableRLS();

/** Request reservations are retained on failure; no post bodies or credentials are recorded. */
export const xApiCalls = agentsSchema
  .table(
    "x_api_calls",
    {
      id: uuid("id").primaryKey(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id),
      kind: text("kind").notNull(),
      policyVersion: integer("policy_version").notNull(),
      reservedResources: integer("reserved_resources").notNull(),
      startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    },
    (t) => [
      check("x_call_kind", sql`${t.kind} in ('identity','posts')`),
      check("x_call_resources", sql`${t.reservedResources} > 0`),
    ],
  )
  .enableRLS();

/** Historical verification evidence is never deleted when an active link is disconnected. */
export const xAccountHistory = agentsSchema
  .table("x_account_history", {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    xUserId: text("x_user_id").notNull(),
    handle: text("handle").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    verificationPostId: text("verification_post_id"),
    verificationMethod: text("verification_method").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();

/** Tokens that lost a connection fence are retained only to finish revocation explicitly. */
export const xOAuthRevocations = agentsSchema
  .table("x_oauth_revocations", {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    token: text("token").notNull(),
    keyVersion: integer("key_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  })
  .enableRLS();
