import test from "node:test";
import { AUSD } from "@pickler/chain";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  AuthenticationRequiredError,
  buildUserPrincipal,
  createTokenLaunchService,
  createTokenOperationService,
  type TokenOperationDriver,
  tokenReferenceEconomics,
} from "@pickler/core";
import { tokenFixture } from "@pickler/infrastructure/testing/token";
import {
  tokenStateSchema,
  tokenAuthorizationSchema,
  tokenDraftSchema,
  tokenOperationPreparedSchema,
  tokenOperationSchema,
} from "@pickler/api-schema";
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
  let signs = 0,
    sends = 0;
  const hash = "0x" + "a".repeat(64);
  const driver: TokenOperationDriver = {
    ready: true,
    async prepare(_scope, intent) {
      return {
        operationId: intent.id,
        chainId: 10143,
        sender: grant.params.creator,
        destination: grant.factory,
        unsignedTransaction: "0x02",
        transactionNonce: 0,
        gas: "1",
        maxFeePerGas: "1",
        maximumGasCost: "1",
        deadline: intent.deadline,
        activity: {
          url: "https://api.turnkey.com/public/v1/submit/sign_transaction",
          body: "controlled",
          organizationId: "controlled",
          timestampMs: "1",
        },
      };
    },
    async preflight() {},
    async verify() {
      return hash;
    },
    async sign() {
      signs++;
      return { activityId: "controlled", status: "completed", rawTransaction: "0x02aa" };
    },
    async activity() {
      throw new Error("No automatic activity polling");
    },
    async broadcast() {
      sends++;
      return hash;
    },
    async receipt() {
      return { status: "finalized", blockHash: "0x" + "b".repeat(64) };
    },
  };
  services.tokenOperations = createTokenOperationService({
    repository: f.repository,
    tokens: f.service,
    driver,
    chainId: 10143,
  });
  for (const extra of [
    { calldata: "0x1234" },
    { wallet: grant.params.creator },
    { factory: grant.factory },
    { chainId: 143 },
    { action: "arbitrary" },
  ]) {
    assert.equal(
      (
        await request("/operations", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ action: "launch", expectedVersion: 1, ...extra }),
        })
      ).status,
      400,
    );
  }
  const preparedResponse = await request("/operations", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ action: "launch", expectedVersion: 1 }),
  });
  assert.equal(preparedResponse.status, 200);
  const prepared = tokenOperationPreparedSchema.parse(await preparedResponse.json());
  assert.equal(prepared.operation.status, "awaiting_signature");
  assert.ok(prepared.activity);
  const confirm = await request(`/operations/${prepared.operation.id}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      expectedVersion: prepared.operation.version,
      signed: {
        url: prepared.activity!.url,
        body: prepared.activity!.body,
        stamp: { stampHeaderName: "X-Stamp-Webauthn", stampHeaderValue: "controlled" },
      },
    }),
  });
  assert.equal(confirm.status, 200);
  const sent = tokenOperationSchema.parse(await confirm.json());
  assert.equal(sent.status, "confirming");
  const repeat = await request(`/operations/${sent.id}/confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedVersion: sent.version }),
  });
  assert.equal(repeat.status, 200);
  assert.deepEqual({ signs, sends }, { signs: 1, sends: 1 });
  const checked = await request(`/operations/${sent.id}`, { headers });
  const final = await checked.json();
  assert.equal(tokenOperationSchema.parse(final).status, "finalized");
  assert.equal(JSON.stringify(final).includes("0x02aa"), false);
  assert.equal(
    tokenStateSchema.parse(await (await request("", { headers })).json()).confirmation,
    "pending",
  );
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

import { createApp } from "../src/app.js";
import { documentationServices } from "../src/openapi/composition.js";
import { createTokenMetadata } from "@pickler/infrastructure";
import { keccak256, stringToHex } from "viem";
test("public metadata is hash-addressed read-only JSON/SVG with immutable privacy headers", async () => {
  const body = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  const filename = keccak256(stringToHex(body)).slice(2) + ".svg";
  let reads = 0;
  const metadata = createTokenMetadata(
    {
      async put() {
        throw new Error("No public writes");
      },
      async get(key) {
        reads++;
        return key === "tokens/" + filename
          ? {
              size: body.length,
              async text() {
                return body;
              },
            }
          : null;
      },
    },
    "https://app.pickler.fun",
  );
  const services = documentationServices({});
  services.tokenAssets = metadata;
  const app = createApp(services);
  const response = await app.request("/v1/token-assets/" + filename, {}, { APP_ENV: "local" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
  assert.match(response.headers.get("content-type")!, /image\/svg\+xml/);
  assert.match(response.headers.get("cache-control")!, /immutable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const before = reads;
  assert.equal(
    (await app.request("/v1/token-assets/invalid", {}, { APP_ENV: "local" })).status,
    404,
  );
  assert.equal(reads, before);
  assert.equal(
    (await app.request("/v1/token-assets/" + filename, { method: "POST" }, { APP_ENV: "local" }))
      .status,
    404,
  );
});
