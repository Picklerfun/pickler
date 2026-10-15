import type { Pool } from "pg";
import type { KuruTokenLaunchPolicy } from "./policy.js";
export interface KuruPositionSnapshot {
  owner: string;
  market: string;
  baseToken: string;
  quoteToken: string;
  accountId: string;
  positions: { id: string; owner: string; low: number; high: number; shares: string }[];
  tokenReserved: string;
  quoteReserved: string;
}
/** Read each snapshot at the event block, outside SQL transactions, then validate canonicality again. */
export class PostgresKuruProjector {
  constructor(
    private readonly pool: Pool,
    private readonly policy: KuruTokenLaunchPolicy,
    private readonly lease?: { chain: string; owner: string },
  ) {}
  async project(
    read: (
      vault: string,
      market: string,
      block: number,
      blockHash: string,
    ) => Promise<KuruPositionSnapshot>,
  ) {
    const rows = await this.pool.query<{
      decoded: Record<string, string>;
      blockHash: string;
      blockNumber: number;
      txHash: string;
    }>(
      `
      SELECT e.decoded,e.block_hash AS "blockHash",e.block_number AS "blockNumber",e.tx_hash AS "txHash"
      FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
      WHERE e.chain='eip155:10143' AND e.emitter=$1 AND e.event_name='LaunchGraduatedKuru'
        AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')
        AND NOT EXISTS(SELECT 1 FROM market.kuru_graduations g WHERE g.chain=e.chain AND g.token=lower(e.decoded->>'token') AND g.block_hash=e.block_hash)
      ORDER BY e.block_number,e.log_index`,
      [this.policy.adapter.address],
    );
    let projected = 0;
    for (const event of rows.rows) {
      const d = event.decoded;
      if (
        d.venueHash !== this.policy.approvedVenueConfigHash ||
        !/^0x[0-9a-f]{40}$/i.test(d.token ?? "") ||
        !/^0x[0-9a-f]{40}$/i.test(d.market ?? "") ||
        !/^0x[0-9a-f]{40}$/i.test(d.vault ?? "")
      ) {
        throw new Error("INVALID_KURU_GRADUATION");
      }
      const snapshot = await read(d.vault!, d.market!, event.blockNumber, event.blockHash);
      if (
        snapshot.owner.toLowerCase() !== d.vault!.toLowerCase() ||
        snapshot.market.toLowerCase() !== d.market!.toLowerCase() ||
        snapshot.baseToken.toLowerCase() !== d.token!.toLowerCase() ||
        snapshot.quoteToken.toLowerCase() !== this.policy.preset.quoteAddress ||
        snapshot.accountId !== d.accountId ||
        snapshot.tokenReserved !== d.tokensReserved ||
        snapshot.quoteReserved !== d.quoteReserved ||
        !snapshot.positions.length ||
        snapshot.positions.length > 32 ||
        new Set(snapshot.positions.map((p) => p.id)).size !== snapshot.positions.length ||
        snapshot.positions.some(
          (p) => p.owner !== d.accountId || BigInt(p.shares) <= 0n || p.low <= 0 || p.high <= p.low,
        ) ||
        BigInt(d.tokensReserved!) + BigInt(d.tokenRemainder!) !== BigInt(d.tokensReleased!) ||
        BigInt(d.quoteReserved!) + BigInt(d.quoteRemainder!) !== BigInt(d.quoteReleased!)
      ) {
        throw new Error("INVALID_KURU_POSITIONS");
      }
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        if (this.lease) {
          const r = await client.query(
            "SELECT 1 FROM launch.indexer_admission WHERE chain=$1 AND owner=$2 AND expires_at>clock_timestamp() FOR UPDATE",
            [this.lease.chain, this.lease.owner],
          );
          if (!r.rowCount) {
            throw new Error("INDEX_LEASE_LOST");
          }
        }
        const token = await client.query<{ id: string }>(
          `SELECT t.id FROM market.tokens t JOIN market.chain_events e ON e.chain=t.chain AND e.tx_hash=t.launch_tx_hash
          JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
          JOIN launch.grants g ON g.agent_id=t.agent_id AND g.chain=t.chain AND g.factory=e.emitter
          WHERE t.chain='eip155:10143' AND t.address=$1 AND t.agent_id IS NOT NULL AND e.event_name='LaunchCreated'
            AND g.factory=$2 AND g.payload->'params'->>'expectedConfigHash'=$3
            AND lower(e.decoded->>'token')=t.address AND lower(e.decoded->>'creator')=lower(g.payload->'params'->>'creator')
            AND lower(e.decoded->>'metadataHash')=lower(g.payload->'params'->>'metadataHash')
            AND lower(e.decoded->>'agentKey')=lower(g.payload->'params'->>'agentKey')
            AND lower(e.decoded->>'curve')=$4
            AND date_trunc('second',g.created_at)<=b.block_time AND g.expires_at>=b.block_time AND NOT e.orphaned AND NOT b.orphaned
            AND b.finality IN ('confirmed','finalized') FOR UPDATE OF t`,
          [
            d.token!.toLowerCase(),
            this.policy.factory.address,
            this.policy.preset.configHash,
            d.curve!.toLowerCase(),
          ],
        );
        const block = await client.query(
          `SELECT 1 FROM market.chain_blocks WHERE chain='eip155:10143' AND hash=$1 AND NOT orphaned AND finality IN ('confirmed','finalized') FOR SHARE`,
          [event.blockHash],
        );
        if (!token.rows[0] || !block.rowCount) {
          await client.query("ROLLBACK");
          continue;
        }
        await client.query(
          `INSERT INTO market.kuru_graduations(chain,token,market,vault,account_id,venue_hash,adapter,block_hash,block_number,tx_hash,positions,token_reserved,quote_reserved,token_remainder,quote_remainder)
          VALUES('eip155:10143',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT DO NOTHING`,
          [
            d.token!.toLowerCase(),
            d.market!.toLowerCase(),
            d.vault!.toLowerCase(),
            d.accountId,
            d.venueHash,
            this.policy.adapter.address,
            event.blockHash,
            event.blockNumber,
            event.txHash,
            JSON.stringify(snapshot.positions),
            d.tokensReserved,
            d.quoteReserved,
            d.tokenRemainder,
            d.quoteRemainder,
          ],
        );
        await client.query(
          `INSERT INTO market.pools(token_id,phase,venue,address,pool_key,opened_tx_hash,opened_at)
          SELECT $1,'post_graduation','kuru_passive',$2,NULL,$3,block_time FROM market.chain_blocks WHERE chain='eip155:10143' AND hash=$4
          ON CONFLICT(token_id,phase) DO UPDATE SET venue='kuru_passive',address=EXCLUDED.address,pool_key=EXCLUDED.pool_key,opened_tx_hash=EXCLUDED.opened_tx_hash,opened_at=EXCLUDED.opened_at`,
          [token.rows[0].id, d.market!.toLowerCase(), event.txHash, event.blockHash],
        );
        await client.query(
          `UPDATE market.tokens SET status='graduated',graduated_at=(SELECT block_time FROM market.chain_blocks WHERE chain='eip155:10143' AND hash=$2) WHERE id=$1`,
          [token.rows[0].id, event.blockHash],
        );
        await client.query("COMMIT");
        projected++;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    // Reapply stored canonical snapshots on every replay, without another RPC read.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (this.lease) {
        const r = await client.query(
          "SELECT 1 FROM launch.indexer_admission WHERE chain=$1 AND owner=$2 AND expires_at>clock_timestamp() FOR UPDATE",
          [this.lease.chain, this.lease.owner],
        );
        if (!r.rowCount) {
          throw new Error("INDEX_LEASE_LOST");
        }
      }
      await client.query(
        `SELECT hash FROM market.chain_blocks WHERE chain='eip155:10143' AND NOT orphaned FOR SHARE`,
      );
      await client.query(
        `UPDATE market.tokens t SET status='graduated',graduated_at=b.block_time FROM market.kuru_graduations g JOIN market.chain_blocks b ON b.chain=g.chain AND b.hash=g.block_hash WHERE t.chain=g.chain AND t.address=g.token AND t.status<>'failed' AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')`,
      );
      // Retain orphaned snapshots as history; remove only their active interpretation.
      await client.query(`UPDATE market.tokens t SET status='pre_graduation',graduated_at=NULL WHERE t.chain='eip155:10143' AND t.status<>'failed'
        AND EXISTS(SELECT 1 FROM market.kuru_graduations g WHERE g.chain=t.chain AND g.token=t.address)
        AND NOT EXISTS(SELECT 1 FROM market.kuru_graduations g JOIN market.chain_blocks b ON b.chain=g.chain AND b.hash=g.block_hash WHERE g.chain=t.chain AND g.token=t.address AND NOT b.orphaned AND b.finality IN ('confirmed','finalized'))`);
      await client.query(`DELETE FROM market.pools p USING market.tokens t WHERE p.token_id=t.id AND t.chain='eip155:10143' AND p.venue='kuru_passive'
        AND NOT EXISTS(SELECT 1 FROM market.kuru_graduations g JOIN market.chain_blocks b ON b.chain=g.chain AND b.hash=g.block_hash WHERE g.chain=t.chain AND g.token=t.address AND NOT b.orphaned AND b.finality IN ('confirmed','finalized'))`);
      // A branch that becomes canonical again restores its pool without repeating snapshot reads.
      await client.query(`INSERT INTO market.pools(token_id,phase,venue,address,opened_tx_hash,opened_at)
        SELECT t.id,'post_graduation','kuru_passive',g.market,g.tx_hash,b.block_time FROM market.kuru_graduations g JOIN market.chain_blocks b ON b.chain=g.chain AND b.hash=g.block_hash JOIN market.tokens t ON t.chain=g.chain AND t.address=g.token
        WHERE NOT b.orphaned AND b.finality IN ('confirmed','finalized') AND t.status='graduated'
        ON CONFLICT(token_id,phase) DO UPDATE SET venue='kuru_passive',address=EXCLUDED.address,pool_key=NULL,opened_tx_hash=EXCLUDED.opened_tx_hash,opened_at=EXCLUDED.opened_at`);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return projected;
  }
}
