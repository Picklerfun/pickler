import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AuthenticationRequiredError,
  AccessDeniedError,
  buildUserPrincipal,
  createAdviceService,
  DEFAULT_CONFIG,
  type AdviceAgent,
  type AdviceJob,
  type AdvicePolicy,
  type AdviceRepository,
} from "@pickler/core";
import { adviceRecommendationSchema, adviceHistorySchema } from "@pickler/api-schema";
import { createApp } from "../src/app.js";
import { documentationServices } from "../src/openapi/composition.js";
import { apiDocument } from "../src/openapi/document.js";
import { assertDocumentCoverage } from "../src/openapi/coverage.js";
const id = randomUUID(),
  jobId = randomUUID(),
  userId = randomUUID();
const policy: AdvicePolicy = {
  version: 1,
  jevModel: "jev-1.13.0",
  deepseekModel: "deepseek-chat",
  inputRates: { jev: "0.1", deepseek: "0.1" },
  outputRates: { jev: "0", deepseek: "0.2" },
  webSearchUsd: "0.01",
  requestLimitUsd: "0.1",
  dailyLimitUsd: "1",
  pricingVerifiedAt: "2026-10-02T00:00:00Z",
  pricingSources: ["https://example.test/pricing"],
};
const config = {
  ...DEFAULT_CONFIG,
  tools: ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"] as const,
  plugins: { version: 1 as const, enabled: ["perpl"] as const },
  perpl: { version: 1 as const, network: "testnet" as const, markets: ["BTC"] as const },
};
function fixture(enabled = true) {
  let notified = 0,
    created = 0;
  const agent: AdviceAgent = {
    publicId: id,
    tenantId: "private-tenant",
    agentId: "private-runtime",
    version: 1,
    config: structuredClone(config) as unknown as AdviceAgent["config"],
    published: true,
    enabled: true,
  };
  const job: AdviceJob = {
    id: jobId,
    publicAgentId: id,
    userId,
    tenantId: agent.tenantId,
    agentId: agent.agentId,
    symbol: "BTC",
    status: "queued",
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    configVersion: 1,
    config: agent.config,
    policy,
    result: null,
    error: null,
  };
  const repository: AdviceRepository = {
    requestReplay: async () => null,
    resolve: async () => agent,
    enqueue: async () => {
      created++;
      return job;
    },
    get: async () => job,
    history: async () => ({ items: job.status === "completed" ? [job] : [], nextCursor: null }),
  };
  const services = documentationServices({});
  const authenticate: typeof services.authenticate = async (credentials, options) => {
    if (credentials.apiKey && options?.userOnly) {
      throw new AccessDeniedError("User required");
    }
    if (!credentials.bearerToken || credentials.bearerToken === "invalid") {
      throw new AuthenticationRequiredError("Sign in");
    }
    return {
      principal: buildUserPrincipal({
        user: { id: credentials.bearerToken === "other" ? randomUUID() : userId },
      }),
      workspace: null,
    };
  };
  services.authenticate = authenticate;
  services.advice = {
    authenticate,
    service: createAdviceService(repository, { enabled, policy }),
    notify: async () => {
      notified++;
    },
  };
  return { app: createApp(services), agent, job, created: () => created, notified: () => notified };
}
const headers = {
  authorization: "Bearer user",
  "content-type": "application/json",
  "idempotency-key": "new-request",
};
test("all advice operations require a user session; API keys, HMAC and invalid JWTs cannot generate work", async () => {
  const f = fixture();
  for (const denied of [
    {},
    { authorization: "Bearer invalid" },
    { "x-agent-id": "a", "x-agent-auth": "secret", "x-request-timestamp": "0" },
    { "x-api-key": "key" },
  ]) {
    const response = await f.app.request(
      `/v1/agent-advice/agents/${id}/recommendations`,
      { method: "POST", headers: denied, body: JSON.stringify({ symbol: "BTC" }) },
      { APP_ENV: "test" },
    );
    assert.ok([401, 403].includes(response.status));
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(f.created(), 0);
});
test("strict requests, idempotency header and disabled admissions fail before enqueue", async () => {
  const f = fixture();
  for (const body of [
    { symbol: "SOL" },
    { symbol: "BTC", tenantId: "other" },
    { symbol: "BTC", leverage: 10 },
  ]) {
    assert.equal(
      (
        await f.app.request(
          `/v1/agent-advice/agents/${id}/recommendations`,
          { method: "POST", headers, body: JSON.stringify(body) },
          { APP_ENV: "test" },
        )
      ).status,
      400,
    );
  }
  const missingKey = await f.app.request(
    `/v1/agent-advice/agents/${id}/recommendations`,
    {
      method: "POST",
      headers: { authorization: "Bearer user", "content-type": "application/json" },
      body: JSON.stringify({ symbol: "BTC" }),
    },
    { APP_ENV: "test" },
  );
  assert.equal(missingKey.status, 400);
  const tooLarge = await f.app.request(
    `/v1/agent-advice/agents/${id}/recommendations`,
    { method: "POST", headers, body: JSON.stringify({ symbol: "BTC", padding: "x".repeat(8192) }) },
    { APP_ENV: "test" },
  );
  assert.equal(tooLarge.status, 413);
  assert.equal((await tooLarge.json()).success, false);
  const disabled = fixture(false);
  assert.equal(
    (
      await disabled.app.request(
        `/v1/agent-advice/agents/${id}/recommendations`,
        { method: "POST", headers, body: JSON.stringify({ symbol: "BTC" }) },
        { APP_ENV: "test" },
      )
    ).status,
    503,
  );
  assert.equal(disabled.created(), 0);
});
test("accepted request wakes only analysis and pending status is private", async () => {
  const f = fixture();
  const response = await f.app.request(
    `/v1/agent-advice/agents/${id}/recommendations`,
    { method: "POST", headers, body: JSON.stringify({ symbol: "BTC" }) },
    { APP_ENV: "test" },
  );
  assert.equal(response.status, 202);
  assert.equal(f.notified(), 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(
    (
      await f.app.request(
        `/v1/agent-advice/recommendations/${jobId}`,
        { headers: { authorization: "Bearer other" } },
        { APP_ENV: "test" },
      )
    ).status,
    404,
  );
  const read = await f.app.request(
    `/v1/agent-advice/recommendations/${jobId}`,
    { headers },
    { APP_ENV: "test" },
  );
  const payload = await read.json();
  adviceRecommendationSchema.parse(payload.data);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /private-tenant|private-runtime|userId|inputRates|leaseOwner/,
  );
});
test("completed history is free and shared, with concrete generated OpenAPI contracts", async () => {
  const f = fixture();
  f.job.status = "completed";
  f.job.result = {
    version: 1,
    symbol: "BTC",
    network: "testnet",
    horizonHours: 24,
    orientation: "wait",
    summary: "No supported direction.",
    reasons: ["Uncertain"],
    risks: ["Volatility"],
    limitations: [],
    sources: [
      {
        id: "ticker",
        name: "Perpl",
        url: "https://perpl.xyz/data",
        observedAt: new Date().toISOString(),
      },
    ],
    generatedAt: new Date().toISOString(),
    dataAsOf: new Date().toISOString(),
  };
  const response = await f.app.request(
    `/v1/agent-advice/agents/${id}/recommendations`,
    { headers: { authorization: "Bearer other" } },
    { APP_ENV: "test" },
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  adviceHistorySchema.parse(payload.data);
  assert.equal(payload.data.items.length, 1);
  assert.equal(f.created(), 0);
  const document = await apiDocument(f.app);
  assertDocumentCoverage(f.app, document);
  assert.deepEqual(
    document.paths["/v1/agent-advice/agents/{agentId}/recommendations"]!.post!.security,
    [{ bearerAuth: [] }],
  );
  const disabled = fixture(false);
  assert.ok((await apiDocument(disabled.app)).paths["/v1/agent-advice/recommendations/{id}"]);
});
