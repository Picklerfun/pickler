import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../env";

/** Browsers may call the API only from origins listed in ALLOWED_ORIGINS (comma-separated). */
export const corsFromEnv = createMiddleware<AppEnv>(async (c, next) => {
  const allowed = (c.env?.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
    allowHeaders: ["Authorization", "Content-Type", "X-Integrator-Id", "X-Request-Id"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    exposeHeaders: ["X-Request-Id"],
    maxAge: 600,
  })(c, next);
});
