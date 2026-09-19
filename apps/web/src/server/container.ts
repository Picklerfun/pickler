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
} from "@pickler/api-schema";
import { apiJson, apiFetch } from "./api-client";

// Presentation facade over the sole business API; no database or provider adapters.
export const services = {
  clock: { now: () => new Date() },
  getLanding: () => apiJson<LandingResponse>("/landing"),
  listAgents: () => apiJson<AgentSummaryDto[]>("/demo/agents"),
  listDirectory: () => apiJson<DirectoryAgentDto[]>("/demo/directory"),
  listReads: () => apiJson<AgentReadDto[]>("/demo/reads"),
  getRead: (id: string) => apiJson<AgentReadDto | null>(`/demo/reads/${encodeURIComponent(id)}`),
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
