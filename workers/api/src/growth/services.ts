import {
  createCheckTicker,
  createGetAgentProfile,
  createGetPickDetail,
  createGetAgentPersona,
  createGetLeaderboard,
  createGetMarket,
  createGetPlatformAnalytics,
  createGetRead,
  createListAgents,
  createListDirectory,
  createListMarkets,
  createListReads,
  createGetApplicant,
  createGetHealth,
  createGetLanding,
  createJoinWaitlist,
  createSubmitApplication,
  type MarketBoard,
  type PerpNetwork,
} from "@pickler/core";
import {
  createPerplMarketBoard,
  createSampleLandingReadModel,
  createSampleMarketBoard,
  PerplBoardMemory,
  PostgresAgentDirectory,
  PostgresApplicants,
  PostgresWaitlist,
  systemClock,
  type PostgresResearchStore,
} from "@pickler/infrastructure";

// `pg` is not a direct dependency here; the pool is whatever the composition root already opened.
type Pool = PostgresResearchStore["pool"];

// Services are composed per request, so what the board remembers between requests lives here, one
// per network: the venue's last answer, each market's history and the pacing of its requests.
const boardMemory = new Map<PerpNetwork, PerplBoardMemory>();

/**
 * The market board for `PERPL_BOARD_NETWORK`: Perpl on that network, or — for any other value,
 * and for none — the sample board, which says it is a sample on every market it lists.
 */
export function marketBoardFor(network: string | undefined): MarketBoard {
  if (network !== "testnet" && network !== "mainnet") {
    return createSampleMarketBoard();
  }
  let memory = boardMemory.get(network);
  if (!memory) {
    memory = new PerplBoardMemory();
    boardMemory.set(network, memory);
  }
  return createPerplMarketBoard({ network, memory });
}

export function createGrowthServices(pool: Pool, options: { perplBoardNetwork?: string } = {}) {
  const adapters = {
    // Stays sample: the landing is marketing copy, not a read of the database.
    landing: createSampleLandingReadModel(systemClock),
    agents: new PostgresAgentDirectory(pool),
    markets: marketBoardFor(options.perplBoardNetwork),
    waitlist: new PostgresWaitlist(pool),
    applicants: new PostgresApplicants(pool),
  };
  return {
    clock: systemClock,
    getHealth: createGetHealth(systemClock),
    getLanding: createGetLanding(adapters.landing),
    joinWaitlist: createJoinWaitlist(adapters.waitlist, adapters.applicants),
    getApplicant: createGetApplicant(adapters.applicants),
    submitApplication: createSubmitApplication(adapters.applicants),
    checkTicker: createCheckTicker(adapters.applicants),
    listAgents: createListAgents(adapters.agents),
    getAgentProfile: createGetAgentProfile(adapters.agents),
    getPickDetail: createGetPickDetail(adapters.agents),
    getAgentPersona: createGetAgentPersona(adapters.agents),
    getPlatformAnalytics: createGetPlatformAnalytics(adapters.agents),
    getLeaderboard: createGetLeaderboard(adapters.agents),
    listDirectory: createListDirectory(adapters.agents),
    listReads: createListReads(adapters.agents),
    listMarkets: createListMarkets(adapters.markets),
    getMarket: createGetMarket(adapters.markets),
    getRead: createGetRead(adapters.agents),
  };
}
