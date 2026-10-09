import { Hono, type Context } from "hono";
import { z } from "zod";
import { createStudioAccess } from "@pickler/core";
import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
import type { AppEnv } from "../env";
import type { StudioServices } from "./studio";

export function studioTokenRoutes(services: StudioServices) {
  const api = new Hono<AppEnv>();
  const access = createStudioAccess(services.directory);
  const agentId = z.string().uuid();
  const errors = [400, 401, 403, 404, 409, 500, 503];
  async function scope(c: Context<AppEnv>) {
    const principal = c.get("principal");
    const current = await access.authorize(principal);
    await services.directory.agentScope(current, agentId.parse(c.req.param("id")));
    return { userId: principal.id, workspaceId: current.workspaceId, agentId: c.req.param("id")! };
  }
  api.get(
    "/agents/:id/token",
    operation("studioTokenState", {
      security: "user",
      response: dto.tokenStateSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Owner-only stored token intent and confirmed token identity. No chain or signer call. Launch authorization is unavailable in ordinary composition.",
    }),
    async (c) => {
      const target = await scope(c);
      if (!services.tokens) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token state is unavailable" }, 503);
      }
      return c.json(dto.tokenStateSchema.parse(await services.tokens.state(target)));
    },
  );
  api.put(
    "/agents/:id/token/draft",
    operation("studioTokenDraft", {
      security: "user",
      body: dto.tokenDraftInputSchema,
      response: dto.tokenDraftSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Saves the owner's name/ticker intent with optimistic concurrency. Network, avatar and master wallet are resolved by the server. Does not authorize or send a transaction.",
    }),
    async (c) => {
      const target = await scope(c);
      const body = dto.tokenDraftInputSchema.parse(await c.req.json());
      if (!services.tokens) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token drafts are unavailable" }, 503);
      }
      return c.json(dto.tokenDraftSchema.parse(await services.tokens.saveDraft(target, body)));
    },
  );
  api.post(
    "/agents/:id/token/authorize",
    operation("studioTokenAuthorize", {
      security: "user",
      body: dto.tokenAuthorizeInputSchema,
      response: dto.tokenAuthorizationSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Issues an idempotent five-minute platform launch grant only with an injected controlled issuer. Ordinary composition always refuses. This is not a creator signature, transaction submission or proof of deployment.",
      idempotent: true,
    }),
    async (c) => {
      const target = await scope(c);
      const body = dto.tokenAuthorizeInputSchema.parse(await c.req.json());
      const key = z
        .string()
        .regex(/^[A-Za-z0-9_-]{16,120}$/)
        .parse(c.req.header("Idempotency-Key"));
      if (!services.tokens) {
        return c.json(
          { error: "TOKEN_UNAVAILABLE", message: "Token authorization is unavailable" },
          503,
        );
      }
      return c.json(
        dto.tokenAuthorizationSchema.parse(
          await services.tokens.authorize(target, body.expectedVersion, key),
        ),
      );
    },
  );
  return api;
}
