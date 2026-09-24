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
  /** Quote base units, numeric(78,0) as text. Nullable even on a launched token. */
  graduationTarget: string | null;
  /** Required on a launched token (`tokens_launched_consistent`); null before launch. */
  quoteDecimals: number | null;
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
         t.graduation_target::text AS "graduationTarget",
         t.quote_decimals AS "quoteDecimals"
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

/**
 * The integer part of a base-units amount in display units: "5000000000" at 6 decimals is 5000.
 * BigInt division truncates, which is enough for a figure the board shows as a round number.
 */
function toDisplayUnits(raw: string, decimals: number): number {
  return Number(BigInt(raw) / 10n ** BigInt(decimals));
}

/**
 * A launched token's graduation target in display units. `graduation_target` is not part of
 * `tokens_launched_consistent`, so it can be null on a launched token; then the target is 0
 * because the column was null, not because the curve needs nothing.
 */
function graduationTargetOf(row: AgentRow): number {
  if (row.graduationTarget === null || row.quoteDecimals === null) {
    return 0;
  }
  return toDisplayUnits(row.graduationTarget, row.quoteDecimals);
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
          graduationTarget: graduationTargetOf(row),
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

  /**
   * Every agent that has not been killed, newest first. A killed agent is not deleted, but it is
   * no longer on the board.
   *
   * No catch anywhere in this class: a failed read is a failure, never an empty marketplace.
   */
  private async listRows(): Promise<AgentRow[]> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.killed_at IS NULL
       ORDER BY a.created_at DESC`,
    );
    return rows;
  }

  async listAgents(): Promise<AgentSummary[]> {
    const rows = await this.listRows();
    return rows.map(summary);
  }

  /**
   * Tickers arrive normalized as "$HALF", and market.tokens stores them the same way. The token
   * join only matches a launched token, so a reserved or failed ticker has no profile page.
   */
  async getProfile(ticker: string): Promise<AgentProfile | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE t.ticker = $1`,
      [ticker],
    );
    const row = rows[0];
    if (!row || !stageOf(row.tokenStatus)) {
      return null;
    }
    const s = summary(row);
    return {
      ...s,
      blurb: row.blurb ?? "",
      xHandle: row.xHandle,
      creatorHandle: row.creatorHandle,
      // No settlement exists (spec §3), so nothing is open and there are no calls to list.
      openPicks: 0,
      // market.candles and market.holders are written by the launchpad indexer (PR #37).
      // Until it has written, there is no market to show: null, not zeros.
      market: null,
      calls: [],
    };
  }

  /** No settlement exists (spec §3): no pick has ever been resolved, so none can be shown. */
  async getPick(_ticker: string, _pickId: string): Promise<PickDetail | null> {
    return null;
  }

  /**
   * Not filtered by `killed_at`, on purpose: a killed agent is not deleted and its profile still
   * serves, so a link to a record that existed keeps resolving.
   */
  async getPersona(handle: string): Promise<AgentPersona | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.handle = $1`,
      [handle],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    const s = summary(row);
    const aliveDays = Math.floor((Date.now() - row.createdAt.getTime()) / 86_400_000);
    return {
      name: s.name,
      handle: s.handle,
      ticker: s.ticker,
      accent: s.accent,
      beat: s.beat,
      venue: s.venue,
      vibe: row.vibe ?? "",
      voice: row.voice ?? "",
      blurb: row.blurb ?? "",
      xHandle: row.xHandle,
      creatorHandle: row.creatorHandle,
      // No settlement exists (spec §3): no gap, no rate, zero resolved, nothing open.
      calibrationGap: null,
      resolved: 0,
      hitRate: null,
      net: 0,
      openPicks: 0,
      aliveDays,
      // A launched token's cap is unread until the indexer (PR #37) is read; this field can say
      // so, where the summary's `token.marketCap` cannot. `stage` still says the token exists.
      marketCap: null,
      stage: s.token?.stage ?? null,
      // Meters are read from behaviour, and there is no behaviour on record yet.
      meters: [],
      decides: row.decides ?? "",
      wrong: row.wrong ?? "",
      // Paid reads have no persistence (spec §7), so there is no price, no answers, no service.
      askPrice: null,
      answers: [],
      decisions: [],
      service: null,
      reads: [],
    };
  }

  /** Every live agent; none publishes a read service yet, because paid reads have no persistence (spec §7). */
  async listDirectory(): Promise<DirectoryAgent[]> {
    const rows = await this.listRows();
    return rows.map((row) => {
      const s = summary(row);
      return {
        agent: { name: s.name, handle: s.handle, ticker: s.ticker, accent: s.accent },
        beat: s.beat,
        venue: s.venue,
        decides: row.decides ?? "",
        // The score needs a calibration gap, and no settlement exists (spec §3).
        score: null,
        hitRate: null,
        resolved: 0,
        net: 0,
        service: null,
      };
    });
  }

  /** Paid reads have no persistence (spec §7): nobody has paid for one, so there is none to list. */
  async listReads(): Promise<AgentRead[]> {
    return [];
  }

  async getRead(_id: string): Promise<AgentRead | null> {
    return null;
  }

  /**
   * Analytics are settled volume over a window, and nothing has settled (spec §3). Zero is the
   * true total, and there is no series, no log and no table to draw it from.
   */
  async getAnalytics(range: AnalyticsRange): Promise<PlatformAnalytics> {
    return {
      range,
      settledVolumeAllTime: 0,
      groups: [],
      predictionsShare: 0,
      splitNote: "Nothing has settled yet.",
      series: [],
      log: [],
      table: [],
    };
  }

  /** Ranks by record, and no record exists until settlement does (spec §3). */
  async getLeaderboard(): Promise<Leaderboard> {
    return { entries: [], weights: [], calibration: [] };
  }
}
