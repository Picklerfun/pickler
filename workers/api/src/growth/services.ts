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
  createJoinWaitlist,
  createSubmitApplication,
  MarketDataUnavailableError,
  type MarketBoard,
  type PerpNetwork,
} from "@pickler/core";
import {
  createPerplMarketBoard,
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
 * The market board for `PERPL_BOARD_NETWORK`: Perpl on that network. For any other value, and for
 * none, the board is unavailable and says so (503), which the pages render as the venue catching
 * up. There is no sample board in the product since docs/specs/marketplace-real-only-v1.md N3: the
 * only sample lives with the design harness.
 */
export function marketBoardFor(network: string | undefined): MarketBoard {
  if (network !== "testnet" && network !== "mainnet") {
    return unavailableMarketBoard();
  }
  let memory = boardMemory.get(network);
  if (!memory) {
    memory = new PerplBoardMemory();
    boardMemory.set(network, memory);
  }
  return createPerplMarketBoard({ network, memory });
}

/** A board with no venue behind it: every read is the venue being unavailable, never a list. */
export function unavailableMarketBoard(): MarketBoard {
  const refuse = () => {
    throw new MarketDataUnavailableError("PERPL_BOARD_NETWORK is not set to testnet or mainnet");
  };
  return { listMarkets: async () => refuse(), getMarket: async () => refuse() };
}

export function createGrowthServices(pool: Pool, options: { perplBoardNetwork?: string } = {}) {
  const adapters = {
    agents: new PostgresAgentDirectory(pool),
    markets: marketBoardFor(options.perplBoardNetwork),
    waitlist: new PostgresWaitlist(pool),
    applicants: new PostgresApplicants(pool),
  };
  return {
    clock: systemClock,
    getHealth: createGetHealth(systemClock),
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
