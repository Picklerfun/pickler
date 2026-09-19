// Market: agent tokens and their trading, projected from chain events. Pickler never signs here.
// EVM chains only (CAIP-2 `eip155:<id>`). Amounts are base units; numeric(78,0) holds any uint256.
// Prices are quote per whole token. See docs/market/token-launch.md.

import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  numeric,
  pgSchema,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agents } from "./agents";

export const market = pgSchema("market");

export const tokenStatus = market.enum("token_status", [
  "reserved",
  "launching",
  "pre_graduation",
  "graduated",
  "failed",
]);
export const poolPhase = market.enum("pool_phase", ["pre_graduation", "post_graduation"]);
export const tradeSide = market.enum("trade_side", ["buy", "sell"]);
export const candleInterval = market.enum("candle_interval", ["5m", "1h", "4h", "1d"]);
export const feeRecipientRole = market.enum("fee_recipient_role", ["creator", "agent", "platform"]);

const baseUnits = (name: string) => numeric(name, { precision: 78, scale: 0 });

export const tokens = market
  .table(
    "tokens",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      agentId: uuid("agent_id")
        .notNull()
        .references(() => agents.id, { onDelete: "restrict" }),
      /** Reserved when an application is approved, before any contract exists. */
      ticker: text("ticker").notNull(),
      name: text("name").notNull(),
      imageUri: text("image_uri"),
      chain: text("chain").notNull(),
      address: text("address"),
      decimals: smallint("decimals").notNull().default(18),
      totalSupply: baseUnits("total_supply"),
      /** A null quote address is the chain's native asset. */
      quoteSymbol: text("quote_symbol"),
      quoteAddress: text("quote_address"),
      quoteDecimals: smallint("quote_decimals"),
      /** Quote raised on the curve that triggers graduation, in quote base units. */
      graduationTarget: baseUnits("graduation_target"),
      status: tokenStatus("status").notNull().default("reserved"),
      launchTxHash: text("launch_tx_hash"),
      launchedAt: timestamp("launched_at", { withTimezone: true }),
      graduatedAt: timestamp("graduated_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      // A failed launch frees the agent and the ticker for another attempt.
      uniqueIndex("tokens_agent_key")
        .on(t.agentId)
        .where(sql`${t.status} <> 'failed'`),
      uniqueIndex("tokens_ticker_key")
        .on(t.ticker)
        .where(sql`${t.status} <> 'failed'`),
      uniqueIndex("tokens_address_key")
        .on(t.chain, t.address)
        .where(sql`${t.address} is not null`),
      index("tokens_agent_idx").on(t.agentId),
      check("tokens_ticker_format", sql`${t.ticker} ~ '^\\$[A-Z][A-Z0-9]{1,5}$'`),
      check("tokens_name_length", sql`char_length(${t.name}) between 1 and 40`),
      check("tokens_image_uri", sql`${t.imageUri} ~ '^(https|ipfs)://'`),
      check("tokens_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("tokens_address_format", sql`${t.address} ~ '^0x[0-9a-f]{40}$'`),
      check("tokens_decimals_range", sql`${t.decimals} between 0 and 36`),
      check("tokens_supply_positive", sql`${t.totalSupply} > 0`),
      check("tokens_quote_address_format", sql`${t.quoteAddress} ~ '^0x[0-9a-f]{40}$'`),
      check("tokens_quote_decimals_range", sql`${t.quoteDecimals} between 0 and 36`),
      check("tokens_graduation_target_positive", sql`${t.graduationTarget} > 0`),
      check("tokens_launch_tx_format", sql`${t.launchTxHash} ~ '^0x[0-9a-f]{64}$'`),
      check(
        "tokens_launched_consistent",
        sql`${t.status} not in ('pre_graduation', 'graduated') or (${t.address} is not null and ${t.launchedAt} is not null and ${t.totalSupply} is not null and ${t.quoteDecimals} is not null)`,
      ),
      check(
        "tokens_graduated_consistent",
        sql`(${t.status} = 'graduated') = (${t.graduatedAt} is not null)`,
      ),
    ],
  )
  .enableRLS();

/** Where a token trades in each phase: our curve before graduation, a pool after it. */
export const pools = market
  .table(
    "pools",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      tokenId: uuid("token_id")
        .notNull()
        .references(() => tokens.id, { onDelete: "restrict" }),
      phase: poolPhase("phase").notNull(),
      venue: text("venue").notNull(),
      address: text("address"),
      /** Uniswap V4 PoolId: V4 pools live inside the PoolManager and have no address. */
      poolKey: text("pool_key"),
      openedTxHash: text("opened_tx_hash").notNull(),
      openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
      closedTxHash: text("closed_tx_hash"),
      closedAt: timestamp("closed_at", { withTimezone: true }),
    },
    (t) => [
      uniqueIndex("pools_token_phase_key").on(t.tokenId, t.phase),
      check("pools_venue", sql`${t.venue} in ('pickler_curve', 'pons', 'uniswap_v4')`),
      check("pools_address_format", sql`${t.address} ~ '^0x[0-9a-f]{40}$'`),
      check("pools_pool_key_format", sql`${t.poolKey} ~ '^0x[0-9a-f]{64}$'`),
      check("pools_opened_tx_format", sql`${t.openedTxHash} ~ '^0x[0-9a-f]{64}$'`),
      check("pools_closed_tx_format", sql`${t.closedTxHash} ~ '^0x[0-9a-f]{64}$'`),
      check("pools_locator", sql`${t.address} is not null or ${t.poolKey} is not null`),
      check("pools_closed_consistent", sql`(${t.closedAt} is null) = (${t.closedTxHash} is null)`),
    ],
  )
  .enableRLS();

