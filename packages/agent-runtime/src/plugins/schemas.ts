import { z } from "zod";
export const sourceSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  title: z.string(),
  content: z.string().min(1).max(6000),
  retrievedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  provider: z.string(),
  truncated: z.boolean(),
  requestedUrl: z.string().url().optional(),
  provenance: z.enum(["search", "resolution-rule-link"]).optional(),
  pluginVersion: z.string().optional(),
  externalId: z.string().optional(),
  providerUsage: z.unknown().optional(),
});
export const marketSchema = z.object({
  id: z.string(),
  question: z.string(),
  rules: z.string().min(1).max(16000),
  categoryIds: z.array(z.string()),
  active: z.boolean(),
  startsAt: z.string().nullable().optional(),
  timingSource: z.string().nullable().optional(),
  sportsMarketType: z.string().nullable().optional(),
  resolutionUrls: z.array(z.string().url()).optional(),
  closesAt: z.string().nullable(),
  liquidity: z.number(),
  outcomes: z.array(z.object({ id: z.string(), label: z.string() })),
});
const level = z.object({ price: z.string(), size: z.string() });
export const bookSchema = z.object({
  outcomeId: z.string(),
  observedAt: z.string().datetime(),
  bids: z.array(level),
  asks: z.array(level),
});

export const contextSchema = z
  .object({
    status: z.enum(["available", "no_coverage", "stale"]),
    sources: z.array(sourceSchema),
    usage: z.unknown().optional(),
  })
  .strict();
