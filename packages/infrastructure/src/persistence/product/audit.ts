// Audit: an append-only record of who did what, and idempotency for retried writes.

import { sql } from "drizzle-orm";
import {
  check,
  index,
  inet,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { workspaces } from "./identity";

export const audit = pgSchema("audit");

export const events = audit
  .table(
    "events",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
      actorType: text("actor_type").notNull(),
      actorId: text("actor_id").notNull(),
      action: text("action").notNull(),
      resourceType: text("resource_type").notNull(),
      resourceId: text("resource_id"),
      requestId: uuid("request_id"),
      ipAddress: inet("ip_address"),
      metadata: jsonb("metadata")
        .notNull()
        .default(sql`'{}'::jsonb`),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("events_workspace_idx").on(t.workspaceId, t.createdAt.desc()),
      index("events_resource_idx").on(t.resourceType, t.resourceId, t.createdAt.desc()),
      check("events_actor_type", sql`${t.actorType} in ('user', 'api_key', 'agent', 'system')`),
      check("events_action_length", sql`char_length(${t.action}) between 1 and 100`),
    ],
  )
  .enableRLS();

export const idempotencyKeys = audit
  .table(
    "idempotency_keys",
    {
      workspaceId: uuid("workspace_id")
        .notNull()
        .references(() => workspaces.id, { onDelete: "cascade" }),
      endpoint: text("endpoint").notNull(),
      key: text("key").notNull(),
      requestHash: text("request_hash").notNull(),
      responseStatus: integer("response_status"),
      responseBody: jsonb("response_body"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.workspaceId, t.endpoint, t.key] }),
      index("idempotency_keys_expiry_idx").on(t.expiresAt),
      check("idempotency_keys_key_length", sql`char_length(${t.key}) between 1 and 200`),
      check("idempotency_keys_request_hash", sql`${t.requestHash} ~ '^[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();
