// Ported from Relayer signing repositories (commit bb6bb1226e92). Two changes:
// the four inserts run in one transaction rather than in sequence — Relayer's version logs
// "orphan in Turnkey" on every intermediate failure — and challenges are consumed with
// DELETE ... RETURNING instead of a Redis get-then-delete.

import type { Pool } from "pg";
import type {
  ChallengeStore,
  CustodyAccount,
  CustodyRepository,
  RegistrationInput,
  StoredChallenge,
} from "@pickler/core";

export class PostgresCustodyStore implements CustodyRepository, ChallengeStore {
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
