import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { createWalletSignIn } from "@pickler/core";
import {
  AddressTakenError,
  BadSignatureError,
  ExpiredNonceError,
  UnknownNonceError,
  WalletAccountConflictError,
  WrongDomainError,
} from "@pickler/core";
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
 * tells a person to try again later when the truth is that their nonce is stale.
 *
 * `BadSignatureError` deliberately carries no `error` code: the client distinguishes it by the 401
 * alone, and the absence is what makes that work. Adding a code here would not be tidying.
 */
function asHttp(caught: unknown): never {
  if (caught instanceof UnknownNonceError || caught instanceof ExpiredNonceError) {
    throw badRequest(caught.message, { error: "nonce_invalid" });
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
  api.post("/nonce", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      address?: string;
      chain_id?: number;
    } | null;
    if (!body?.address || typeof body.chain_id !== "number") {
      throw badRequest("An address and a chain id are required to build the message");
    }
    const issued = await services.signIn
      .issueNonce({
        address: body.address,
        namespace: "eip155",
        chainReference: body.chain_id,
      })
      .catch(asHttp);
    return c.json(successEnvelope(issued, c.req.path));
  });

  /** `raw` is the whole request: the signature covers that string and nothing else is trusted. */
  function presented(body: unknown) {
    const it = body as { raw?: string; signature?: string } | null;
    if (!it?.raw || !it.signature) {
      throw badRequest("The exact string signed and its signature are both required");
    }
    return { raw: it.raw, signature: it.signature };
  }

  api.post("/verify", async (c) => {
    const result = await services.signIn
      .verify(presented(await c.req.json().catch(() => null)))
      .catch(asHttp);
    return c.json(successEnvelope(result, c.req.path, "Signed in"));
  });

  api.post("/link", authenticated(services.authenticate, { userOnly: true }), async (c) => {
    const result = await services.signIn
      .link(c.get("principal").id, presented(await c.req.json().catch(() => null)))
      .catch(asHttp);
    return c.json(successEnvelope(result, c.req.path, "Wallet linked"));
  });

  api.get("/links", authenticated(services.authenticate, { userOnly: true }), async (c) =>
    c.json(successEnvelope(await services.signIn.listLinks(c.get("principal").id), c.req.path)),
  );

  return api;
}
