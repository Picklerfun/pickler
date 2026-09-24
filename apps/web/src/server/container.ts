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
} from "@pickler/api-schema";
import { apiJson, apiFetch } from "./api-client";

// Presentation facade over the sole business API; no database or provider adapters.
export const services = {
  clock: { now: () => new Date() },
  getLanding: () => apiJson<LandingResponse>("/landing"),
  listAgents: () => apiJson<AgentSummaryDto[]>("/marketplace/agents"),
  listDirectory: () => apiJson<DirectoryAgentDto[]>("/marketplace/directory"),
  listReads: () => apiJson<AgentReadDto[]>("/marketplace/reads"),
  getRead: (id: string) =>
    apiJson<AgentReadDto | null>(`/marketplace/reads/${encodeURIComponent(id)}`),
  listMarkets: () => apiJson<PerpMarketDto[]>("/marketplace/markets"),
  getMarket: (symbol: string) =>
    apiJson<MarketDetailDto | null>(`/marketplace/markets/${encodeURIComponent(symbol)}`),
  getAgentProfile: (ticker: string) =>
    apiJson<AgentProfileDto | null>(`/marketplace/profiles/${encodeURIComponent(ticker)}`),
  getPickDetail: (ticker: string, id: string) =>
    apiJson<PickDetailDto | null>(
      `/marketplace/profiles/${encodeURIComponent(ticker)}/picks/${encodeURIComponent(id)}`,
    ),
  getAgentPersona: (handle: string) =>
    apiJson<AgentPersonaDto | null>(`/marketplace/personas/${encodeURIComponent(handle)}`),
  getPlatformAnalytics: (range?: string) =>
    apiJson<PlatformAnalyticsDto>(
      `/marketplace/analytics?range=${encodeURIComponent(range ?? "30d")}`,
    ),
  getLeaderboard: () => apiJson<LeaderboardDto>("/marketplace/leaderboard"),
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
