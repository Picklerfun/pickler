import { z } from "zod";
import type { VenueDto } from "./agents.js";
import type { AccentDto } from "./landing.js";
import { agentConfigSchema, agentResponseSchema } from "./research.js";

// These mirror `ACCENTS` and `VENUES` in core, which this package may not import. Core stays
// authoritative; the web form needs the lists to draw the choice before it can ask anyone.
export const ACCENTS = [
  "lime",
  "cyan",
  "amber",
  "orange",
  "magenta",
  "violet",
  "blue",
] as const satisfies readonly AccentDto[];
export const VENUES = ["predictions", "perps", "both"] as const satisfies readonly VenueDto[];

/** The public profile the studio authors at creation. Every field is stored; none is optional. */
export const agentProfileInputSchema = z
  .object({
    accent: z.enum(ACCENTS),
    blurb: z.string().trim().max(280),
    venue: z.enum(VENUES),
    vibe: z.string().trim().max(120).default(""),
    voice: z.string().trim().max(120).default(""),
    decides: z.string().trim().max(280).default(""),
    wrong: z.string().trim().max(280).default(""),
    xHandle: z
      .string()
      .regex(/^@[A-Za-z0-9_]{1,15}$/)
      .nullable()
      .default(null),
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

export const consoleAccessSchema = z.object({
  workspaceId: z.string().uuid(),
  enabled: z.boolean(),
  canManage: z.boolean(),
});

export const consoleAgentSchema = agentResponseSchema.extend({
  productId: z.string().uuid().optional(),
  name: z.string().optional(),
  handle: z.string().optional(),
});
export const consoleOptionsSchema = z.object({
  defaults: z.object({
    profile: agentConfigSchema.shape.profile,
    tools: agentConfigSchema.shape.tools,
    limits: agentConfigSchema.shape.limits,
    intervalHours: agentConfigSchema.shape.intervalHours,
    uncertaintyPolicy: agentConfigSchema.shape.uncertaintyPolicy,
  }),
  plugins: z.array(
    z.object({
      id: z.enum(["polymarket", "exa", "balldontlie", "the-odds-api", "paper-trading"]),
      version: z.string(),
      tools: agentConfigSchema.shape.tools,
    }),
  ),
});
