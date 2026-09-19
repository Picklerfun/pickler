import type { HealthResponse } from "@pickler/api-schema";
import type { createGrowthServices } from "./services";
import type { Context } from "hono";
import type { AppEnv } from "../env";

export function GET(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  const health = services.getHealth();
  const body: HealthResponse = {
    status: health.status,
    checkedAt: health.checkedAt.toISOString(),
  };
  return Response.json(body, {
    headers: { "Cache-Control": "no-store" },
  });
}
