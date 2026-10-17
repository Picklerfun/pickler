import { readAgentToken, readConfirmedAgentTokens } from "../studio/token-read.js";
import type { Pool } from "pg";
import { PilotError, advicePrice } from "@pickler/core";
import type {
  AgentCatalog,
  AgentCatalogQuery,
  CatalogPage,
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
  cursorAt?: string;
  /** bigint comes back from pg as text. */
  advicePriceMicroAusd: string | null;
  name: string;
  handle: string;
  createdAt: Date;
  /** Whole days since creation, on the database clock; the only clock this class reads. */
  aliveDays: number;
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
  SELECT a.id AS "id",
         a.advice_price_micro_ausd::text AS "advicePriceMicroAusd",
         a.name,
         a.handle,
         a.created_at AS "createdAt",
         floor(extract(epoch from now() - a.created_at) / 86400)::int AS "aliveDays",
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
    id: row.id,
    advicePrice: advicePrice(
      row.advicePriceMicroAusd === null ? null : BigInt(row.advicePriceMicroAusd),
    ),
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

export class PostgresAgentDirectory implements AgentDirectory, AgentCatalog {
  constructor(
    private readonly pool: Pool,
    private readonly tokenChainId: number | null = null,
  ) {}

  /**
   * Every agent that has not been killed, newest first. A killed agent is not deleted, but it is
   * no longer on the board. A private agent (a draft, or any agent never published through Go
   * Public, studio-draft-dashboard-v1 D7) is not on the board either.
   *
   * No catch anywhere in this class: a failed read is a failure, never an empty marketplace.
   */
  private async listRows(): Promise<AgentRow[]> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.killed_at IS NULL AND a.visibility = 'public'
       ORDER BY a.created_at DESC,a.id DESC LIMIT 50`,
    );
    return rows;
  }

  private async pageRows(
    query: AgentCatalogQuery,
    kind: string,
  ): Promise<{ rows: AgentRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? 20;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 50 ||
      (query.q?.length ?? 0) > 80 ||
      (query.theme?.length ?? 0) > 40
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid catalogue page");
    }
    const binding = JSON.stringify([
      kind,
      this.tokenChainId,
      query.q?.trim().toLowerCase() ?? "",
      query.theme ?? "",
      query.available ?? false,
      query.adviceForSale ?? false,
      query.tokensOnly ?? false,
    ]);
    let before: { at: string; id: string } | null = null;
    if (query.cursor) {
      try {
        if (query.cursor.length > 2048) {
          throw new Error("cursor");
        }
        const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
        if (
          value.v !== 1 ||
          value.binding !== binding ||
          typeof value.at !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value.at) ||
          !Number.isFinite(Date.parse(value.at)) ||
          new Date(value.at).toISOString().slice(0, 10) !== value.at.slice(0, 10) ||
          !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value.id)
        ) {
          throw new Error("cursor");
        }
        before = value;
      } catch {
        throw new PilotError("INVALID_INPUT", "Invalid catalogue cursor");
      }
    }
    // No settlement/read service exists yet: record ordering is tied, availability is false.
    // Stable creation/id ties preserve the current domain order without invented performance.
    const { rows } = await this.pool.query<AgentRow>(
      `SELECT a.id,a.advice_price_micro_ausd::text AS "advicePriceMicroAusd",a.name,a.handle,
         a.created_at AS "createdAt",to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",p.beat,p.accent,p.venue,p.decides,
         t.ticker,t.status AS "tokenStatus",t.address AS "tokenAddress",t.chain AS "tokenChain",
         t.graduation_target::text AS "graduationTarget",t.quote_decimals AS "quoteDecimals"
       FROM agents.agents a LEFT JOIN agents.agent_profiles p ON p.agent_id=a.id
       LEFT JOIN market.tokens t ON t.agent_id=a.id AND t.status IN ('pre_graduation','graduated')
       WHERE a.killed_at IS NULL AND a.visibility = 'public'
         AND ($1::timestamptz IS NULL OR (a.created_at,a.id) < ($1,$2::uuid))
         AND NOT EXISTS (SELECT 1 FROM unnest($3::text[]) word WHERE position(word in lower(concat_ws(' ',a.handle,a.name,p.beat,p.venue,p.decides)))=0)
         AND ($4::text IS NULL OR p.beat=$4)
         AND NOT $5::boolean
         AND (NOT $6::boolean OR (a.advice_price_micro_ausd IS NOT NULL AND p.venue IN ('perps','both')))
         AND (NOT $7::boolean OR EXISTS (SELECT 1 FROM market.tokens mt WHERE mt.agent_id=a.id AND mt.chain=$8 AND mt.status IN ('pre_graduation','graduated') AND mt.address IS NOT NULL AND EXISTS (
           SELECT 1 FROM market.chain_events e JOIN market.chain_blocks b ON b.chain=e.chain AND b.hash=e.block_hash
           JOIN launch.agent_keys k ON k.agent_id=a.id AND k.chain=e.chain AND k.agent_key=lower(e.decoded->>'agentKey')
           JOIN launch.grants g ON g.agent_id=k.agent_id AND g.chain=k.chain AND g.factory=lower(e.emitter)
           WHERE e.chain=mt.chain AND e.tx_hash=mt.launch_tx_hash AND e.event_name='LaunchCreated'
             AND NOT e.orphaned AND NOT b.orphaned AND b.finality IN ('confirmed','finalized')
             AND lower(e.decoded->>'token')=lower(mt.address)
             AND lower(g.payload->'params'->>'creator')=lower(e.decoded->>'creator')
             AND lower(g.payload->'params'->>'metadataHash')=lower(e.decoded->>'metadataHash')
             AND lower(g.payload->'params'->>'expectedConfigHash')=lower(e.decoded->>'presetHash')
             AND date_trunc('second',g.created_at)<=b.block_time AND g.expires_at>=b.block_time)))
       ORDER BY a.created_at DESC,a.id DESC LIMIT $9`,
      [
        before?.at ?? null,
        before?.id ?? null,
        query.q?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [],
        query.theme || null,
        query.available ?? false,
        query.adviceForSale ?? false,
        query.tokensOnly ?? false,
        `eip155:${this.tokenChainId}`,
        limit + 1,
      ],
    );
    const items = rows.slice(0, limit);
    const last = items.at(-1);
    return {
      rows: items,
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify({ v: 1, binding, at: last.cursorAt, id: last.id })).toString(
              "base64url",
            )
          : null,
    };
  }

  async pageAgents(query: AgentCatalogQuery): Promise<CatalogPage<AgentSummary>> {
    const page = await this.pageRows(query, "agents");
    return { items: page.rows.map(summary), nextCursor: page.nextCursor };
  }

  async pageDirectory(query: AgentCatalogQuery): Promise<CatalogPage<DirectoryAgent>> {
    const page = await this.pageRows(query, "directory");
    const tokens = await readConfirmedAgentTokens(
      this.pool,
      page.rows.map((row) => row.id),
      this.tokenChainId,
    );
    return {
      items: page.rows.map((row) => {
        const s = summary(row);
        return {
          agent: {
            id: s.id,
            advicePrice: s.advicePrice,
            name: s.name,
            handle: s.handle,
            ticker: s.ticker,
            accent: s.accent,
          },
          launchedToken: tokens.get(row.id) ?? null,
          beat: s.beat,
          venue: s.venue,
          decides: row.decides ?? "",
          score: null,
          hitRate: null,
          resolved: 0,
          net: 0,
          service: null,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  async listAgents(): Promise<AgentSummary[]> {
    const rows = await this.listRows();
    return rows.map(summary);
  }

  /**
   * Tickers arrive normalized as "$HALF", and market.tokens stores them the same way. A reserved
   * or failed ticker has no profile page, and that is locked twice on purpose: the token join only
   * matches a launched status, and the stage check below refuses anything else independently of
   * the join, so a change to AGENT_SELECT alone cannot open a page for a token that never launched.
   * A private agent has no profile page either: it is not public until Go Public.
   */
  async getProfile(ticker: string): Promise<AgentProfile | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE t.ticker = $1 AND a.visibility = 'public'`,
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
  async getPick(): Promise<PickDetail | null> {
    return null;
  }

  /**
   * Not filtered by `killed_at`, on purpose: a killed agent is not deleted and its profile still
   * serves, so a link to a record that existed keeps resolving. A private agent has no persona: it
   * is not public until Go Public.
   */
  async getPersona(handle: string): Promise<AgentPersona | null> {
    const { rows } = await this.pool.query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.handle = $1 AND a.visibility = 'public'`,
      [handle],
    );
    const row = rows[0];
    if (!row) {
      return null;
    }
    const s = summary(row);
    const token = await readAgentToken(this.pool, row.id, this.tokenChainId);
    return {
      id: s.id,
      advicePrice: s.advicePrice,
      launchedToken: token.token,
      tokenConfirmation: token.token ? "confirmed" : token.pending ? "pending" : "absent",
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
      aliveDays: row.aliveDays,
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
    const tokens = await readConfirmedAgentTokens(
      this.pool,
      rows.map((row) => row.id),
      this.tokenChainId,
    );
    return rows.map((row) => {
      const s = summary(row);
      return {
        agent: {
          id: s.id,
          advicePrice: s.advicePrice,
          name: s.name,
          handle: s.handle,
          ticker: s.ticker,
          accent: s.accent,
        },
        launchedToken: tokens.get(row.id) ?? null,
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

  async getRead(): Promise<AgentRead | null> {
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
