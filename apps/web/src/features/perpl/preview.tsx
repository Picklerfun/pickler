"use client";
import { perplDashboardMarketsSchema, perplPortfolioSchema } from "@pickler/api-schema";
import { PerplDashboardSurface } from "./dashboard";
import fixture from "./preview-data.json";

const market = perplDashboardMarketsSchema.parse(fixture.market);
const portfolio = perplPortfolioSchema.parse(fixture.portfolio);
const snapshot = {
  market,
  portfolio,
  marketError: null,
  error: null,
  now: Date.parse(portfolio.observedAt),
};

/** Server-gated local example. The live dashboard hook is never mounted. */
export function PerplDashboardPreview() {
  return <PerplDashboardSurface snapshot={snapshot} walletAddress={portfolio.wallet} preview />;
}
