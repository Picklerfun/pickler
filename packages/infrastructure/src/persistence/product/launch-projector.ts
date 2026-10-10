import { and, eq, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { databasePoolConfig, type DatabaseConnectionOptions } from "../connection.js";
import { chainEvents, pools, tokens, trades } from "./market.js";

/**
 * Turns indexed events into the catalogue the API serves.
 *
 * Reads only from `market.chain_events`, never from a node. That separation is what makes a
 * projection rebuildable: the events are the record of what happened, and this is one
 * interpretation of them that can be thrown away and recomputed without touching the chain.
 *
 * Only events on the canonical branch are projected. An orphaned event is still stored — it
 * is evidence of what a node said — but it describes a trade that did not happen, and
 * counting it would inflate a token's volume with a branch that lost.
 */
export interface LaunchMetadata {
  /** As the token contract reports it. */
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
}

/** Reads a launch's token metadata, which no event carries. */
export type MetadataReader = (token: string, atBlock: bigint) => Promise<LaunchMetadata>;

export interface ProjectionResult {
  launches: number;
  trades: number;
  graduations: number;
  /** Events seen but not understood well enough to project. Never silently zero. */
  skipped: number;
}

export class PostgresLaunchProjector {
  readonly pool: Pool;
  admissionFence?: { chain: string; owner: string };
  private readonly database: NodePgDatabase;

  constructor(connectionString: string | Pool, options?: DatabaseConnectionOptions) {
    this.pool =
      typeof connectionString === "string"
        ? new Pool(databasePoolConfig(connectionString, options))
        : connectionString;
    this.database = drizzle(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async mutation<T>(
    chain: string,
    blockHash: string | null,
    work: (tx: Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0]) => Promise<T>,
  ) {
    return this.database.transaction(async (tx) => {
      if (this.admissionFence) {
        const f = this.admissionFence;
        const r = await tx.execute(
          sql`SELECT 1 FROM launch.indexer_admission WHERE chain=${f.chain} AND owner=${f.owner}::uuid AND expires_at>clock_timestamp() FOR UPDATE`,
        );
        if (!r.rowCount) {
          throw new Error("INDEX_LEASE_LOST");
        }
      }
      if (blockHash) {
        const canonical = await tx.execute(
          sql`SELECT 1 FROM market.chain_blocks WHERE chain=${chain} AND hash=${blockHash} AND NOT orphaned FOR SHARE`,
        );
        if (!canonical.rowCount) {
          return undefined;
        }
      }
      return work(tx);
    });
  }

  /**
   * Projects every canonical event for a chain, in chain order.
   *
   * Idempotent by construction: each write is keyed by something the chain already made
   * unique — a token address, a pool's phase, a log's position — so running this twice
   * produces the same catalogue as running it once.
   */
  async project(chain: string, readMetadata: MetadataReader): Promise<ProjectionResult> {
    await this.mutation(chain, null, async (tx) => {
      await tx.execute(
        sql`DELETE FROM market.trades tr USING market.pools p,market.tokens t,market.chain_blocks b WHERE tr.pool_id=p.id AND p.token_id=t.id AND b.chain=t.chain AND b.hash=tr.block_hash AND t.chain=${chain} AND b.orphaned`,
      );
      await tx.execute(
        sql`UPDATE market.tokens t SET status='failed',graduated_at=NULL WHERE t.chain=${chain} AND t.launch_tx_hash IS NOT NULL AND EXISTS(SELECT 1 FROM market.chain_events e WHERE e.chain=t.chain AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated') AND NOT EXISTS(SELECT 1 FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash WHERE e.chain=t.chain AND e.tx_hash=t.launch_tx_hash AND e.event_name='LaunchCreated' AND NOT e.orphaned AND NOT b.orphaned)`,
      );
    });
    const rows = await this.database
      .select({
        blockNumber: chainEvents.blockNumber,
        blockHash: chainEvents.blockHash,
        txHash: chainEvents.txHash,
        logIndex: chainEvents.logIndex,
        emitter: chainEvents.emitter,
        eventName: chainEvents.eventName,
        decoded: chainEvents.decoded,
        blockTime: sql<Date>`(
          select "block_time" from "market"."chain_blocks"
          where "chain" = ${chain} and "hash" = ${chainEvents.blockHash}
        )`.as("block_time"),
      })
      .from(chainEvents)
      .where(and(eq(chainEvents.chain, chain), eq(chainEvents.orphaned, false)))
      .orderBy(chainEvents.blockNumber, chainEvents.logIndex);

    const result: ProjectionResult = { launches: 0, trades: 0, graduations: 0, skipped: 0 };

    for (const raw of rows) {
      // The driver hands a raw subquery column back as a string; every write below stores a
      // timestamp, so it is normalised once here rather than at each call site.
      const row = { ...raw, blockTime: new Date(raw.blockTime) };
      const args = row.decoded as Record<string, string> | null;

      if (args === null) {
        result.skipped++;
        continue;
      }

      switch (row.eventName) {
        case "LaunchCreated":
          await this.projectLaunch(chain, args, row, readMetadata);
          result.launches++;
          break;

        case "CurveBought":
        case "CurveSold":
          if (await this.projectTrade(chain, row.eventName, args, row)) {
            result.trades++;
          } else {
            result.skipped++;
          }
          break;

        case "LaunchGraduated":
          if (await this.projectGraduation(chain, args, row)) {
            result.graduations++;
          } else {
            result.skipped++;
          }
          break;

        default:
          result.skipped++;
      }
    }

    return result;
  }

  private async projectLaunch(
    chain: string,
    args: Record<string, string>,
    row: {
      txHash: string;
      blockNumber: number;
      blockTime: Date;
      blockHash: string;
      emitter: string;
    },
    readMetadata: MetadataReader,
  ): Promise<void> {
    const address = args.token!.toLowerCase();
    const curve = args.curve!.toLowerCase();
    const metadata = await readMetadata(address, BigInt(row.blockNumber));

    // Attribution requires a persisted grant for this factory and canonical confirmation.
    const mapping = await this.pool.query<{ agentId: string; imageUri: string | null }>(
      `
      SELECT k.agent_id AS "agentId",g.payload->>'imageUri' AS "imageUri"
      FROM launch.agent_keys k JOIN launch.grants g ON g.agent_id=k.agent_id AND g.chain=k.chain
      JOIN market.chain_blocks b ON b.chain=k.chain AND b.hash=$3
      WHERE k.chain=$1 AND k.agent_key=$2 AND NOT b.orphaned
        AND b.finality IN ('confirmed','finalized') AND g.factory=$4
        AND lower(g.payload->'params'->>'creator')=$5
        AND lower(g.payload->'params'->>'metadataHash')=$6
        AND lower(g.payload->'params'->>'expectedConfigHash')=$7
        AND date_trunc('second',g.created_at) <= b.block_time AND g.expires_at >= b.block_time
        AND g.payload->'params'->>'name'=$8 AND g.payload->'params'->>'symbol'=$9
        AND lower(g.payload->'params'->>'creatorFeeRecipient')=$10
      LIMIT 2`,
      [
        chain,
        args.agentKey?.toLowerCase(),
        row.blockHash,
        row.emitter.toLowerCase(),
        args.creator?.toLowerCase(),
        args.metadataHash?.toLowerCase(),
        args.presetHash?.toLowerCase(),
        metadata.name,
        metadata.symbol,
        args.creator?.toLowerCase(),
      ],
    );
    if (mapping.rows.length > 1 && new Set(mapping.rows.map((r) => r.agentId)).size > 1) {
      throw new Error("AMBIGUOUS_LAUNCH_GRANT");
    }
    const agentId = mapping.rows[0]?.agentId ?? null;

    await this.mutation(chain, row.blockHash, async (tx) => {
      const [token] = await tx
        .insert(tokens)
        .values({
          agentId,
          imageUri: mapping.rows[0]?.imageUri ?? null,
          ticker: `$${metadata.symbol.toUpperCase()}`.slice(0, 7),
          name: metadata.name,
          chain,
          address,
          decimals: metadata.decimals,
          totalSupply: metadata.totalSupply.toString(),
          quoteAddress: args.quoteToken!.toLowerCase(),
          quoteDecimals: 6,
          status: "pre_graduation",
          launchTxHash: row.txHash,
          launchedAt: row.blockTime,
        })
        .onConflictDoUpdate({
          target: [tokens.chain, tokens.address],
          // tokens_address_key is a partial index, so Postgres only matches it as a conflict
          // target when the predicate is repeated here.
          targetWhere: sql`"address" is not null`,
          set: {
            agentId,
            imageUri: mapping.rows[0]?.imageUri ?? null,
            ticker: `$${metadata.symbol.toUpperCase()}`.slice(0, 7),
            name: metadata.name,
            totalSupply: metadata.totalSupply.toString(),
            quoteAddress: args.quoteToken!.toLowerCase(),
            launchTxHash: row.txHash,
            launchedAt: row.blockTime,
            status: "pre_graduation",
            graduatedAt: null,
            updatedAt: sql`now()`,
          },
        })
        .returning({ id: tokens.id });

      await tx
        .insert(pools)
        .values({
          tokenId: token!.id,
          phase: "pre_graduation",
          venue: "pickler_curve",
          address: curve,
          openedTxHash: row.txHash,
          openedAt: row.blockTime,
        })
        .onConflictDoNothing({ target: [pools.tokenId, pools.phase] });
    });
  }

  private async projectTrade(
    chain: string,
    eventName: "CurveBought" | "CurveSold",
    args: Record<string, string>,
    row: {
      txHash: string;
      logIndex: number;
      blockNumber: number;
      blockHash: string;
      blockTime: Date;
      emitter: string;
    },
  ): Promise<boolean> {
    // The curve emitted the log, so its address is the emitter. No trade event carries it as
    // an argument, and inferring it from anything else would be guessing.
    const curve = await this.findCurvePool(chain, row.emitter);
    if (curve === null) {
      // A trade whose curve we never saw would have to invent the launch it belongs to.
      return false;
    }

    const buying = eventName === "CurveBought";

    await this.mutation(chain, row.blockHash, async (tx) => {
      await tx
        .insert(trades)
        .values({
          poolId: curve,
          side: buying ? "buy" : "sell",
          trader: (buying ? args.recipient! : args.seller!).toLowerCase(),
          tokenAmount: buying ? args.tokensOut! : args.tokensIn!,
          quoteAmount: buying ? args.grossQuoteIn! : args.netQuoteOut!,
          feeAmount: args.totalFee ?? "0",
          blockNumber: row.blockNumber,
          blockHash: row.blockHash,
          txHash: row.txHash,
          logIndex: row.logIndex,
          blockTime: row.blockTime,
        })
        // The log's own position is what makes a replay cost nothing.
        .onConflictDoNothing({ target: [trades.poolId, trades.txHash, trades.logIndex] });
    });

    return true;
  }

  private async projectGraduation(
    chain: string,
    args: Record<string, string>,
    row: { txHash: string; blockTime: Date; blockHash: string },
  ): Promise<boolean> {
    const address = args.token?.toLowerCase();
    if (!address) {
      return false;
    }

    const [token] = await this.database
      .select({ id: tokens.id })
      .from(tokens)
      .where(and(eq(tokens.chain, chain), eq(tokens.address, address)))
      .limit(1);

    if (!token) {
      return false;
    }

    await this.mutation(chain, row.blockHash, async (tx) => {
      await tx
        .update(tokens)
        .set({ status: "graduated", graduatedAt: row.blockTime, updatedAt: sql`now()` })
        .where(eq(tokens.id, token.id));

      await tx
        .update(pools)
        .set({ closedTxHash: row.txHash, closedAt: row.blockTime })
        .where(and(eq(pools.tokenId, token.id), eq(pools.phase, "pre_graduation")));

      await tx
        .insert(pools)
        .values({
          tokenId: token.id,
          phase: "post_graduation",
          venue: "uniswap_v4",
          // A V4 pool lives inside the PoolManager and has no address of its own.
          poolKey: args.poolId!,
          openedTxHash: row.txHash,
          openedAt: row.blockTime,
        })
        .onConflictDoNothing({ target: [pools.tokenId, pools.phase] });
    });

    return true;
  }

  /** The curve pool a trade belongs to, found by the address that emitted the log. */
  private async findCurvePool(chain: string, emitter: string): Promise<string | null> {
    const curve = emitter.toLowerCase();

    const [row] = await this.database
      .select({ id: pools.id })
      .from(pools)
      .innerJoin(tokens, eq(pools.tokenId, tokens.id))
      .where(
        and(eq(tokens.chain, chain), eq(pools.phase, "pre_graduation"), eq(pools.address, curve)),
      )
      .limit(1);

    return row?.id ?? null;
  }
}
