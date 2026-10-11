import {
  PublicTokenTradeError,
  TokenTradeError,
  type createPublicTokenTrading,
} from "@pickler/core";
import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
import { Hono } from "hono";
import type { AppEnv } from "../env";
import type { createGrowthServices } from "../growth/services";
import {
  toAgentActionDto,
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
export function marketplaceRoutes(
  services: ReturnType<typeof createGrowthServices>,
  trading?: ReturnType<typeof createPublicTokenTrading>,
) {
  const api = new Hono<AppEnv>();
  api.post(
    "/personas/:handle/token/prepare",
    operation("marketplaceTokenPrepare", {
      security: "public",
      body: dto.publicTokenTradeInputSchema,
      response: dto.publicTokenTradePreparedSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 404, 409, 429, 503],
      description:
        "Prepare an unsigned Monad testnet curve approval or swap for the visitor wallet. Public published token only; wallet input grants no Pickler account permissions. Server resolves canonical contracts and limits. Does not sign, broadcast, attribute tokens or start an indexer. Explicit shared RPC ceiling; private no-store response.",
    }),
    async (c) => {
      c.header("Cache-Control", "private, no-store");
      const parsed = dto.publicTokenTradeInputSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success) {
        return c.json({ error: "INVALID_TRADE", message: "Invalid trade parameters." }, 400);
      }
      const body = parsed.data;
      if (!trading) {
        return c.json(
          { error: "TRADING_UNAVAILABLE", message: "Public trading is unavailable." },
          503,
        );
      }
      try {
        return c.json(
          dto.publicTokenTradePreparedSchema.parse(
            await trading.prepare(c.req.param("handle"), body),
          ),
        );
      } catch (error) {
        if (error instanceof TokenTradeError) {
          return c.json({ error: error.code, message: error.code }, 409);
        }
        if (error instanceof PublicTokenTradeError) {
          const status =
            error.code === "RPC_LIMIT"
              ? 429
              : error.code === "TOKEN_NOT_FOUND"
                ? 404
                : error.code === "INVALID_TRADE"
                  ? 400
                  : 503;
          if (status === 429) {
            c.header("Retry-After", "60");
          }
          return c.json({ error: error.code, message: error.code }, status);
        }
        return c.json(
          {
            error: "PROVIDER_UNAVAILABLE",
            message: "Could not prepare the trade. No transaction was sent.",
          },
          503,
        );
      }
    },
  );
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
    "/activity",
    operation("marketplaceActivity", {
      response: dto.agentActionSchema.array(),
      query: { limit: { description: "1 to 50, default 12" } },
    }),
    async (c) => {
      const asked = Number(c.req.query("limit") ?? "");
      const actions = await services.listAgentActions(Number.isFinite(asked) ? asked : undefined);
      return c.json(actions.map(toAgentActionDto));
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
