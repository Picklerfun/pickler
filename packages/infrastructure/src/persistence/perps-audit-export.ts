import type { Pool, QueryResult } from "pg";
import { PilotError } from "@pickler/core";
import type { PerpsStudyScope, PerpsStudyView, PerpsStudyMap } from "@pickler/trading/evaluation";
import { perpsStrategies } from "@pickler/trading/evaluation";
import type { PerpsPaperView } from "@pickler/trading/perps";

export type PerpsAuditPart =
  | { kind: "record"; value: PerpsStudyView["record"] }
  | { kind: "round"; value: PerpsStudyView["rounds"][number] }
  | { kind: "event"; value: PerpsStudyView["events"][number] }
  | { kind: "account"; variant: string; value: PerpsPaperView };

/** Paged, consistent, read-only export. The sink may persist parts without retaining old evidence. */
export async function exportPerpsAuditParts(
  pool: Pool,
  scope: PerpsStudyScope,
  emit: (part: PerpsAuditPart) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const study = await client.query(
      `SELECT id, document FROM pickler.perps_studies
       WHERE tenant_id=$1 AND session_id=$2 AND network=$3`,
      [scope.tenantId, scope.sessionId, scope.network],
    );
    if (study.rows.length !== 1) {
      throw new PilotError("NOT_FOUND", "Scoped study not found");
    }
    const { id, document: record } = study.rows[0];
    await emit({ kind: "record", value: record });
    let roundKey: string | null = null;
    for (;;) {
      const page: QueryResult<{ key: string; document: PerpsStudyView["rounds"][number] }> =
        await client.query(
          `SELECT key,document FROM pickler.perps_study_rounds
         WHERE study_id=$1 AND ($2::text IS NULL OR key>$2)
         ORDER BY key LIMIT 1`,
          [id, roundKey],
        );
      if (!page.rows.length) {
        break;
      }
      const row = page.rows[0]!;
      await emit({ kind: "round", value: row.document });
      roundKey = row.key;
    }
    let eventAt: number | null = null;
    let eventKey: string | null = null;
    for (;;) {
      const page: QueryResult<PerpsStudyView["events"][number]> = await client.query(
        `SELECT key,at::double precision AS at,kind,data
         FROM pickler.perps_study_events
         WHERE study_id=$1 AND ($2::bigint IS NULL OR (at,key)>($2,$3))
         ORDER BY at,key LIMIT 16`,
        [id, eventAt, eventKey],
      );
      if (!page.rows.length) {
        break;
      }
      for (const row of page.rows) {
        await emit({ kind: "event", value: row });
        eventAt = row.at;
        eventKey = row.key;
      }
    }
    for (const strategy of perpsStrategies(record.config)) {
      const result = await client.query(
        `SELECT id,document FROM pickler.perps_paper_accounts
         WHERE tenant_id=$1 AND session_id=$2 AND network=$3 AND agent_id=$4`,
        [scope.tenantId, scope.sessionId, scope.network, record.agentIds[strategy]],
      );
      if (result.rows.length !== 1) {
        throw new PilotError("NOT_FOUND", "Scoped paper account not found");
      }
      const account = result.rows[0];
      const attempts = await client.query(
        "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 ORDER BY key",
        [account.id],
      );
      const movements = await client.query(
        "SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1 ORDER BY key",
        [account.id],
      );
      await emit({
        kind: "account",
        variant: strategy,
        value: {
          account: account.document,
          attempts: attempts.rows.map((r) => r.document),
          movements: movements.rows.map((r) => r.document),
        },
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Historical v1 projection. Unlike paper.view(), this never recovers expired attempts. */
export async function exportPerpsAudit(pool: Pool, scope: PerpsStudyScope) {
  let record: PerpsStudyView["record"] | undefined;
  const rounds: PerpsStudyView["rounds"] = [];
  const events: PerpsStudyView["events"] = [];
  const accounts = {} as PerpsStudyMap<PerpsPaperView>;
  await exportPerpsAuditParts(pool, scope, async (part) => {
    if (part.kind === "record") {
      record = part.value;
    } else if (part.kind === "round") {
      rounds.push(part.value);
    } else if (part.kind === "event") {
      events.push(part.value);
    } else {
      accounts[part.variant as keyof typeof accounts] = part.value;
    }
  });
  if (!record) {
    throw new PilotError("NOT_FOUND", "Scoped study not found");
  }
  return { study: { record, rounds, events }, accounts };
}
