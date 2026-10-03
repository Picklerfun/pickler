import { test } from "node:test";
import assert from "node:assert/strict";
import SwaggerParser from "@apidevtools/swagger-parser";
import { z } from "zod";
import { AuthenticationRequiredError, buildUserPrincipal } from "@pickler/core";
import * as dto from "@pickler/api-schema";
import { createApp } from "../src/app.js";
import { documentationServices } from "../src/openapi/composition.js";
import { apiDocument } from "../src/openapi/document.js";
import { assertDocumentCoverage } from "../src/openapi/coverage.js";
import { operation } from "../src/openapi/operation.js";

const env = { APP_ENV: "test" };

test("full document validates, covers mounted routes and retains unique alias operations", async () => {
  const app = createApp(documentationServices());
  const document = await apiDocument(app);
  assertDocumentCoverage(app, document);
  await SwaggerParser.validate(structuredClone(document), { resolve: { external: false } });
  assert.equal(document.openapi, "3.1.0");
  assert.deepEqual(
    document.servers?.map((server) => server.url),
    ["/api"],
  );
  assert.ok(document.paths["/v1/studio/wallets/transfers/confirm"]?.post);
  assert.ok(document.paths["/v1/auth/wallet/join"]?.post);
  assert.ok(document.paths["/v1/studio/wallets/ledger"]?.get);
  assert.ok(document.paths["/v1/studio/agents/{id}/setup"]?.put);
  assert.ok(document.paths["/v1/studio/agents/{id}/publish"]?.post);
  assert.ok(document.paths["/v1/studio/agents/{id}/x/verify"]?.post);
  for (const [path, method] of [
    ["/v1/studio/agents/{id}/perps/checks", "post"],
    ["/v1/studio/agents/{id}/perps/checks", "get"],
    ["/v1/studio/perps/checks/{id}", "get"],
    ["/v1/studio/agents/{id}/perps/positions", "get"],
    ["/v1/studio/perps/positions/{id}/close", "post"],
    ["/v1/studio/agents/{id}/perps/stop", "post"],
    ["/v1/studio/agents/{id}/perps/proposals", "get"],
    ["/v1/studio/perps/proposals/{id}/approve", "post"],
    ["/v1/studio/perps/proposals/{id}/skip", "post"],
    ["/v1/studio/agents/{id}/perps/record", "get"],
  ] as const) {
    const described = document.paths[path]?.[method];
    assert.ok(described, `${method} ${path}`);
    assert.deepEqual(described.security, [{ bearerAuth: [] }]);
  }
  assert.ok(
    document.paths["/v1/studio/agents/{id}/perps/checks"]?.post?.responses?.["202"] &&
      document.paths["/v1/studio/agents/{id}/perps/checks"]?.post?.responses?.["429"],
  );
  assert.match(
    document.paths["/v1/console/agents/{id}"]?.get?.description ?? "",
    /alias of \/v1\/studio\/agents/,
  );
  assert.notEqual(
    document.paths["/v1/demo/reads"]?.get?.operationId,
    document.paths["/v1/marketplace/reads"]?.get?.operationId,
  );
  assert.deepEqual(document.paths["/v1/profile"]?.post?.security, [{ bearerAuth: [] }]);
  assert.deepEqual(document.paths["/v1/marketplace/reads"]?.get?.security, []);
  assert.deepEqual(document.paths["/v1/applications"]?.post?.security, [{ applyCookie: [] }]);
  const agentSecurity = document.paths["/v1/agents/{id}/status"]?.get?.security;
  assert.ok(
    agentSecurity?.some(
      (entry) => "agentSignature" in entry && "agentId" in entry && "agentTimestamp" in entry,
    ),
  );
  assert.ok(
    document.paths["/v1/agents/{id}"]?.get?.parameters?.some(
      (entry) => "name" in entry && entry.name === "id" && entry.required,
    ),
  );
  assert.ok(
    document.paths["/v1/studio/agents/{id}/runs"]?.post?.parameters?.some(
      (entry) => "name" in entry && entry.name === "Idempotency-Key" && entry.required,
    ),
  );
});

test("optional route groups are absent when not mounted, with no document cache cross-contamination", async () => {
  const full = createApp(documentationServices());
  await apiDocument(full);
  const app = createApp(documentationServices({}));
  const document = await apiDocument(app);
  assertDocumentCoverage(app, document);
  assert.ok(!document.paths["/v1/signing/passkeys/challenge"]);
  assert.ok(!document.paths["/v1/auth/wallet/nonce"]);
  assert.ok(!document.paths["/v1/studio/agents"]);
  assert.ok(!document.paths["/v1/launches"]);
  assert.ok(!document.paths["/v1/marketplace/reads"]);
  assert.ok(document.paths["/v1/profile"]);
});

test("public document generation never invokes services and adds no token or provider example", async () => {
  const app = createApp(documentationServices());
  const response = await app.request("/v1/openapi.json", {}, env);
  assert.equal(response.status, 200);
  const document = await response.json();
  assertDocumentCoverage(app, document);
  const encoded = JSON.stringify(document);
  assert.ok(!encoded.includes("PRIVATE_KEY"));
  assert.ok(!encoded.includes("SUPABASE_SECRET_KEY"));
  assert.ok(!encoded.includes("postgresql://"));
});

