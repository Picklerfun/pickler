// Launch: drafting, preparing and tracking a token launch. Private to the product.
//
// Separate from `market` on purpose. `market` holds projections — what the chain says is
// true, rebuildable by replaying logs. Everything here is the opposite: intent that exists
// only off chain, and that no replay could reconstruct. Mixing the two would make it
// impossible to say which tables may be safely truncated and rebuilt.
//
// EVM chains only (CAIP-2 `eip155:<id>`). Amounts are base units; numeric(78,0) holds any
// uint256. See docs/specs/launchpad-monad-v1.md.

import { sql } from "drizzle-orm";
import { profiles } from "./identity";
import { agents } from "./agents";
import {
  bigint,
  boolean,
  check,
  index,
  foreignKey,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const launch = pgSchema("launch");

export const draftStatus = launch.enum("draft_status", [
  "draft",
  "validated",
  "prepared",
  "submitted",
  "launched",
  "abandoned",
]);

export const transactionStatus = launch.enum("transaction_status", [
  "prepared",
  "submitted",
  "included",
  "finalized",
  "reverted",
  "replaced",
]);

export const outboxStatus = launch.enum("outbox_status", ["pending", "delivered", "failed"]);

const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });

/**
 * Economic presets as published on chain, mirrored here so the API can show and compare them
 * without an RPC round trip.
 *
 * A published version is immutable in the factory, so it is immutable here: a change is a new
 * row with a new version, never an update. `configHash` is what a launch committed to.
 */
export const presets = launch
  .table(
    "presets",
    {
      chain: text("chain").notNull(),
      presetId: integer("preset_id").notNull(),
      version: integer("version").notNull(),
      configHash: text("config_hash").notNull(),
      /** The full preset as the contract stores it, amounts as decimal strings. */
      params: jsonb("params").notNull(),
      quoteAddress: text("quote_address").notNull(),
      totalSupply: baseUnits("total_supply").notNull(),
      saleAllocation: baseUnits("sale_allocation").notNull(),
      lpAllocation: baseUnits("lp_allocation").notNull(),
      enabled: boolean("enabled").notNull().default(true),
      publishedBlock: bigint("published_block", { mode: "number" }).notNull(),
      publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.chain, t.presetId, t.version] }),
      uniqueIndex("presets_config_hash_idx").on(t.chain, t.configHash),
      check("presets_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("presets_config_hash_format", sql`${t.configHash} ~ '^0x[0-9a-f]{64}$'`),
      check("presets_quote_format", sql`${t.quoteAddress} ~ '^0x[0-9a-f]{40}$'`),
      check(
        "presets_allocations_sum",
        sql`${t.totalSupply} = ${t.saleAllocation} + ${t.lpAllocation}`,
      ),
      check("presets_lp_below_sale", sql`${t.lpAllocation} < ${t.saleAllocation}`),
      check("presets_published_block_positive", sql`${t.publishedBlock} >= 0`),
    ],
  )
  .enableRLS();

/**
 * A creator's work in progress. Nothing here exists on chain, and a draft never becomes
 * authoritative: the launch that results is read back from the factory's own record.
 */
