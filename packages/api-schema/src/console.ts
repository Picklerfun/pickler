import { z } from "zod";
import { agentConfigSchema, agentResponseSchema } from "./research.js";
export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    config: agentConfigSchema.refine((config) => Boolean(config.marketScope), {
      message: "Choose a category and subcategory",
    }),
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
