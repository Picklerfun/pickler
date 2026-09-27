import { z } from "zod";
const marketClassificationSchema = z
  .object({
    version: z.literal(1),
    category: z.literal("sports"),
    subcategory: z.enum(["soccer", "american-football", "basketball", "tennis"]),
    temporalClass: z.enum(["match", "award", "season", "unknown"]),
    league: z.literal("nfl").optional(),
    provenance: z
      .object({
        provider: z.literal("polymarket"),
        mappingVersion: z.literal("1.0.0"),
        tagIds: z.array(z.string()),
        temporalBasis: z.string(),
      })
      .strict(),
  })
  .strict();
const decimal = z.string().regex(/^\d+(\.\d{1,8})?$/);
const signedDecimal = z.string().regex(/^-?\d+(\.\d{1,8})?$/);
const resolutionSchema = z
  .object({
    marketId: z.string(),
    outcomeId: z.string(),
    conditionId: z.string().regex(/^0x[0-9a-f]{64}$/),
    outcomeIndex: z.number().int().nonnegative(),
    numerator: z.string().regex(/^\d+$/),
    denominator: z.string().regex(/^\d+$/),
    observedAt: z.string().datetime(),
    chainId: z.literal(137),
    contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    blockNumber: z.string().regex(/^\d+$/),
    blockHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();
export const paperSummarySchema = z
  .object({
    filled: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    settled: z.number().int().nonnegative(),
    totalCost: decimal,
    openCost: decimal,
    payouts: decimal,
    realizedPnl: signedDecimal,
    netCashFlow: signedDecimal,
  })
  .strict();
const level = z.object({ price: decimal, size: decimal }).strict();
export const paperOrderSchema = z
  .object({
    id: z.string(),
    tenantId: z.string(),
    agentId: z.string(),
    runId: z.string(),
    marketId: z.string(),
    outcomeId: z.string(),
    status: z.enum(["pending", "filled", "not_filled", "failed", "interrupted"]),
    virtualBudget: z.literal("10"),
    createdAt: z.number(),
    finishedAt: z.number().nullable(),
    reason: z.string().nullable(),
    settlement: z
      .object({
        version: z.literal(1),
        settledAt: z.number(),
        payout: decimal,
        realizedPnl: signedDecimal,
        resolution: resolutionSchema,
      })
      .strict()
      .nullable()
      .optional(),
    fill: z
      .object({
        quantity: decimal,
        averagePrice: decimal,
        fees: decimal,
        totalCost: decimal,
        levels: z
          .array(z.object({ price: decimal, quantity: decimal, fee: decimal }).strict())
          .max(20),
        book: z
          .object({
            outcomeId: z.string(),
            observedAt: z.string().datetime(),
            bids: z.array(level),
            asks: z.array(level),
          })
          .strict(),
        conditions: z
          .object({
            marketId: z.string(),
            outcomeId: z.string(),
            observedAt: z.string().datetime(),
            minimumNotional: decimal,
            minimumShares: decimal.optional(),
            resolution: z
              .object({
                conditionId: z.string().regex(/^0x[0-9a-f]{64}$/),
                outcomeIndex: z.number().int().min(0).max(9),
                outcomeCount: z.number().int().min(2).max(10),
              })
              .strict()
              .optional(),
            tickSize: decimal,
            feeRate: decimal,
            feeExponent: z.literal(1),
            provenance: z.string().url(),
          })
          .strict(),
        market: z
          .object({
            id: z.string(),
            question: z.string(),
            rules: z.string(),
            categoryIds: z.array(z.string()),
            classification: marketClassificationSchema.optional(),
            active: z.boolean(),
            closesAt: z.string().nullable(),
            startsAt: z.string().nullable().optional(),
            timingSource: z.string().nullable().optional(),
            sportsMarketType: z.string().nullable().optional(),
            resolutionUrls: z.array(z.string()).optional(),
            liquidity: z.number(),
            outcomes: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
          })
          .strict(),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type PaperOrderDto = z.infer<typeof paperOrderSchema>;
