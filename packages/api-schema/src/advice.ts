import { z } from "zod";
export const adviceSymbolSchema = z.enum(["BTC", "ETH"]);
export const adviceRequestSchema = z.object({ symbol: adviceSymbolSchema }).strict();
export const adviceCapabilitiesSchema = z
  .object({
    agentId: z.string().uuid(),
    symbols: adviceSymbolSchema.array(),
    horizonHours: z.literal(24),
    available: z.boolean(),
  })
  .strict();
export const adviceResultSchema = z
  .object({
    version: z.literal(1),
    symbol: adviceSymbolSchema,
    network: z.enum(["mainnet", "testnet"]),
    horizonHours: z.literal(24),
    orientation: z.enum(["long", "short", "wait"]),
    summary: z.string().min(1).max(2000),
    reasons: z.array(z.string().min(1).max(1000)).min(1).max(8),
    risks: z.array(z.string().min(1).max(1000)).min(1).max(8),
    limitations: z.array(z.string().min(1).max(1000)).max(12),
    sources: z
      .array(
        z
          .object({
            id: z.string().max(100),
            name: z.string().max(300),
            url: z.string().url(),
            observedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(20),
    generatedAt: z.string().datetime(),
    dataAsOf: z.string().datetime(),
  })
  .strict();
export const adviceRecommendationSchema = z
  .object({
    id: z.string().uuid(),
    agentId: z.string().uuid(),
    symbol: adviceSymbolSchema,
    status: z.enum(["queued", "running", "completed", "failed"]),
    createdAt: z.string().datetime(),
    startedAt: z.string().datetime().nullable(),
    finishedAt: z.string().datetime().nullable(),
    result: adviceResultSchema.nullable(),
    error: z.enum(["ANALYSIS_FAILED", "ANALYSIS_INTERRUPTED", "ANALYSIS_EXPIRED"]).nullable(),
  })
  .strict();
export const adviceAcceptedSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(["queued", "running", "completed", "failed"]),
    statusUrl: z.string(),
  })
  .strict();
export const adviceHistorySchema = z
  .object({ items: adviceRecommendationSchema.array(), nextCursor: z.string().nullable() })
  .strict();
export type AdviceResultDto = z.infer<typeof adviceResultSchema>;
