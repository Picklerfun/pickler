import type { JoinWaitlistResponse } from "@pickler/api-schema";
import type { createGrowthServices } from "./services";
import type { Context } from "hono";
import type { AppEnv } from "../env";
import { getCookie, setCookie } from "hono/cookie";

import { errorResponse, toErrorResponse } from "./errors";
import { readJsonObject } from "./read-json";

export async function POST(c: Context<AppEnv>, services: ReturnType<typeof createGrowthServices>) {
  const body = await readJsonObject(c.req.raw, 1024);
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
      currentToken: getCookie(c, "pk_apply") ?? null,
    });
    if (placement.applyToken) {
      setCookie(c, "pk_apply", placement.applyToken, {
        httpOnly: true,
        secure: c.env.APP_ENV !== "local",
        sameSite: "Lax",
        path: "/",
        maxAge: 2592000,
      });
    }
    const response: JoinWaitlistResponse = {
      position: placement.position,
      alreadyJoined: placement.alreadyJoined,
      canApply: placement.applyToken !== null,
    };
    return c.json(response, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    return toErrorResponse(error);
  }
}
