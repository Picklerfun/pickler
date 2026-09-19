import type { TickerAvailabilityResponse } from "@pickler/api-schema";
import { services } from "@/server/container";
import { errorResponse, toErrorResponse } from "@/server/http/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("ticker");
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
