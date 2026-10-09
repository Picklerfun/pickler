import type { ReadDto, LaunchSummaryDto } from "@pickler/api-schema";
import "server-only";
import type {
  ApplicantResponse,
  AgentSummaryDto,
  AgentProfileDto,
  PickDetailDto,
  AgentPersonaDto,
  DirectoryAgentDto,
  AgentReadDto,
  PlatformAnalyticsDto,
  PerpMarketDto,
  MarketDetailDto,
} from "@pickler/api-schema";
import { apiFetch, apiRead, apiReadOne, apiReadVenueItem } from "./api-client";
import { emptyAnalytics } from "./api-read";

// Presentation facade over the sole business API; no database or provider adapters.
export const services = {
  clock: { now: () => new Date() },
  listAgents: () => apiRead<AgentSummaryDto[]>("/marketplace/agents", []),
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
  listDirectory: () => apiRead<DirectoryAgentDto[]>("/marketplace/directory", []),
  listReads: () => apiRead<AgentReadDto[]>("/marketplace/reads", []),
  getRead: (id: string) => apiReadOne<AgentReadDto>(`/marketplace/reads/${encodeURIComponent(id)}`),
  listMarkets: () => apiRead<PerpMarketDto[]>("/marketplace/markets", []),
  getMarket: (symbol: string) =>
    apiReadVenueItem<MarketDetailDto>(`/marketplace/markets/${encodeURIComponent(symbol)}`),
  getAgentProfile: (ticker: string) =>
    apiReadOne<AgentProfileDto>(`/marketplace/profiles/${encodeURIComponent(ticker)}`),
  getPickDetail: (ticker: string, id: string) =>
    apiReadOne<PickDetailDto>(
      `/marketplace/profiles/${encodeURIComponent(ticker)}/picks/${encodeURIComponent(id)}`,
    ),
  getAgentPersona: (handle: string) =>
    apiReadOne<AgentPersonaDto>(`/marketplace/personas/${encodeURIComponent(handle)}`),
  getPlatformAnalytics: (range?: string) =>
    apiRead<PlatformAnalyticsDto>(
      `/marketplace/analytics?range=${encodeURIComponent(range ?? "30d")}`,
      emptyAnalytics(range),
    ),
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
