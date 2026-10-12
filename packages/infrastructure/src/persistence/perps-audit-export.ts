import type { Pool, QueryResult } from "pg";
import { PilotError } from "@pickler/core";
import type { PerpsStudyScope, PerpsStudyView, PerpsStudyMap } from "@pickler/trading/evaluation";
import { perpsStrategies } from "@pickler/trading/evaluation";
import type { PerpsPaperView } from "@pickler/trading/perps";

/** Native JSONB fingerprint, distinct from the historical canonical audit payload digest. */
export interface PerpsAuditSourceRevision {
  version: 1;
  policy: "postgres-jsonb-sha256-v1";
  kind: "round" | "event";
  key: string;
  sha256: string;
}

export interface PerpsAuditCaptureStats {
  version: 1;
  policy: "full" | "postgres-jsonb-sha256-v1";
  roundsChecked: number;
  roundsFetched: number;
  roundsReused: number;
  eventsChecked: number;
  eventsFetched: number;
  eventsReused: number;
}

export type PerpsAuditPart =
  | { kind: "record"; value: PerpsStudyView["record"] }
  | {
      kind: "round";
      value: PerpsStudyView["rounds"][number];
      sourceRevision?: PerpsAuditSourceRevision;
    }
  | {
      kind: "event";
      value: PerpsStudyView["events"][number];
      sourceRevision?: PerpsAuditSourceRevision;
    }
  | { kind: "account"; variant: string; value: PerpsPaperView };

/** Paged, consistent, read-only export. Optional reuse checks every row in the same snapshot. */
export async function exportPerpsAuditParts(
  pool: Pool,
  scope: PerpsStudyScope,
  emit: (part: PerpsAuditPart) => Promise<void>,
  options: { reuse?: (revision: PerpsAuditSourceRevision) => Promise<boolean> } = {},
): Promise<PerpsAuditCaptureStats> {
  const stats: PerpsAuditCaptureStats = {
    version: 1,
    policy: options.reuse ? "postgres-jsonb-sha256-v1" : "full",
    roundsChecked: 0,
    roundsFetched: 0,
    roundsReused: 0,
    eventsChecked: 0,
    eventsFetched: 0,
    eventsReused: 0,
  };
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
      const page: QueryResult<{
        key: string;
        document?: PerpsStudyView["rounds"][number];
        sha256?: string;
      }> = await client.query(
        options.reuse
          ? `WITH page AS MATERIALIZED (
               SELECT key FROM pickler.perps_study_rounds
               WHERE study_id=$1 AND ($2::text IS NULL OR key>$2)
               ORDER BY key LIMIT 1
             )
             SELECT r.key,encode(sha256(convert_to(r.document::text,'UTF8')),'hex') AS sha256
             FROM page JOIN pickler.perps_study_rounds r ON r.study_id=$1 AND r.key=page.key
             ORDER BY r.key`
          : `SELECT key,document FROM pickler.perps_study_rounds
             WHERE study_id=$1 AND ($2::text IS NULL OR key>$2)
             ORDER BY key LIMIT 1`,
        [id, roundKey],
      );
      if (!page.rows.length) {
        break;
      }
      const row = page.rows[0]!;
      stats.roundsChecked++;
      const revision = row.sha256 ? sourceRevision("round", row.key, row.sha256) : undefined;
      if (revision && (await options.reuse!(revision))) {
        stats.roundsReused++;
      } else {
        const value =
          row.document ??
          (
            await client.query(
              "SELECT document FROM pickler.perps_study_rounds WHERE study_id=$1 AND key=$2",
              [id, row.key],
            )
          ).rows[0]?.document;
        if (!value) {
          throw new PilotError("AUDIT_SOURCE_INVALID", "Round absent from consistent snapshot");
        }
        await emit({ kind: "round", value, ...(revision ? { sourceRevision: revision } : {}) });
        stats.roundsFetched++;
      }
      roundKey = row.key;
    }

    let eventAt: number | null = null;
    let eventKey: string | null = null;
    for (;;) {
      const page: QueryResult<{
        key: string;
        at: number;
        kind?: string;
        data?: PerpsStudyView["events"][number]["data"];
        sha256?: string;
      }> = await client.query(
        options.reuse
          ? `WITH page AS MATERIALIZED (
               SELECT key FROM pickler.perps_study_events
               WHERE study_id=$1 AND ($2::bigint IS NULL OR (at,key)>($2,$3))
               ORDER BY at::double precision,key LIMIT 16
             )
             SELECT e.key,e.at::double precision AS at,
               encode(sha256(convert_to(jsonb_build_object(
                 'key',e.key,'at',e.at::double precision,'kind',e.kind,'data',e.data
               )::text,'UTF8')),'hex') AS sha256
             FROM page JOIN pickler.perps_study_events e ON e.study_id=$1 AND e.key=page.key
             ORDER BY at,e.key`
          : `SELECT key,at::double precision AS at,kind,data
             FROM pickler.perps_study_events
             WHERE study_id=$1 AND ($2::bigint IS NULL OR (at,key)>($2,$3))
             ORDER BY at,key LIMIT 16`,
        [id, eventAt, eventKey],
      );
      if (!page.rows.length) {
        break;
      }
      for (const row of page.rows) {
        stats.eventsChecked++;
        const revision = row.sha256 ? sourceRevision("event", row.key, row.sha256) : undefined;
        if (revision && (await options.reuse!(revision))) {
          stats.eventsReused++;
        } else {
          const value = revision
            ? (
                await client.query(
                  `SELECT key,at::double precision AS at,kind,data
               FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2`,
                  [id, row.key],
                )
              ).rows[0]
            : row;
          if (!value) {
            throw new PilotError("AUDIT_SOURCE_INVALID", "Event absent from consistent snapshot");
          }
          await emit({
            kind: "event",
            value: { key: value.key, at: value.at, kind: value.kind!, data: value.data! },
            ...(revision ? { sourceRevision: revision } : {}),
          });
          stats.eventsFetched++;
        }
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
    return stats;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function sourceRevision(
  kind: PerpsAuditSourceRevision["kind"],
  key: string,
  sha256: string,
): PerpsAuditSourceRevision {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new PilotError("AUDIT_SOURCE_INVALID", "Invalid native audit fingerprint");
  }
  return { version: 1, policy: "postgres-jsonb-sha256-v1", kind, key, sha256 };
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
