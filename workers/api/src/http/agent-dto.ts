// Response shapes of Relayer's agent endpoints (snake_case entity without secrets,
// analytics and audit pages), so the dashboard and agent SDK parse them unchanged.

import type { AgentAnalytics, AgentEvent, AuditPage, RegisteredAgent } from "@pickler/core";
import type { LedgerSnapshot } from "../budget/agent-ledger";

export const agentDto = (agent: RegisteredAgent) => ({
  id: agent.id,
  integrator_id: agent.workspaceId,
  name: agent.name,
  description: agent.description,
  status: agent.status,
  turnkey_user_id: agent.turnkeyUserId,
  wallet_id: agent.walletId,
  wallet_address: agent.walletAddress,
  chain_id: agent.chainId,
  threshold_usd: agent.thresholdUsd,
  killed_at: agent.killedAt?.toISOString() ?? null,
  turnkey_agent_user_id: agent.turnkeyAgentUserId,
  turnkey_policy_id: agent.turnkeyPolicyId,
  active_policy_id: agent.activePolicyId,
  created_at: agent.createdAt.toISOString(),
  updated_at: agent.updatedAt?.toISOString() ?? null,
});

const eventDto = (event: AgentEvent) => ({
  id: event.id,
  agent_id: event.agentId,
  integrator_id: event.workspaceId,
  event_type: event.eventType,
  skill_id: event.skillId,
  payload: event.payload,
  created_at: event.createdAt.toISOString(),
});

export const analyticsDto = (analytics: AgentAnalytics) => ({
  total_events: analytics.totalEvents,
  total_spend: analytics.totalSpend,
  events_by_type: analytics.eventsByType,
  top_recipients: analytics.topRecipients,
  period: analytics.period,
  period_start: analytics.periodStart.toISOString(),
});

export const auditDto = (page: AuditPage) => ({
  events: page.events.map(eventDto),
  total: page.total,
  page: page.page,
  limit: page.limit,
});

/** Relayer's BudgetResponseDto (micro-USD strings) plus `reserved`, which Relayer did not track. */
export const budgetDto = (agentId: string, snapshot: LedgerSnapshot) => ({
  agent_id: agentId,
  categories: snapshot.categories.map((c) => ({
    category: c.category,
    limit: c.limit.toString(),
    spent: c.spent.toString(),
    reserved: c.reserved.toString(),
    remaining: c.remaining.toString(),
    usage_pct: c.usagePct,
    period_start: c.periodStart.toISOString(),
    period_end: c.periodEnd.toISOString(),
    status: c.status,
  })),
});
