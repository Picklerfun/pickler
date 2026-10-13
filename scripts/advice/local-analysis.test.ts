// Runs without network: the model is a stubbed fetch and the Perpl evidence a fixture.
// node --import tsx --test scripts/advice/local-analysis.test.ts

import test from "node:test";
import assert from "node:assert/strict";
import * as dto from "@pickler/api-schema";
import {
  DEFAULT_CONFIG,
  type AdviceAgent,
  type AdviceJob,
  type PerpMarketInfo,
} from "@pickler/core";
import type { AdviceEvidence } from "@pickler/trading/perps";
import { createLocalAdviceModels, createLocalAnalysis, parseModelEnv } from "./local-analysis.ts";

const NOW = 1790899200000 + 120000;
const SETTINGS = {
  baseUrl: "https://model.test/v1",
  model: "test-model",
  apiKey: "sk-test-secret",
  responseFormat: "json_object" as const,
};

function fixture() {
  const provenance = {
    provider: "perpl" as const,
    pluginVersion: "1.1.0" as const,
    network: "testnet" as const,
    chainId: 10143,
    url: "https://testnet.perpl.xyz/api/v1/market-data",
    receivedAt: NOW,
    providerTimestamp: NOW - 1000,
    block: 100,
  };
  const market: PerpMarketInfo = {
    symbol: "BTC",
    marketId: 1,
    perpetualId: 1,
    instanceId: 1,
    exchangeAddress: "0xexchange",
    collateral: { tokenId: 1, address: "0xcollateral", symbol: "AUSD", decimals: 6 },
    configVersion: 1,
    priceDecimals: 2,
    sizeDecimals: 4,
    open: true,
    fundingIntervalSeconds: 3600,
    fundingIntervalBlocks: 100,
    initialMarginRaw: 100,
    maintenanceMarginRaw: 50,
    fees: { basis: "public-base-tier", maker: "0", taker: "0.0002" },
    provenance,
  };
  const hour = Math.floor(NOW / 3600000) * 3600000;
  const evidence: AdviceEvidence = {
    frame: {
      snapshot: {
        market,
        ticker: {
          mark: "60000",
          index: "60000",
          last: "60000",
          bid: "59999",
          ask: "60001",
          openInterestBase: "20",
          freshness: "fresh",
          provenance,
        },
        funding: null,
      },
      book: {
        market,
        requestedLevels: 20,
        depthLimited: true,
        bids: [{ price: "59999", size: "10", orders: 1 }],
        asks: [{ price: "60001", size: "10", orders: 1 }],
        freshness: "fresh",
        provenance,
      },
      hash: "a".repeat(64),
    },
    candles: {
      market,
      resolution: 3600,
      from: hour - 60 * 3600000,
      to: hour,
      missingOpenTimes: [],
      candles: Array.from({ length: 60 }, (_, i) => ({
        openTime: hour - (60 - i) * 3600000,
        open: "60000",
        high: "60010",
        low: "59990",
        close: "60001",
        volumeCollateral: "1000",
        trades: 1,
        closed: true,
      })),
      provenance,
    },
    sources: [
      {
        id: "perpl-ticker",
        name: "Perpl ticker",
        url: "https://testnet.perpl.xyz/api/v1/market-data/ticker",
        observedAt: new Date(NOW).toISOString(),
      },
      {
        id: "perpl-candles",
        name: "Perpl closed hourly candles",
        url: "https://testnet.perpl.xyz/api/v1/market-data/candles",
        observedAt: new Date(NOW).toISOString(),
      },
    ],
    web: [],
  };
  const config = {
    ...structuredClone(DEFAULT_CONFIG),
    tools: ["getPerpSnapshot", "getPerpOrderBook", "getPerpCandles"],
    plugins: { version: 1, enabled: ["perpl"] },
    perpl: { version: 1, network: "testnet", markets: ["BTC", "ETH"] },
  } as unknown as AdviceAgent["config"];
  const agent: AdviceAgent = {
    publicId: "d08d112f-c1d1-4130-98cb-8c981883cd02",
    tenantId: "tenant",
    agentId: "agent",
    version: 1,
    config,
    published: true,
    enabled: true,
  };
  const job: AdviceJob = {
    id: "d08d112f-c1d1-4130-98cb-8c981883cd01",
    publicAgentId: agent.publicId,
    userId: "d08d112f-c1d1-4130-98cb-8c981883cd03",
    tenantId: agent.tenantId,
    agentId: agent.agentId,
    symbol: "BTC",
    status: "queued",
    createdAt: NOW - 5000,
    startedAt: null,
    finishedAt: null,
    configVersion: 1,
    config,
    policy: {
      version: 1,
      jevModel: "jev-1.13.0",
      deepseekModel: "test-model",
      inputRates: { jev: "0", deepseek: "0" },
      outputRates: { jev: "0", deepseek: "0" },
      webSearchUsd: "0",
      requestLimitUsd: "0",
      dailyLimitUsd: "0",
      pricingVerifiedAt: new Date(NOW).toISOString(),
      pricingSources: ["https://example.test/pricing"],
    },
    result: null,
    error: null,
  };
  return { agent, job, evidence };
}

