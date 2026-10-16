import { createHash } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import { PilotError } from "@pickler/core";
import {
  BREAKOUT_FINANCIAL_ROLES,
  assertHourlyBreakoutConfig,
  canonicalBreakoutJson,
  type BreakoutFinancialRole,
  type HourlyBreakoutVariant,
  type PerpsStudyScope,
} from "@pickler/trading/evaluation";
import type {
  PerpsPaperAccount,
  PerpsPaperAttempt,
  PerpsPaperMovement,
  PerpsPaperPosition,
} from "@pickler/trading/perps";
import type { PerpsBreakoutStudyRecord } from "./perps-breakout-store.js";

export type PerpsBreakoutAuditPart =
  | { kind: "record"; value: PerpsBreakoutStudyRecord }
  | { kind: "account"; role: BreakoutFinancialRole; value: PerpsPaperAccount }
  | { kind: "position"; role: BreakoutFinancialRole; value: PerpsPaperPosition }
  | { kind: "attempt"; role: BreakoutFinancialRole; value: PerpsPaperAttempt }
  | { kind: "movement"; role: BreakoutFinancialRole; value: PerpsPaperMovement }
  | { kind: "event"; value: { key: string; at: number; kind: string; data: unknown } }
  | { kind: "round"; key: string; value: unknown };

export interface PerpsBreakoutAuditManifest {
  version: 3;
  protocol: "perps-breakout-canonical-segmented-v1";
  sha256: string;
  rows: number;
  positions: number;
  attempts: number;
  movements: number;
  events: number;
  rounds: number;
}

const variants: Record<BreakoutFinancialRole, HourlyBreakoutVariant> = {
  C: "hourly-breakout",
  S: "sma-reference",
  L: "hourly-long",
};

/** One original database snapshot; page boundaries never participate in its canonical digest. */
export async function exportPerpsBreakoutAuditParts(
  pool: Pool,
  scope: PerpsStudyScope,
  emit: (part: PerpsBreakoutAuditPart) => Promise<void>,
  options: { pageSize?: number } = {},
): Promise<PerpsBreakoutAuditManifest> {
  const pageSize = options.pageSize ?? 32;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 256) {
    throw new PilotError("INVALID_INPUT", "Bounded audit page size required");
  }
  const digest = createHash("sha256");
  const manifest: PerpsBreakoutAuditManifest = {
    version: 3,
    protocol: "perps-breakout-canonical-segmented-v1",
    sha256: "",
    rows: 0,
    positions: 0,
    attempts: 0,
    movements: 0,
    events: 0,
    rounds: 0,
  };
  const output = async (part: PerpsBreakoutAuditPart) => {
    digest.update(canonicalBreakoutJson(part));
    digest.update("\n");
    await emit(part);
    manifest.rows++;
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await client.query<{ id: string; document: PerpsBreakoutStudyRecord }>(
      "SELECT id,document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
      [scope.tenantId, scope.sessionId, scope.network],
    );
    const study = result.rows[0];
    if (!study) {
      throw new PilotError("NOT_FOUND", "Scoped v10 study not found");
    }
    assertHourlyBreakoutConfig(study.document.config);
    if (!study.document.acceptance) {
      throw new PilotError("VERSIONED_EXPORT_REQUIRED", "Financial v10 study required");
    }
    await output({ kind: "record", value: study.document });
    for (const role of BREAKOUT_FINANCIAL_ROLES) {
      const account = await client.query<{ id: string; document: PerpsPaperAccount }>(
        `SELECT id,document FROM pickler.perps_paper_accounts
         WHERE tenant_id=$1 AND session_id=$2 AND network=$3 AND agent_id=$4`,
        [scope.tenantId, scope.sessionId, scope.network, study.document.agentIds[variants[role]]],
      );
      if (account.rows.length !== 1) {
        throw new PilotError(
          "ACCOUNT_PROJECTION_MISMATCH",
          "Exact scoped role account is required",
        );
      }
      const row = account.rows[0]!;
      await output({ kind: "account", role, value: row.document });
      await exportRows<PerpsPaperPosition>(client, "position", row.id, pageSize, async (value) => {
        await output({ kind: "position", role, value });
        manifest.positions++;
      });
      await exportRows<PerpsPaperAttempt>(client, "attempt", row.id, pageSize, async (value) => {
        await output({ kind: "attempt", role, value });
        manifest.attempts++;
      });
      await exportRows<PerpsPaperMovement>(client, "movement", row.id, pageSize, async (value) => {
        await output({ kind: "movement", role, value });
        manifest.movements++;
      });
    }
    let roundKey: string | null = null;
    for (;;) {
      const page: QueryResult<{ key: string; document: unknown }> = await client.query(
        `SELECT key,document FROM pickler.perps_study_rounds
         WHERE study_id=$1${roundKey === null ? "" : " AND key>$3"} ORDER BY key LIMIT $2`,
        roundKey === null ? [study.id, pageSize] : [study.id, pageSize, roundKey],
      );
      if (!page.rows.length) {
        break;
      }
      for (const row of page.rows) {
        await output({ kind: "round", key: row.key, value: row.document });
        manifest.rounds++;
        roundKey = row.key;
      }
    }
    let eventKey: string | null = null;
    for (;;) {
      const page: QueryResult<{ key: string; at: number; kind: string; data: unknown }> =
        await client.query(
          `SELECT key,at::double precision AS at,kind,data FROM pickler.perps_study_events
         WHERE study_id=$1${eventKey === null ? "" : " AND key>$3"} ORDER BY key LIMIT $2`,
          eventKey === null ? [study.id, pageSize] : [study.id, pageSize, eventKey],
        );
      if (!page.rows.length) {
        break;
      }
      for (const row of page.rows) {
        await output({ kind: "event", value: row });
        manifest.events++;
        eventKey = row.key;
      }
    }
    await client.query("COMMIT");
    manifest.sha256 = digest.digest("hex");
    return manifest;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function exportRows<T>(
  client: PoolClient,
  kind: "position" | "attempt" | "movement",
  accountId: string,
  pageSize: number,
  emit: (value: T) => Promise<void>,
) {
  const names = {
    position: ["perps_paper_positions", "id"],
    attempt: ["perps_paper_attempts", "key"],
    movement: ["perps_paper_movements", "key"],
  } as const;
  const [table, column] = names[kind];
  let cursor: string | null = null;
  for (;;) {
    const page: QueryResult<{ cursor: string; document: T }> = await client.query(
      `WITH page AS MATERIALIZED (
         SELECT ${column} FROM pickler.${table}
         WHERE account_id=$1${cursor === null ? "" : ` AND ${column}>$3`}
         ORDER BY ${column} LIMIT $2
       )
       SELECT source.${column} AS cursor,source.document FROM page
       JOIN pickler.${table} source ON source.account_id=$1 AND source.${column}=page.${column}
       ORDER BY page.${column}`,
      cursor === null ? [accountId, pageSize] : [accountId, pageSize, cursor],
    );
    if (!page.rows.length) {
      break;
    }
    for (const row of page.rows) {
      await emit(row.document);
      cursor = row.cursor;
    }
  }
}
