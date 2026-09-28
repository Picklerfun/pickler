import { z } from "zod";
import { COMPARISON_PROTOCOL } from "@pickler/trading/strategies";
export const quantConfigSchema = z
  .object({
    version: z.literal(2),
    protocol: z.literal("btc-quant-jev-v1"),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    plugins: z
      .array(z.enum(["polymarket", "coinbase", "jev"]))
      .refine((v) => new Set(v).size === v.length),
    jevInputPerMillion: z.number().positive(),
    maxNewReservedUsd: z.number().positive().max(0.1),
    historicalStudies: z.array(z.string().regex(/^[a-z0-9-]{1,60}$/)),
  })
  .strict();
export const comparisonConfigSchema = z
  .object({
    version: z.literal(3),
    protocol: z.literal(COMPARISON_PROTOCOL),
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    plugins: z
      .array(z.enum(["polymarket", "coinbase", "jev"]))
      .refine((p) => new Set(p).size === p.length),
    jevInputPerMillion: z.number().positive(),
    maxNewReservedUsd: z.number().positive().max(0.25),
    historicalStudies: z
      .array(z.string().regex(/^[a-z0-9-]{1,60}$/))
      .refine((p) => new Set(p).size === p.length),
  })
  .strict();
