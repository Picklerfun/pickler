import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  AuthenticationRequiredError,
  AccessDeniedError,
  buildUserPrincipal,
  createAdviceService,
  createPaidAdvice,
  DEFAULT_CONFIG,
  PilotError,
  type AdviceAgent,
  type AdviceJob,
  type AdvicePaymentGateway,
  type AdvicePaymentRecord,
  type AdvicePaymentStore,
  type AdvicePolicy,
  type AdviceRepository,
  type SaleTerms,
} from "@pickler/core";
import {
  adviceRecommendationSchema,
  adviceHistorySchema,
  paymentRequiredSchema,
} from "@pickler/api-schema";
import { createApp } from "../src/app.js";
import { paidAdviceFrom } from "../src/container.js";
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
const PAY_TO = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const TX = `0x${"ef".repeat(32)}`;
const NOW_MS = Date.now();
const NOW_S = Math.floor(NOW_MS / 1000);
/** The fake chain and payment rows behind `paid`; tests flip these to reach each branch. */
interface PaidState {
  terms: SaleTerms | null;
  replay: AdviceJob | null;
  record: AdvicePaymentRecord | null;
  inFlight: boolean;
  settled: number;
}
function paidState(): PaidState {
  return {
    terms: { priceMicro: 1_500_000n, payTo: PAY_TO, handle: "trader" },
    replay: null,
    record: null,
    inFlight: false,
    settled: 0,
  };
}
type PaidFactory = (
  advice: ReturnType<typeof createAdviceService>,
  repository: AdviceRepository,
) => ReturnType<typeof createPaidAdvice> | undefined;
function fixture(enabled = true, paid?: PaidState, compose?: PaidFactory) {
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
    requestReplay: async () => paid?.replay ?? null,
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
  const advice = createAdviceService(repository, { enabled, policy });
  const composed = compose?.(advice, repository);
  services.advice = {
    authenticate,
    service: advice,
    ...(paid ? { paid: paidAdvice(paid, advice, repository) } : {}),
    ...(composed ? { paid: composed } : {}),
    notify: async () => {
      notified++;
    },
  };
  return { app: createApp(services), agent, job, created: () => created, notified: () => notified };
}
function paidAdvice(
  state: PaidState,
  advice: ReturnType<typeof createAdviceService>,
  repository: AdviceRepository,
) {
  const store: AdvicePaymentStore = {
    saleTerms: async () => state.terms,
    payerLinked: async () => true,
    byKey: async () => state.record,
    insertPending: async (input) => {
      if (state.inFlight) {
        throw new PilotError("CONFLICT", "Another payment attempt for this key is in flight");
      }
      state.record = {
        id: "payment-1",
        jobId: null,
        status: "pending",
        txHash: null,
        payer: input.authorization.from,
        nonce: input.authorization.nonce,
        validBefore: input.authorization.validBefore,
      };
      return state.record;
    },
    settled: async (paymentId, txHash) => {
      state.settled++;
      state.record = { ...state.record!, id: paymentId, status: "settled", txHash };
    },
    failed: async () => {},
    attachJob: async () => {},
    refundOwed: async () => {},
  };
  const gateway: AdvicePaymentGateway = {
    signatureValid: async () => true,
    nonceUsed: async () => false,
    balance: async () => 10_000_000n,
    settle: async () => ({ txHash: TX, blockNumber: 42n }),
  };
  return createPaidAdvice({
    advice,
    repository,
    store,
    gateway,
    now: () => NOW_MS,
    resourceBase: "https://pickler.fun/api",
  });
}
function payment(value = "1500000") {
  const envelope = {
    x402Version: 1,
    scheme: "exact",
    network: "monad-testnet",
    payload: {
      signature: `0x${"cd".repeat(65)}`,
      authorization: {
        from: PAYER,
        to: PAY_TO,
        value,
        validAfter: String(NOW_S - 10),
        validBefore: String(NOW_S + 240),
        nonce: `0x${"ab".repeat(32)}`,
      },
    },
  };
  return Buffer.from(JSON.stringify(envelope)).toString("base64");
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

const recommendations = `/v1/agent-advice/agents/${id}/recommendations`;
function ask(f: ReturnType<typeof fixture>, extra: Record<string, string> = {}) {
  return f.app.request(
    recommendations,
    { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ symbol: "BTC" }) },
    { APP_ENV: "test" },
  );
}
const requirements = {
  scheme: "exact",
  network: "monad-testnet",
  maxAmountRequired: "1500000",
  resource: `https://pickler.fun/api/v1/agent-advice/agents/${id}/recommendations`,
  description: "Fresh 24-hour BTC analysis by @trader",
  mimeType: "application/json",
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  asset: "0xa9012a055bd4e0eDfF8Ce09f960291C09D5322dC",
  extra: { name: "Agora Dollar", version: "1", chainId: 10143 },
};

test("x402 on: a request without X-PAYMENT answers 402 with the terms and enqueues nothing", async () => {
  const f = fixture(true, paidState());

  const response = await ask(f);

  assert.equal(response.status, 402);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await response.json(), {
    x402Version: 1,
    error: "X-PAYMENT header is required",
    accepts: [requirements],
  });
  assert.equal(f.created(), 0);
  assert.equal(f.notified(), 0);
});

