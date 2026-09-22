import { and, desc, eq, lt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type {
  CurveStateDto,
  FreshnessDto,
  LaunchDetailDto,
  LaunchSummaryDto,
  ReadDto,
  TradeDto,
} from "@pickler/api-schema";

import { databasePoolConfig, type DatabaseConnectionOptions } from "../connection.js";
import { indexerCursors, pools, tokens, trades } from "./market.js";

/**
 * Reads the launch catalogue for the public API.
 *
 * Every answer carries how fresh it is. A projection can lag or be rebuilding, and a caller
 * that cannot tell a current answer from a stale one will present both the same way — which
 * is how an interface ends up showing a price that stopped being true an hour ago.
 *
 * Freshness comes from the indexer's own cursor, not from when this row was written. A row
 * can be perfectly current and still belong to a chain nobody has read for a day.
 */
export interface LaunchListQuery {
  chain?: string | undefined;
  phase?: string | undefined;
  limit?: number | undefined;
  /** Opaque; the launch id to continue after. */
  cursor?: string | undefined;
}

/** Blocks behind the indexer's own tip before a read is flagged. */
const STALE_AFTER_BLOCKS = 50;

export class PostgresLaunchReadModel {
  readonly pool: Pool;
  private readonly database: NodePgDatabase;

  constructor(connectionString: string, options?: DatabaseConnectionOptions) {
    this.pool = new Pool(databasePoolConfig(connectionString, options));
    this.database = drizzle(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listLaunches(query: LaunchListQuery): Promise<ReadDto<LaunchSummaryDto[]>> {
    const limit = Math.min(Math.max(query.limit ?? 25, 1), 100);

    const conditions = [
      query.chain ? eq(tokens.chain, query.chain) : undefined,
      query.phase ? eq(tokens.status, query.phase as never) : undefined,
      // Keyset rather than offset: a catalogue that grows while a client pages must not
      // repeat or skip a row.
      query.cursor
        ? lt(
            tokens.createdAt,
            sql`(select "created_at" from "market"."tokens" where "id" = ${query.cursor})`,
          )
        : undefined,
    ].filter(Boolean);

    const rows = await this.database
      .select()
      .from(tokens)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tokens.createdAt))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const freshness = await this.readFreshness(query.chain);

    return {
      ...freshness,
      data: page.map(toSummary),
      ...(rows.length > limit && page.length > 0 ? { nextCursor: page[page.length - 1]!.id } : {}),
    };
  }

  async getLaunch(id: string): Promise<ReadDto<LaunchDetailDto> | null> {
    const [token] = await this.database.select().from(tokens).where(eq(tokens.id, id)).limit(1);

    if (!token) {
      return null;
    }

    const poolRows = await this.database.select().from(pools).where(eq(pools.tokenId, token.id));

    const curve = poolRows.find((row) => row.phase === "pre_graduation");
    const post = poolRows.find((row) => row.phase === "post_graduation");
    const freshness = await this.readFreshness(token.chain);

    return {
      ...freshness,
      data: {
        ...toSummary(token),
        curve: curve ? toCurve(curve, token.graduationTarget) : null,
        pool: post ? toCurve(post, null) : null,
      },
    };
  }

  async listTrades(
    launchId: string,
    options: { limit?: number | undefined; cursor?: string | undefined } = {},
  ): Promise<ReadDto<TradeDto[]> | null> {
    const [token] = await this.database
      .select({ id: tokens.id, chain: tokens.chain })
      .from(tokens)
      .where(eq(tokens.id, launchId))
      .limit(1);

    if (!token) {
      return null;
    }

    const limit = Math.min(Math.max(options.limit ?? 25, 1), 100);

    const rows = await this.database
      .select({
        side: trades.side,
        trader: trades.trader,
        tokenAmount: trades.tokenAmount,
        quoteAmount: trades.quoteAmount,
        feeAmount: trades.feeAmount,
        blockNumber: trades.blockNumber,
        txHash: trades.txHash,
        logIndex: trades.logIndex,
        blockTime: trades.blockTime,
        id: trades.id,
      })
      .from(trades)
      .innerJoin(pools, eq(trades.poolId, pools.id))
      .where(
        and(
          eq(pools.tokenId, token.id),
          options.cursor ? lt(trades.id, Number(options.cursor)) : undefined,
        ),
      )
      .orderBy(desc(trades.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const freshness = await this.readFreshness(token.chain);

    return {
      ...freshness,
      data: page.map((row) => ({
        side: row.side,
        trader: row.trader,
        tokenAmount: row.tokenAmount,
        quoteAmount: row.quoteAmount,
        feeAmount: row.feeAmount,
        blockNumber: String(row.blockNumber),
        txHash: row.txHash,
        logIndex: row.logIndex,
        blockTime: row.blockTime.toISOString(),
      })),
      ...(rows.length > limit && page.length > 0
        ? { nextCursor: String(page[page.length - 1]!.id) }
        : {}),
    };
  }

  /**
   * How far the indexer has read, and whether that is far enough to trust.
   *
   * With no cursor at all the answer is not "fresh": nothing has ever been indexed, so every
   * projection is empty for a reason a caller needs to know about.
   */
  private async readFreshness(chain?: string): Promise<FreshnessDto> {
    const rows = await this.database
      .select({
        lastBlock: indexerCursors.lastBlock,
        lastBlockHash: indexerCursors.lastBlockHash,
        updatedAt: indexerCursors.updatedAt,
      })
      .from(indexerCursors)
      .where(chain ? eq(indexerCursors.chain, chain) : undefined)
      .orderBy(desc(indexerCursors.lastBlock))
      .limit(1);

    const cursor = rows[0];

    if (!cursor) {
      return {
        asOfBlock: null,
        asOfBlockHash: null,
        indexedAt: null,
        finality: "unknown",
        stale: true,
      };
    }

    const ageMs = Date.now() - cursor.updatedAt.getTime();

    return {
      asOfBlock: String(cursor.lastBlock),
      asOfBlockHash: cursor.lastBlockHash,
      indexedAt: cursor.updatedAt.toISOString(),
      finality: "confirmed",
      // Time rather than block height: the indexer's own tip says nothing about how far the
      // chain has moved since, and a worker that stopped an hour ago still reports the block
      // it reached.
      stale: ageMs > STALE_AFTER_BLOCKS * 1_000,
    };
  }
}

function toSummary(token: typeof tokens.$inferSelect): LaunchSummaryDto {
  return {
    id: token.id,
    chainId: token.chain,
    address: token.address ?? "",
    ticker: token.ticker,
    name: token.name,
    imageUri: token.imageUri,
    phase: token.status,
    agentId: token.agentId,
    quote: {
      chainId: token.chain,
      address: token.quoteAddress ?? "",
      symbol: token.quoteSymbol,
      decimals: token.quoteDecimals ?? 18,
    },
    totalSupply: token.totalSupply,
    launchedAt: token.launchedAt?.toISOString() ?? null,
    graduatedAt: token.graduatedAt?.toISOString() ?? null,
  };
}

function toCurve(pool: typeof pools.$inferSelect, graduationTarget: string | null): CurveStateDto {
  return {
    venue: pool.venue as CurveStateDto["venue"],
    address: pool.address,
    poolKey: pool.poolKey,
    // Both are read from the chain rather than projected, so they are absent here rather
    // than guessed from trades. Quoting reads the curve directly.
    remainingTokens: null,
    realQuoteReserve: null,
    graduationTarget,
    openedAt: pool.openedAt.toISOString(),
    closedAt: pool.closedAt?.toISOString() ?? null,
  };
}
