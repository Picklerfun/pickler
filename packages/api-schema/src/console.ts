import { z } from "zod";
import { agentConfigSchema } from "./research.js";
export const createAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(40),
    handle: z.string().regex(/^[a-z0-9_]{3,15}$/),
    config: agentConfigSchema,
  })
  .strict();
export const idempotencyKeySchema = z.string().min(1).max(200);
