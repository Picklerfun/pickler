import type { PerplDashboardData } from "@pickler/trading/perps";
import {
  AuthenticationRequiredError,
  AccessDeniedError,
  InactiveWorkspaceError,
} from "@pickler/core";
import { HTTPException } from "hono/http-exception";
import { handleError } from "../http/error-handler";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import * as dto from "@pickler/api-schema";
import { PerplDashboardError, type PerplDashboardGateway } from "@pickler/infrastructure";
import type { AppEnv } from "../env";
import { authenticated, type Authenticate } from "../middleware/auth";
import { operation } from "../openapi/operation";
export interface PerplDashboardServices {
  gateway: PerplDashboardData & Pick<PerplDashboardGateway, "payload" | "enroll">;
  authenticate: Authenticate;
}
const MESSAGES: Record<PerplDashboardError["code"], string> = {
  UNAVAILABLE: "Perpl is not responding. Your last snapshot is kept.",
  INVALID_RESPONSE: "Perpl returned an incomplete snapshot. Try again shortly.",
  READ_ACCESS_EXPIRED: "Read access expired or was revoked. Authorize read-only access again.",
  READ_ACCESS_DENIED: "Perpl denied read access. Check the key permissions and integration origin.",
  NO_PERPL_PROFILE: "This wallet has no Perpl profile. Connect it at testnet.perpl.xyz first.",
  KEY_LIMIT: "Perpl's key limit was reached. Remove unused keys at testnet.perpl.xyz/apikeys.",
  INVALID_AUTHORIZATION: "Read authorization changed or expired. Start again.",
  RATE_LIMITED: "Perpl is limiting reads. Updates will resume shortly.",
};
export function perplDashboardRoutes(services: PerplDashboardServices) {
  const api = new Hono<AppEnv>();
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  api.use("*", bodyLimit({ maxSize: 24 * 1024 }));
  api.onError((error, c) => {
    if (
      error instanceof AuthenticationRequiredError ||
      error instanceof AccessDeniedError ||
      error instanceof InactiveWorkspaceError ||
      error instanceof HTTPException
    ) {
      return handleError(error, c);
    }
    const code = error instanceof PerplDashboardError ? error.code : "UNAVAILABLE";
    const status =
      code === "INVALID_AUTHORIZATION"
        ? 400
        : code === "READ_ACCESS_EXPIRED"
          ? 401
          : code === "READ_ACCESS_DENIED"
            ? 403
            : code === "NO_PERPL_PROFILE"
              ? 404
              : code === "KEY_LIMIT"
                ? 409
                : code === "RATE_LIMITED"
                  ? 429
                  : 503;
    if (status === 429) {
      c.header("Retry-After", "30");
    }
    return c.json({ error: code, message: MESSAGES[code] }, status);
  });
  api.get(
    "/markets",
    operation("perplDashboardMarkets", {
      response: dto.perplDashboardMarketsSchema,
      security: "public",
      errors: dto.studioErrorSchema,
      errorStatuses: [429, 503],
      description:
        "Read Perpl Monad testnet markets and prepared open-interest/funding metrics. Fixed venue, bounded context cache, explicit unknowns and freshness. No paper data or wallet access.",
    }),
    (c) => services.gateway.markets(c.req.raw.signal).then((result) => c.json(result)),
  );
  api.use("/read-key/*", authenticated(services.authenticate, { userOnly: true }));
  api.use("/portfolio", authenticated(services.authenticate, { userOnly: true }));
  api.post(
    "/read-key/payload",
    operation("perplDashboardReadPayload", {
      body: dto.perplReadKeyInputSchema,
      response: dto.perplReadKeyPayloadSchema,
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 413, 429, 503],
      description:
        "Prepare exact Perpl testnet read-only scope 1 enrollment for the caller-selected wallet and Ed25519 public key. One-hour maximum expiry, no trading/withdrawal/builder/delegation scopes. The browser owns the private key. No on-chain transaction.",
    }),
    async (c) => {
      const input = dto.perplReadKeyInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json(
          { error: "INVALID_AUTHORIZATION", message: MESSAGES.INVALID_AUTHORIZATION },
          400,
        );
      }
      return c.json(await services.gateway.payload(input.data, c.req.raw.signal));
    },
  );
  api.post(
    "/read-key/enroll",
    operation("perplDashboardReadEnroll", {
      body: dto.perplReadKeyEnrollSchema,
      response: dto.perplReadKeyResultSchema,
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 413, 429, 503],
      description:
        "Present the wallet-approved read-only enrollment and Ed25519 proof of possession to Perpl. Verifies the returned wallet, scope and expiry. Private no-store; neither signing key is received or persisted; no order/deposit/withdrawal operation.",
    }),
    async (c) => {
      const input = dto.perplReadKeyEnrollSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json(
          { error: "INVALID_AUTHORIZATION", message: MESSAGES.INVALID_AUTHORIZATION },
          400,
        );
      }
      return c.json(await services.gateway.enroll(input.data, c.req.raw.signal));
    },
  );
  api.post(
    "/portfolio",
    operation("perplDashboardPortfolio", {
      body: dto.perplPortfolioInputSchema,
      response: dto.perplPortfolioSchema,
      security: "user",
      errors: dto.studioErrorSchema,
      errorStatuses: [400, 401, 403, 404, 409, 413, 429, 503],
      description:
        "Read the key owner's real testnet wallet and open positions using two fresh client-signed proofs over fixed GET targets. Verify wallet identity, account ownership, unique positions and bounded block skew; compute exact price-only PnL, exposure and collateral exhaustion estimates. Funding/close fees are excluded from estimates. No credential persistence, URLs, writes, orders, paper balances or trades.",
    }),
    async (c) => {
      const input = dto.perplPortfolioInputSchema.safeParse(await c.req.json().catch(() => null));
      if (!input.success) {
        return c.json(
          { error: "INVALID_AUTHORIZATION", message: MESSAGES.INVALID_AUTHORIZATION },
          400,
        );
      }
      return c.json(await services.gateway.portfolio(input.data, c.req.raw.signal));
    },
  );
  return api;
}
