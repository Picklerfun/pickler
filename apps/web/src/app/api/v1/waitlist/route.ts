import type { JoinWaitlistResponse } from "@pickler/api-schema";
import { services } from "@/server/container";
import { readApplyToken, writeApplyToken } from "@/server/http/apply-cookie";
import { errorResponse, toErrorResponse } from "@/server/http/errors";
import { readJsonObject } from "@/server/http/read-json";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await readJsonObject(request, 1024);
  if (body instanceof Response) {
    return body;
  }
  if (typeof body.email !== "string") {
    return errorResponse(400, "invalid_request", "Field 'email' must be a string.");
  }
  const referralCode = typeof body.ref === "string" ? body.ref : null;

  try {
    const placement = await services.joinWaitlist(body.email, {
      referralCode,
      currentToken: await readApplyToken(),
    });
    if (placement.applyToken) {
      await writeApplyToken(placement.applyToken);
    }
    const response: JoinWaitlistResponse = {
      position: placement.position,
      alreadyJoined: placement.alreadyJoined,
      canApply: placement.applyToken !== null,
    };
    return Response.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
