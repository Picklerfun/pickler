import { PERPS_MANUAL_READY_SQL } from "./perps-hourly-readiness.js";
import type { Pool } from "pg";
import {
  PilotError,
  ACCENTS,
  type ExecutionReads,
  type ExecutionStatus,
  type RunSummary,
  type ExecutionEvent,
} from "@pickler/core";
const MAX_BYTES = 250 * 1024;
const kinds = {
  research: { runs: "runs", events: "events", foreign: "run_id", owner: "tenant_id", path: "runs" },
  preview: {
    runs: "preview_runs",
    events: "preview_events",
    foreign: "preview_run_id",
    owner: "user_id",
    path: "preview-runs",
  },
} as const;
function limit(value = 50, max = 100) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new PilotError("INVALID_INPUT", "Invalid page limit");
  }
  return value;
}
function eventCursor(value = "0") {
  if (!/^\d{1,19}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new PilotError("INVALID_INPUT", "Invalid event cursor");
  }
  return value;
}
export class PostgresExecutionReads implements ExecutionReads {
  constructor(readonly pool: Pool) {}
  async previewResult(
    actorId: string,
    id: string,
    now: number,
  ): Promise<import("@pickler/core").PreviewRun> {
    const result = await this.pool.query(
      `SELECT id,status,created_at::double precision AS "createdAt",started_at::double precision AS "startedAt",finished_at::double precision AS "finishedAt",expires_at::double precision AS "expiresAt",adopted_at IS NOT NULL AS adopted,decision,error
      FROM pickler.preview_runs WHERE id=$1 AND user_id=$2 AND expires_at>$3`,
      [id, actorId, now],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Preview not found");
    }
    return result.rows[0];
  }
  async studioIdentity(workspaceId: string, tenantId: string, productId: string) {
    const result = await this.pool.query(
      `SELECT a.id,a.name,a.handle,a.status='draft' AS draft,a.visibility::text AS visibility,
      a.published_at AS "publishedAt",xa.handle AS "xHandle",pr.accent,pr.avatar_pattern AS "avatarPattern",a.advice_price_micro_ausd::text AS price,p.runtime_agent_id AS "runtimeId"
      FROM agents.agents a JOIN pickler.product_agents p ON p.product_agent_id=a.id
      LEFT JOIN agents.agent_profiles pr ON pr.agent_id=a.id LEFT JOIN agents.x_accounts xa ON xa.agent_id=a.id
      WHERE p.workspace_id=$1 AND p.tenant_id=$2 AND a.id::text=$3`,
      [workspaceId, tenantId, productId],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    const pattern = Number(row.avatarPattern ?? 0);
    return {
      id: row.id as string,
      name: row.name as string,
      handle: row.handle as string,
      draft: row.draft === true,
      visibility: row.visibility as "public" | "private",
      publishedAt: (row.publishedAt as Date | null) ?? null,
      xHandle: (row.xHandle as string | null) ?? null,
      accent: ACCENTS.includes(row.accent) ? row.accent : "lime",
      avatarPattern: Number.isInteger(pattern) && pattern >= 0 && pattern <= 5 ? pattern : 0,
      advicePriceMicro: row.price === null ? null : BigInt(row.price as string),
      scope: { tenantId, agentId: row.runtimeId as string },
    };
  }
  async studioWallets(agentIds: string[]) {
    if (!agentIds.length) {
      return [];
    }
    return (
      await this.pool.query<{ agentId: string; walletId: string; address: string }>(
        `SELECT l.agent_id::text AS "agentId",l.wallet_id AS "walletId",a.address
      FROM wallets.agent_wallets l JOIN LATERAL (SELECT address FROM wallets.wallet_accounts WHERE wallet_id=l.wallet_id ORDER BY created_at,id LIMIT 1) a ON true
      WHERE l.agent_id=ANY($1::uuid[])`,
        [agentIds],
      )
    ).rows;
  }
  async studioRecords(tenantId: string, agentIds: string[]) {
    if (!agentIds.length) {
      return [];
    }
    const result = await this.pool.query(
      `SELECT r.tenant_id AS "tenantId",r.id,r.version,r.config,r.paused,r.schedule_enabled AS "scheduleEnabled",r.next_due::double precision AS "nextDueAt",
      EXISTS(SELECT 1 FROM pickler.metadata m WHERE m.value='true' AND m.key=CASE WHEN EXISTS(SELECT 1 FROM pickler.product_agents p WHERE p.tenant_id=r.tenant_id AND p.runtime_agent_id=r.id)
        THEN 'connections_checked:'||r.tenant_id||':'||r.id||':'||r.version ELSE 'connections_checked' END) AS checked,
      CASE WHEN jsonb_typeof(r.config->'perpl')='object' THEN ${PERPS_MANUAL_READY_SQL}
        ELSE EXISTS(SELECT 1 FROM pickler.runs run WHERE run.tenant_id=r.tenant_id AND run.agent_id=r.id AND run.config_version=r.version AND run.trigger='manual' AND run.status='completed') END AS succeeded
      FROM pickler.agents r WHERE r.tenant_id=$1 AND r.id=ANY($2::text[])`,
      [tenantId, agentIds],
    );
    return result.rows.map(({ checked, succeeded, ...agent }) => ({
      agent: agent as import("@pickler/core").AgentRecord,
      readiness: { connectionsChecked: checked === true, manualSucceeded: succeeded === true },
    }));
  }
  async summaries(
    tenantId: string,
    agentId: string,
    query: { limit?: number | undefined; cursor?: string | undefined },
  ) {
    const size = limit(query.limit ?? 20, 50);
    let cursor: { at: string; id: string } | null = null;
    if (query.cursor) {
      try {
        if (query.cursor.length > 512) {
          throw new Error("cursor");
        }
        const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
        if (
          parsed.v !== 1 ||
          parsed.tenant !== tenantId ||
          parsed.agent !== agentId ||
          !/^\d{1,16}$/.test(parsed.at) ||
          typeof parsed.id !== "string" ||
          parsed.id.length > 128
        ) {
          throw new Error("cursor");
        }
        cursor = parsed;
      } catch {
        throw new PilotError("INVALID_INPUT", "Invalid run cursor");
      }
    }
    const result = await this.pool.query<RunSummary & { cursorAt: string }>(
      `
      SELECT r.id,r.tenant_id AS "tenantId",r.agent_id AS "agentId",r.trigger,r.market_id AS "marketId",r.status,
        r.created_at::double precision AS "createdAt",r.created_at::text AS "cursorAt",r.started_at::double precision AS "startedAt",
        r.finished_at::double precision AS "finishedAt",r.config_version AS "configVersion",
        CASE WHEN r.error IS NULL THEN NULL WHEN r.error IN ('CONFIG_CHANGED','SCHEDULE_DISABLED','LEASE_EXPIRED') THEN r.error ELSE 'RUN_FAILED' END AS error,
        r.decision IS NOT NULL AS "resultAvailable",(SELECT max(e.id)::text FROM pickler.events e WHERE e.run_id=r.id) AS "lastEventId"
      FROM pickler.runs r WHERE r.tenant_id=$1 AND r.agent_id=$2 AND ($3::bigint IS NULL OR (r.created_at,r.id)<($3,$4::text))
      ORDER BY r.created_at DESC,r.id DESC LIMIT $5`,
      [tenantId, agentId, cursor?.at ?? null, cursor?.id ?? null, size + 1],
    );
    const items = result.rows.slice(0, size);
    const last = items.at(-1);
    return {
      items: items.map(({ cursorAt, ...row }) => {
        void cursorAt;
        return row;
      }),
      nextCursor:
        result.rows.length > size && last
          ? Buffer.from(
              JSON.stringify({
                v: 1,
                tenant: tenantId,
                agent: agentId,
                at: last.cursorAt,
                id: last.id,
              }),
            ).toString("base64url")
          : null,
    };
  }
  async status(
    kind: keyof typeof kinds,
    actorId: string,
    id: string,
    now: number,
  ): Promise<ExecutionStatus> {
    if (id.length > 128) {
      throw new PilotError("INVALID_INPUT", "Invalid run identity");
    }
    const k = kinds[kind];
    const preview = kind === "preview";
    const result = await this.pool.query<ExecutionStatus>(
      `
      SELECT r.id,r.tenant_id AS "tenantId",${preview ? "NULL::text" : "r.agent_id"} AS "agentId",${preview ? "'manual'::text" : "r.trigger"} AS trigger,
        ${preview ? "NULL::text" : "r.market_id"} AS "marketId",r.status,r.created_at::double precision AS "createdAt",
        r.started_at::double precision AS "startedAt",r.finished_at::double precision AS "finishedAt",${preview ? "1" : "r.config_version"} AS "configVersion",
        CASE WHEN r.error IS NULL THEN NULL WHEN r.error IN ('CONFIG_CHANGED','SCHEDULE_DISABLED','LEASE_EXPIRED') THEN r.error ELSE 'RUN_FAILED' END AS error,
        r.decision IS NOT NULL AS "resultAvailable",(SELECT max(e.id)::text FROM pickler.${k.events} e WHERE e.${k.foreign}=r.id) AS "lastEventId"
      FROM pickler.${k.runs} r WHERE r.id=$1 AND r.${k.owner}=$2 ${preview ? "AND r.expires_at>$3" : "AND $3::bigint IS NOT NULL"}`,
      [id, actorId, now],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Run not found");
    }
    return result.rows[0];
  }
  async events(
    kind: keyof typeof kinds,
    actorId: string,
    id: string,
    query: { limit?: number | undefined; after?: string | undefined },
    now: number,
  ) {
    await this.status(kind, actorId, id, now);
    const k = kinds[kind];
    const size = limit(query.limit);
    const after = eventCursor(query.after);
    const result = await this.pool.query<ExecutionEvent & { oversized: boolean }>(
      `
      WITH page AS MATERIALIZED (
        SELECT id,type,created_at,data,octet_length(convert_to(jsonb_build_object('id',id::text,'type',type,'createdAt',created_at,'data',data)::text,'UTF8'))+128 AS bytes
        FROM pickler.${k.events} WHERE ${k.foreign}=$1 AND id>$2::bigint ORDER BY id LIMIT $3
      ), sized AS (
        SELECT *,sum(CASE WHEN bytes>$4 THEN 512 ELSE bytes END) OVER(ORDER BY id) AS total FROM page
      )
      SELECT id::text,CASE WHEN bytes>$4 THEN 'oversized_event' ELSE type END AS type,created_at::double precision AS "createdAt",bytes>$4 AS oversized,
        CASE WHEN bytes<=$4 THEN data ELSE NULL END AS data
      FROM sized WHERE total<=$4 ORDER BY sized.id`,
      [id, after, size + 1, MAX_BYTES],
    );
    const rows = result.rows.slice(0, size);
    const last = rows.at(-1);
    const items: ExecutionEvent[] = rows.map((row) =>
      row.oversized
        ? {
            id: row.id,
            type: row.type,
            createdAt: row.createdAt,
            oversized: true,
            detailUrl: `/v1/studio/${k.path}/${encodeURIComponent(id)}/events/${row.id}`,
          }
        : { id: row.id, type: row.type, createdAt: row.createdAt, data: row.data },
    );
    const more = last
      ? !!(
          await this.pool.query(
            `SELECT 1 FROM pickler.${k.events} WHERE ${k.foreign}=$1 AND id>$2::bigint LIMIT 1`,
            [id, last.id],
          )
        ).rowCount
      : false;
    return { items, nextCursor: last?.id ?? null, hasMore: more };
  }
  async event(
    kind: keyof typeof kinds,
    actorId: string,
    id: string,
    eventId: string,
    now: number,
  ): Promise<ExecutionEvent> {
    await this.status(kind, actorId, id, now);
    const k = kinds[kind];
    eventCursor(eventId);
    const result = await this.pool.query(
      `SELECT id::text,type,data,created_at::double precision AS "createdAt" FROM pickler.${k.events} WHERE ${k.foreign}=$1 AND id=$2::bigint`,
      [id, eventId],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Event not found");
    }
    return result.rows[0];
  }
}
