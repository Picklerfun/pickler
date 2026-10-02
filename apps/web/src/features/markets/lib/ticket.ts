import { LEVERAGE_OPTIONS } from "@pickler/api-schema";
import type { PerpMarketDto } from "@pickler/api-schema";

// The ticket's arithmetic is in `quote.ts`, which reads no value from another package and can
// therefore be loaded by a test. This file adds the one thing that does.
export * from "./quote";

/** The leverages this market allows, in the order the ticket shows them. */
export const leverageChoices = (market: Pick<PerpMarketDto, "maxLeverage">) =>
  LEVERAGE_OPTIONS.filter((choice) => choice <= market.maxLeverage);
