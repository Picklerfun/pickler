import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  perpSymbolSchema,
  perpFundingRequestSchema,
  perpFundingHistorySchema,
  perpMarketsSchema,
  perpSnapshotSchema,
  perpOrderBookSchema,
  perpCandleRequestSchema,
  perpCandlesSchema,
} from "@pickler/api-schema";
import type { PerpReadTools } from "@pickler/core";

/** These read tools are separate from prediction-market research tools. */
export function buildPerplTools(service: PerpReadTools) {
  return {
    getPerpFundingHistory: createTool({
      id: "getPerpFundingHistory",
      description:
        "Read bounded Perpl funding history. Events may have estimated application times; repeated blocks identify corrections, not new payments.",
      inputSchema: perpFundingRequestSchema,
      outputSchema: perpFundingHistorySchema,
      execute: async (input) =>
        perpFundingHistorySchema.parse(await service.getPerpFundingHistory(input)),
    }),
    listPerpMarkets: createTool({
      id: "listPerpMarkets",
      description:
        "Read the agent's permitted Perpl markets and their published configuration. No orders or private accounts.",
      inputSchema: z.object({}).strict(),
      outputSchema: perpMarketsSchema,
      execute: async () => perpMarketsSchema.parse(await service.listPerpMarkets()),
    }),
    getPerpSnapshot: createTool({
      id: "getPerpSnapshot",
      description:
        "Read distinct mark, index, last trade and funding data on Perpl. Components may have different timestamps; stale data is marked. Data is not a trading recommendation.",
      inputSchema: z.object({ symbol: perpSymbolSchema }).strict(),
      outputSchema: perpSnapshotSchema,
      execute: async (input) => perpSnapshotSchema.parse(await service.getPerpSnapshot(input)),
    }),
    getPerpOrderBook: createTool({
      id: "getPerpOrderBook",
      description:
        "Read a bounded snapshot of the Perpl L2 book. Depth is limited and is not a guaranteed fill.",
      inputSchema: z
        .object({ symbol: perpSymbolSchema, levels: z.number().int().min(1).max(100).default(20) })
        .strict(),
      outputSchema: perpOrderBookSchema,
      execute: async (input) => perpOrderBookSchema.parse(await service.getPerpOrderBook(input)),
    }),
    getPerpCandles: createTool({
      id: "getPerpCandles",
      description:
        "Read up to 1024 aligned Perpl candle intervals [from,to) in Unix milliseconds. Missing candles remain gaps and open candles are flagged.",
      inputSchema: perpCandleRequestSchema,
      outputSchema: perpCandlesSchema,
      execute: async (input) => perpCandlesSchema.parse(await service.getPerpCandles(input)),
    }),
  };
}
