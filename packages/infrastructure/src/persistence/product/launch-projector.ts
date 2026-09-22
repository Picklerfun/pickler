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
  private readonly database: NodePgDatabase;
  private readonly ownsPool: boolean;

  constructor(connection: string | Pool, options?: DatabaseConnectionOptions) {
    this.ownsPool = typeof connection === "string";
    this.pool =
      typeof connection === "string"
        ? new Pool(databasePoolConfig(connection, options))
        : connection;
    this.database = drizzle(this.pool);
  }

  async close(): Promise<void> {
    if (this.ownsPool) {
      await this.pool.end();
    }
  }

  /**
   * Projects every canonical event for a chain, in chain order.
   *
   * Idempotent by construction: each write is keyed by something the chain already made
   * unique — a token address, a pool's phase, a log's position — so running this twice
   * produces the same catalogue as running it once.
   */
  async project(chain: string, readMetadata: MetadataReader): Promise<ProjectionResult> {
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

    // RPC reads happen before locks; failures leave the previous projection intact.
    const metadata = new Map<string, LaunchMetadata>();
    const existing = await this.database.select().from(tokens).where(eq(tokens.chain, chain));
    for (const row of rows) {
      if (row.eventName === "LaunchCreated" && row.decoded) {
        const args = row.decoded as Record<string, string>;
        const cached = existing.find(
          (token) =>
            token.address === args.token?.toLowerCase() && token.launchTxHash === row.txHash,
        );
        metadata.set(
          args.token!,
          cached && cached.totalSupply !== null
            ? {
                name: cached.name,
                symbol: cached.ticker.replace(/^\$/, ""),
                decimals: cached.decimals,
                totalSupply: BigInt(cached.totalSupply),
              }
            : await readMetadata(args.token!, BigInt(row.blockNumber)),
        );
      }
    }
    return this.database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${"launch-projection:" + chain}, 0))`,
      );
      await tx.execute(sql`lock table "market"."chain_events" in share mode`);
      const current = await tx
        .select()
        .from(chainEvents)
        .where(and(eq(chainEvents.chain, chain), eq(chainEvents.orphaned, false)))
        .orderBy(chainEvents.blockNumber, chainEvents.logIndex);
      const identity = (events: { blockHash: string; txHash: string; logIndex: number }[]) =>
        JSON.stringify(events.map((row) => [row.blockHash, row.txHash, row.logIndex]));
      if (identity(current) !== identity(rows)) {
        throw new Error(
          "Launch events changed during metadata reads; retry projection on the next pass",
        );
      }
      await tx.execute(sql`
        delete from "market"."trades" t using "market"."pools" p, "market"."tokens" token
        where t.pool_id = p.id and p.token_id = token.id and token.chain = ${chain}
          and p.venue = 'pickler_curve'
          and not exists (select 1 from "market"."chain_events" e where e.chain = ${chain}
            and e.block_hash = t.block_hash and e.tx_hash = t.tx_hash and e.log_index = t.log_index and not e.orphaned)
      `);
      await tx.execute(sql`
        delete from "market"."pools" p using "market"."tokens" t
        where p.token_id = t.id and t.chain = ${chain} and p.phase = 'post_graduation'
          and exists (select 1 from "market"."chain_events" e where e.chain = ${chain}
            and e.tx_hash = p.opened_tx_hash and e.event_name = 'LaunchGraduated')
          and not exists (select 1 from "market"."chain_events" e where e.chain = ${chain}
            and e.tx_hash = p.opened_tx_hash and e.event_name = 'LaunchGraduated' and not e.orphaned)
      `);
      await tx.execute(sql`
        update "market"."tokens" t set status = 'pre_graduation', graduated_at = null
        where t.chain = ${chain} and exists (select 1 from "market"."chain_events" e
          where e.chain = ${chain} and e.tx_hash = t.launch_tx_hash and e.event_name = 'LaunchCreated')
      `);
      await tx.execute(sql`
        update "market"."pools" p set closed_at = null, closed_tx_hash = null
        from "market"."tokens" t where p.token_id = t.id and t.chain = ${chain}
          and p.venue = 'pickler_curve'
      `);
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
            await this.projectLaunch(tx, chain, args, row, async (token) => metadata.get(token)!);
            result.launches++;
            break;

          case "CurveBought":
          case "CurveSold":
            if (await this.projectTrade(tx, chain, row.eventName, args, row)) {
              result.trades++;
            } else {
              result.skipped++;
            }
            break;

          case "LaunchGraduated":
            if (await this.projectGraduation(tx, chain, args, row)) {
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
    });
  }

  private async projectLaunch(
    database: NodePgDatabase,
    chain: string,
    args: Record<string, string>,
    row: { txHash: string; blockNumber: number; blockTime: Date },
    readMetadata: MetadataReader,
  ): Promise<void> {
    const address = args.token!.toLowerCase();
    const curve = args.curve!.toLowerCase();
    const metadata = await readMetadata(address, BigInt(row.blockNumber));

    const [token] = await database
      .insert(tokens)
      .values({
        // Left null on purpose: the chain knows an agentKey, which nothing reverses into our
        // agent's identifier. The product links it afterwards.
        agentId: null,
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
        set: { status: "pre_graduation", updatedAt: sql`now()` },
      })
      .returning({ id: tokens.id });

    await database
      .insert(pools)
      .values({
        tokenId: token!.id,
        phase: "pre_graduation",
        venue: "pickler_curve",
        address: curve,
        openedTxHash: row.txHash,
        openedAt: row.blockTime,
      })
      .onConflictDoUpdate({
        target: [pools.tokenId, pools.phase],
        set: {
          openedTxHash: row.txHash,
          openedAt: row.blockTime,
        },
      });
  }

  private async projectTrade(
    database: NodePgDatabase,
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
    const curve = await this.findCurvePool(database, chain, row.emitter);
    if (curve === null) {
      // A trade whose curve we never saw would have to invent the launch it belongs to.
      return false;
    }

    const buying = eventName === "CurveBought";

    await database
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

    return true;
  }

  private async projectGraduation(
    database: NodePgDatabase,
    chain: string,
    args: Record<string, string>,
    row: { txHash: string; blockTime: Date },
  ): Promise<boolean> {
    const address = args.token?.toLowerCase();
    if (!address) {
      return false;
    }

    const [token] = await database
      .select({ id: tokens.id })
      .from(tokens)
      .where(and(eq(tokens.chain, chain), eq(tokens.address, address)))
      .limit(1);

    if (!token) {
      return false;
    }

    await database
      .update(tokens)
      .set({ status: "graduated", graduatedAt: row.blockTime, updatedAt: sql`now()` })
      .where(eq(tokens.id, token.id));

    await database
      .update(pools)
      .set({ closedTxHash: row.txHash, closedAt: row.blockTime })
      .where(and(eq(pools.tokenId, token.id), eq(pools.phase, "pre_graduation")));

    await database
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
      .onConflictDoUpdate({
        target: [pools.tokenId, pools.phase],
        set: {
          openedTxHash: row.txHash,
          openedAt: row.blockTime,
        },
      });

    return true;
  }

  /** The curve pool a trade belongs to, found by the address that emitted the log. */
  private async findCurvePool(
    database: NodePgDatabase,
    chain: string,
    emitter: string,
  ): Promise<string | null> {
    const curve = emitter.toLowerCase();

    const [row] = await database
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
