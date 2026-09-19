import type { LandingResponse } from "@pickler/api-schema";
import { services } from "@/server/container";
import { toErrorResponse } from "@/server/http/errors";
import { toLandingResponse } from "@/server/http/landing-response";

export const runtime = "nodejs";

export async function GET() {
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
