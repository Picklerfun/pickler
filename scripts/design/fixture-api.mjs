/**
 * A loopback stand-in for the Pickler API, so the design checks have pages to look at.
 *
 * Every marketplace and auth route renders on the server and asks the API for its data, so without
 * one they answer 500 and a surface check reads a stack trace instead of a page. This serves the
 * same endpoints the real worker serves, and it invents nothing: the sample adapters, the use cases
 * and the DTO mappers are the product's own, imported from where the worker imports them. If a
 * response shape changes, this changes with it or fails to start.
 *
 * It is a verification fixture, not product code. Nothing ships against it, and the only thing that
 * points at it is PICKLER_API_LOCAL_URL, which api-client.ts already refuses unless it is loopback.
 *
 *   node --import tsx scripts/design/fixture-api.mjs [port]
 *
 * Then start the web app against it. Note the command: `npm run dev` goes through Turborepo, whose
 * dev task declares no `env`, so it strips PICKLER_API_LOCAL_URL and every route answers 503 as if
 * this file were not running. Run Next directly instead.
 *
 *   cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:8787 npx next dev
 */
import { createServer } from "node:http";
import {
  createGetAgentPersona,
  createGetAgentProfile,
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
} from "@pickler/core";
import {
  createSampleAgentDirectory,
  createSampleLandingReadModel,
  createSampleMarketBoard,
  systemClock,
} from "@pickler/infrastructure";
import { toLandingResponse } from "../../workers/api/src/growth/landing-response.ts";
import {
  toAgentPersonaDto,
  toAgentProfileDto,
  toAgentReadDto,
  toAgentSummaryDto,
  toDirectoryAgentDto,
  toLeaderboardDto,
  toPickDetailDto,
  toPlatformAnalyticsDto,
} from "../../workers/api/src/growth/agent-responses.ts";
import {
  toMarketDetailDto,
  toPerpMarketDto,
} from "../../workers/api/src/growth/market-responses.ts";

const agents = createSampleAgentDirectory(systemClock);
const markets = createSampleMarketBoard();
const landing = createSampleLandingReadModel(systemClock);

const services = {
  getLanding: createGetLanding(landing),
  listAgents: createListAgents(agents),
  listDirectory: createListDirectory(agents),
  listReads: createListReads(agents),
  getRead: createGetRead(agents),
  getAgentProfile: createGetAgentProfile(agents),
  getPickDetail: createGetPickDetail(agents),
  getAgentPersona: createGetAgentPersona(agents),
  getPlatformAnalytics: createGetPlatformAnalytics(agents),
  getLeaderboard: createGetLeaderboard(agents),
  listMarkets: createListMarkets(markets),
  getMarket: createGetMarket(markets),
};

const one = (value, map) => (value ? map(value) : null);

/** Path patterns in the order the worker mounts them, each answering the DTO the worker answers. */
const routes = [
  [/^\/v1\/landing$/, async () => toLandingResponse(await services.getLanding())],
  [/^\/v1\/demo\/agents$/, async () => (await services.listAgents()).map(toAgentSummaryDto)],
  [
    /^\/v1\/demo\/directory$/,
    async () => (await services.listDirectory()).map(toDirectoryAgentDto),
  ],
  [/^\/v1\/demo\/reads$/, async () => (await services.listReads()).map(toAgentReadDto)],
  [/^\/v1\/demo\/reads\/([^/]+)$/, async (id) => one(await services.getRead(id), toAgentReadDto)],
  [
    /^\/v1\/demo\/profiles\/([^/]+)$/,
    async (ticker) => one(await services.getAgentProfile(ticker), toAgentProfileDto),
  ],
  [
    /^\/v1\/demo\/profiles\/([^/]+)\/picks\/([^/]+)$/,
    async (ticker, id) => one(await services.getPickDetail(ticker, id), toPickDetailDto),
  ],
  [
    /^\/v1\/demo\/personas\/([^/]+)$/,
    async (handle) => one(await services.getAgentPersona(handle), toAgentPersonaDto),
  ],
  [/^\/v1\/demo\/markets$/, async () => (await services.listMarkets()).map(toPerpMarketDto)],
  [
    /^\/v1\/demo\/markets\/([^/]+)$/,
    async (symbol) => one(await services.getMarket(symbol), toMarketDetailDto),
  ],
  [/^\/v1\/demo\/leaderboard$/, async () => toLeaderboardDto(await services.getLeaderboard())],
];

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  const send = (status, body) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "x-pickler-data-source": "sample",
    });
    response.end(JSON.stringify(body));
  };
  // Analytics takes a range off the query string rather than the path, so it sits outside the table.
  if (url.pathname === "/v1/demo/analytics") {
    const value = await services.getPlatformAnalytics(url.searchParams.get("range") ?? "30d");
    return send(200, toPlatformAnalyticsDto(value));
  }
  for (const [pattern, handler] of routes) {
    const match = pattern.exec(url.pathname);
    if (match) {
      try {
        return send(200, await handler(...match.slice(1).map(decodeURIComponent)));
      } catch (error) {
        // Loudly, and in the shape the client reads, because a fixture that answers 200 with
        // nothing looks exactly like a page that has no data.
        console.error(`fixture-api: ${url.pathname} threw`, error);
        return send(500, { error: String(error) });
      }
    }
  }
  // Anything unmapped says so. A silent 404 here reads downstream as an empty page.
  console.warn(`fixture-api: no route for ${request.method} ${url.pathname}`);
  send(404, { error: `fixture-api has no route for ${url.pathname}` });
});

const port = Number(process.argv[2] ?? 8787);
server.listen(port, "127.0.0.1", () => {
  console.log(`fixture-api listening on http://127.0.0.1:${port}`);
  // Not `npm run dev`: Turborepo's dev task declares no env and drops the variable, and the only
  // symptom is every route answering 503 exactly as it does with no fixture at all.
  console.log(
    `point the web app at it:  cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:${port} npx next dev`,
  );
});
