import { z } from "zod";
const decimal = z.string().regex(/^\d+(\.\d{1,6})?$/);
export const liveBuySchema = z
  .object({
    marketId: z.string().regex(/^\d+$/),
    outcomeId: z.string().regex(/^\d+$/),
    limitPrice: decimal,
    budget: decimal,
  })
  .strict();
export const liveOrderSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  agentId: z.string(),
  runId: z.string().nullable(),
  origin: z.enum(["manual", "agent"]),
  status: z.enum([
    "prepared",
    "queued",
    "submitting",
    "unknown",
    "settled",
    "not_filled",
    "failed",
    "expired",
  ]),
  configVersion: z.number().int(),
  createdAt: z.number(),
  expiresAt: z.number(),
  orderHash: z.string().nullable(),
  reason: z.string().nullable(),
  preview: liveBuySchema.extend({
    market: z.object({ id: z.string(), question: z.string() }),
    estimatedFee: decimal,
    estimatedShares: decimal,
    observedAt: z.number(),
  }),
  fill: z
    .object({ shares: decimal, costUpperBound: decimal, transactionHashes: z.array(z.string()) })
    .nullable(),
});
export const tradingAccountSchema = z.object({
  tenantId: z.string(),
  agentId: z.string(),
  wallet: z.string(),
  signer: z.string(),
  chainId: z.literal(137),
  budgetMicros: z.number().int(),
  reservedMicros: z.number().int(),
  spentMicros: z.number().int(),
});
