import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Pool } from "pg";
import {
  MAX_OPEN_NONCES_PER_ADDRESS,
  normalizeAddress,
  type Namespace,
  type NonceHolder,
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

/**
 * How many expired nonces one issue deletes at most. Nothing else deletes them, so every issue
 * does; the bound is what keeps a backlog from landing on whoever asks next.
 */
export const EXPIRED_NONCE_PURGE_BATCH = 100;

const TAG_LENGTH = 16;

/**
 * `identity.siwe_nonces` has two columns, the nonce and its expiry, and no place for who the nonce
 * was issued to. So the row's key is the holder's tag followed by the nonce: sixteen hex characters
 * of sha256 over `namespace:address`, the digest the synthetic email uses. That makes "this
 * address's open nonces" a range of the primary key, and it binds the nonce to the address — one
 * issued for a wallet cannot be spent in a message naming another.
 *
 * The person is handed the nonce alone; the tag never leaves this file.
 */
function holderTag(holder: NonceHolder): string {
  const digest = sha256(new TextEncoder().encode(`${holder.namespace}:${holder.address}`));
  return bytesToHex(digest).slice(0, TAG_LENGTH);
}

export class PostgresWalletIdentityStore implements NonceStore, WalletLinkRepository {
  constructor(private readonly pool: Pool) {}

  /**
   * Always issues. The route is public and the address unverified, so anybody can ask for nonces
   * in somebody else's name: a cap that refused would let them keep that wallet from signing in
   * for as long as they kept asking. Instead the holder's oldest nonces are evicted, so that with
   * the new one it holds `MAX_OPEN_NONCES_PER_ADDRESS` at most. That bounds the rows an address
   * can have, and all a stranger can do with it is invalidate a nonce the holder has not used
   * yet, which costs the holder one retry.
   *
   * The statement deletes a bounded batch of expired nonces through `siwe_nonces_expiry_idx`,
   * evicts, and inserts. Both deletes go through `ctid` because DELETE has no LIMIT or OFFSET;
   * both skip locked rows, so two issues at once share the backlog instead of waiting on each
   * other, and an eviction never waits on another holder's purge of the same expired row — two
   * of those waiting on each other would be a deadlock.
   *
   * The holder's rows are a range of the primary key — every key with this tag sorts between the
   * tag and the tag followed by `g`, a character no hex digit reaches — with `starts_with` as the
   * exact test, so a collation that orders otherwise can only make the range wider than the
   * answer, never the answer wrong.
   *
   * A statement reads the snapshot it started with, so two issues for one address at once would
   * each evict down to four and leave six. The advisory lock, held until the transaction ends,
   * makes issues for one holder take turns; other holders are not kept waiting.
   */
  async issue(nonce: string, expiresAt: Date, holder: NonceHolder): Promise<void> {
    const tag = holderTag(holder);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `identity.siwe_nonces:${tag}`,
      ]);
      await client.query(
        `WITH purged AS (
           DELETE FROM identity.siwe_nonces
            WHERE ctid = ANY (ARRAY(
                    SELECT ctid
                      FROM identity.siwe_nonces
                     WHERE expires_at < now()
                     ORDER BY expires_at
                     LIMIT $5
                       FOR UPDATE SKIP LOCKED))
         ), evicted AS (
           DELETE FROM identity.siwe_nonces
            WHERE ctid = ANY (ARRAY(
                    SELECT ctid
                      FROM identity.siwe_nonces
                     WHERE nonce >= $3 AND nonce < $4
                       AND starts_with(nonce, $3)
                     ORDER BY expires_at DESC, nonce
                    OFFSET $6
                       FOR UPDATE SKIP LOCKED))
         )
         INSERT INTO identity.siwe_nonces (nonce, expires_at) VALUES ($1, $2)`,
        [
          `${tag}${nonce}`,
          expiresAt,
          tag,
          `${tag}g`,
          EXPIRED_NONCE_PURGE_BATCH,
          MAX_OPEN_NONCES_PER_ADDRESS - 1,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** One statement, so two concurrent verifications cannot both receive the same nonce. */
  async consume(nonce: string, holder: NonceHolder): Promise<{ expiresAt: Date } | null> {
    const { rows } = await this.pool.query<{ expiresAt: Date }>(
      `DELETE FROM identity.siwe_nonces
        WHERE nonce = $1
        RETURNING expires_at AS "expiresAt"`,
      [`${holderTag(holder)}${nonce}`],
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
