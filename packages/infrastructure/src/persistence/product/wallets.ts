// Ported from Relayer signing.{turnkey_orgs,wallets,wallet_accounts,passkeys}
// (commit bb6bb1226e92). Two deliberate changes, both required by
// docs/relayer-extraction/00-plan.md:
//   - the key is user_id, not integrator_id: a Pickler workspace is already unique per owner
//     and registration must not wait for one to exist;
//   - challenges live here rather than in Redis, because Workers has no Redis and KV cannot
//     promise a single consumer (blocker W2).

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  numeric,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const wallets = pgSchema("wallets");

/** One Turnkey sub-organization per person. Its only root user is their passkey. */
export const turnkeyOrgs = wallets
  .table(
    "turnkey_orgs",
    {
      userId: uuid("user_id").primaryKey(),
      subOrganizationId: text("sub_organization_id").notNull(),
      masterWalletId: text("master_wallet_id").notNull(),
      rootUserId: text("root_user_id").notNull(),
      /** Pickler's non-root user inside this person's sub-organization; set in the first agent's ceremony. */
      delegatedUserId: text("delegated_user_id"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [uniqueIndex("turnkey_orgs_sub_organization_key").on(t.subOrganizationId)],
  )
  .enableRLS();

export const walletRecords = wallets
  .table(
    "wallets",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      walletId: text("wallet_id").notNull(),
      subOrganizationId: text("sub_organization_id").notNull(),
      kind: text("kind").notNull(),
      name: text("name").notNull(),
      /**
       * The policy ids Turnkey actually created after the person's passkey confirmed them, set
       * once by `confirmPolicies`. Null until then. An agent's creation reads this column, never
       * a client-supplied list, so the server is the only source of which rules a wallet carries.
       */
      approvedPolicyIds: text("approved_policy_ids").array(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("wallets_wallet_key").on(t.walletId),
      index("wallets_user_idx").on(t.userId),
      check("wallets_kind", sql`${t.kind} in ('master', 'agent')`),
    ],
  )
  .enableRLS();

export const walletAccounts = wallets
  .table(
    "wallet_accounts",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      walletId: text("wallet_id").notNull(),
      chain: text("chain").notNull(),
      address: text("address").notNull(),
      addressFormat: text("address_format").notNull(),
      path: text("path").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("wallet_accounts_wallet_path_key").on(t.walletId, t.path),
      check("wallet_accounts_chain", sql`${t.chain} in ('monad')`),
      check("wallet_accounts_address_format", sql`${t.address} ~ '^0x[0-9a-fA-F]{40}$'`),
    ],
  )
  .enableRLS();

/** One wallet per agent, linked only once its policies were approved. */
export const agentWallets = wallets
  .table(
    "agent_wallets",
    {
      agentId: uuid("agent_id")
        .primaryKey()
        .references(() => agents.id, { onDelete: "cascade" }),
      walletId: text("wallet_id")
        .notNull()
        .references(() => walletRecords.walletId),
      /** Turnkey policy ids the person approved for this wallet, in the order created. */
      policyIds: text("policy_ids").array().notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("agent_wallets_wallet_key").on(t.walletId),
      check("agent_wallets_policies", sql`cardinality(${t.policyIds}) >= 2`),
    ],
  )
  .enableRLS();

/** What the person sent from the master wallet to an agent's. The chain is the truth; this is the receipt. */
export const deposits = wallets
  .table(
    "deposits",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "cascade" }),
      txHash: text("tx_hash").notNull(),
      amountMicroUsd: bigint("amount_micro_usd", { mode: "bigint" }).notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("deposits_tx_key").on(t.txHash),
      index("deposits_agent_idx").on(t.agentId),
      check("deposits_tx_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
      check("deposits_amount_positive", sql`${t.amountMicroUsd} > 0`),
    ],
  )
  .enableRLS();

/** Master ↔ agent moves of AUSD or MON, signed by the person's passkey. The chain is the truth; this is the receipt. */
export const transfers = wallets
  .table(
    "transfers",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      fromWalletId: text("from_wallet_id").notNull(),
      toWalletId: text("to_wallet_id").notNull(),
      token: text("token").notNull(),
      /** Micro-AUSD or wei, by `token`. */
      amount: numeric("amount", { precision: 78, scale: 0 }).notNull(),
      txHash: text("tx_hash").notNull(),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex("transfers_tx_key").on(t.txHash),
      index("transfers_user_idx").on(t.userId),
      check("transfers_token", sql`${t.token} in ('ausd', 'mon')`),
      check("transfers_amount_positive", sql`${t.amount} > 0`),
      check("transfers_tx_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();

/** Local mirror of the credentials Turnkey holds, for listing devices in the interface. */
export const passkeys = wallets
  .table(
    "passkeys",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      userId: uuid("user_id").notNull(),
      credentialId: text("credential_id").notNull(),
      label: text("label").notNull(),
      transports: text("transports")
        .array()
        .notNull()
        .default(sql`array[]::text[]`),
      deviceType: text("device_type"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("passkeys_credential_key").on(t.credentialId),
      index("passkeys_user_idx").on(t.userId),
    ],
  )
  .enableRLS();

/** Single-use, five-minute TTL. Consumed with DELETE ... RETURNING. */
export const webauthnChallenges = wallets
  .table(
    "webauthn_challenges",
    {
      challenge: text("challenge").primaryKey(),
      userId: uuid("user_id").notNull(),
      expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    },
    (t) => [index("webauthn_challenges_expiry_idx").on(t.expiresAt)],
  )
  .enableRLS();
