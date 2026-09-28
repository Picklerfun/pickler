import { z } from "zod";
const price = z
  .string()
  .regex(/^\d+(?:\.\d{1,18})?$/)
  .max(40);
export const perpsStudyConfigSchema = z
  .object({
    version: z.literal(1),
    protocol: z.literal("perps-comparison-v1"),
    tenantId: z.string().min(1).max(100),
    sessionId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,39}$/),
    network: z.enum(["mainnet", "testnet"]),
    hours: z.literal(24),
    budgetUsd: z.literal("5"),
    deepseek: z
      .object({
        model: z.string().min(1).max(100),
        baseUrl: z.url(),
        inputPerMillion: price,
        outputPerMillion: price,
      })
      .strict(),
    jev: z
      .object({
        model: z.literal("jev-1.13.0"),
        inputPerMillion: price,
        outputPerMillion: z.literal("0"),
      })
      .strict(),
    pricingVerifiedAt: z.iso.datetime(),
    pricingSources: z.array(z.url()).min(2).max(10),
  })
  .strict();
export type PerpsStudyConfigDto = z.infer<typeof perpsStudyConfigSchema>;