/** Fee split configured on-chain for each phase, mirrored for display. */
export const feeSplits = market
  .table(
    "fee_splits",
    {
      tokenId: uuid("token_id")
        .notNull()
        .references(() => tokens.id, { onDelete: "restrict" }),
      phase: poolPhase("phase").notNull(),
      role: feeRecipientRole("role").notNull(),
      recipient: text("recipient").notNull(),
      shareBps: integer("share_bps").notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tokenId, t.phase, t.role] }),
      check("fee_splits_recipient_format", sql`${t.recipient} ~ '^0x[0-9a-f]{40}$'`),
      check("fee_splits_share_range", sql`${t.shareBps} between 0 and 10000`),
    ],
  )
  .enableRLS();

/** Log-derived rows carry block hash and log position: the indexer deletes them on a reorg. */
export const trades = market
  .table(
    "trades",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      poolId: uuid("pool_id")
        .notNull()
        .references(() => pools.id, { onDelete: "restrict" }),
      side: tradeSide("side").notNull(),
      trader: text("trader").notNull(),
      tokenAmount: baseUnits("token_amount").notNull(),
      quoteAmount: baseUnits("quote_amount").notNull(),
      feeAmount: baseUnits("fee_amount").notNull().default("0"),
      blockNumber: bigint("block_number", { mode: "number" }).notNull(),
      blockHash: text("block_hash").notNull(),
      txHash: text("tx_hash").notNull(),
      logIndex: integer("log_index").notNull(),
      blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    },
    (t) => [
      uniqueIndex("trades_log_key").on(t.poolId, t.txHash, t.logIndex),
      index("trades_pool_time_idx").on(t.poolId, t.blockTime.desc()),
      index("trades_trader_idx").on(t.trader, t.blockTime.desc()),
      check("trades_trader_format", sql`${t.trader} ~ '^0x[0-9a-f]{40}$'`),
      check("trades_token_amount_positive", sql`${t.tokenAmount} > 0`),
      check("trades_quote_amount_positive", sql`${t.quoteAmount} >= 0`),
      check("trades_fee_positive", sql`${t.feeAmount} >= 0`),
      check("trades_block_positive", sql`${t.blockNumber} >= 0`),
      check("trades_block_hash_format", sql`${t.blockHash} ~ '^0x[0-9a-f]{64}$'`),
      check("trades_tx_hash_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
      check("trades_log_index_positive", sql`${t.logIndex} >= 0`),
    ],
  )
  .enableRLS();

