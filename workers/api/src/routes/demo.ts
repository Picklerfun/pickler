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

/** Explicit sample content only. Private research never feeds these public endpoints. */
export function demoRoutes(services: ReturnType<typeof createGrowthServices>) {
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.header("X-Pickler-Data-Source", "sample");
    await next();
  });
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
  api.get("/analytics", async (c) =>
    c.json(toPlatformAnalyticsDto(await services.getPlatformAnalytics(c.req.query("range")))),
  );
  api.get("/leaderboard", async (c) => c.json(toLeaderboardDto(await services.getLeaderboard())));
  return api;
}
