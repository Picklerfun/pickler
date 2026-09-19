// Ported from Relayer apps/api/src/kits/agent/repositories/AgentRepository.ts (findById,
// findByIntegratorId) and AgentEventRepository.ts (getAnalytics row scan, getAudit)
// (commit bb6bb1226e92). Tables: agents.agents + agents.agent_profiles, agents.agent_credentials,
// agents.agent_events. Nothing here writes.
// Behaviour changes: storage errors throw DataSourceUnavailableError instead of returning empty
// results. Wallet and Turnkey references are null until the wallets schema exists.

import {
  DataSourceUnavailableError,
  type AgentEvent,
  type AgentEventLog,
  type AgentRegistry,
  type RegisteredAgent,
} from "@pickler/core";
import type { SupabaseAdmin } from "../supabase-admin-client.js";

interface AgentRow {
  id: string;
  workspace_id: string;
  name: string;
  status: RegisteredAgent["status"];
  chain_id: number | null;
  killed_at: string | null;
  created_at: string;
  updated_at: string;
  agent_profiles: { blurb: string } | null;
}

interface EventRow {
  id: string;
  agent_id: string | null;
  workspace_id: string;
  event_type: string;
  payload: Record<string, unknown> | null;
  created_at: string;
}

// Explicit columns: credentials are never selected on the read path.
const AGENT_COLUMNS =
  "id, workspace_id, name, status, chain_id, killed_at, created_at, updated_at, agent_profiles(blurb)";
const EVENT_COLUMNS = "id, agent_id, workspace_id, event_type, payload, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const toAgent = (row: AgentRow): RegisteredAgent => ({
  id: row.id,
  workspaceId: row.workspace_id,
  name: row.name,
  description: row.agent_profiles?.blurb || null,
  status: row.status,
  walletId: null,
  walletAddress: null,
  chainId: row.chain_id,
  thresholdUsd: "0",
  killedAt: row.killed_at ? new Date(row.killed_at) : null,
  turnkeyUserId: null,
  turnkeyAgentUserId: null,
  turnkeyPolicyId: null,
  activePolicyId: null,
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
});

const toEvent = (row: EventRow): AgentEvent => ({
  id: row.id,
  agentId: row.agent_id,
  workspaceId: row.workspace_id,
  eventType: row.event_type,
  skillId: null,
  payload: row.payload,
  createdAt: new Date(row.created_at),
});

function fail(source: string, error: { message: string }): never {
  throw new DataSourceUnavailableError(`supabase.agents.${source}`, {
    cause: new Error(error.message),
  });
}

export function createSupabaseAgentRegistry(db: SupabaseAdmin): AgentRegistry {
  const agents = () => db.schema("agents").from("agents");
  return {
    async findById(id) {
      if (!UUID.test(id)) {
        return null;
      }
      const { data, error } = await agents()
        .select(AGENT_COLUMNS)
        .eq("id", id)
        .maybeSingle<AgentRow>();
      if (error) {
        fail("agents.findById", error);
      }
      return data && toAgent(data);
    },
    async listByWorkspace(workspaceId) {
      const { data, error } = await agents()
        .select(AGENT_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .returns<AgentRow[]>();
      if (error) {
        fail("agents.listByWorkspace", error);
      }
      return (data ?? []).map(toAgent);
    },
    async findCredentials(id) {
      if (!UUID.test(id)) {
        return null;
      }
      const { data, error } = await agents()
        .select("id, workspace_id, status, agent_credentials(encrypted_hmac_secret)")
        .eq("id", id)
        .maybeSingle<{
          id: string;
          workspace_id: string;
          status: string;
          agent_credentials: { encrypted_hmac_secret: string } | null;
        }>();
      if (error) {
        fail("agents.findCredentials", error);
      }
      return (
        data && {
          id: data.id,
          workspaceId: data.workspace_id,
          walletId: null,
          status: data.status,
          encryptedAgentSecret: data.agent_credentials?.encrypted_hmac_secret ?? null,
        }
      );
    },
  };
}

/** Upper bound on rows scanned for analytics; Relayer scanned without a limit. */
export const ANALYTICS_ROW_LIMIT = 10_000;

export function createSupabaseAgentEventLog(db: SupabaseAdmin): AgentEventLog {
  const events = () => db.schema("agents").from("agent_events");
  return {
    async listSince(agentId, since) {
      const { data, error } = await events()
        .select(EVENT_COLUMNS)
        .eq("agent_id", agentId)
        .gte("created_at", since.toISOString())
        .order("created_at", { ascending: false })
        .limit(ANALYTICS_ROW_LIMIT)
        .returns<EventRow[]>();
      if (error) {
        fail("agent_events.listSince", error);
      }
      return (data ?? []).map(toEvent);
    },
    async audit(agentId, query) {
      let request = events().select(EVENT_COLUMNS, { count: "exact" }).eq("agent_id", agentId);
      if (query.eventTypes) {
        request = request.in("event_type", [...query.eventTypes]);
      }
      if (query.since) {
        request = request.gte("created_at", query.since.toISOString());
      }
      if (query.status) {
        request = request.eq("payload->>status", query.status);
      }
      const from = (query.page - 1) * query.limit;
      const { data, count, error } = await request
        .order("created_at", { ascending: false })
        .range(from, from + query.limit - 1)
        .returns<EventRow[]>();
      if (error) {
        fail("agent_events.audit", error);
      }
      return {
        events: (data ?? []).map(toEvent),
        total: count ?? 0,
        page: query.page,
        limit: query.limit,
      };
    },
  };
}
