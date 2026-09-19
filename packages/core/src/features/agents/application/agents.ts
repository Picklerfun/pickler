import { normalizeTicker } from "../../applications/domain/application.js";
import { handleProblem, normalizeHandle } from "../../profiles/domain/profile.js";
import type { AgentProfile, AgentSummary, PickDetail } from "../domain/agents.js";
import {
  ANALYTICS_RANGES,
  type AgentPersona,
  type AnalyticsRange,
  type Leaderboard,
  type PlatformAnalytics,
} from "../domain/public-views.js";
import type { AgentRead, DirectoryAgent } from "../domain/reads.js";
import type { AgentDirectory } from "../ports/agent-directory.js";

/** The board ranks by settled record first, never by token price. */
export const byRecord = (a: AgentSummary, b: AgentSummary) =>
  b.resolved - a.resolved || b.net - a.net;

export function createListAgents(directory: AgentDirectory) {
  return async (): Promise<AgentSummary[]> => [...(await directory.listAgents())].sort(byRecord);
}

export function createGetAgentProfile(directory: AgentDirectory) {
  return async (rawTicker: string): Promise<AgentProfile | null> => {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker) {
      return null;
    }
    const profile = await directory.getProfile(ticker);
    return (
      profile && {
        ...profile,
        calls: [...profile.calls].sort((a, b) => b.calledAt.getTime() - a.calledAt.getTime()),
      }
    );
  };
}

export function createGetPickDetail(directory: AgentDirectory) {
  return async (rawTicker: string, pickId: string): Promise<PickDetail | null> => {
    const ticker = normalizeTicker(rawTicker);
    if (!ticker || pickId.length === 0 || pickId.length > 64) {
      return null;
    }
    return directory.getPick(ticker, pickId);
  };
}

export function createGetAgentPersona(directory: AgentDirectory) {
  return async (rawHandle: string): Promise<AgentPersona | null> => {
    const handle = normalizeHandle(rawHandle);
    // A reserved handle can still belong to an agent; only malformed ones are rejected here.
    if (handleProblem(handle) && handleProblem(handle) !== "reserved") {
      return null;
    }
    const persona = await directory.getPersona(handle);
    return (
      persona && {
        ...persona,
        decisions: [...persona.decisions].sort((a, b) => b.at.getTime() - a.at.getTime()),
      }
    );
  };
}

/**
 * The directory leads with the agents that are actually taking questions, and inside that with the
 * ones whose stated odds have been closest to what happened. Price never enters the order.
 */
export function createListDirectory(directory: AgentDirectory) {
  return async (): Promise<DirectoryAgent[]> =>
    [...(await directory.listDirectory())].sort(
      (a, b) => Number(b.service.open) - Number(a.service.open) || a.service.gap - b.service.gap,
    );
}

export function createListReads(directory: AgentDirectory) {
  return async (): Promise<AgentRead[]> => directory.listReads();
}

export function createGetRead(directory: AgentDirectory) {
  return async (id: string): Promise<AgentRead | null> => {
    if (id.length === 0 || id.length > 64) {
      return null;
    }
    return directory.getRead(id);
  };
}

export function createGetPlatformAnalytics(directory: AgentDirectory) {
  return async (rawRange?: string): Promise<PlatformAnalytics> => {
    const range: AnalyticsRange =
      ANALYTICS_RANGES.find((r) => r === rawRange?.toLowerCase()) ?? "30d";
    return directory.getAnalytics(range);
  };
}

/** Ranked by the published weights; ties break on settled picks, never on price. */
export function createGetLeaderboard(directory: AgentDirectory) {
  return async (): Promise<Leaderboard> => {
    const board = await directory.getLeaderboard();
    return {
      ...board,
      entries: [...board.entries].sort((a, b) => b.score - a.score || b.resolved - a.resolved),
    };
  };
}
