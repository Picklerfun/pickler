import "server-only";
import type {
  LandingResponse,
  ApplicantResponse,
  AgentSummaryDto,
  AgentProfileDto,
  PickDetailDto,
  AgentPersonaDto,
  DirectoryAgentDto,
  AgentReadDto,
  PlatformAnalyticsDto,
  LeaderboardDto,
  PerpMarketDto,
  MarketDetailDto,
  LaunchSummaryDto,
  ReadDto,
} from "@pickler/api-schema";
import { apiJson, apiFetch } from "./api-client";

// Presentation facade over the sole business API; no database or provider adapters.
export const services = {
  clock: { now: () => new Date() },
  getLanding: () => apiJson<LandingResponse>("/landing"),
  listAgents: () => apiJson<AgentSummaryDto[]>("/demo/agents"),
  /**
   * The real launch catalogue.
   *
   * Returns null when the API has no launch surface mounted, which is what happens without a
   * database binding. Null and an empty list mean different things — "we cannot ask" against
   * "we asked and there is nothing" — and the page says which one it is rather than showing
   * the same emptiness for both.
   */
  listLaunches: async (): Promise<ReadDto<LaunchSummaryDto[]> | null> => {
    const response = await apiFetch(new Request("https://pickler.internal/v1/launches"));

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Pickler API request failed (${response.status})`);
    }

    return response.json() as Promise<ReadDto<LaunchSummaryDto[]>>;
  },
  listDirectory: () => apiJson<DirectoryAgentDto[]>("/demo/directory"),
  listReads: () => apiJson<AgentReadDto[]>("/demo/reads"),
  getRead: (id: string) => apiJson<AgentReadDto | null>(`/demo/reads/${encodeURIComponent(id)}`),
  listMarkets: () => apiJson<PerpMarketDto[]>("/demo/markets"),
  getMarket: (symbol: string) =>
    apiJson<MarketDetailDto | null>(`/demo/markets/${encodeURIComponent(symbol)}`),
  getAgentProfile: (ticker: string) =>
    apiJson<AgentProfileDto | null>(`/demo/profiles/${encodeURIComponent(ticker)}`),
  getPickDetail: (ticker: string, id: string) =>
    apiJson<PickDetailDto | null>(
      `/demo/profiles/${encodeURIComponent(ticker)}/picks/${encodeURIComponent(id)}`,
    ),
  getAgentPersona: (handle: string) =>
    apiJson<AgentPersonaDto | null>(`/demo/personas/${encodeURIComponent(handle)}`),
  getPlatformAnalytics: (range?: string) =>
    apiJson<PlatformAnalyticsDto>(`/demo/analytics?range=${encodeURIComponent(range ?? "30d")}`),
  getLeaderboard: () => apiJson<LeaderboardDto>("/demo/leaderboard"),
  async getApplicant(token: string | null): Promise<ApplicantResponse | null> {
    if (!token) {
      return null;
    }
    const response = await apiFetch(
      new Request("https://pickler.internal/v1/applications", {
        headers: { Cookie: `pk_apply=${encodeURIComponent(token)}` },
      }),
    );
    if (response.status === 401) {
      return null;
    }
    if (!response.ok) {
      throw new Error("Application service unavailable");
    }
    return response.json() as Promise<ApplicantResponse>;
  },
};