test("x402 on: a valid payment settles, enqueues and answers 202 with X-PAYMENT-RESPONSE", async () => {
  const state = paidState();
  const f = fixture(true, state);

  const response = await ask(f, { "x-payment": payment() });

  assert.equal(response.status, 202);
  const payload = await response.json();
  assert.deepEqual(payload.data, {
    id: jobId,
    status: "queued",
    statusUrl: `/v1/agent-advice/recommendations/${jobId}`,
  });
  const settlement = response.headers.get("x-payment-response");
  assert.ok(settlement, "the settlement header is present");
  assert.deepEqual(JSON.parse(Buffer.from(settlement, "base64").toString("utf8")), {
    success: true,
    transaction: TX,
    network: "monad-testnet",
    payer: PAYER,
  });
  assert.equal(state.settled, 1);
  assert.equal(f.created(), 1);
  assert.equal(f.notified(), 1);
});

test("x402 on: a refused payment answers 402 with its reason and the terms, charging nothing", async () => {
  const state = paidState();
  const f = fixture(true, state);

  const response = await ask(f, { "x-payment": payment("1") });

  assert.equal(response.status, 402);
  const body = await response.json();
  paymentRequiredSchema.parse(body);
  assert.equal(body.error, "wrong_amount");
  assert.deepEqual(body.accepts, [requirements]);
  assert.equal(state.settled, 0);
  assert.equal(f.created(), 0);
});

test("x402 on: disabled advice answers 503 before any 402, and a replay stays free", async () => {
  const state = paidState();
  const f = fixture(false, state);

  const refused = await ask(f);

  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error, "ADVICE_UNAVAILABLE");

  state.replay = f.job;
  const replay = await ask(f, { "x-payment": payment() });

  assert.equal(replay.status, 202);
  assert.equal(replay.headers.get("x-payment-response"), null);
  assert.equal(state.settled, 0);
  assert.equal(f.created(), 0);
});

test("x402 off: the request stays free, with no payment header and no 402", async () => {
  const f = fixture();

  const response = await ask(f);

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-payment-response"), null);
  assert.equal(f.created(), 1);
});

test("x402 on but misconfigured: the request answers 503 and never runs a free analysis", async () => {
  const misconfigured: PaidFactory = (advice, repository) =>
    paidAdviceFrom(
      { ADVICE_X402_ENABLED: "true", X402_RELAYER_PRIVATE_KEY: `0x${"7a".repeat(32)}` },
      { advice, repository, pool: {} as Parameters<typeof paidAdviceFrom>[1]["pool"] },
      () => {},
    );
  const f = fixture(true, undefined, misconfigured);

  const response = await ask(f, { "x-payment": payment() });

  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "ADVICE_UNAVAILABLE");
  assert.equal(response.headers.get("x-payment-response"), null);
  assert.equal(f.created(), 0);
  assert.equal(f.notified(), 0);
});

test("x402 flag off through the container: the request stays free and answers 202", async () => {
  const off: PaidFactory = (advice, repository) =>
    paidAdviceFrom(
      { ADVICE_X402_ENABLED: "false" },
      { advice, repository, pool: {} as Parameters<typeof paidAdviceFrom>[1]["pool"] },
      () => {},
    );
  const f = fixture(true, undefined, off);

  const response = await ask(f);

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-payment-response"), null);
  assert.equal(f.created(), 1);
});

test("x402 on: an agent without a price answers 404 ADVICE_NOT_FOR_SALE", async () => {
  const state = paidState();
  state.terms = null;
  const f = fixture(true, state);

  const response = await ask(f);

  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, "ADVICE_NOT_FOR_SALE");
  assert.equal(f.created(), 0);
});

test("x402 on: another attempt in flight for the same key answers 409 and settles nothing", async () => {
  const state = paidState();
  state.inFlight = true;
  const f = fixture(true, state);

  const response = await ask(f, { "x-payment": payment() });

  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, "CONFLICT");
  assert.equal(state.settled, 0);
  assert.equal(f.created(), 0);
});

test("OpenAPI documents the 402, X-PAYMENT and X-PAYMENT-RESPONSE on adviceRequest", async () => {
  const f = fixture(true, paidState());

  const document = await apiDocument(f.app);
  assertDocumentCoverage(f.app, document);
  const post = document.paths["/v1/agent-advice/agents/{agentId}/recommendations"]!.post!;

  assert.equal(post.operationId, "adviceRequest");
  const required = post.responses["402"];
  assert.ok(required && "content" in required && required.content?.["application/json"]?.schema);
  const accepted = post.responses["202"];
  assert.ok(accepted && "headers" in accepted && accepted.headers?.["X-PAYMENT-RESPONSE"]);
  const names = (post.parameters ?? []).map((parameter) =>
    "name" in parameter ? parameter.name : null,
  );
  assert.ok(names.includes("X-PAYMENT"));
  assert.ok(names.includes("Idempotency-Key"));
});
