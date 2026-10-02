import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
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
  api.get(
    "/agents",
    operation("marketplaceAgents", { response: dto.agentSummarySchema.array() }),
    async (c) => c.json((await services.listAgents()).map(toAgentSummaryDto)),
  );
  api.get(
    "/directory",
    operation("marketplaceDirectory", { response: dto.directoryAgentSchema.array() }),
    async (c) => c.json((await services.listDirectory()).map(toDirectoryAgentDto)),
  );
  api.get(
    "/reads",
    operation("marketplaceReads", { response: dto.agentReadSchema.array() }),
    async (c) => c.json((await services.listReads()).map(toAgentReadDto)),
  );
  api.get(
    "/reads/:id",
    operation("marketplaceRead", { response: dto.agentReadSchema.nullable() }),
    async (c) => {
      const value = await services.getRead(c.req.param("id"));
      return c.json(value ? toAgentReadDto(value) : null);
    },
  );
  api.get(
    "/profiles/:ticker",
    operation("marketplaceProfile", { response: dto.agentProfileSchema.nullable() }),
    async (c) => {
      const value = await services.getAgentProfile(c.req.param("ticker"));
      return c.json(value ? toAgentProfileDto(value) : null);
    },
  );
  api.get(
    "/profiles/:ticker/picks/:id",
    operation("marketplacePick", { response: dto.pickDetailSchema.nullable() }),
    async (c) => {
      const value = await services.getPickDetail(c.req.param("ticker"), c.req.param("id"));
      return c.json(value ? toPickDetailDto(value) : null);
    },
  );
  api.get(
    "/personas/:handle",
    operation("marketplacePersona", { response: dto.agentPersonaSchema.nullable() }),
    async (c) => {
      const value = await services.getAgentPersona(c.req.param("handle"));
      return c.json(value ? toAgentPersonaDto(value) : null);
    },
  );
  api.get(
    "/markets",
    operation("marketplaceMarkets", { response: dto.perpMarketDtoSchema.array() }),
    async (c) => c.json((await services.listMarkets()).map(toPerpMarketDto)),
  );
  api.get(
    "/markets/:symbol",
    operation("marketplaceMarket", { response: dto.marketDetailDtoSchema.nullable() }),
    async (c) => {
      const value = await services.getMarket(c.req.param("symbol"));
      return c.json(value ? toMarketDetailDto(value) : null);
    },
  );
  api.get(
    "/analytics",
    operation("marketplaceAnalytics", {
      response: dto.platformAnalyticsSchema,
      query: { range: { description: "7d, 30d or 90d" } },
    }),
    async (c) =>
      c.json(toPlatformAnalyticsDto(await services.getPlatformAnalytics(c.req.query("range")))),
  );
  api.get(
    "/leaderboard",
    operation("marketplaceLeaderboard", { response: dto.leaderboardSchema }),
    async (c) => c.json(toLeaderboardDto(await services.getLeaderboard())),
  );
  return api;
}
