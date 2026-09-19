// Ported from Relayer apps/api/src/kits/agent/repositories/{IAgentEventRepository,AgentEventRepository}.ts
// (commit bb6bb1226e92). The aggregation that Relayer ran inside the repository is pure
// domain logic here; repositories only fetch rows.

export interface AgentEvent {
  id: string;
  agentId: string | null;
  workspaceId: string;
  eventType: string;
  skillId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: Date;
}

export const ANALYTICS_PERIODS = { day: 1, week: 7, month: 30 } as const;
export type AnalyticsPeriod = keyof typeof ANALYTICS_PERIODS;

export interface AgentAnalytics {
  totalEvents: number;
  totalSpend: number;
  eventsByType: Record<string, number>;
  topRecipients: { recipient: string; total: number; count: number }[];
  period: AnalyticsPeriod;
  periodStart: Date;
}

/** Unknown or missing periods fall back to "month", as in Relayer. */
export const parseAnalyticsPeriod = (value: string | null | undefined): AnalyticsPeriod =>
  value === "day" || value === "week" || value === "month" ? value : "month";

export function periodStart(period: AnalyticsPeriod, now: Date): Date {
  const start = new Date(now);
  start.setDate(start.getDate() - ANALYTICS_PERIODS[period]);
  return start;
}

export function aggregateAnalytics(
  events: readonly AgentEvent[],
  period: AnalyticsPeriod,
  start: Date,
): AgentAnalytics {
  const eventsByType: Record<string, number> = {};
  const recipients = new Map<string, { total: number; count: number }>();
  let totalSpend = 0;

  for (const event of events) {
    eventsByType[event.eventType] = (eventsByType[event.eventType] ?? 0) + 1;
    const amount = event.payload?.["amount"];
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      continue;
    }
    totalSpend += amount;
    const recipient = event.payload?.["recipient"];
    if (typeof recipient === "string") {
      const entry = recipients.get(recipient) ?? { total: 0, count: 0 };
      entry.total += amount;
      entry.count += 1;
      recipients.set(recipient, entry);
    }
  }

  return {
    totalEvents: events.length,
    totalSpend,
    eventsByType,
    topRecipients: [...recipients.entries()]
      .map(([recipient, stats]) => ({ recipient, ...stats }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
    period,
    periodStart: start,
  };
}

export const AUDIT_EVENT_TYPES = {
  budget: ["budget_update", "budget_exceeded", "budget_reset"],
  lifecycle: ["agent_created", "agent_paused", "agent_resumed", "agent_killed"],
  credential: ["credential_rotation"],
  approval: ["approval_required", "approval_resolved"],
} as const satisfies Record<string, readonly string[]>;

const AUDIT_WINDOWS_DAYS = { "24h": 1, "7d": 7, "30d": 30 } as const;

export interface AuditQuery {
  page: number;
  limit: number;
  eventTypes: readonly string[] | null;
  since: Date | null;
  /** Matches `payload->>status`. */
  status: string | null;
}

export interface AuditPage {
  events: AgentEvent[];
  total: number;
  page: number;
  limit: number;
}

/** Relayer's parsing: page ≥ 1, limit 1–100 (default 20), unknown filters ignored. */
export function parseAuditQuery(
  raw: {
    page?: string | null;
    limit?: string | null;
    type?: string | null;
    period?: string | null;
    status?: string | null;
  },
  now: Date,
): AuditQuery {
  const page = Math.max(1, Number.parseInt(raw.page ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(raw.limit ?? "20", 10) || 20));
  const types =
    raw.type && raw.type in AUDIT_EVENT_TYPES
      ? AUDIT_EVENT_TYPES[raw.type as keyof typeof AUDIT_EVENT_TYPES]
      : null;
  const days =
    raw.period && raw.period in AUDIT_WINDOWS_DAYS
      ? AUDIT_WINDOWS_DAYS[raw.period as keyof typeof AUDIT_WINDOWS_DAYS]
      : null;
  return {
    page,
    limit,
    eventTypes: types,
    since: days === null ? null : new Date(now.getTime() - days * 86_400_000),
    status: raw.status === "success" || raw.status === "failed" ? raw.status : null,
  };
}
