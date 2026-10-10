import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, asc, eq, gt, sql } from "drizzle-orm";

import type { IndexerCursor } from "@pickler/core";

import { databasePoolConfig, type DatabaseConnectionOptions } from "../connection.js";
import { chainBlocks, chainEvents, indexerCursors } from "./market.js";
import { outbox } from "./launch.js";

/**
 * Persists what the indexer reads, and unwinds it when the chain changes its mind.
 *
 * The whole contract is one sentence: a batch either lands completely or not at all. Blocks,
 * decoded events, the cursor and the outbox rows that announce them are written in a single
 * transaction, because any split between them produces a state no later pass can repair —
 * a projection with no notification, or a cursor past data that was never stored.
 *
 * Applying is idempotent. Ranges overlap after every restart, so re-reading a block must
 * cost nothing rather than double counting; that is what the conflict clauses are for, and
 * what the log's full identity as a primary key makes possible.
 */
export interface IndexBlockInput {
  number: bigint;
  hash: string;
  parentHash: string;
  blockTime: Date;
}

export interface IndexEventInput {
  blockHash: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
  emitter: string;
  eventName: string;
  abiHash: string;
  topics: readonly string[];
  data: string;
  decoded?: unknown;
}

export interface OutboxInput {
  topic: string;
  payload: unknown;
  event?: { blockHash: string; txHash: string; logIndex: number };
}

export interface ApplyBatchInput {
  chain: string;
  contract: string;
  stream: string;
  blocks: readonly IndexBlockInput[];
  events: readonly IndexEventInput[];
  outbox?: readonly OutboxInput[];
  confirmed?: boolean;
}

export class PostgresLaunchIndexStore {
  readonly pool: Pool;
  admissionFence?: { chain: string; owner: string };
  private readonly database: NodePgDatabase;

