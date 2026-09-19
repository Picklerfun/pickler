import type { LandingResponse } from "@pickler/api-schema";
import type { createGrowthServices } from "./services";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { toErrorResponse } from "./errors";
import { toLandingResponse } from "./landing-response";

export async function GET(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  try {
    const body: LandingResponse = toLandingResponse(await services.getLanding());
    // Public aggregate data: a short shared cache absorbs polling from many visitors.
    return Response.json(body, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=15, stale-while-revalidate=60" },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
