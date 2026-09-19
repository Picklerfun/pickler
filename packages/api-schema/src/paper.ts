import { z } from "zod";
const decimal = z.string().regex(/^\d+(\.\d{1,8})?$/);
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
