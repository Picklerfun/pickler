// Fila de Postgres → JSON de la API (spec §2.2). postgres.js entrega int8 y numeric como string y timestamptz como Date.
export type ReadRow = {
  id: string; address: string; agent_id: string; market_id: number; symbol: string; level_bps: number; horizon_min: number;
  price_decimals: number; mark_at_request: string | number; target: string | number; question: string; status: string;
  probability: string | number | null; reasons: unknown; limits: string | null; model: string | null; latency_ms: number | null;
  credits_charged: number; error: string | null; created_at: Date; expires_at: Date; resolved_at: Date | null;
  mark_at_resolution: string | number | null; outcome: boolean | null; brier: string | number | null;
};

export type ReadDto = {
  id: string; agentId: string; marketId: number; symbol: string; priceDecimals: number; levelBps: number; horizonMin: number;
  markAtRequest: number; target: number; question: string; status: string; probability: number | null; reasons: string[] | null;
  limits: string | null; creditsCharged: number; error: string | null; createdAt: string; expiresAt: string; resolvedAt: string | null;
  markAtResolution: number | null; outcome: boolean | null; brier: number | null;
};

const n = (v: string | number | null): number | null => (v === null ? null : Number(v));
const iso = (d: Date | null): string | null => (d === null ? null : new Date(d).toISOString());

export function toReadDto(r: ReadRow): ReadDto {
  return {
    id: r.id, agentId: r.agent_id, marketId: r.market_id, symbol: r.symbol, priceDecimals: r.price_decimals,
    levelBps: r.level_bps, horizonMin: r.horizon_min, markAtRequest: Number(r.mark_at_request), target: Number(r.target),
    question: r.question, status: r.status, probability: n(r.probability),
    reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : null, limits: r.limits, creditsCharged: r.credits_charged,
    error: r.error, createdAt: iso(r.created_at)!, expiresAt: iso(r.expires_at)!, resolvedAt: iso(r.resolved_at),
    markAtResolution: n(r.mark_at_resolution), outcome: r.outcome, brier: n(r.brier),
  };
}

export type ReminderRow = { id: string; kind: string; fire_at: Date };
export const toReminderDto = (r: ReminderRow) => ({ id: r.id, kind: r.kind, fireAt: new Date(r.fire_at).toISOString() });

export type AgentRow = { id: string; handle: string; name: string; owner: string; price_credits: number; reads: string | number; resolved: string | number; right_count: string | number; brier_avg: string | number | null };
export function toAgentDto(r: AgentRow) {
  return {
    id: r.id, handle: r.handle, name: r.name, owner: r.owner, priceCredits: r.price_credits,
    record: { reads: Number(r.reads), resolved: Number(r.resolved), right: Number(r.right_count), brierAvg: n(r.brier_avg) },
  };
}
