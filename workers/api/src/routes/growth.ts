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
  api.get("/landing", (c) => GET_landing(c, services));
  api.get("/health", (c) => GET_health(c, services));
  api.post("/waitlist", (c) => POST_waitlist(c, services));
  api.get("/applications", (c) => GET_applications(c, services));
  api.post("/applications", (c) => POST_applications(c, services));
  api.get("/tickers/availability", (c) => GET_tickers_availability(c, services));
  return api;
}
