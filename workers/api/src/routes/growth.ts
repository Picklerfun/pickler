import * as dto from "@pickler/api-schema";
import { z } from "zod";
import { operation } from "../openapi/operation";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../env";
import type { createGrowthServices } from "../growth/services";
import { GET as GET_landing } from "../growth/landing";
import { GET as GET_health } from "../growth/health";
import { POST as POST_waitlist } from "../growth/waitlist";
import { GET as GET_applications } from "../growth/applications";
import { POST as POST_applications } from "../growth/applications";
import { GET as GET_tickers_availability } from "../growth/tickers-availability";
export function growthRoutes(services: ReturnType<typeof createGrowthServices>) {
  const api = new Hono<AppEnv>();
  api.use("*", bodyLimit({ maxSize: 32_768 }));
  api.use("*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      const allowed = (c.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim());
      if (origin && !allowed.includes(origin)) {
        return c.json({ error: { code: "invalid_request", message: "Origin not allowed" } }, 403);
      }
      if (c.req.header("Sec-Fetch-Site") === "cross-site") {
        return c.json(
          { error: { code: "invalid_request", message: "Cross-site request refused" } },
          403,
        );
      }
    }
    await next();
  });
  api.get(
    "/landing",
    operation("growthLanding", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: dto.landingSchema,
    }),
    (c) => GET_landing(c, services),
  );
  api.get(
    "/health",
    operation("growthHealth", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: z.object({ status: z.literal("ok"), checkedAt: z.string() }),
    }),
    (c) => GET_health(c, services),
  );
  api.post(
    "/waitlist",
    operation("growthWaitlist", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: z.object({
        position: z.number(),
        alreadyJoined: z.boolean(),
        canApply: z.boolean(),
      }),
      body: z.object({ email: z.string(), ref: z.string().optional() }),
      description: "May issue the HttpOnly pk_apply cookie. Origin checks apply.",
    }),
    (c) => POST_waitlist(c, services),
  );
  api.get(
    "/applications",
    operation("growthApplicationGet", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: dto.applicantSchema,
      security: "apply",
    }),
    (c) => GET_applications(c, services),
  );
  api.post(
    "/applications",
    operation("growthApplicationSubmit", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: dto.applicantSchema,
      body: dto.applicationRequestSchema,
      security: "apply",
      status: 201,
    }),
    (c) => POST_applications(c, services),
  );
  api.get(
    "/tickers/availability",
    operation("growthTickerAvailability", {
      errors: z.union([dto.growthErrorSchema, dto.envelopeErrorSchema]),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      response: z.object({ ticker: z.string(), available: z.boolean() }),
      query: { ticker: { required: true } },
    }),
    (c) => GET_tickers_availability(c, services),
  );
  return api;
}
