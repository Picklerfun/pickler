import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { createGrowthServices } from "../growth/services";
import {
  toAgentSummaryDto,
  toAgentProfileDto,
  toPickDetailDto,
  toAgentPersonaDto,
  toDirectoryAgentDto,
  toAgentReadDto,
  toPlatformAnalyticsDto,
  toLeaderboardDto,
} from "../growth/agent-responses";
import { toMarketDetailDto, toPerpMarketDto } from "../growth/market-responses";

/**
 * The marketplace's public reads: agents, profiles, personas, reads, analytics and the leaderboard
 * come from the database, and the perpetuals board from the sample market board until there is a
 * venue to read.
 *
 * Mounted under /v1/marketplace rather than /v1 because the workspace API ported from Relayer
 * already owns /v1/agents behind credentials; on the same path the public list would answer 401
 * and this handler would never run.
 */
export function marketplaceRoutes(services: ReturnType<typeof createGrowthServices>) {
  const api = new Hono<AppEnv>();
  api.get("/agents", async (c) => c.json((await services.listAgents()).map(toAgentSummaryDto)));
  api.get("/directory", async (c) =>
    c.json((await services.listDirectory()).map(toDirectoryAgentDto)),
  );
  api.get("/reads", async (c) => c.json((await services.listReads()).map(toAgentReadDto)));
  api.get("/reads/:id", async (c) => {
    const value = await services.getRead(c.req.param("id"));
    return c.json(value ? toAgentReadDto(value) : null);
  });
  api.get("/profiles/:ticker", async (c) => {
    const value = await services.getAgentProfile(c.req.param("ticker"));
    return c.json(value ? toAgentProfileDto(value) : null);
  });
  api.get("/profiles/:ticker/picks/:id", async (c) => {
    const value = await services.getPickDetail(c.req.param("ticker"), c.req.param("id"));
    return c.json(value ? toPickDetailDto(value) : null);
  });
  api.get("/personas/:handle", async (c) => {
    const value = await services.getAgentPersona(c.req.param("handle"));
    return c.json(value ? toAgentPersonaDto(value) : null);
  });
  api.get("/markets", async (c) => c.json((await services.listMarkets()).map(toPerpMarketDto)));
  api.get("/markets/:symbol", async (c) => {
    const value = await services.getMarket(c.req.param("symbol"));
    return c.json(value ? toMarketDetailDto(value) : null);
  });
  api.get("/analytics", async (c) =>
    c.json(toPlatformAnalyticsDto(await services.getPlatformAnalytics(c.req.query("range")))),
  );
  api.get("/leaderboard", async (c) => c.json(toLeaderboardDto(await services.getLeaderboard())));
  return api;
}
