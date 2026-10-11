/**
 * A loopback stand-in for the Pickler API, so the design checks have pages to look at.
 *
 * Every marketplace and auth route renders on the server and asks the API for its data, so without
 * one they answer 500 and a surface check reads a stack trace instead of a page. This serves the
 * same endpoints the real worker serves. The invented agents are the harness's own, in ./fixtures:
 * the product reads its agents from the database, and a marketplace with nothing in it is what a
 * person sees at launch, not what a design check should be measuring. The market board, the use cases and the DTO mappers are still the product's own, imported from where the
 * worker imports them, so if a response shape changes this changes with it or fails to start.
 *
 * It is a verification fixture, not product code. Nothing ships against it, and the only thing that
 * points at it is PICKLER_API_LOCAL_URL, which api-client.ts already refuses unless it is loopback.
 *
 * `npm run design:check` starts this and the web app together (lib/servers.mjs). By hand:
 *
 *   node --import tsx scripts/design/fixture-api.mjs 8799
 *
 * Then start the web app against it. Note the command: `npm run dev` goes through Turborepo, whose
 * dev task declares no `env`, so it strips PICKLER_API_LOCAL_URL and every route answers 503 as if
 * this file were not running. Run Next directly instead, with authentication switched off so the
 * studio and the account render from their fixtures:
 *
 *   cd apps/web && NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
 *     PICKLER_API_LOCAL_URL=http://127.0.0.1:8799 npx next dev -p 3001
 */
import { createServer } from "node:http";
import {
  createGetAgentPersona,
  createGetAgentProfile,
  createGetLeaderboard,
  createGetMarket,
  createGetPickDetail,
  createGetPlatformAnalytics,
  createGetRead,
  createListAgentActions,
  createListAgents,
  createListDirectory,
  createListMarkets,
  createListReads,
  createCheckTicker,
  createGetApplicant,
  createGetHealth,
  createJoinWaitlist,
  createSubmitApplication,
} from "@pickler/core";
import { createInMemoryApplicantStore, systemClock } from "@pickler/infrastructure";
import { growthRoutes } from "../../workers/api/src/routes/growth.ts";
import { createSampleMarketBoard } from "./fixtures/sample-market-board.mts";
import { createSampleAgentDirectory } from "./fixtures/sample-agent-directory.mts";
import { createSampleActionFeed } from "./fixtures/sample-actions.mts";
import { sampleLaunches } from "./fixtures/sample-launches.mts";
import {
  toAgentActionDto,
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

const services = {
  listAgents: createListAgents(agents),
  listAgentActions: createListAgentActions(createSampleActionFeed(systemClock)),
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
const applicants = createInMemoryApplicantStore();
const growth = growthRoutes({
  ...services,
  clock: systemClock,
  getHealth: createGetHealth(systemClock),
  joinWaitlist: createJoinWaitlist(applicants.waitlist, applicants.applicants),
  getApplicant: createGetApplicant(applicants.applicants),
  submitApplication: createSubmitApplication(applicants.applicants),
  checkTicker: createCheckTicker(applicants.applicants),
});

/** Path patterns in the order the worker mounts them, each answering the DTO the worker answers. */
const routes = [
  // The worker reads launches from its index; the harness has none, so the board gets two rows.
  [/^\/v1\/launches$/, async () => sampleLaunches()],
  [/^\/v1\/marketplace\/agents$/, async () => (await services.listAgents()).map(toAgentSummaryDto)],
  [
    /^\/v1\/marketplace\/activity$/,
    async () => (await services.listAgentActions()).map(toAgentActionDto),
  ],
  [
    /^\/v1\/marketplace\/directory$/,
    async () => (await services.listDirectory()).map(toDirectoryAgentDto),
  ],
  [/^\/v1\/marketplace\/reads$/, async () => (await services.listReads()).map(toAgentReadDto)],
  [
    /^\/v1\/marketplace\/reads\/([^/]+)$/,
    async (id) => one(await services.getRead(id), toAgentReadDto),
  ],
  [
    /^\/v1\/marketplace\/profiles\/([^/]+)$/,
    async (ticker) => one(await services.getAgentProfile(ticker), toAgentProfileDto),
  ],
  [
    /^\/v1\/marketplace\/profiles\/([^/]+)\/picks\/([^/]+)$/,
    async (ticker, id) => one(await services.getPickDetail(ticker, id), toPickDetailDto),
  ],
  [
    /^\/v1\/marketplace\/personas\/([^/]+)$/,
    async (handle) => {
      if (handle === "public_trade") {
        const persona = toAgentPersonaDto(await services.getAgentPersona("halftime"));
        return {
          ...persona,
          handle,
          launchedToken: {
            name: "Halftime",
            ticker: "HALF",
            address: "0x1111111111111111111111111111111111111111",
            chainId: 10143,
            imageUri: null,
            avatar: { accent: "lime", pattern: 0 },
          },
        };
      }
      return one(await services.getAgentPersona(handle), toAgentPersonaDto);
    },
  ],
  [/^\/v1\/marketplace\/markets$/, async () => (await services.listMarkets()).map(toPerpMarketDto)],
  [
    /^\/v1\/marketplace\/markets\/([^/]+)$/,
    async (symbol) => one(await services.getMarket(symbol), toMarketDetailDto),
  ],
  [
    /^\/v1\/marketplace\/leaderboard$/,
    async () => toLeaderboardDto(await services.getLeaderboard()),
  ],
];

const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (["/v1/waitlist", "/v1/applications", "/v1/tickers/availability"].includes(url.pathname)) {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
    }
    const endpoint = new URL(url);
    endpoint.pathname = endpoint.pathname.replace(/^\/v1/, "");
    const result = await growth.request(
      endpoint.toString(),
      {
        method: request.method,
        headers: request.headers,
        ...(body ? { body } : {}),
      },
      {
        APP_ENV: "local",
        ALLOWED_ORIGINS: "http://localhost:3001,http://localhost:3012",
      },
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
    return;
  }
  const send = (status, body) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "x-pickler-data-source": "sample",
    });
    response.end(JSON.stringify(body));
  };
  // Analytics takes a range off the query string rather than the path, so it sits outside the table.
  if (url.pathname === "/v1/marketplace/analytics") {
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

const port = Number(process.argv[2] ?? 8799);
server.listen(port, "127.0.0.1", () => {
  console.log(`fixture-api listening on http://127.0.0.1:${port}`);
  // Not `npm run dev`: Turborepo's dev task declares no env and drops the variable, and the only
  // symptom is every route answering 503 exactly as it does with no fixture at all.
  console.log(
    `point the web app at it:  cd apps/web && PICKLER_API_LOCAL_URL=http://127.0.0.1:${port} npx next dev -p 3001`,
  );
});
