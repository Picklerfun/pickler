import { readRecordProjection } from "./paper-record-projection.js";
import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import {
  paperDecimal,
  paperUnits,
  utcDayStart,
  type PaperExecutionState,
  type PerpsPaperScope,
} from "@pickler/trading/perps";

type Database = Pool | PoolClient;
export const paperLedger = `SELECT m.account_id,m.key,m.document FROM pickler.perps_paper_movements m
UNION ALL SELECT p.account_id,p.key,p.document || jsonb_build_object('at',e.committed_at)
FROM pickler.paper_funding_postings p JOIN pickler.paper_funding_epochs e ON e.id=p.epoch_id
WHERE e.status='committed'`;
export const scopeValues = (scope: PerpsPaperScope) => [
  scope.tenantId,
  scope.agentId,
  scope.sessionId,
  scope.network,
];

/** This query never transfers closed positions, terminal attempts or ledger documents. */
export async function executionSnapshot(
  db: Database,
  scope: PerpsPaperScope,
  at: number,
): Promise<PaperExecutionState> {
  const found = await db.query(
    `SELECT jsonb_set(a.document - 'positions','{fundingPending}',to_jsonb(coalesce((a.document->>'fundingPending')::boolean,false) OR coalesce(s.coverage_required>s.coverage_complete,false))) || jsonb_build_object('positions',coalesce((
      SELECT jsonb_agg(p.document-'sizeUps' ORDER BY p.sequence) FROM pickler.perps_paper_positions p
      WHERE p.account_id=a.id AND p.closed_at IS NULL),'[]'::jsonb)) AS account,
      coalesce((SELECT jsonb_agg(t.document ORDER BY t.key) FROM pickler.perps_paper_attempts t
        WHERE t.account_id=a.id AND t.owner IS NOT NULL AND t.document->>'status'='pending' AND t.expires_at>$5),'[]'::jsonb) AS attempts,
      coalesce((SELECT d.realized FROM pickler.paper_daily_totals d WHERE d.account_id=a.id AND d.day=$6),'0')::text AS realized,
      coalesce((SELECT d.margin FROM pickler.paper_daily_totals d WHERE d.account_id=a.id AND d.day=$6),'0')::text AS margin
    FROM pickler.perps_paper_accounts a LEFT JOIN pickler.paper_storage s ON s.account_id=a.id
    WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4`,
    [...scopeValues(scope), at, utcDayStart(at)],
  );
  const row = found.rows[0];
  if (!row) {
    throw new PilotError("NOT_FOUND", "Paper account not found");
  }
  return {
    operational: true,
    account: row.account,
    attempts: row.attempts,
    movements: [],
    accounting: {
      realizedToday: paperDecimal(paperUnits(row.realized)),
      newMarginToday: paperDecimal(paperUnits(row.margin)),
    },
  };
}

export async function positionPnl(
  db: Database,
  accountId: string,
  positionId: string,
): Promise<string> {
  const result = await db.query(
    `WITH position AS (
      SELECT document FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2
    ), fee_keys AS (
      SELECT $2 || ':fee' AS key UNION ALL SELECT t.key || ':fee'
      FROM pickler.perps_paper_attempts t CROSS JOIN position p
      WHERE t.account_id=$1 AND t.document->>'status'='filled'
        AND t.document->>'reason'='size_up'
        AND t.document->'intent'->>'symbol'=p.document->>'symbol'
        AND (t.document->>'createdAt')::bigint >= (p.document->>'openedAt')::bigint
        AND (t.document->>'createdAt')::bigint <= (p.document->>'closedAt')::bigint
    ), deltas AS (
      SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1
        AND key>='close:'||$2||':' AND key<'close:'||$2||';'
      UNION ALL SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1
        AND key IN (SELECT key FROM fee_keys)
    ) SELECT coalesce(sum((document->>'delta')::numeric),0)::text AS pnl FROM deltas`,
    [accountId, positionId],
  );
  return paperDecimal(paperUnits(result.rows[0].pnl));
}

/** Hourly chart points are bounded independently of the number of closes. Historical folds
 * stay in PostgreSQL; no historical ledger/position document leaves this statement. */
export async function recordSnapshot(
  db: Database,
  scope: PerpsPaperScope,
  input: { now: number; openPnl: string | null },
) {
  const state = await executionSnapshot(db, scope, input.now);
  const account = (
    await db.query<{ id: string }>(
      "SELECT id FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4",
      scopeValues(scope),
    )
  ).rows[0]!;
  const stats = await readRecordProjection(db, account.id, input.now, input.openPnl);
  return {
    ...stats,
    realizedTodayAusd: Number(state.accounting.realizedToday),
    newMarginToday: state.accounting.newMarginToday,
  };
}
