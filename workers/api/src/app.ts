import { Hono } from "hono";
import type { AppEnv } from "./env";
import { successEnvelope } from "./http/envelope";
import { handleError } from "./http/error-handler";
import { HttpError } from "./http/http-error";
import type { Authenticate } from "./middleware/auth";
import { requestId } from "./middleware/request-id";
import { agentRoutes, type AgentRouteServices } from "./routes/agents";
import { authRoutes } from "./routes/auth";
import { corsFromEnv } from "./middleware/cors";
import { handleRoutes, profileRoutes, type ProfileRouteServices } from "./routes/profiles";

export interface Services extends AgentRouteServices, ProfileRouteServices {
  authenticate: Authenticate;
}

/** Builds the HTTP app from services, so tests can inject fakes without bindings. */
export function createApp(services: Services) {
  const app = new Hono<AppEnv>();
  app.use("*", requestId);
  app.use("/v1/*", corsFromEnv);
  app.onError(handleError);
  app.notFound((c) => handleError(new HttpError(404, "Route not found"), c));

  // Liveness only; it does not check Supabase or other dependencies.
  app.get("/health", (c) => c.json(successEnvelope({ status: "ok" }, c.req.path)));
  app.route("/v1/auth", authRoutes(services.authenticate));
  app.route("/v1/agents", agentRoutes(services));
  app.route("/v1/handles", handleRoutes(services));
  app.route("/v1/profile", profileRoutes(services));

  return app;
}
