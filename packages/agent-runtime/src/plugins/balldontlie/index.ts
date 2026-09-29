import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { ResearchTools } from "@pickler/core";
import { contextSchema } from "../schemas.js";
export function buildResearchTools(capabilities: Partial<ResearchTools>) {
  return capabilities.getSportsContext
    ? {
        getSportsContext: createTool({
          id: "getSportsContext",
          description:
            "Read structured NFL context for the selected game. External odds are reference data, not a forecast; rules may differ.",
          inputSchema: z.object({}).strict(),
          outputSchema: contextSchema,
          execute: async () => contextSchema.parse(await capabilities.getSportsContext!()),
        }),
      }
    : {};
}
