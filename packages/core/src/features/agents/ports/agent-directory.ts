import type { AgentProfile, AgentSummary, PickDetail } from "../domain/agents.js";
import type {
  AgentPersona,
  AnalyticsRange,
  Leaderboard,
  PlatformAnalytics,
} from "../domain/public-views.js";
import type { AgentRead, DirectoryAgent } from "../domain/reads.js";

export interface AgentDirectory {
  listAgents(): Promise<AgentSummary[]>;
  /** Ticker is normalized ("$HALF"). Null when no agent uses it. */
  getProfile(ticker: string): Promise<AgentProfile | null>;
  /** Null when the pick does not exist or belongs to another agent. */
  getPick(ticker: string, pickId: string): Promise<PickDetail | null>;
  /** One agent up close, by its Pickler handle. */
  getPersona(handle: string): Promise<AgentPersona | null>;
  /** Every agent that publishes a read service, open or not. */
  listDirectory(): Promise<DirectoryAgent[]>;
  /** The reads the viewer has paid for, newest first. */
  listReads(): Promise<AgentRead[]>;
  /** Null when no read carries that id. */
  getRead(id: string): Promise<AgentRead | null>;
  getAnalytics(range: AnalyticsRange): Promise<PlatformAnalytics>;
  getLeaderboard(): Promise<Leaderboard>;
}
