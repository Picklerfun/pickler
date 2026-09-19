// Ported from Relayer apps/api/src/kits/agent/agent.controller.ts read handlers and
// agent.service.ts#findById/findByIntegratorId (commit bb6bb1226e92).
// Behaviour change: storage failures propagate (Relayer returned zeros or empty pages).

import { AgentNotFoundError, type RegisteredAgent } from "../domain/agent.js";
import {
  aggregateAnalytics,
  parseAnalyticsPeriod,
  parseAuditQuery,
  periodStart,
  type AgentAnalytics,
  type AuditPage,
} from "../domain/events.js";
import type { AgentEventLog, AgentRegistry } from "../ports/agent-registry.js";

export interface AgentQueryDependencies {
  agents: AgentRegistry;
  events: AgentEventLog;
  now(): Date;
}

export function createAgentQueries(deps: AgentQueryDependencies) {
  /** Tenant isolation: an agent outside the workspace is indistinguishable from a missing one. */
  async function requireAgent(workspaceId: string, agentId: string): Promise<RegisteredAgent> {
    const agent = await deps.agents.findById(agentId);
    if (!agent || agent.workspaceId !== workspaceId) {
      throw new AgentNotFoundError();
    }
    return agent;
  }

  return {
    listAgents: (workspaceId: string) => deps.agents.listByWorkspace(workspaceId),

    getAgent: requireAgent,

    async getStatus(workspaceId: string, agentId: string) {
      const agent = await requireAgent(workspaceId, agentId);
      return { agentId: agent.id, killSwitch: agent.status === "killed", status: agent.status };
    },

    async getAnalytics(
      workspaceId: string,
      agentId: string,
      rawPeriod: string | null,
    ): Promise<AgentAnalytics> {
      await requireAgent(workspaceId, agentId);
      const period = parseAnalyticsPeriod(rawPeriod);
      const start = periodStart(period, deps.now());
      return aggregateAnalytics(await deps.events.listSince(agentId, start), period, start);
    },

    async getAudit(
      workspaceId: string,
      agentId: string,
      raw: {
        page?: string | null;
        limit?: string | null;
        type?: string | null;
        period?: string | null;
        status?: string | null;
      },
    ): Promise<AuditPage> {
      await requireAgent(workspaceId, agentId);
      return deps.events.audit(agentId, parseAuditQuery(raw, deps.now()));
    },
  };
}