/** Fees paid out to a recipient: claims or automatic distributions. */
export const feePayouts = market
  .table(
    "fee_payouts",
    {
      id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
      tokenId: uuid("token_id")
        .notNull()
        .references(() => tokens.id, { onDelete: "restrict" }),
      poolId: uuid("pool_id").references(() => pools.id, { onDelete: "restrict" }),
      role: feeRecipientRole("role").notNull(),
      recipient: text("recipient").notNull(),
      assetAddress: text("asset_address"),
      amount: baseUnits("amount").notNull(),
      blockNumber: bigint("block_number", { mode: "number" }).notNull(),
      blockHash: text("block_hash").notNull(),
      txHash: text("tx_hash").notNull(),
      logIndex: integer("log_index").notNull(),
      blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    },
    (t) => [
      uniqueIndex("fee_payouts_log_key").on(t.tokenId, t.txHash, t.logIndex),
      index("fee_payouts_pool_idx").on(t.poolId),
      check("fee_payouts_recipient_format", sql`${t.recipient} ~ '^0x[0-9a-f]{40}$'`),
      check("fee_payouts_asset_format", sql`${t.assetAddress} ~ '^0x[0-9a-f]{40}$'`),
      check("fee_payouts_amount_positive", sql`${t.amount} > 0`),
      check("fee_payouts_block_positive", sql`${t.blockNumber} >= 0`),
      check("fee_payouts_block_hash_format", sql`${t.blockHash} ~ '^0x[0-9a-f]{64}$'`),
      check("fee_payouts_tx_hash_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
      check("fee_payouts_log_index_positive", sql`${t.logIndex} >= 0`),
    ],
  )
  .enableRLS();

export const holders = market
  .table(
    "holders",
    {
      tokenId: uuid("token_id")
        .notNull()
        .references(() => tokens.id, { onDelete: "restrict" }),
      address: text("address").notNull(),
      balance: baseUnits("balance").notNull(),
      updatedBlock: bigint("updated_block", { mode: "number" }).notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tokenId, t.address] }),
      index("holders_top_idx").on(t.tokenId, t.balance.desc()),
      check("holders_address_format", sql`${t.address} ~ '^0x[0-9a-f]{40}$'`),
      check("holders_balance_positive", sql`${t.balance} >= 0`),
      check("holders_block_positive", sql`${t.updatedBlock} >= 0`),
    ],
  )
  .enableRLS();

export const candles = market
  .table(
    "candles",
    {
      tokenId: uuid("token_id")
        .notNull()
        .references(() => tokens.id, { onDelete: "restrict" }),
      bucket: candleInterval("bucket").notNull(),
      bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
      open: numeric("open").notNull(),
      high: numeric("high").notNull(),
      low: numeric("low").notNull(),
      close: numeric("close").notNull(),
      volumeQuote: baseUnits("volume_quote").notNull().default("0"),
      tradeCount: integer("trade_count").notNull().default(0),
    },
    (t) => [
      primaryKey({ columns: [t.tokenId, t.bucket, t.bucketStart] }),
      check("candles_open_positive", sql`${t.open} > 0`),
      check("candles_low_positive", sql`${t.low} > 0`),
      check("candles_close_positive", sql`${t.close} > 0`),
      check("candles_volume_positive", sql`${t.volumeQuote} >= 0`),
      check("candles_trade_count_positive", sql`${t.tradeCount} >= 0`),
      check(
        "candles_range",
        sql`${t.low} <= least(${t.open}, ${t.close}) and ${t.high} >= greatest(${t.open}, ${t.close})`,
      ),
    ],
  )
  .enableRLS();

/** Last block each indexer stream processed, with its hash to detect reorgs on resume. */
export const indexerCursors = market
  .table(
    "indexer_cursors",
    {
      chain: text("chain").notNull(),
      contract: text("contract").notNull(),
      stream: text("stream").notNull(),
      lastBlock: bigint("last_block", { mode: "number" }).notNull(),
      lastBlockHash: text("last_block_hash").notNull(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.chain, t.contract, t.stream] }),
      check("indexer_cursors_chain_format", sql`${t.chain} ~ '^eip155:[1-9][0-9]*$'`),
      check("indexer_cursors_contract_format", sql`${t.contract} ~ '^0x[0-9a-f]{40}$'`),
      check("indexer_cursors_stream_length", sql`char_length(${t.stream}) between 1 and 40`),
      check("indexer_cursors_block_positive", sql`${t.lastBlock} >= 0`),
      check("indexer_cursors_block_hash_format", sql`${t.lastBlockHash} ~ '^0x[0-9a-f]{64}$'`),
    ],
  )
  .enableRLS();
