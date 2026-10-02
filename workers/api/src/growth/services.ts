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
} from "@pickler/core";
import {
  createSampleLandingReadModel,
  createSampleMarketBoard,
  PostgresAgentDirectory,
  PostgresApplicants,
  PostgresWaitlist,
  systemClock,
  type PostgresResearchStore,
} from "@pickler/infrastructure";

// `pg` is not a direct dependency here; the pool is whatever the composition root already opened.
type Pool = PostgresResearchStore["pool"];

export function createGrowthServices(pool: Pool) {
  const adapters = {
    // Stays sample: the landing is marketing copy, not a read of the database.
    landing: createSampleLandingReadModel(systemClock),
    agents: new PostgresAgentDirectory(pool),
    // Stays sample: there is no venue table to read yet.
    markets: createSampleMarketBoard(),
    waitlist: new PostgresWaitlist(pool),
    applicants: new PostgresApplicants(pool),
  };
  return {
    clock: systemClock,
    getHealth: createGetHealth(systemClock),
    // The sample landing, with the waitlist's real count under its form.
    getLanding: createGetLanding(adapters.landing, () => adapters.waitlist.count()),
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