test("CI refuses a new handler with no description or duplicate operation id", async () => {
  const app = createApp(documentationServices({}));
  app.get("/v1/forgotten", (c) => c.json({ value: true }));
  assert.throws(() => assertDocumentCoverage(app, {} as Awaited<ReturnType<typeof apiDocument>>));
  const document = await apiDocument(app);
  assert.throws(() => assertDocumentCoverage(app, document));
  const described = createApp(documentationServices({}));
  described.get(
    "/v1/duplicate",
    operation("authMe", { response: z.object({ ok: z.boolean() }) }),
    (c) => c.json({ ok: true }),
  );
  const duplicate = await apiDocument(described);
  assert.throws(() => assertDocumentCoverage(described, duplicate), /duplicate operationId/);
});

test("existing authentication and invalid-input responses retain their wire format", async () => {
  const services = documentationServices({});
  services.authenticate = async () => {
    throw new AuthenticationRequiredError();
  };
  const app = createApp(services);
  const forbidden = await app.request("/v1/profile", {}, env);
  assert.equal(forbidden.status, 401);
  dto.envelopeErrorSchema.parse(await forbidden.json());
  // Documentation must not introduce a validator or change this hand-written error mapping.
  services.authenticate = async () => ({
    principal: buildUserPrincipal({
      user: { id: "user", email: "user@example.invalid" },
      memberRole: "owner",
    }),
    workspace: null,
  });
  const invalid = await createApp(services).request(
    "/v1/profile",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
    env,
  );
  assert.equal(invalid.status, 400);
  dto.envelopeErrorSchema.parse(await invalid.json());
});

test("representative profile and wallet-auth responses conform to published schemas", async () => {
  const services = documentationServices({});
  services.authenticate = async () => ({
    principal: buildUserPrincipal({ user: { id: "user", email: null }, memberRole: "owner" }),
    workspace: null,
  });
  services.profiles = {
    ...services.profiles,
    getProfile: async () => ({
      userId: "user",
      handle: "alice",
      displayName: "Alice",
      createdAt: new Date("2026-10-02T00:00:00Z"),
    }),
  };
  const response = await createApp(services).request("/v1/profile", {}, env);
  assert.equal(response.status, 200);
  dto.envelopeSchema(dto.profileSchema).parse(await response.json());
  dto.envelopeSchema(dto.walletSignInSchema).parse({
    success: true,
    message: "Signed in",
    data: { userId: "u", session: { accessToken: "test-token", refreshToken: "test-refresh" } },
    statusCode: 200,
    timestamp: "2026-10-02",
  });
});

test("operation metadata supports explicit errors and never executes runtime validation", async () => {
  const app = createApp(documentationServices({}));
  app.post(
    "/v1/documented",
    operation("testDocumented", {
      body: z.object({ required: z.string() }),
      response: z.object({ accepted: z.boolean() }),
    }),
    (c) => c.json({ accepted: true }),
  );
  const response = await app.request("/v1/documented", { method: "POST", body: "not JSON" }, env);
  assert.equal(response.status, 200);
  assertDocumentCoverage(app, await apiDocument(app));
});

test("the real web catch-all forwards the public JSON to the mounted Worker without authentication", async () => {
  const { readFile } = await import("node:fs/promises");
  const { runInNewContext } = await import("node:vm");
  const { transpileModule, ModuleKind } = await import("typescript");
  const source = await readFile(
    new URL("../../../apps/web/src/app/api/v1/[...path]/route.ts", import.meta.url),
    "utf8",
  );
  const app = createApp(documentationServices({}));
  const forwarded: string[] = [];
  const exports: { GET?: (request: Request) => Promise<Response> } = {};
  runInNewContext(
    transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS } }).outputText,
    {
      exports,
      URL,
      Request,
      require: (name: string) => {
        assert.equal(name, "@/server/api-client");
        return {
          apiFetch: async (request: Request) => {
            forwarded.push(new URL(request.url).pathname);
            return app.fetch(request, env);
          },
        };
      },
    },
  );
  const response = await exports.GET!(new Request("https://example.invalid/api/v1/openapi.json"));
  assert.equal(response.status, 200);
  assert.deepEqual(forwarded, ["/v1/openapi.json"]);
  assert.equal((await response.json()).openapi, "3.1.0");
});

test("Perpl contract preserves unknown counts and reach, source freshness and venue limits", () => {
  const market: dto.PerpMarketDto = {
    symbol: "BTC",
    base: "BTC",
    accent: "lime",
    mark: 60000,
    change24h: 0.01,
    funding1h: 0.0001,
    openInterest: 1000,
    maxLeverage: 10,
    agentsReading: null,
    openCalls: null,
    lastCall: null,
    note: "Public venue data",
    hourlyReach: null,
    limits: {
      takerFee: 0.0005,
      maintenanceMargin: 0.05,
      slippageCap: 0.005,
      minimumAccountOpen: 10,
    },
    source: { venue: "perpl", network: "mainnet", observedAt: "2026-10-02T00:00:00Z", stale: true },
  };
  assert.deepEqual(dto.perpMarketDtoSchema.parse(market), market);
  assert.equal(
    dto.nonceRequestSchema.parse({ address: "0xabc", chain_id: 143, joining: "0xdef" }).joining,
    "0xdef",
  );
});
