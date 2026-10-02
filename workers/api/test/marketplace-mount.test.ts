import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthenticationRequiredError,
  createGetAgentPersona,
  createGetAgentProfile,
  createGetHealth,
  createGetLanding,
  createGetLeaderboard,
  createGetMarket,
  createGetPickDetail,
  createGetPlatformAnalytics,
  createGetRead,
  createListAgents,
  createListDirectory,
  createListMarkets,
  createListReads,
  MarketDataUnavailableError,
  type AgentDirectory,
  type MarketBoard,
} from "@pickler/core";
import {
  createSampleLandingReadModel,
  createSampleMarketBoard,
  systemClock,
} from "@pickler/infrastructure";
import { createApp } from "../src/app.js";
import { marketBoardFor, type createGrowthServices } from "../src/growth/services.js";

const env = { APP_ENV: "staging", ALLOWED_ORIGINS: "https://web.example" } as never;

/** A directory with nothing in it: what the database answers on launch day. */
const emptyDirectory: AgentDirectory = {
  listAgents: async () => [],
  getProfile: async () => null,
  getPick: async () => null,
  getPersona: async () => null,
  listDirectory: async () => [],
  listReads: async () => [],
  getRead: async () => null,
  getAnalytics: async (range) => ({
    range,
    settledVolumeAllTime: 0,
    groups: [],
    predictionsShare: 0,
    splitNote: "Nothing has settled yet.",
    series: [],
    log: [],
    table: [],
  }),
  getLeaderboard: async () => ({ entries: [], weights: [], calibration: [] }),
};

function app(markets: MarketBoard = createSampleMarketBoard()) {
  const growth = {
    clock: systemClock,
    getHealth: createGetHealth(systemClock),
    getLanding: createGetLanding(createSampleLandingReadModel(systemClock)),
    listAgents: createListAgents(emptyDirectory),
    getAgentProfile: createGetAgentProfile(emptyDirectory),
    getPickDetail: createGetPickDetail(emptyDirectory),
    getAgentPersona: createGetAgentPersona(emptyDirectory),
    getPlatformAnalytics: createGetPlatformAnalytics(emptyDirectory),
    getLeaderboard: createGetLeaderboard(emptyDirectory),
    listDirectory: createListDirectory(emptyDirectory),
    listReads: createListReads(emptyDirectory),
    getRead: createGetRead(emptyDirectory),
    listMarkets: createListMarkets(markets),
    getMarket: createGetMarket(markets),
  } as ReturnType<typeof createGrowthServices>;

  return createApp({
    // The public marketplace carries no credentials, so this is what every request looks like.
    authenticate: (async () => {
      throw new AuthenticationRequiredError();
    }) as never,
    authenticateAgent: (async () => {
      throw new Error("unused");
    }) as never,
    findWorkspace: async () => null,
    agentQueries: {} as never,
    budgets: {} as never,
    profiles: {} as never,
    growth,
  });
}

const PUBLIC_READS = [
  "/v1/landing",
  "/v1/health",
  "/v1/marketplace/agents",
  "/v1/marketplace/directory",
  "/v1/marketplace/reads",
  "/v1/marketplace/markets",
  "/v1/marketplace/analytics",
  "/v1/marketplace/leaderboard",
];

// This is the test that guards the mount: with the routes on /v1 instead of /v1/marketplace, these
// paths do not exist and answer 404 — and the public list would sit behind /v1/agents' credentials.
test("every marketplace read answers without credentials", async () => {
  const api = app();

  for (const path of PUBLIC_READS) {
    const response = await api.request(path, {}, env);
    assert.equal(response.status, 200, `${path} answered ${response.status}`);
  }
});

test("an empty database is an empty list, not an error", async () => {
  const response = await app().request("/v1/marketplace/agents", {}, env);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), []);
  // The sample marker is gone with the sample: nothing here says the data is invented.
  assert.equal(response.headers.get("x-pickler-data-source"), null);
});

test("legacy demo reads remain an alias of the public marketplace", async () => {
  const response = await app().request("/v1/demo/agents", {}, env);

  assert.equal(response.status, 200);
  const current = await app().request("/v1/marketplace/agents", {}, env);
  assert.deepEqual(await response.json(), await current.json());
});

test("the workspace agent list stays authenticated", async () => {
  const response = await app().request("/v1/agents", {}, env);

  assert.equal(response.status, 401);
});

test("a venue that cannot be read answers 503 with a code, and the list is never empty instead", async () => {
  const unreadable: MarketBoard = {
    listMarkets: async () => {
      throw new MarketDataUnavailableError("perpl testnet");
    },
    getMarket: async () => {
      throw new MarketDataUnavailableError("perpl testnet");
    },
  };
  const api = app(unreadable);

  for (const path of ["/v1/marketplace/markets", "/v1/marketplace/markets/BTC-PERP"]) {
    const response = await api.request(path, {}, env);
    const body = (await response.json()) as { error?: string };

    assert.equal(response.status, 503, path);
    assert.equal(body.error, "MARKET_DATA_UNAVAILABLE", path);
  }
});

test("without a network the board is the sample, and every market says so", async () => {
  const sample = await marketBoardFor(undefined).listMarkets();
  const unknown = await marketBoardFor("devnet").listMarkets();

  assert.equal(sample.length, 6);
  assert.ok(sample.every((market) => market.source.venue === "sample"));
  assert.ok(unknown.every((market) => market.source.venue === "sample"));
});
