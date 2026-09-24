import type { Pool } from "pg";
import type {
  Accent,
  AgentDirectory,
  AgentPersona,
  AgentProfile,
  AgentRead,
  AgentSummary,
  AnalyticsRange,
  DirectoryAgent,
  Leaderboard,
  PickDetail,
  PlatformAnalytics,
  TokenStage,
  Venue,
} from "@pickler/core";

/**
 * One row of the join the marketplace reads. Identity from agents.agents, the public face from
 * agents.agent_profiles (LEFT, because agents created before the profile existed are still
 * agents), the token from market.tokens (LEFT, because most agents have none).
 *
 * There is no record here on purpose. No table records whether a pick was right — a decision is a
 * prediction and an order is a fill — so `resolved` is the true count, zero, and `hitRate` is
 * null because there is no rate to state. See docs/specs/marketplace-real-data-v1.md §3.
 */
interface AgentRow {
  id: string;
  name: string;
  handle: string;
  createdAt: Date;
  beat: string | null;
  accent: Accent | null;
  blurb: string | null;
  venue: Venue | null;
  vibe: string | null;
  voice: string | null;
  decides: string | null;
  wrong: string | null;
  xHandle: string | null;
  creatorHandle: string | null;
  /** Stored with its "$", as `tokens_ticker_format` requires: "$HALF". */
  ticker: string | null;
  tokenStatus: string | null;
  tokenAddress: string | null;
  tokenChain: string | null;
  graduationTarget: string | null;
}

const AGENT_SELECT = `
  SELECT a.id,
         a.name,
         a.handle,
         a.created_at AS "createdAt",
         p.beat,
         p.accent,
         p.blurb,
         p.venue,
         p.vibe,
         p.voice,
         p.decides,
         p.wrong,
         p.x_handle AS "xHandle",
         cp.handle AS "creatorHandle",
         t.ticker,
         t.status AS "tokenStatus",
         t.address AS "tokenAddress",
         t.chain AS "tokenChain",
         t.graduation_target::text AS "graduationTarget"
    FROM agents.agents a
    LEFT JOIN agents.agent_profiles p ON p.agent_id = a.id
    LEFT JOIN identity.profiles cp ON cp.user_id = a.created_by
    LEFT JOIN market.tokens t
      ON t.agent_id = a.id AND t.status IN ('pre_graduation', 'graduated')`;

/** `reserved`, `launching` and `failed` are not launched tokens; the agent has no token. */
function stageOf(status: string | null): TokenStage | null {
  if (status === "pre_graduation") {
    return "pre-graduation";
  }
  if (status === "graduated") {
    return "graduated";
  }
  return null;
}

function summary(row: AgentRow): AgentSummary {
  const stage = stageOf(row.tokenStatus);
  return {
    name: row.name,
    handle: row.handle,
    ticker: stage ? row.ticker : null,
    beat: row.beat ?? "",
    accent: row.accent ?? "lime",
    venue: row.venue ?? "predictions",
    createdAt: row.createdAt,
    // Zero is the true count: nothing has ever settled (spec §3).
    resolved: 0,
    hitRate: null,
    net: 0,
    token: stage
      ? {
          stage,
          // market.candles and market.holders are written by the launchpad indexer (PR #37) and
          // are not read yet. The type requires numbers here; these are unread figures, not
          // measurements, and the profile's `market` stays null for the same reason.
          marketCap: 0,
          raised: 0,
          graduationTarget: Number(row.graduationTarget ?? 0),
          volume24h: 0,
          price: 0,
          change24h: 0,
          address: row.tokenAddress,
          chain: row.tokenChain ?? "",
        }
      : null,
  };
}

export class PostgresAgentDirectory implements AgentDirectory {
  constructor(private readonly pool: Pool) {}

  /** No catch anywhere in this class: a failed read is a failure, never an empty marketplace. */
  async listAgents(): Promise<AgentSummary[]> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.killed_at IS NULL
       ORDER BY a.created_at DESC`,
    );
    return rows.map(summary);
  }

  // Added in Tasks 5 and 6. Declared so the class satisfies the port; each throws so nothing
  // silently serves a stub.
  async getProfile(): Promise<AgentProfile | null> {
    throw new Error("Task 6");
  }

  async getPick(): Promise<PickDetail | null> {
    throw new Error("Task 6");
  }

  async getPersona(): Promise<AgentPersona | null> {
    throw new Error("Task 5");
  }

  async listDirectory(): Promise<DirectoryAgent[]> {
    throw new Error("Task 5");
  }

  async listReads(): Promise<AgentRead[]> {
    throw new Error("Task 6");
  }

  async getRead(): Promise<AgentRead | null> {
    throw new Error("Task 6");
  }

  async getAnalytics(_range: AnalyticsRange): Promise<PlatformAnalytics> {
    throw new Error("Task 6");
  }

  async getLeaderboard(): Promise<Leaderboard> {
    throw new Error("Task 6");
  }
}
