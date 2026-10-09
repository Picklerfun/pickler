import type { Pool } from "pg";
import {
  PilotError,
  type AdvicePaymentRecord,
  type AdvicePaymentStore,
  type Authorization,
  type SaleTerms,
} from "@pickler/core";

const UNIQUE_VIOLATION = "23505";
const IN_PROGRESS = "An advice payment for this request is already in progress";

const RETURNING = `
  RETURNING id, job_id AS "jobId", status, tx_hash AS "txHash", payer, nonce,
    extract(epoch FROM valid_before)::bigint::text AS "validBefore"`;

export class PostgresAdvicePayments implements AdvicePaymentStore {
  constructor(private readonly pool: Pool) {}

  async saleTerms(publicAgentId: string): Promise<SaleTerms | null> {
    const { rows } = await this.pool.query<{ price: string; handle: string; payTo: string | null }>(
      `
      SELECT a.advice_price_micro_ausd::text AS price, a.handle,
        (
          SELECT address FROM wallets.wallet_accounts
           WHERE wallet_id = l.wallet_id
           ORDER BY created_at
           LIMIT 1
        ) AS "payTo"
        FROM agents.agents a
        JOIN wallets.agent_wallets l ON l.agent_id = a.id
       WHERE a.id = $1
         AND a.visibility = 'public'
         AND a.killed_at IS NULL
         AND a.advice_price_micro_ausd IS NOT NULL
      `,
      [publicAgentId],
    );
    const row = rows[0];

    if (!row || !row.payTo) {
      return null;
    }

    return { priceMicro: BigInt(row.price), payTo: row.payTo, handle: row.handle };
  }

  async payerLinked(userId: string, address: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `
      SELECT 1 FROM identity.wallet_links
       WHERE user_id = $1 AND lower(address) = lower($2)
       LIMIT 1
      `,
      [userId, address],
    );

    return (rowCount ?? 0) > 0;
  }

  async byKey(
    userId: string,
    publicAgentId: string,
    key: string,
  ): Promise<AdvicePaymentRecord | null> {
    const { rows } = await this.pool.query<AdvicePaymentRecord>(
      `
      SELECT id, job_id AS "jobId", status, tx_hash AS "txHash", payer, nonce,
             extract(epoch FROM valid_before)::bigint::text AS "validBefore"
        FROM pickler.advice_payments
       WHERE user_id = $1 AND public_agent_id = $2 AND request_key = $3
      `,
      [userId, publicAgentId, key],
    );

    return rows[0] ?? null;
  }

  async insertPending(input: {
    userId: string;
    publicAgentId: string;
    key: string;
    authorization: Authorization;
  }): Promise<AdvicePaymentRecord> {
    const { authorization } = input;

    try {
      const { rows } = await this.pool.query<AdvicePaymentRecord>(
        `
        INSERT INTO pickler.advice_payments
          (user_id, public_agent_id, request_key, payer, pay_to, amount_micro_ausd, nonce,
           valid_before, status)
        VALUES ($1, $2, $3, lower($4), lower($5), $6, lower($7), to_timestamp($8::bigint), 'pending')
        ON CONFLICT (user_id, public_agent_id, request_key) DO UPDATE SET
          payer = EXCLUDED.payer,
          pay_to = EXCLUDED.pay_to,
          amount_micro_ausd = EXCLUDED.amount_micro_ausd,
          nonce = EXCLUDED.nonce,
          valid_before = EXCLUDED.valid_before,
          status = 'pending',
          error = NULL,
          tx_hash = NULL,
          block_number = NULL,
          job_id = NULL,
          updated_at = clock_timestamp()
        WHERE advice_payments.status = 'failed'
        ${RETURNING}
        `,
        [
          input.userId,
          input.publicAgentId,
          input.key,
          authorization.from,
          authorization.to,
          authorization.value,
          authorization.nonce,
          authorization.validBefore,
        ],
      );

      if (!rows[0]) {
        throw new PilotError("CONFLICT", IN_PROGRESS);
      }

      return rows[0];
    } catch (error) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        throw new PilotError("CONFLICT", IN_PROGRESS);
      }

      throw error;
    }
  }

  async settled(id: string, txHash: string, blockNumber: bigint): Promise<void> {
    await this.pool.query(
      `
      UPDATE pickler.advice_payments
         SET status = 'settled', tx_hash = $2, block_number = $3, updated_at = clock_timestamp()
       WHERE id = $1
      `,
      [id, txHash, blockNumber.toString()],
    );
  }

  async failed(id: string, error: string): Promise<void> {
    await this.setStatus(id, "failed", error);
  }

  async refundOwed(id: string, error: string): Promise<void> {
    await this.setStatus(id, "refund_owed", error);
  }

  async attachJob(id: string, jobId: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE pickler.advice_payments
         SET job_id = $2, updated_at = clock_timestamp()
       WHERE id = $1
      `,
      [id, jobId],
    );
  }

  private async setStatus(id: string, status: string, error: string): Promise<void> {
    await this.pool.query(
      `
      UPDATE pickler.advice_payments
         SET status = $2, error = $3, updated_at = clock_timestamp()
       WHERE id = $1
      `,
      [id, status, error],
    );
  }
}
