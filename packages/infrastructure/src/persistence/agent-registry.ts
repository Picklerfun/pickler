import type { Pool } from "pg";
import type {
  AgentCredentialRecord,
  AgentEvent,
  AgentEventLog,
  AgentRegistry,
  AuditPage,
  AuditQuery,
  BudgetSource,
  RegisteredAgent,
} from "@pickler/core";
import { readRows } from "./data-source.js";

/** Upper bound on rows scanned for analytics; Relayer scanned without a limit. */
export const ANALYTICS_ROW_LIMIT = 10_000;

// agents.agents + agents.agent_profiles, agents.agent_credentials, agents.agent_events and
// budget.budgets over the API's pool, mirroring the Supabase adapters these replace. Nothing here
// writes. Wallet and Turnkey references are null until the wallets schema is joined in.

interface AgentRow {
  id: string;
  workspaceId: string;
  name: string;
  status: RegisteredAgent["status"];
  chainId: number | null;
  killedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  blurb: string | null;
}

// Explicit columns: credentials are never selected on the read path.
const AGENT_SELECT = `SELECT a.id, a.workspace_id AS "workspaceId", a.name, a.status::text AS status,
         a.chain_id AS "chainId", a.killed_at AS "killedAt", a.created_at AS "createdAt",
         a.updated_at AS "updatedAt", p.blurb
    FROM agents.agents a LEFT JOIN agents.agent_profiles p ON p.agent_id = a.id`;
const EVENT_COLUMNS = `id, agent_id AS "agentId", workspace_id AS "workspaceId",
         event_type AS "eventType", NULL::text AS "skillId", payload, created_at AS "createdAt"`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toAgent = (row: AgentRow): RegisteredAgent => ({
  id: row.id,
  workspaceId: row.workspaceId,
  name: row.name,
  description: row.blurb || null,
  status: row.status,
  walletId: null,
  walletAddress: null,
  chainId: row.chainId,
  thresholdUsd: "0",
  killedAt: row.killedAt,
  turnkeyUserId: null,
  turnkeyAgentUserId: null,
  turnkeyPolicyId: null,
  activePolicyId: null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class PostgresAgentRegistry implements AgentRegistry {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<RegisteredAgent | null> {
    if (!UUID.test(id)) {
      return null;
    }
    const rows = await readRows<AgentRow>(
      this.pool,
      "agents.agents.findById",
      `${AGENT_SELECT} WHERE a.id = $1`,
      [id],
    );
    return rows[0] ? toAgent(rows[0]) : null;
  }

  async listByWorkspace(workspaceId: string): Promise<RegisteredAgent[]> {
    const rows = await readRows<AgentRow>(
      this.pool,
      "agents.agents.listByWorkspace",
      `${AGENT_SELECT} WHERE a.workspace_id = $1 ORDER BY a.created_at DESC`,
      [workspaceId],
    );
    return rows.map(toAgent);
  }

  async findCredentials(id: string): Promise<AgentCredentialRecord | null> {
    if (!UUID.test(id)) {
      return null;
    }
    const rows = await readRows<AgentCredentialRecord>(
      this.pool,
      "agents.agents.findCredentials",
      `SELECT a.id, a.workspace_id AS "workspaceId", NULL::text AS "walletId",
              a.status::text AS status, c.encrypted_hmac_secret AS "encryptedAgentSecret"
         FROM agents.agents a LEFT JOIN agents.agent_credentials c ON c.agent_id = a.id
        WHERE a.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }
}

export class PostgresAgentEventLog implements AgentEventLog {
  constructor(private readonly pool: Pool) {}

  async listSince(agentId: string, since: Date): Promise<AgentEvent[]> {
    return readRows<AgentEvent>(
      this.pool,
      "agents.agent_events.listSince",
      `SELECT ${EVENT_COLUMNS} FROM agents.agent_events
        WHERE agent_id = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT $3`,
      [agentId, since, ANALYTICS_ROW_LIMIT],
    );
  }

  async audit(agentId: string, query: AuditQuery): Promise<AuditPage> {
    // Null filters match everything, so one statement serves every combination.
    const where = `agent_id = $1 AND ($2::text[] IS NULL OR event_type = ANY($2))
      AND ($3::timestamptz IS NULL OR created_at >= $3)
      AND ($4::text IS NULL OR payload->>'status' = $4)`;
    const filters = [
      agentId,
      query.eventTypes ? [...query.eventTypes] : null,
      query.since,
      query.status,
    ];
    // The total counts every match, not just the page, as PostgREST's exact count did.
    const [events, counted] = await Promise.all([
      readRows<AgentEvent>(
        this.pool,
        "agents.agent_events.audit",
        `SELECT ${EVENT_COLUMNS} FROM agents.agent_events WHERE ${where}
          ORDER BY created_at DESC LIMIT $5 OFFSET $6`,
        [...filters, query.limit, (query.page - 1) * query.limit],
      ),
      readRows<{ total: number }>(
        this.pool,
        "agents.agent_events.audit",
        `SELECT count(*)::int AS total FROM agents.agent_events WHERE ${where}`,
        filters,
      ),
    ]);
    return { events, total: counted[0]?.total ?? 0, page: query.page, limit: query.limit };
  }
}

/** budget.budgets for ledger hydration; micro-USD bigints arrive as decimal strings. */
export class PostgresBudgetSource implements BudgetSource {
  constructor(private readonly pool: Pool) {}

  async loadBudgets(
    agentId: string,
  ): Promise<{ category: string; limit: string; spent: string }[]> {
    return readRows<{ category: string; limit: string; spent: string }>(
      this.pool,
      "budget.budgets",
      `SELECT category::text AS category, limit_micro_usd::text AS "limit",
              spent_micro_usd::text AS spent
         FROM budget.budgets WHERE agent_id = $1`,
      [agentId],
    );
  }
}
