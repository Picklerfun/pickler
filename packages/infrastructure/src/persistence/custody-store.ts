// Ported from Relayer signing repositories (commit bb6bb1226e92). Two changes:
// the four inserts run in one transaction rather than in sequence — Relayer's version logs
// "orphan in Turnkey" on every intermediate failure — and challenges are consumed with
// DELETE ... RETURNING instead of a Redis get-then-delete.

import type { Pool } from "pg";
import {
  AgentWalletNotFoundError,
  DelegatedUserExistsError,
  DepositAlreadyRecordedError,
  LEVERAGE_BOUNDS,
  MIN_AGENT_WALLET_POLICIES,
  TransferAlreadyRecordedError,
} from "@pickler/core";
import type {
  AgentWallet,
  AgentWalletRepository,
  AgentWalletSummary,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  UnlinkedAgentWallet,
  Passkey,
  RegistrationInput,
  StoredChallenge,
} from "@pickler/core";

export class PostgresCustodyStore
  implements CustodyRepository, ChallengeStore, AgentWalletRepository
{
  constructor(private readonly pool: Pool) {}

  async findByUserId(userId: string): Promise<CustodyAccount | null> {
    const { rows } = await this.pool.query<CustodyAccount>(
      `SELECT o.user_id AS "userId",
              o.sub_organization_id AS "subOrganizationId",
              o.master_wallet_id AS "masterWalletId",
              o.root_user_id AS "rootUserId",
              a.address AS "address"
         FROM wallets.turnkey_orgs o
         JOIN wallets.wallet_accounts a ON a.wallet_id = o.master_wallet_id
        WHERE o.user_id = $1
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async listCredentials(userId: string) {
    const { rows } = await this.pool.query<{ credentialId: string; transports: string[] }>(
      `SELECT credential_id AS "credentialId", transports
         FROM wallets.passkeys
        WHERE user_id = $1
        ORDER BY created_at`,
      [userId],
    );
    return rows;
  }

  /**
   * Every passkey on the account, oldest first.
   *
   * Beside `listCredentials` and not folded into it: that one feeds `excludeCredentials`, whose
   * caller swallows a failure, and this one answers a question about whether somebody can still
   * reach their funds. Nothing here catches, so an unreachable database reaches the route as a
   * failure rather than as an account with no passkeys.
   *
   * `device_type` and `last_used_at` are selected as they are stored, null included. A COALESCE
   * here would turn "this passkey has never been used" into a date, which is the one thing the
   * column exists to be able to say.
   */
  async listPasskeys(userId: string): Promise<Passkey[]> {
    const { rows } = await this.pool.query<Passkey>(
      `SELECT id,
              credential_id AS "credentialId",
              label,
              transports,
              device_type AS "deviceType",
              created_at AS "createdAt",
              last_used_at AS "lastUsedAt"
         FROM wallets.passkeys
        WHERE user_id = $1
        ORDER BY created_at, id`,
      [userId],
    );
    return rows;
  }

  async saveRegistration(input: RegistrationInput): Promise<{ created: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const org = await client.query(
        `INSERT INTO wallets.turnkey_orgs
           (user_id, sub_organization_id, master_wallet_id, root_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING user_id`,
        [input.userId, input.subOrganizationId, input.masterWalletId, input.rootUserId],
      );
      if (org.rowCount === 0) {
        await client.query("ROLLBACK");
        return { created: false };
      }
      await client.query(
        `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
         VALUES ($1, $2, $3, 'master', 'Master Wallet')`,
        [input.userId, input.walletId, input.subOrganizationId],
      );
      await client.query(
        `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
         VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', $3)`,
        [input.walletId, input.address, "m/44'/60'/0'/0/0"],
      );
      await client.query(
        `INSERT INTO wallets.passkeys (user_id, credential_id, label, transports, device_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [input.userId, input.credentialId, input.label, input.transports, input.deviceType],
      );
      await client.query("COMMIT");
      return { created: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async addPasskey(input: {
    userId: string;
    credentialId: string;
    label: string;
    transports: string[];
    deviceType: string;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO wallets.passkeys (user_id, credential_id, label, transports, device_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (credential_id) DO NOTHING`,
      [input.userId, input.credentialId, input.label, input.transports, input.deviceType],
    );
  }

  /**
   * Sets the delegated user once. The same id again is a no-op (a retried confirm); a different
   * one is refused, because a second Pickler user in someone's sub-organization would be a key
   * nobody records. No row at all means no sub-organization, which is refused too.
   */
  async saveDelegatedUser(userId: string, delegatedUserId: string): Promise<void> {
    const { rows } = await this.pool.query<{ delegatedUserId: string | null }>(
      `UPDATE wallets.turnkey_orgs
          SET delegated_user_id = $2
        WHERE user_id = $1
          AND (delegated_user_id IS NULL OR delegated_user_id = $2)
        RETURNING delegated_user_id AS "delegatedUserId"`,
      [userId, delegatedUserId],
    );
    if (rows.length === 0) {
      throw new DelegatedUserExistsError();
    }
  }

  async delegatedUserId(userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ delegatedUserId: string | null }>(
      `SELECT delegated_user_id AS "delegatedUserId"
         FROM wallets.turnkey_orgs
        WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.delegatedUserId ?? null;
  }

  async saveWallet(input: {
    userId: string;
    walletId: string;
    subOrganizationId: string;
    kind: "agent";
    name: string;
    address: string;
    path: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        `INSERT INTO wallets.wallets (user_id, wallet_id, sub_organization_id, kind, name)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (wallet_id) DO NOTHING`,
        [input.userId, input.walletId, input.subOrganizationId, input.kind, input.name],
      );
      if (inserted.rowCount === 0) {
        // A re-forwarded stamp: Turnkey answers the same wallet again. Idempotent when the row
        // is this person's; anyone else's wallet id is never adopted.
        const { rows } = await client.query<{ userId: string }>(
          `SELECT user_id AS "userId" FROM wallets.wallets WHERE wallet_id = $1 FOR UPDATE`,
          [input.walletId],
        );
        if (rows[0]?.userId !== input.userId) {
          throw new Error(`Wallet ${input.walletId} is already recorded for another person`);
        }
      }
      await client.query(
        `INSERT INTO wallets.wallet_accounts (wallet_id, chain, address, address_format, path)
         VALUES ($1, 'monad', $2, 'ADDRESS_FORMAT_ETHEREUM', $3)
         ON CONFLICT (wallet_id, path) DO NOTHING`,
        [input.walletId, input.address, input.path],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The newest unlinked agent wallet of this person's, if a creation stopped before its link, with
   * the policy ids its owner approved (core decides from them whether the rules step is done).
   */
  async findUnlinkedWallet(userId: string): Promise<UnlinkedAgentWallet | null> {
    const { rows } = await this.pool.query<UnlinkedAgentWallet>(
      `SELECT w.wallet_id AS "walletId", a.address, w.approved_policy_ids AS "approvedPolicyIds"
         FROM wallets.wallets w
         JOIN LATERAL (
           SELECT address FROM wallets.wallet_accounts
            WHERE wallet_id = w.wallet_id ORDER BY created_at LIMIT 1
         ) a ON true
        WHERE w.user_id = $1 AND w.kind = 'agent'
          AND NOT EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id = w.wallet_id)
        ORDER BY w.created_at DESC, w.wallet_id DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async countAgentWallets(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM wallets.wallets WHERE user_id = $1 AND kind = 'agent'",
      [userId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  async listAgentWallets(userId: string): Promise<AgentWalletSummary[]> {
    const { rows } = await this.pool.query<{
      walletId: string;
      address: string;
      agentId: string | null;
      agentName: string | null;
      approvedPolicyIds: string[] | null;
      spend: { perCallAusd: number; perDayAusd: number } | null;
      maxLeverage: number | null;
    }>(
      `SELECT w.wallet_id AS "walletId", a.address, l.agent_id::text AS "agentId", ag.name AS "agentName",
              w.approved_policy_ids AS "approvedPolicyIds", pa.config->'spend' AS spend,
              (pa.config->>'maxLeverage')::int AS "maxLeverage"
         FROM wallets.wallets w
         JOIN LATERAL (
           SELECT address FROM wallets.wallet_accounts
            WHERE wallet_id = w.wallet_id ORDER BY created_at LIMIT 1
         ) a ON true
         LEFT JOIN wallets.agent_wallets l ON l.wallet_id = w.wallet_id
         LEFT JOIN agents.agents ag ON ag.id = l.agent_id
         LEFT JOIN pickler.product_agents p ON p.product_agent_id = l.agent_id
         LEFT JOIN pickler.agents pa ON pa.tenant_id = p.tenant_id AND pa.id = p.runtime_agent_id
        WHERE w.user_id = $1 AND w.kind = 'agent'
        ORDER BY w.created_at, w.wallet_id`,
      [userId],
    );
    return rows.map((row) => ({
      walletId: row.walletId,
      address: row.address,
      agentId: row.agentId,
      agentName: row.agentName,
      policiesApproved: (row.approvedPolicyIds?.length ?? 0) >= MIN_AGENT_WALLET_POLICIES,
      caps: row.spend
        ? {
            perTradeAusd: row.spend.perCallAusd,
            perDayAusd: row.spend.perDayAusd,
            maxLeverage: row.maxLeverage ?? LEVERAGE_BOUNDS.min,
          }
        : null,
    }));
  }

  async saveTransfer(input: {
    userId: string;
    fromWalletId: string;
    toWalletId: string;
    token: "ausd" | "mon";
    amount: bigint;
    txHash: string;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO wallets.transfers (user_id, from_wallet_id, to_wallet_id, token, amount, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.userId,
          input.fromWalletId,
          input.toWalletId,
          input.token,
          input.amount.toString(),
          input.txHash.toLowerCase(),
        ],
      );
    } catch (error) {
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === "23505" && constraint === "transfers_tx_key") {
        throw new TransferAlreadyRecordedError();
      }
      throw error;
    }
  }

  async transferRecorded(txHash: string): Promise<boolean> {
    const { rows } = await this.pool.query("SELECT 1 FROM wallets.transfers WHERE tx_hash = $1", [
      txHash.toLowerCase(),
    ]);
    return rows.length > 0;
  }

  async findOwnedAgentWallet(
    userId: string,
    walletId: string,
  ): Promise<(AgentWallet & { linked: boolean }) | null> {
    // The first account's address, as `listAgentWallets` and `findUnlinkedWallet` read it, so a
    // transfer or a balance read never uses an address other than the one the studio shows.
    const { rows } = await this.pool.query<AgentWallet & { linked: boolean }>(
      `SELECT w.wallet_id AS "walletId", a.address,
              EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id = w.wallet_id) AS linked
         FROM wallets.wallets w
         JOIN LATERAL (
           SELECT address FROM wallets.wallet_accounts
            WHERE wallet_id = w.wallet_id ORDER BY created_at LIMIT 1
         ) a ON true
        WHERE w.user_id = $1
          AND w.wallet_id = $2
          AND w.kind = 'agent'`,
      [userId, walletId],
    );
    return rows[0] ?? null;
  }

  async hasLinkedAgentWallet(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ linked: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM wallets.agent_wallets l
           JOIN wallets.wallets w ON w.wallet_id = l.wallet_id
          WHERE w.user_id = $1
       ) AS linked`,
      [userId],
    );
    return rows[0]?.linked === true;
  }

  async findAgentWallet(agentId: string): Promise<AgentWallet | null> {
    const { rows } = await this.pool.query<AgentWallet>(
      `SELECT l.wallet_id AS "walletId", a.address
         FROM wallets.agent_wallets l
         JOIN wallets.wallet_accounts a ON a.wallet_id = l.wallet_id
        WHERE l.agent_id = $1
        LIMIT 1`,
      [agentId],
    );
    return rows[0] ?? null;
  }

  /**
   * Updates only the caller's own `kind='agent'` wallet, so the ids a stranger's confirm produced
   * can never land on someone else's wallet. No matching row is `AgentWalletNotFoundError`, the
   * same refusal `findOwnedAgentWallet`'s absence maps to elsewhere.
   */
  async saveApprovedPolicies(userId: string, walletId: string, policyIds: string[]): Promise<void> {
    const { rowCount } = await this.pool.query(
      `UPDATE wallets.wallets
          SET approved_policy_ids = $3
        WHERE wallet_id = $1
          AND user_id = $2
          AND kind = 'agent'`,
      [walletId, userId, policyIds],
    );
    if (rowCount === 0) {
      throw new AgentWalletNotFoundError();
    }
  }

  /** The hash is lowercased: the column accepts only `^0x[0-9a-f]{64}$`, and wallets vary. */
  async saveDeposit(input: {
    agentId: string;
    txHash: string;
    amountMicroUsd: bigint;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO wallets.deposits (agent_id, tx_hash, amount_micro_usd) VALUES ($1, $2, $3)`,
        [input.agentId, input.txHash.toLowerCase(), input.amountMicroUsd.toString()],
      );
    } catch (error) {
      // Only the hash's unique index: any other failure is not "already recorded".
      const { code, constraint } = error as { code?: string; constraint?: string };
      if (code === "23505" && constraint === "deposits_tx_key") {
        throw new DepositAlreadyRecordedError();
      }
      throw error;
    }
  }

  async depositRecorded(txHash: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM wallets.deposits WHERE tx_hash = $1 LIMIT 1`,
      [txHash.toLowerCase()],
    );
    return rows.length > 0;
  }

  async put(challenge: string, record: StoredChallenge): Promise<void> {
    await this.pool.query(
      `INSERT INTO wallets.webauthn_challenges (challenge, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [challenge, record.userId, record.expiresAt],
    );
  }

  /** One statement, so two concurrent readers cannot both receive the same challenge. */
  async consume(challenge: string): Promise<StoredChallenge | null> {
    const { rows } = await this.pool.query<{ userId: string; expiresAt: Date }>(
      `DELETE FROM wallets.webauthn_challenges
        WHERE challenge = $1
        RETURNING user_id AS "userId", expires_at AS "expiresAt"`,
      [challenge],
    );
    return rows[0] ?? null;
  }
}