export const drafts = launch
  .table(
    "drafts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: uuid("owner_id")
        .notNull()
        .references(() => profiles.userId, { onDelete: "cascade" }),
      agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
      chain: text("chain").notNull(),
      presetId: integer("preset_id"),
      presetVersion: integer("preset_version"),
      params: jsonb("params").notNull(),
      status: draftStatus("status").notNull().default("draft"),
      /** Optimistic concurrency: a write carrying a stale version is rejected. */
      version: integer("version").notNull().default(1),
      /** Set once the launch exists, so a draft can be traced to what it became. */
      launchedToken: text("launched_token"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("drafts_owner_idx").on(t.ownerId, t.status),
      uniqueIndex("drafts_agent_chain_key").on(t.agentId, t.chain),
      uniqueIndex("drafts_identity_key").on(t.id, t.agentId, t.chain),
      check("drafts_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("drafts_version_positive", sql`${t.version} >= 1`),
      check(
        "drafts_launched_token_format",
        sql`${t.launchedToken} is null or ${t.launchedToken} ~ '^0x[0-9a-f]{40}$'`,
      ),
    ],
  )
  .enableRLS();

/**
 * Every version of a launch's public metadata, with the hash the chain committed to.
 *
 * History rather than a single current row: the contract records a hash, and a viewer needs
 * to be able to check that what they are shown is what was committed, including for an older
 * version.
 */
export const metadataVersions = launch
  .table(
    "metadata_versions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      chain: text("chain").notNull(),
      token: text("token").notNull(),
      uri: text("uri").notNull(),
      contentHash: text("content_hash").notNull(),
      authorId: uuid("author_id").references(() => profiles.userId, { onDelete: "set null" }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("metadata_versions_hash_idx").on(t.chain, t.token, t.contentHash),
      index("metadata_versions_token_idx").on(t.chain, t.token, t.createdAt),
      check("metadata_versions_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("metadata_versions_token_format", sql`${t.token} ~ '^0x[0-9a-f]{40}$'`),
      check("metadata_versions_hash_format", sql`${t.contentHash} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/**
 * Transactions the API prepared and is tracking.
 *
 * The API never signs, so a row here is a claim about what a user said they would send, not
 * proof that anything happened. Only a receipt moves a row to `included`, and a row that
 * reaches `replaced` or `reverted` is not a completed operation however it was reported.
 */
export const transactionRequests = launch
  .table(
    "transaction_requests",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      ownerId: uuid("owner_id").references(() => profiles.userId, { onDelete: "set null" }),
      chain: text("chain").notNull(),
      /** The wallet expected to send it. A different sender does not satisfy this request. */
      sender: text("sender").notNull(),
      destination: text("destination").notNull(),
      /** Hash of the prepared parameters, so a mismatched payload cannot reuse this row. */
      paramsHash: text("params_hash").notNull(),
      idempotencyKey: text("idempotency_key"),
      status: transactionStatus("status").notNull().default("prepared"),
      txHash: text("tx_hash"),
      blockHash: text("block_hash"),
      failureReason: text("failure_reason"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("transaction_requests_idempotency_idx")
        .on(t.ownerId, t.idempotencyKey)
        .where(sql`${t.idempotencyKey} is not null`),
      index("transaction_requests_tx_idx").on(t.chain, t.txHash),
      check("transaction_requests_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("transaction_requests_sender_format", sql`${t.sender} ~ '^0x[0-9a-f]{40}$'`),
      check("transaction_requests_destination_format", sql`${t.destination} ~ '^0x[0-9a-f]{40}$'`),
      check(
        "transaction_requests_tx_hash_format",
        sql`${t.txHash} is null or ${t.txHash} ~ '^0x[0-9a-f]{64}$'`,
      ),
      // An included or finalized transaction without a hash would be a claim with no evidence.
      check(
        "transaction_requests_included_has_hash",
        sql`${t.status} not in ('included', 'finalized') or ${t.txHash} is not null`,
      ),
    ],
  )
  .enableRLS();

/**
 * Work the indexer committed in the same transaction as the projection it came from.
 *
 * Writing the projection and this row together is what makes delivery at-least-once rather
 * than maybe-once: a crash between the two would otherwise lose the notification while
 * keeping the data, and no later replay would notice.
 */
export const outbox = launch
  .table(
    "outbox",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      /** The chain event this came from, when it came from one. */
      eventChain: text("event_chain"),
      eventBlockHash: text("event_block_hash"),
      eventTxHash: text("event_tx_hash"),
      eventLogIndex: integer("event_log_index"),
      topic: text("topic").notNull(),
      payload: jsonb("payload").notNull(),
      status: outboxStatus("status").notNull().default("pending"),
      attempts: integer("attempts").notNull().default(0),
      lastError: text("last_error"),
      availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      index("outbox_pending_idx").on(t.status, t.availableAt),
      // One row per event per topic: a replay of the same log must not enqueue twice.
      uniqueIndex("outbox_event_topic_idx")
        .on(t.eventChain, t.eventBlockHash, t.eventTxHash, t.eventLogIndex, t.topic)
        .where(sql`${t.eventChain} is not null`),
      check("outbox_attempts_positive", sql`${t.attempts} >= 0`),
      check("outbox_topic_length", sql`char_length(${t.topic}) between 1 and 80`),
    ],
  )
  .enableRLS();

/** Stable identity before launch; no address or transaction is accepted as proof of existence. */
export const agentKeys = launch
  .table(
    "agent_keys",
    {
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "restrict" }),
      chain: text("chain").notNull(),
      agentKey: text("agent_key").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.agentId, t.chain] }),
      uniqueIndex("agent_keys_chain_key").on(t.chain, t.agentKey),
      check("agent_keys_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("agent_keys_hash_format", sql`${t.agentKey} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/** Immutable short-lived permissions. Only the owner's JWT API can return their payloads. */
export const tokenGrants = launch
  .table(
    "grants",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id").notNull(),
      chain: text("chain").notNull(),
      draftId: uuid("draft_id").notNull(),
      draftVersion: integer("draft_version").notNull(),
      ownerId: uuid("owner_id")
        .notNull()
        .references(() => profiles.userId, { onDelete: "restrict" }),
      factory: text("factory").notNull(),
      nonce: baseUnits("nonce").notNull(),
      idempotencyKey: text("idempotency_key").notNull(),
      payload: jsonb("payload").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      foreignKey({
        columns: [t.agentId, t.chain],
        foreignColumns: [agentKeys.agentId, agentKeys.chain],
      }),
      foreignKey({
        columns: [t.draftId, t.agentId, t.chain],
        foreignColumns: [drafts.id, drafts.agentId, drafts.chain],
      }),
      uniqueIndex("grants_request_key").on(t.agentId, t.chain, t.idempotencyKey),
      uniqueIndex("grants_nonce_key").on(t.chain, t.factory, t.nonce),
      check("grants_factory_format", sql`${t.factory} ~ '^0x[0-9a-f]{40}$'`),
      check("grants_nonce_range", sql`${t.nonce} >= 0 AND ${t.nonce} < power(2::numeric, 256)`),
      check("grants_version_positive", sql`${t.draftVersion} > 0`),
      check(
        "grants_expiry",
        sql`${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '5 minutes'`,
      ),
    ],
  )
  .enableRLS();

/** Durable private operations; payload includes immutable unsigned activity and signed recovery bytes. */
export const tokenOperations = launch
  .table(
    "operations",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "restrict" }),
      ownerId: uuid("owner_id")
        .notNull()
        .references(() => profiles.userId, { onDelete: "restrict" }),
      chain: text("chain").notNull(),
      sender: text("sender"),
      transactionNonce: integer("transaction_nonce"),
      rpcCalls: integer("rpc_calls").notNull().default(0),
      requestKey: text("request_key").notNull(),
      action: text("action").notNull(),
      status: text("status").notNull(),
      version: integer("version").notNull().default(1),
      nonce: baseUnits("nonce").notNull(),
      payload: jsonb("payload").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
      transactionId: uuid("transaction_id").references(() => transactionRequests.id),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("operations_request_key").on(t.agentId, t.chain, t.requestKey),
      uniqueIndex("operations_nonce_key").on(t.chain, t.nonce),
      uniqueIndex("operations_master_nonce")
        .on(t.chain, t.sender, t.transactionNonce)
        .where(
          sql`${t.status} IN ('awaiting_signature','signing','signed','submitting','confirming','included','unknown')`,
        ),
      index("operations_agent_status").on(t.agentId, t.chain, t.status),
      check("operations_chain", sql`${t.chain} = 'eip155:10143'`),
      check(
        "operations_action",
        sql`${t.action} IN ('launch','graduate','collect_curve_fees','collect_lp_fees','claim_fees','approve_buy','approve_sell','buy','sell')`,
      ),
      check(
        "operations_status",
        sql`${t.status} IN ('preparing','awaiting_signature','signing','signed','submitting','confirming','included','finalized','failed','cancelled','unknown')`,
      ),
      check("operations_version", sql`${t.version} > 0`),
      check("operations_nonce", sql`${t.nonce} >= 0 AND ${t.nonce} < power(2::numeric,256)`),
    ],
  )
  .enableRLS();

/** Renewable single-run lease and UTC daily RPC admission, shared by all streams on a chain. */
export const indexerAdmission = launch
  .table(
    "indexer_admission",
    {
      chain: text("chain").primaryKey(),
      owner: uuid("owner"),
      expiresAt: timestamp("expires_at", { withTimezone: true }),
      day: text("day").notNull(),
      requests: integer("requests").notNull().default(0),
    },
    (t) => [check("indexer_admission_requests", sql`${t.requests}>=0`)],
  )
  .enableRLS();