function completion(content: string): Response {
  return new Response(
    JSON.stringify({
      model: "test-model",
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const VALID_ANSWER = {
  orientation: "short",
  summary: "Momentum faded over the last hours and the book leans to the offer.",
  reasons: ["Closes drifted lower across the last six hourly candles."],
  risks: ["A squeeze through the offer would invalidate the view."],
  limitations: ["Testnet liquidity is thin."],
  sourceIds: ["perpl-ticker"],
};

async function run(transport: typeof fetch, data?: () => Promise<AdviceEvidence>) {
  const { agent, job, evidence } = fixture();
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const recording: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return transport(input, init);
  };

  const analyze = createLocalAnalysis({
    resolve: async () => agent,
    data: data ?? (async () => evidence),
    models: createLocalAdviceModels(SETTINGS, recording),
    now: () => NOW,
    log: () => {},
  });
  await analyze(job);

  return { job, requests };
}

test("a valid model answer completes the job with a result the API schema accepts", async () => {
  const { job, requests } = await run(async () => completion(JSON.stringify(VALID_ANSWER)));

  assert.equal(job.status, "completed");
  assert.equal(job.error, null);
  const result = dto.adviceResultSchema.parse(job.result);
  assert.equal(result.orientation, "short");
  assert.equal(result.network, "testnet");
  assert.equal(result.symbol, "BTC");
  assert.equal(result.summary, VALID_ANSWER.summary);
  assert.deepEqual(
    result.sources.map((source) => source.id),
    ["perpl-ticker"],
  );
  assert.equal(result.dataAsOf, new Date(NOW - 1000).toISOString());
  assert.equal(JSON.stringify(result).includes("LOCAL TEST"), false);
  assert.equal(job.startedAt, NOW);
  assert.equal(job.finishedAt, NOW);

  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://model.test/v1/chat/completions");
  const headers = new Headers(requests[0]!.init?.headers);
  assert.equal(headers.get("authorization"), "Bearer sk-test-secret");
  const body = JSON.parse(String(requests[0]!.init?.body)) as {
    model: string;
    messages: { role: string; content: string }[];
  };
  assert.equal(body.model, "test-model");
  assert.match(body.messages[1]!.content, /"symbol":"BTC"/);
});

test("a fenced JSON answer is accepted", async () => {
  const fenced = "```json\n" + JSON.stringify(VALID_ANSWER) + "\n```";
  const { job } = await run(async () => completion(fenced));

  assert.equal(job.status, "completed");
});

test("an answer outside the contract fails the job without a result", async () => {
  const invalid = { ...VALID_ANSWER, orientation: "buy", positionSize: 2 };
  const { job } = await run(async () => completion(JSON.stringify(invalid)));

  assert.equal(job.status, "failed");
  assert.equal(job.error, "ANALYSIS_FAILED");
  assert.equal(job.result, null);
});

test("an answer citing a source that was not read fails the job", async () => {
  const invented = { ...VALID_ANSWER, sourceIds: ["coindesk"] };
  const { job } = await run(async () => completion(JSON.stringify(invented)));

  assert.equal(job.status, "failed");
  assert.equal(job.result, null);
});

test("prose instead of JSON fails the job", async () => {
  const { job } = await run(async () => completion("I think BTC goes up."));

  assert.equal(job.status, "failed");
  assert.equal(job.result, null);
});

test("a model HTTP error fails the job", async () => {
  const { job } = await run(async () => new Response("rate limited", { status: 429 }));

  assert.equal(job.status, "failed");
  assert.equal(job.error, "ANALYSIS_FAILED");
  assert.equal(job.result, null);
});

test("a network error reaching the model fails the job", async () => {
  const { job } = await run(async () => {
    throw new TypeError("fetch failed");
  });

  assert.equal(job.status, "failed");
  assert.equal(job.result, null);
});

test("a market data failure fails the job before calling the model", async () => {
  const { job, requests } = await run(
    async () => completion(JSON.stringify(VALID_ANSWER)),
    async () => {
      throw new Error("Perpl unavailable");
    },
  );

  assert.equal(job.status, "failed");
  assert.equal(job.result, null);
  assert.equal(requests.length, 0);
});

test("model.env values are required and never echoed", () => {
  const settings = parseModelEnv(
    {
      MODEL_BASE_URL: "https://api.example.com/v1/",
      MODEL_ID: "some-model",
      MODEL_API_KEY: "sk-very-secret",
    },
    "/x/model.env",
  );
  assert.deepEqual(settings, {
    baseUrl: "https://api.example.com/v1",
    model: "some-model",
    apiKey: "sk-very-secret",
    responseFormat: "json_object",
  });

  assert.throws(
    () => parseModelEnv({ MODEL_BASE_URL: "https://api.example.com/v1", MODEL_ID: "m" }, "f"),
    /MODEL_API_KEY/,
  );
  assert.throws(
    () =>
      parseModelEnv(
        { MODEL_BASE_URL: "https://u:sk-very-secret@h/v1", MODEL_ID: "m", MODEL_API_KEY: "k" },
        "f",
      ),
    (error: Error) =>
      /MODEL_BASE_URL/.test(error.message) && !error.message.includes("sk-very-secret"),
  );
  assert.throws(
    () =>
      parseModelEnv(
        { MODEL_BASE_URL: "http://api.example.com/v1", MODEL_ID: "m", MODEL_API_KEY: "k" },
        "f",
      ),
    /MODEL_BASE_URL/,
  );
});

test("MODEL_RESPONSE_FORMAT is json_object by default, or none; anything else is refused", () => {
  const base = { MODEL_BASE_URL: "https://api.example.com/v1", MODEL_ID: "m", MODEL_API_KEY: "k" };

  const explicit = parseModelEnv({ ...base, MODEL_RESPONSE_FORMAT: "json_object" }, "f");
  const none = parseModelEnv({ ...base, MODEL_RESPONSE_FORMAT: "none" }, "f");

  assert.equal(explicit.responseFormat, "json_object");
  assert.equal(none.responseFormat, "none");
  assert.throws(
    () => parseModelEnv({ ...base, MODEL_RESPONSE_FORMAT: "json_schema-secret" }, "f"),
    (error: Error) =>
      /MODEL_RESPONSE_FORMAT/.test(error.message) && !error.message.includes("json_schema-secret"),
  );
});

async function requestBody(responseFormat: "json_object" | "none") {
  const { agent, job, evidence } = fixture();
  let body: Record<string, unknown> = {};
  const transport: typeof fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return completion(JSON.stringify(VALID_ANSWER));
  };

  const analyze = createLocalAnalysis({
    resolve: async () => agent,
    data: async () => evidence,
    models: createLocalAdviceModels({ ...SETTINGS, responseFormat }, transport),
    now: () => NOW,
    log: () => {},
  });
  await analyze(job);

  return { body, job };
}

test("the request asks for a JSON object by default and omits response_format with none", async () => {
  const byDefault = await requestBody("json_object");
  const omitted = await requestBody("none");

  assert.deepEqual(byDefault.body.response_format, { type: "json_object" });
  assert.equal("response_format" in omitted.body, false);
  assert.equal(omitted.job.status, "completed");
});
