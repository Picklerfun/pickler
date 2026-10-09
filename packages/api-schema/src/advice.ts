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
/** x402 v1 `exact` terms of one fresh analysis (docs/specs/agent-advice-x402-v1.md §4.3). */
export const paymentRequirementsSchema = z
  .object({
    scheme: z.literal("exact"),
    network: z.literal("monad-testnet"),
    maxAmountRequired: z.string().regex(/^\d+$/),
    resource: z.string().url(),
    description: z.string(),
    mimeType: z.literal("application/json"),
    payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    maxTimeoutSeconds: z.literal(300),
    asset: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    extra: z
      .object({
        name: z.literal("Agora Dollar"),
        version: z.literal("1"),
        chainId: z.literal(10143),
      })
      .strict(),
  })
  .strict();
export const paymentErrorSchema = z.enum([
  "X-PAYMENT header is required",
  "invalid_payment",
  "invalid_signature",
  "wrong_amount",
  "wrong_recipient",
  "expired",
  "nonce_used",
  "insufficient_funds",
  "payer_not_linked",
  "settlement_failed",
]);
/** The 402 body: x402 v1's own shape, not the response envelope. */
export const paymentRequiredSchema = z
  .object({
    x402Version: z.literal(1),
    error: paymentErrorSchema,
    accepts: paymentRequirementsSchema.array().length(1),
  })
  .strict();
export type PaymentRequirementsDto = z.infer<typeof paymentRequirementsSchema>;
export type PaymentRequiredDto = z.infer<typeof paymentRequiredSchema>;
