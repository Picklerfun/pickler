// Ported from Relayer signing repositories (commit bb6bb1226e92). Two changes:
// the four inserts run in one transaction rather than in sequence — Relayer's version logs
// "orphan in Turnkey" on every intermediate failure — and challenges are consumed with
// DELETE ... RETURNING instead of a Redis get-then-delete.

import type { Pool } from "pg";
import {
  AgentWalletNotFoundError,
  DelegatedUserExistsError,
  DepositAlreadyRecordedError,
} from "@pickler/core";
import type {
  AgentWallet,
  AgentWalletRepository,
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  OrphanAgentWallet,
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
   * The newest unlinked agent wallet of this person's under this name, if a creation failed, with
   * the policy ids its owner approved (core decides from them whether the rules step is done).
   */
  async findOrphanWallet(userId: string, name: string): Promise<OrphanAgentWallet | null> {
    const { rows } = await this.pool.query<OrphanAgentWallet>(
      `SELECT w.wallet_id AS "walletId", a.address, w.approved_policy_ids AS "approvedPolicyIds"
         FROM wallets.wallets w
         JOIN wallets.wallet_accounts a ON a.wallet_id = w.wallet_id
        WHERE w.user_id = $1
          AND w.kind = 'agent'
          AND w.name = $2
          AND NOT EXISTS (SELECT 1 FROM wallets.agent_wallets l WHERE l.wallet_id = w.wallet_id)
        ORDER BY w.created_at DESC
        LIMIT 1`,
      [userId, name],
    );
    return rows[0] ?? null;
  }

  async findOwnedAgentWallet(userId: string, walletId: string): Promise<AgentWallet | null> {
    const { rows } = await this.pool.query<AgentWallet>(
      `SELECT w.wallet_id AS "walletId", a.address
         FROM wallets.wallets w
         JOIN wallets.wallet_accounts a ON a.wallet_id = w.wallet_id
        WHERE w.user_id = $1
          AND w.wallet_id = $2
          AND w.kind = 'agent'
        LIMIT 1`,
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
