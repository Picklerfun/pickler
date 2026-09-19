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
} from "@pickler/core";
import {
  createSampleAgentDirectory,
  createSampleLandingReadModel,
  createSupabaseApplicants,
  createSupabaseRestClient,
  createSupabaseWaitlist,
  systemClock,
} from "@pickler/infrastructure";
import type { Env } from "../env";

export function createGrowthServices(env: Env) {
  const growth = createSupabaseRestClient({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
    schema: "growth",
  });
  const adapters = {
    landing: createSampleLandingReadModel(systemClock),
    agents: createSampleAgentDirectory(systemClock),
    waitlist: createSupabaseWaitlist(growth),
    applicants: createSupabaseApplicants(growth),
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
    getRead: createGetRead(adapters.agents),
  };
}
