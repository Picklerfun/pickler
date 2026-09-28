import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ResearchTools } from "@pickler/core";
import { marketSchema, bookSchema } from "../schemas.js";
export function buildResearchTools(capabilities: Partial<ResearchTools>) {
  return {
    ...(capabilities.getMarketRules
      ? {
          getMarketRules: createTool({
            id: "getMarketRules",
            description: "Read the selected market and its full resolution rules.",
            inputSchema: z.object({}).strict(),
            outputSchema: marketSchema,
            execute: async () => marketSchema.parse(await capabilities.getMarketRules!()),
          }),
        }
      : {}),
    ...(capabilities.getOrderBook
      ? {
          getOrderBook: createTool({
            id: "getOrderBook",
            description:
              "Read current bids and asks for an outcome in the selected market. Prices are fractions of one unit of payout per share.",
            inputSchema: z.object({ outcomeId: z.string().regex(/^\d+$/) }).strict(),
            outputSchema: bookSchema,
            execute: async ({ outcomeId }) =>
              bookSchema.parse(await capabilities.getOrderBook!(outcomeId)),
          }),
        }
      : {}),
  };
}
