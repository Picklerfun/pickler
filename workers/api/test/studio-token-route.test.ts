import test from "node:test";
import { AUSD } from "@pickler/chain";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  createTokenLaunchService,
  tokenReferenceEconomics,
} from "@pickler/core";
import { tokenFixture } from "@pickler/infrastructure/testing/token";
import { tokenStateSchema, tokenAuthorizationSchema, tokenDraftSchema } from "@pickler/api-schema";
import { studioRoutes, type StudioServices } from "../src/routes/studio.js";
import type { AppEnv } from "../src/env.js";

test("owner JWT -> private draft -> controlled grant -> stored state; no browser receipt can confirm", async (t) => {
  const f = await tokenFixture(t);
  const headers = { Authorization: "Bearer controlled-jwt", "content-type": "application/json" };
  const services: StudioServices = {
    directory: f.directory,
    repository: f.store,
    tokens: f.service,
    notifyQueued: async () => {},
    wallets: { findAgentWallet: async () => null },
    balances: {
      read: async () => {
        throw new Error("No provider calls allowed");
      },
      forget: () => {},
    },
    authenticate: async (request) => {
      if (request.bearerToken !== "controlled-jwt") {
        throw new AuthenticationRequiredError();
      }
      return {
        principal: buildUserPrincipal({
          user: { id: f.scope.userId },
          integrator: { id: f.access.workspaceId },
          memberRole: "admin",
        }),
        workspace: null,
      };
    },
  };
  const app = new Hono<AppEnv>();
  app.route("/v1/studio", studioRoutes(services));
  const path = `/v1/studio/agents/${f.scope.agentId}/token`;
  const request = (suffix: string, init: RequestInit = {}) =>
    app.request(path + suffix, init, { APP_ENV: "local" } as AppEnv["Bindings"]);
  for (const unauthorized of [
    {},
    { "X-API-Key": "controlled-key" },
    { Authorization: "HMAC controlled" },
  ]) {
    assert.equal((await request("", { headers: unauthorized })).status, 401);
  }
  const response = await request("", { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /private.*no-store/);
  assert.equal(tokenStateSchema.parse(await response.json()).confirmation, "absent");
  for (const extra of [
    { chainId: 143 },
    { creator: "0x1111111111111111111111111111111111111111" },
    { agentKey: "0x11" },
    { txHash: "0x22" },
    { economics: { source: "reference" } },
  ]) {
    assert.equal(
      (
        await request("/draft", {
          method: "PUT",
          headers,
          body: JSON.stringify({
            expectedVersion: 0,
            name: "Controlled",
            ticker: "CTRL",
            ...extra,
          }),
        })
      ).status,
      400,
    );
  }
  const saved = await request("/draft", {
    method: "PUT",
    headers,
    body: JSON.stringify({ expectedVersion: 0, name: "Controlled", ticker: "CTRL" }),
  });
  assert.equal(saved.status, 200);
  assert.equal(tokenDraftSchema.parse(await saved.json()).version, 1);
  const authHeaders = { ...headers, "Idempotency-Key": "controlled_api_launch_01" };
  const auth = await request("/authorize", {
    method: "POST",
    headers: authHeaders,
    body: '{"expectedVersion":1}',
  });
  assert.equal(auth.status, 200);
  const grant = tokenAuthorizationSchema.parse(await auth.json());
  assert.equal(grant.draftVersion, 1);
  const again = await request("/authorize", {
    method: "POST",
    headers: authHeaders,
    body: '{"expectedVersion":1}',
  });
  assert.deepEqual(await again.json(), grant);
  assert.equal(f.signer.calls(), 1);
  assert.equal(tokenStateSchema.parse(await (await request("", { headers })).json()).token, null);
  services.tokens = createTokenLaunchService({
    repository: f.repository,
    chainId: 10143,
    referenceEconomics: tokenReferenceEconomics(AUSD[10143]),
  });
  const reference = tokenStateSchema.parse(await (await request("", { headers })).json());
  assert.equal(reference.economics?.quoteAddress, AUSD[10143].address);
  assert.equal(reference.economics?.netReserveAtCompletion, "31999999998");
  assert.equal(reference.available, false);
  assert.equal(reference.preset, null);
  const hosted = await request("/authorize", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": "controlled_hosted_launch" },
    body: '{"expectedVersion":1}',
  });
  assert.equal(hosted.status, 409);
  assert.equal(f.signer.calls(), 1);
});
