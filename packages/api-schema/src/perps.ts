import { z } from "zod";
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const decimal = z.string().regex(/^-?(0|[1-9]\d*)(\.\d+)?$/);
export const perpSymbolSchema = z.enum(["BTC", "ETH"]);
export const perplConfigSchema = z
  .object({
    version: z.literal(1),
    network: z.enum(["mainnet", "testnet"]),
    markets: z
      .array(perpSymbolSchema)
      .min(1)
      .max(2)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export const perpProvenanceSchema = z
  .object({
    provider: z.literal("perpl"),
    pluginVersion: z.literal("1.0.0"),
    network: z.enum(["mainnet", "testnet"]),
    chainId: integer,
    url: z.string().url(),
    receivedAt: integer,
    providerTimestamp: integer.nullable(),
    block: integer.nullable(),
  })
  .strict();
export const perpMarketInfoSchema = z
  .object({
    symbol: perpSymbolSchema,
    marketId: integer,
    perpetualId: integer,
    instanceId: integer,
    exchangeAddress: z.string(),
    collateral: z
      .object({ tokenId: integer, address: z.string(), symbol: z.string(), decimals: integer })
      .strict(),
    configVersion: integer,
    priceDecimals: integer,
    sizeDecimals: integer,
    open: z.boolean(),
    fundingIntervalSeconds: integer.positive(),
    fundingIntervalBlocks: integer.positive(),
    initialMarginRaw: integer,
    maintenanceMarginRaw: integer,
    fees: z
      .object({ basis: z.literal("public-base-tier"), maker: decimal, taker: decimal })
      .strict(),
    provenance: perpProvenanceSchema,
  })
  .strict();
export const perpMarketsSchema = z
  .object({ markets: z.array(perpMarketInfoSchema).max(2) })
  .strict();
const freshness = z.enum(["fresh", "stale", "unknown"]);
export const perpSnapshotSchema = z
  .object({
    market: perpMarketInfoSchema,
    ticker: z
      .object({
        mark: decimal,
        index: decimal,
        last: decimal,
        bid: decimal,
        ask: decimal,
        openInterestBase: decimal,
        freshness,
        provenance: perpProvenanceSchema,
      })
      .strict(),
    funding: z
      .object({
        rate: decimal,
        intervalSeconds: integer.positive(),
        intervalBlocks: integer.positive(),
        appliesAt: integer.nullable(),
        eventBlock: integer,
        applicationTimeEstimated: z.boolean().nullable(),
        provenance: perpProvenanceSchema,
      })
      .strict()
      .nullable(),
  })
  .strict();
const level = z.object({ price: decimal, size: decimal, orders: integer }).strict();
export const perpOrderBookSchema = z
  .object({
    market: perpMarketInfoSchema,
    requestedLevels: integer.min(1).max(100),
    depthLimited: z.literal(true),
    bids: z.array(level).max(100),
    asks: z.array(level).max(100),
    freshness,
    provenance: perpProvenanceSchema,
  })
  .strict();
export const perpCandleRequestSchema = z
  .object({
    symbol: perpSymbolSchema,
    resolution: z.union([
      z.literal(60),
      z.literal(300),
      z.literal(900),
      z.literal(1800),
      z.literal(3600),
      z.literal(7200),
      z.literal(14400),
      z.literal(28800),
      z.literal(43200),
      z.literal(86400),
    ]),
    from: integer,
    to: integer,
  })
  .strict()
  .refine(
    (v) =>
      v.to > v.from &&
      v.from % (v.resolution * 1000) === 0 &&
      v.to % (v.resolution * 1000) === 0 &&
      (v.to - v.from) / (v.resolution * 1000) <= 1024,
  );
export const perpCandlesSchema = z
  .object({
    market: perpMarketInfoSchema,
    resolution: integer.positive(),
    from: integer,
    to: integer,
    missingOpenTimes: z.array(integer).max(1024),
    candles: z
      .array(
        z
          .object({
            openTime: integer,
            open: decimal,
            high: decimal,
            low: decimal,
            close: decimal,
            volumeCollateral: decimal,
            trades: integer,
            closed: z.boolean(),
          })
          .strict(),
      )
      .max(1024),
    provenance: perpProvenanceSchema,
  })
  .strict();
