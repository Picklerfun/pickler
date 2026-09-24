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
  type AgentDirectory,
} from "@pickler/core";
import {
  createSampleLandingReadModel,
  createSampleMarketBoard,
  systemClock,
} from "@pickler/infrastructure";
import { createApp } from "../src/app.js";
import type { createGrowthServices } from "../src/growth/services.js";

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

function app() {
  const markets = createSampleMarketBoard();
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

// This is the test that guards the mount: with the routes on /v1 instead of /v1/marketplace, the
// public agents list lands behind the workspace API's credentials and answers 401 here.
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

test("/v1/demo is retired", async () => {
  const response = await app().request("/v1/demo/agents", {}, env);

  assert.equal(response.status, 404);
});

test("the workspace agent list stays authenticated", async () => {
  const response = await app().request("/v1/agents", {}, env);

  assert.equal(response.status, 401);
});
