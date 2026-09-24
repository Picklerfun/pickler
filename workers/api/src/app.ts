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

import { growthRoutes } from "./routes/growth";
import { marketplaceRoutes } from "./routes/marketplace";
import type { createGrowthServices } from "./growth/services";
import { consoleRoutes, type ConsoleServices } from "./routes/console";
import { signingRoutes, type SigningRouteServices } from "./routes/signing";
import { walletAuthRoutes, type WalletAuthServices } from "./routes/wallet-auth";

export interface Services extends AgentRouteServices, ProfileRouteServices {
  authenticate: Authenticate;
  console?: ConsoleServices;
  growth?: ReturnType<typeof createGrowthServices>;
  /** Absent when the deployment has no Turnkey bindings; the rest of the API still serves. */
  custody?: SigningRouteServices;
  /** Absent when SIWE_DOMAIN or WALLET_EMAIL_DOMAIN is missing; the rest of the API still serves. */
  walletAuth?: WalletAuthServices;
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

  if (services.console) {
    app.route("/v1/console", consoleRoutes(services.console));
  }
  if (services.custody) {
    app.route("/v1/signing", signingRoutes(services.custody));
  }
  if (services.walletAuth) {
    app.route("/v1/auth/wallet", walletAuthRoutes(services.walletAuth));
  }
  if (services.growth) {
    app.route("/v1", growthRoutes(services.growth));
    // Under its own prefix: /v1/agents is the authenticated workspace list ported from Relayer.
    app.route("/v1/marketplace", marketplaceRoutes(services.growth));
  }
  return app;
}
