import * as dto from "@pickler/api-schema";
import { operation } from "../openapi/operation";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { createWalletSignIn } from "@pickler/core";
import {
  AddressTakenError,
  BadSignatureError,
  ExpiredNonceError,
  InvalidAddressError,
  InvalidChainError,
  UnknownNonceError,
  WalletAccountConflictError,
  WrongDomainError,
} from "@pickler/core";
import { MalformedMessageError } from "@pickler/infrastructure";
import type { AppEnv } from "../env";
import { successEnvelope } from "../http/envelope";
import { badRequest, HttpError } from "../http/http-error";
import { authenticated, type Authenticate } from "../middleware/auth";

export interface WalletAuthServices {
  authenticate: Authenticate;
  signIn: ReturnType<typeof createWalletSignIn>;
}

/**
 * Every refusal is a 400, 401 or 409 with something the browser can branch on, never a 500. A 500
 * tells a person to try again later when the truth is that their nonce is stale. Malformed input
 * is the same: an address that is not one, a chain that is not a positive whole number and a string
 * that is not a sign-in message are each a 400 with a code of their own.
 *
 * viem's refusal of a message field is recognised by its name because this worker does not depend
 * on viem; it reaches here only through the builder the container hands to core.
 *
 * `BadSignatureError` deliberately carries no `error` code: the client distinguishes it by the 401
 * alone, and the absence is what makes that work. Adding a code here would not be tidying.
 */
function asHttp(caught: unknown): never {
  if (caught instanceof UnknownNonceError || caught instanceof ExpiredNonceError) {
    throw badRequest(caught.message, { error: "nonce_invalid" });
  }
  if (caught instanceof InvalidAddressError) {
    throw badRequest(caught.message, { error: "invalid_address" });
  }
  if (caught instanceof InvalidChainError) {
    throw badRequest(caught.message, { error: "invalid_chain" });
  }
  if (
    caught instanceof MalformedMessageError ||
    (caught instanceof Error && caught.name === "SiweInvalidMessageFieldError")
  ) {
    throw badRequest("That is not a Pickler sign-in message", { error: "invalid_message" });
  }
  if (caught instanceof WrongDomainError) {
    throw badRequest(caught.message, { error: "wrong_domain" });
  }
  if (caught instanceof BadSignatureError) {
    throw new HttpError(401, caught.message);
  }
  if (caught instanceof AddressTakenError) {
    throw new HttpError(409, caught.message);
  }
  if (caught instanceof WalletAccountConflictError) {
    throw new HttpError(409, caught.message, { error: "wallet_account_conflict" });
  }
  throw caught;
}

export function walletAuthRoutes(services: WalletAuthServices) {
  const api = new Hono<AppEnv>();
  api.use("*", bodyLimit({ maxSize: 8_192 }));
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });

  // Public: there is no session yet, which is the point. Answers with the string to sign.
  api.post(
    "/nonce",
    operation("walletNonce", {
      response: dto.envelopeSchema(dto.nonceResponseSchema),
      errorStatuses: [400, 413, 500, 503],
      body: dto.nonceRequestSchema,
    }),
    async (c) => {
      const body = (await c.req.json().catch(() => null)) as {
        address?: unknown;
        chain_id?: unknown;
      } | null;
      if (typeof body?.address !== "string" || !body.address || typeof body.chain_id !== "number") {
        throw badRequest("An address and a chain id are required to build the message");
      }
      // `typeof 1.5` is "number". Core refuses it too; refusing it here keeps it from the service.
      if (!Number.isSafeInteger(body.chain_id) || body.chain_id <= 0) {
        throw badRequest("The chain id must be a positive whole number", {
          error: "invalid_chain",
        });
      }
      const issued = await services.signIn
        .issueNonce({
          address: body.address,
          namespace: "eip155",
          chainReference: body.chain_id,
        })
        .catch(asHttp);
      return c.json(successEnvelope(issued, c.req.path));
    },
  );

  /** `raw` is the whole request: the signature covers that string and nothing else is trusted. */
  function presented(body: unknown) {
    const it = body as { raw?: unknown; signature?: unknown } | null;
    if (typeof it?.raw !== "string" || !it.raw) {
      throw badRequest("The exact string signed and its signature are both required");
    }
    if (typeof it.signature !== "string" || !it.signature) {
      throw badRequest("The exact string signed and its signature are both required");
    }
    return { raw: it.raw, signature: it.signature };
  }

  api.post(
    "/verify",
    operation("walletVerify", {
      response: dto.envelopeSchema(dto.walletSignInSchema),
      errorStatuses: [400, 401, 409, 413, 500, 503],
      body: dto.signatureRequestSchema,
    }),
    async (c) => {
      const result = await services.signIn
        .verify(presented(await c.req.json().catch(() => null)))
        .catch(asHttp);
      return c.json(successEnvelope(result, c.req.path, "Signed in"));
    },
  );

  api.post(
    "/link",
    operation("walletLink", {
      response: dto.envelopeSchema(dto.walletLinkResultSchema),
      errorStatuses: [400, 401, 403, 409, 413, 500, 503],
      body: dto.signatureRequestSchema,
      security: "user",
    }),
    authenticated(services.authenticate, { userOnly: true }),
    async (c) => {
      const result = await services.signIn
        .link(c.get("principal").id, presented(await c.req.json().catch(() => null)))
        .catch(asHttp);
      return c.json(successEnvelope(result, c.req.path, "Wallet linked"));
    },
  );

  api.get(
    "/links",
    operation("walletLinks", {
      response: dto.envelopeSchema(dto.walletLinkSchema.array()),
      security: "user",
    }),
    authenticated(services.authenticate, { userOnly: true }),
    async (c) =>
      c.json(successEnvelope(await services.signIn.listLinks(c.get("principal").id), c.req.path)),
  );

  return api;
}
