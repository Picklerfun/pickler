import type { Pool } from "pg";
import {
  ACCENTS,
  AGENT_ACTION_CALLS,
  AGENT_ACTION_OUTCOMES,
  type Accent,
  type AgentAction,
  type AgentActionCall,
  type AgentActionFeed,
  type AgentActionOutcome,
} from "@pickler/core";

interface Row {
  id: string;
  finishedAt: string | number;
  outcome: string;
  outcomeText: string | null;
  decision: {
    instrument?: unknown;
    action?: unknown;
    probability?: unknown;
    horizonHours?: unknown;
  } | null;
  name: string;
  handle: string;
  accent: string | null;
  ticker: string | null;
}

const isOutcome = (value: string): value is AgentActionOutcome =>
  (AGENT_ACTION_OUTCOMES as readonly string[]).includes(value);
const isCall = (value: unknown): value is AgentActionCall =>
  typeof value === "string" && (AGENT_ACTION_CALLS as readonly string[]).includes(value);
const isAccent = (value: string | null): value is Accent =>
  value !== null && (ACCENTS as readonly string[]).includes(value);
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * The marketplace's read of the Perpl paper runtime (perpl-paper-runtime-v1 R14): finished checks
 * of public, living agents, newest first. The rationale, the steps and the cost stay in the studio;
 * what leaves here is the call and the outcome. No catch: a failed read is a failure, never an
 * empty feed.
 */
export class PostgresAgentActionFeed implements AgentActionFeed {
  constructor(private readonly pool: Pool) {}

  async listRecent(limit: number): Promise<AgentAction[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT c.id,
              c.finished_at AS "finishedAt",
              c.outcome,
              c.outcome_text AS "outcomeText",
              c.decision,
              a.name,
              a.handle,
              p.accent,
              t.ticker
         FROM pickler.perps_checks c
         JOIN agents.agents a ON a.id = c.product_agent_id
         LEFT JOIN agents.agent_profiles p ON p.agent_id = a.id
         LEFT JOIN market.tokens t
           ON t.agent_id = a.id AND t.status IN ('pre_graduation', 'graduated')
        WHERE a.visibility = 'public'
          AND a.killed_at IS NULL
          AND c.finished_at IS NOT NULL
          AND c.outcome IN ('entered', 'exited', 'held', 'blocked', 'proposed')
        ORDER BY c.finished_at DESC
        LIMIT $1`,
      [limit],
    );
    const actions: AgentAction[] = [];
    for (const row of rows) {
      if (!isOutcome(row.outcome)) {
        continue;
      }
      const decision = row.decision ?? {};
      actions.push({
        id: row.id,
        at: new Date(Number(row.finishedAt)),
        agent: {
          name: row.name,
          handle: row.handle,
          ticker: row.ticker,
          accent: isAccent(row.accent) ? row.accent : "lime",
        },
        outcome: row.outcome,
        outcomeText: row.outcomeText,
        instrument: typeof decision.instrument === "string" ? decision.instrument : null,
        call: isCall(decision.action) ? decision.action : null,
        probability: number(decision.probability),
        horizonHours: number(decision.horizonHours),
      });
    }
    return actions;
  }
}
