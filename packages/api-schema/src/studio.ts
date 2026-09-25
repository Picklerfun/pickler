import { z } from "zod";
import { VENUES } from "./agents.js";
import { ACCENTS } from "./landing.js";
import { agentConfigSchema, agentResponseSchema } from "./research.js";

// Mirrors `STYLES` in core, which this package may not import; a drift test in workers/api pins it.
export const STYLES = ["careful", "balanced", "bold"] as const;
export type StyleDto = (typeof STYLES)[number];

/** The public profile the studio authors at creation. Every field travels; nothing is filled in. */
export const agentProfileInputSchema = z
  .object({
    accent: z.enum(ACCENTS),
    blurb: z.string().trim().max(280),
    venue: z.enum(VENUES),
    vibe: z.string().trim().max(120),
    voice: z.string().trim().max(120),
    decides: z.string().trim().max(280),
    wrong: z.string().trim().max(280),
    xHandle: z
      .string()
      .regex(/^@[A-Za-z0-9_]{1,15}$/)
      .nullable(),
  })
  .strict();

export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    config: agentConfigSchema.refine((config) => Boolean(config.marketScope), {
      message: "Choose a category and subcategory",
    }),
    profile: agentProfileInputSchema,
  })
  .strict();
export const idempotencyKeySchema = z.string().min(1).max(200);

export const studioAccessSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  canManage: z.boolean(),
});

export const studioAgentSchema = agentResponseSchema.extend({
  productId: z.string().uuid().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
});
export const studioOptionsSchema = z.object({
  defaults: z.object({
    profile: agentConfigSchema.shape.profile,
    tools: agentConfigSchema.shape.tools,
    limits: agentConfigSchema.shape.limits,
    intervalHours: agentConfigSchema.shape.intervalHours,
    uncertaintyPolicy: agentConfigSchema.shape.uncertaintyPolicy,
    sources: agentConfigSchema.shape.sources,
    skills: agentConfigSchema.shape.skills,
  }),
  plugins: z.array(
    z.object({
      id: z.enum(["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"]),
      version: z.string(),
      tools: agentConfigSchema.shape.tools,
    }),
  ),
});
