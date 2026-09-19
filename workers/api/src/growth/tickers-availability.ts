import type { TickerAvailabilityResponse } from "@pickler/api-schema";
import type { createGrowthServices } from "./services";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { errorResponse, toErrorResponse } from "./errors";

export async function GET(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  const raw = new URL(c.req.url).searchParams.get("ticker");
  if (!raw || raw.length > 16) {
    return errorResponse(400, "invalid_request", "Query parameter 'ticker' is required.");
  }

  try {
    const body: TickerAvailabilityResponse = await services.checkTicker(raw);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
