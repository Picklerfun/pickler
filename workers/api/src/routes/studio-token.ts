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
        "Owner-only stored token intent, confirmed identity and optional reference economics. Reference terms are not a published preset or executable quote. No chain or signer call. Launch remains unavailable without the independently verified testnet configuration.",
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
        "Issues an idempotent five-minute platform launch grant only with a verified testnet configuration and dedicated backend issuer. This is not a creator signature, transaction submission or proof of deployment.",
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

  api.post(
    "/agents/:id/token/operations",
    operation("studioTokenPrepareOperation", {
      security: "user",
      body: dto.tokenOperationInputSchema,
      response: dto.tokenOperationPreparedSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      idempotent: true,
      description:
        "Owner-only testnet preparation of an enumerated launch or fee action. The backend resolves all wallets/contracts/calldata and freezes a durable intent before external work. Requires the reviewed venue policy. Buy/sell and exact approvals accept only atomic amounts and bounded slippage; no transaction is sent.",
    }),
    async (c) => {
      const target = await scope(c);
      const body = dto.tokenOperationInputSchema.parse(await c.req.json());
      const key = z
        .string()
        .regex(/^[A-Za-z0-9_-]{16,120}$/)
        .parse(c.req.header("Idempotency-Key"));
      if (!services.tokenOperations) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token operations unavailable" }, 503);
      }
      return c.json(
        dto.tokenOperationPreparedSchema.parse(
          await services.tokenOperations.prepare(
            target,
            {
              action: body.action,
              expectedVersion: body.expectedVersion,
              ...(body.asset ? { asset: body.asset } : {}),
              ...(body.trade ? { trade: body.trade } : {}),
            },
            key,
          ),
        ),
      );
    },
  );
  api.post(
    "/agents/:id/token/operations/:operationId/confirm",
    operation("studioTokenConfirmOperation", {
      security: "user",
      body: dto.tokenOperationConfirmSchema,
      response: dto.tokenOperationSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Byte-exact existing passkey activity confirmation. Persists signing admission and signed transaction before one broadcast. Uncertain responses require reconciliation, never another grant or replacement.",
    }),
    async (c) => {
      const target = await scope(c);
      const body = dto.tokenOperationConfirmSchema.parse(await c.req.json());
      const id = z.string().uuid().parse(c.req.param("operationId"));
      if (!services.tokenOperations) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token operations unavailable" }, 503);
      }
      return c.json(
        dto.tokenOperationSchema.parse(
          await services.tokenOperations.confirm(target, id, body.expectedVersion, body.signed),
        ),
      );
    },
  );
  api.get(
    "/agents/:id/token/operations/:operationId",
    operation("studioTokenOperationStatus", {
      security: "user",
      response: dto.tokenOperationSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Explicit bounded reconciliation of the same activity/hash. No signing, replacement or automatic broadcast. Inclusion alone never confirms token identity; canonical indexer attribution is required.",
    }),
    async (c) => {
      const target = await scope(c);
      const id = z.string().uuid().parse(c.req.param("operationId"));
      if (!services.tokenOperations) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token operations unavailable" }, 503);
      }
      return c.json(
        dto.tokenOperationSchema.parse(await services.tokenOperations.status(target, id)),
      );
    },
  );
  api.post(
    "/agents/:id/token/operations/:operationId/cancel",
    operation("studioTokenCancelOperation", {
      security: "user",
      body: dto.tokenOperationCancelSchema,
      response: dto.tokenOperationSchema,
      errors: dto.studioErrorSchema,
      errorStatuses: errors,
      description:
        "Cancels only before signing admission. Does not erase the grant/nonce or make an uncertain signed operation retryable.",
    }),
    async (c) => {
      const target = await scope(c);
      const body = dto.tokenOperationCancelSchema.parse(await c.req.json());
      const id = z.string().uuid().parse(c.req.param("operationId"));
      if (!services.tokenOperations) {
        return c.json({ error: "TOKEN_UNAVAILABLE", message: "Token operations unavailable" }, 503);
      }
      return c.json(
        dto.tokenOperationSchema.parse(
          await services.tokenOperations.cancel(target, id, body.expectedVersion),
        ),
      );
    },
  );
  return api;
}
