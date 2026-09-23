import type { Pool } from "pg";
import {
  normalizeAddress,
  type Namespace,
  type NonceStore,
  type NormalizedAddress,
  type WalletLink,
  type WalletLinkRepository,
} from "@pickler/core";

/** What Postgres hands back: every branded or unioned column arrives as a plain string. */
interface WalletLinkRow {
  userId: string;
  namespace: string;
  address: string;
  verifiedChain: string;
  kind: string;
  verifiedAt: Date;
}

const COLUMNS = `user_id AS "userId", namespace, address,
              verified_chain AS "verifiedChain", kind, verified_at AS "verifiedAt"`;

function namespaceOf(value: string): Namespace {
  if (value !== "eip155" && value !== "solana") {
    throw new Error(`identity.wallet_links holds a namespace this code cannot read: ${value}`);
  }
  return value;
}

function kindOf(value: string): WalletLink["kind"] {
  if (value !== "external" && value !== "mera") {
    throw new Error(`identity.wallet_links holds a kind this code cannot read: ${value}`);
  }
  return value;
}

/**
 * Re-runs each row through the domain rather than casting it.
 *
 * A cast asserts the invariant; `normalizeAddress` re-establishes it, and that is the difference
 * that matters at a read boundary — a branded value that came from a cast proves something about
 * the code that wrote it, not about the row that came back. The cost is one regex per row, and in
 * exchange a row that is already wrong raises here instead of travelling on as a `NormalizedAddress`
 * that is nothing of the kind.
 */
function toWalletLink(row: WalletLinkRow): WalletLink {
  const namespace = namespaceOf(row.namespace);
  return {
    userId: row.userId,
    namespace,
    address: normalizeAddress(namespace, row.address),
    verifiedChain: row.verifiedChain,
    kind: kindOf(row.kind),
    verifiedAt: row.verifiedAt,
  };
}

export class PostgresWalletIdentityStore implements NonceStore, WalletLinkRepository {
  constructor(private readonly pool: Pool) {}

  async issue(nonce: string, expiresAt: Date): Promise<void> {
    await this.pool.query(`INSERT INTO identity.siwe_nonces (nonce, expires_at) VALUES ($1, $2)`, [
      nonce,
      expiresAt,
    ]);
  }

  /** One statement, so two concurrent verifications cannot both receive the same nonce. */
  async consume(nonce: string): Promise<{ expiresAt: Date } | null> {
    const { rows } = await this.pool.query<{ expiresAt: Date }>(
      `DELETE FROM identity.siwe_nonces
        WHERE nonce = $1
        RETURNING expires_at AS "expiresAt"`,
      [nonce],
    );
    return rows[0] ? { expiresAt: rows[0].expiresAt } : null;
  }

  async findByAddress(
    namespace: Namespace,
    address: NormalizedAddress,
  ): Promise<WalletLink | null> {
    const { rows } = await this.pool.query<WalletLinkRow>(
      `SELECT ${COLUMNS}
         FROM identity.wallet_links
        WHERE namespace = $1 AND address = $2`,
      [namespace, address],
    );
    const row = rows[0];
    return row ? toWalletLink(row) : null;
  }

  /**
   * ON CONFLICT DO NOTHING on the unique (namespace, address) index, so a concurrent link of the
   * same address reports `created: false` rather than raising. The caller decides what that means.
   *
   * That index is named `wallet_links_address_key`, which reads as uniqueness on the address
   * alone. It is not: a violation citing that name means the (namespace, address) pair is taken,
   * and one address is still free to be held in a second chain family.
   */
  async link(link: Omit<WalletLink, "verifiedAt">): Promise<{ created: boolean }> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO identity.wallet_links
         (user_id, namespace, verified_chain, address, method, kind, verified_at)
       VALUES ($1, $2, $3, $4, 'siwe', $5, now())
       ON CONFLICT (namespace, address) DO NOTHING`,
      [link.userId, link.namespace, link.verifiedChain, link.address, link.kind],
    );
    return { created: rowCount === 1 };
  }

  /** No catch. A failed read is a failure, never an account with no wallets. */
  async listForUser(userId: string): Promise<WalletLink[]> {
    const { rows } = await this.pool.query<WalletLinkRow>(
      `SELECT ${COLUMNS}
         FROM identity.wallet_links
        WHERE user_id = $1
        ORDER BY verified_at`,
      [userId],
    );
    return rows.map(toWalletLink);
  }
}