  constructor(connectionString: string, options?: DatabaseConnectionOptions) {
    this.pool = new Pool(databasePoolConfig(connectionString, options));
    this.database = drizzle(this.pool);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async readCursor(chain: string, contract: string, stream: string): Promise<IndexerCursor | null> {
    const [row] = await this.database
      .select()
      .from(indexerCursors)
      .where(
        and(
          eq(indexerCursors.chain, chain),
          eq(indexerCursors.contract, contract),
          eq(indexerCursors.stream, stream),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    return {
      chain: row.chain,
      contract: row.contract,
      stream: row.stream,
      lastBlock: BigInt(row.lastBlock),
      lastBlockHash: row.lastBlockHash,
    };
  }

  /**
   * Writes a batch and moves the cursor, in one transaction.
   *
   * The cursor lands on the highest block in the batch, so a crash mid-batch leaves the
   * cursor where it was and the whole range is simply read again.
   */
  async applyBatch(input: ApplyBatchInput): Promise<void> {
    if (input.blocks.length === 0) {
      return;
    }

    const highest = [...input.blocks].sort((left, right) =>
      left.number < right.number ? 1 : -1,
    )[0]!;

    await this.database.transaction(async (tx) => {
      if (this.admissionFence) {
        const f = this.admissionFence;
        const result = await tx.execute(
          sql`SELECT 1 FROM launch.indexer_admission WHERE chain=${f.chain} AND owner=${f.owner}::uuid AND expires_at>clock_timestamp() FOR UPDATE`,
        );
        if (!result.rowCount) {
          throw new Error("INDEX_LEASE_LOST");
        }
      }
      for (const block of input.blocks) {
        await tx
          .insert(chainBlocks)
          .values({
            chain: input.chain,
            hash: block.hash,
            number: Number(block.number),
            parentHash: block.parentHash,
            blockTime: block.blockTime,
            orphaned: false,
            ...(input.confirmed ? { finality: "confirmed" as const } : {}),
          })
          .onConflictDoUpdate({
            target: [chainBlocks.chain, chainBlocks.hash],
            // Re-reading a block that a previous pass marked orphaned means the chain came
            // back to it; it is canonical again.
            set: {
              orphaned: false,
              ...(input.confirmed ? { finality: "confirmed" as const } : {}),
            },
          });
      }

      for (const event of input.events) {
        await tx
          .insert(chainEvents)
          .values({
            chain: input.chain,
            blockHash: event.blockHash,
            txHash: event.txHash,
            logIndex: event.logIndex,
            blockNumber: Number(event.blockNumber),
            emitter: event.emitter,
            eventName: event.eventName,
            abiHash: event.abiHash,
            topics: event.topics,
            data: event.data,
            decoded: event.decoded ?? null,
            orphaned: false,
          })
          .onConflictDoUpdate({
            target: [
              chainEvents.chain,
              chainEvents.blockHash,
              chainEvents.txHash,
              chainEvents.logIndex,
            ],
            // Same reason as the block above: a branch the chain returns to is canonical
            // again. Doing nothing here would leave the event orphaned for good while its
            // block came back, so a reorg that flaps would quietly lose history.
            set: { orphaned: false },
          });
      }

      for (const message of input.outbox ?? []) {
        await tx
          .insert(outbox)
          .values({
            eventChain: message.event ? input.chain : null,
            eventBlockHash: message.event?.blockHash ?? null,
            eventTxHash: message.event?.txHash ?? null,
            eventLogIndex: message.event?.logIndex ?? null,
            topic: message.topic,
            payload: message.payload as never,
          })
          .onConflictDoNothing();
      }

      await tx
        .insert(indexerCursors)
        .values({
          chain: input.chain,
          contract: input.contract,
          stream: input.stream,
          lastBlock: Number(highest.number),
          lastBlockHash: highest.hash,
        })
        .onConflictDoUpdate({
          target: [indexerCursors.chain, indexerCursors.contract, indexerCursors.stream],
          set: {
            lastBlock: Number(highest.number),
            lastBlockHash: highest.hash,
            updatedAt: sql`now()`,
          },
        });
    });
  }

  /**
   * Unwinds everything strictly above `rollbackToBlock`.
   *
   * Blocks and events are marked orphaned rather than deleted: the branch that lost is still
   * evidence of what the node said, and keeping it is what lets a disagreement be explained
   * afterwards. Outbox rows for those events are dropped, because announcing something that
   * did not happen is worse than announcing nothing.
   *
   * The cursor moves back to the highest surviving block, so the next pass re-reads from
   * there and rebuilds on whichever branch the chain settled on.
   */
  async rollbackFrom(
    chain: string,
    _contract: string,
    _stream: string,
    rollbackToBlock: bigint,
  ): Promise<{ orphanedBlocks: number; orphanedEvents: number }> {
    return this.database.transaction(async (tx) => {
      if (this.admissionFence) {
        const f = this.admissionFence;
        const result = await tx.execute(
          sql`SELECT 1 FROM launch.indexer_admission WHERE chain=${f.chain} AND owner=${f.owner}::uuid AND expires_at>clock_timestamp() FOR UPDATE`,
        );
        if (!result.rowCount) {
          throw new Error("INDEX_LEASE_LOST");
        }
      }
      const blocks = await tx
        .update(chainBlocks)
        .set({ orphaned: true })
        .where(and(eq(chainBlocks.chain, chain), gt(chainBlocks.number, Number(rollbackToBlock))))
        .returning({ hash: chainBlocks.hash });

      const events = await tx
        .update(chainEvents)
        .set({ orphaned: true })
        .where(
          and(eq(chainEvents.chain, chain), gt(chainEvents.blockNumber, Number(rollbackToBlock))),
        )
        .returning({ txHash: chainEvents.txHash });

      await tx.execute(sql`
        delete from "launch"."outbox"
        where "event_chain" = ${chain}
          and "status" = 'pending'
          and "event_block_hash" in (
            select "hash" from "market"."chain_blocks"
            where "chain" = ${chain} and "number" > ${Number(rollbackToBlock)}
          )
      `);

      const [survivor] = await tx
        .select({ number: chainBlocks.number, hash: chainBlocks.hash })
        .from(chainBlocks)
        .where(and(eq(chainBlocks.chain, chain), eq(chainBlocks.orphaned, false)))
        .orderBy(sql`${chainBlocks.number} desc`)
        .limit(1);

      if (survivor) {
        await tx
          .update(indexerCursors)
          .set({ lastBlock: survivor.number, lastBlockHash: survivor.hash, updatedAt: sql`now()` })
          .where(
            and(
              eq(indexerCursors.chain, chain),
              gt(indexerCursors.lastBlock, Number(rollbackToBlock)),
            ),
          );
      } else {
        await tx
          .delete(indexerCursors)
          .where(
            and(
              eq(indexerCursors.chain, chain),
              gt(indexerCursors.lastBlock, Number(rollbackToBlock)),
            ),
          );
      }

      return { orphanedBlocks: blocks.length, orphanedEvents: events.length };
    });
  }

  /** Events on the canonical branch, in chain order. */
  async readCanonicalEvents(
    chain: string,
  ): Promise<{ blockNumber: bigint; logIndex: number; eventName: string; txHash: string }[]> {
    const rows = await this.database
      .select({
        blockNumber: chainEvents.blockNumber,
        logIndex: chainEvents.logIndex,
        eventName: chainEvents.eventName,
        txHash: chainEvents.txHash,
      })
      .from(chainEvents)
      .where(and(eq(chainEvents.chain, chain), eq(chainEvents.orphaned, false)))
      .orderBy(asc(chainEvents.blockNumber), asc(chainEvents.logIndex));

    return rows.map((row) => ({ ...row, blockNumber: BigInt(row.blockNumber) }));
  }

  async countPendingOutbox(chain: string): Promise<number> {
    const rows = await this.database
      .select({ id: outbox.id })
      .from(outbox)
      .where(and(eq(outbox.eventChain, chain), eq(outbox.status, "pending")));

    return rows.length;
  }
}
