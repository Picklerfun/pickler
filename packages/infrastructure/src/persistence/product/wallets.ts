// Ported from Relayer signing.{turnkey_orgs,wallets,wallet_accounts,passkeys}
// (commit bb6bb1226e92). Two deliberate changes, both required by
// docs/relayer-extraction/00-plan.md:
//   - the key is user_id, not integrator_id: a Pickler workspace is already unique per owner
//     and registration must not wait for one to exist;
//   - challenges live here rather than in Redis, because Workers has no Redis and KV cannot
//     promise a single consumer (blocker W2).

import { sql } from "drizzle-orm";
import { check, index, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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
