import "server-only";
import {
  createCheckTicker,
  createGetAgentProfile,
  createGetPickDetail,
  createGetAgentPersona,
  createGetLeaderboard,
  createGetPlatformAnalytics,
  createGetRead,
  createListAgents,
  createListDirectory,
  createListReads,
  createGetApplicant,
  createGetHealth,
  createGetLanding,
  createJoinWaitlist,
  createSubmitApplication,
  type AgentDirectory,
  type ApplicantRepository,
  type LandingReadModel,
  type WaitlistRepository,
} from "@pickler/core";
import {
  createInMemoryApplicantStore,
  createSampleAgentDirectory,
  createSampleLandingReadModel,
  createSupabaseApplicants,
  createSupabaseRestClient,
  createSupabaseWaitlist,
  SAMPLE_AGENT_TICKERS,
  systemClock,
} from "@pickler/infrastructure";
import { readDataSource } from "./config";

function createAdapters(): {
  landing: LandingReadModel;
  waitlist: WaitlistRepository;
  applicants: ApplicantRepository;
  agents: AgentDirectory;
} {
  const source = readDataSource();
  if (source.kind === "supabase") {
    const growth = createSupabaseRestClient({
      url: source.url,
      secretKey: source.secretKey,
      schema: "growth",
    });
    // No launched agents exist yet: the landing and board keep sample data until the market schema lands.
    return {
      landing: createSampleLandingReadModel(systemClock),
      agents: createSampleAgentDirectory(systemClock),
      waitlist: createSupabaseWaitlist(growth),
      applicants: createSupabaseApplicants(growth),
    };
  }
  // Sample mode: signups and applications live in process memory, so they vanish on restart.
  // Next.js bundles pages and route handlers as separate module instances, so the store
  // is pinned to globalThis to keep one per process.
  const holder = globalThis as typeof globalThis & {
    __picklerSampleStore?: ReturnType<typeof createInMemoryApplicantStore>;
  };
  holder.__picklerSampleStore ??= createInMemoryApplicantStore({
    initialCount: 1204,
    reservedTickers: SAMPLE_AGENT_TICKERS,
  });
  return {
    landing: createSampleLandingReadModel(systemClock),
    agents: createSampleAgentDirectory(systemClock),
    ...holder.__picklerSampleStore,
  };
}

const adapters = createAdapters();

// Composition root: wire concrete adapters here, not inside business logic.
export const services = {
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
  getRead: createGetRead(adapters.agents),
};
