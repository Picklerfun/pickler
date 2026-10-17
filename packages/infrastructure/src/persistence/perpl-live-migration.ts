import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";

type Phase = "sessions" | "orders" | "setup" | "ready";
interface Progress {
  hash: string;
  revision: string;
  phase: Phase;
  offset: number;
  counts: { sessions: number; orders: number; setup: number };
}
const tables = {
  sessions: "perpl_live_sessions",
  orders: "perpl_live_orders",
  setup: "perpl_live_setup",
} as const;

/** Explicit operator conversion; all entity pages remain inside PostgreSQL. */
export class PerplLiveMigration {
  constructor(private readonly pool: Pool) {}
  private async transaction<T>(change: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('pickler.perpl_writer_version','2',true)");
      const result = await change(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async inspect(agent: string, client: Pool | PoolClient = this.pool) {
    const result = await client.query(
      `SELECT storage_mode,revision::text,normalization,
      CASE WHEN storage_mode='split' THEN jsonb_build_object(
        'sessions',(SELECT count(*) FROM pickler.perpl_live_sessions WHERE product_agent_id=$1),
        'orders',(SELECT count(*) FROM pickler.perpl_live_orders WHERE product_agent_id=$1),
        'setup',(SELECT count(*) FROM pickler.perpl_live_setup WHERE product_agent_id=$1))
      ELSE jsonb_build_object('sessions',jsonb_array_length(document->'sessions'),'orders',jsonb_array_length(document->'orders'),'setup',jsonb_array_length(document->'setup')) END AS counts,
      CASE WHEN storage_mode='split' THEN
        EXISTS(SELECT 1 FROM pickler.perpl_live_sessions WHERE product_agent_id=$1 AND (status IN ('active','paused','stopping','frozen') OR net_filled<>0))
        OR EXISTS(SELECT 1 FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND status IN ('prepared','dispatching','unknown','accepted'))
        OR EXISTS(SELECT 1 FROM pickler.perpl_live_setup WHERE product_agent_id=$1 AND status NOT IN ('confirmed','failed'))
        OR coalesce((operational#>>'{lease,expiresAt}')::bigint > (extract(epoch FROM clock_timestamp())*1000)::bigint,false)
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(operational#>'{snapshot,positions}','null'::jsonb),'[]'::jsonb)) x WHERE NOT (x->>'closed')::boolean)
      ELSE
      EXISTS(SELECT 1 FROM jsonb_array_elements(document->'sessions') x WHERE x->>'status' IN ('active','paused','stopping','frozen'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(document->'orders') x WHERE x->>'status' IN ('prepared','dispatching','unknown','accepted'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(document->'setup') x WHERE x->>'status' NOT IN ('confirmed','failed'))
      OR coalesce((document#>>'{lease,expiresAt}')::bigint > (extract(epoch FROM clock_timestamp())*1000)::bigint,false)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(nullif(document#>'{snapshot,positions}','null'::jsonb),'[]'::jsonb)) x WHERE NOT (x->>'closed')::boolean) END AS deferred
      FROM pickler.perpl_live_accounts WHERE product_agent_id=$1`,
      [agent],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Perpl account not found");
    }
    return result.rows[0];
  }
  async begin(agent: string) {
    return this.transaction(async (client) => {
      await client.query(
        "SELECT product_agent_id FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE",
        [agent],
      );
      const status = await this.inspect(agent, client);
      if (status.storage_mode === "split" || status.storage_mode === "converting") {
        return status;
      }
      if (status.deferred) {
        return { ...status, reason: "ACTIVE_OR_UNCERTAIN_WORK" };
      }
      const row = await client.query(
        `UPDATE pickler.perpl_live_accounts SET storage_mode='converting',writer_fence=2,
        normalization=jsonb_build_object('hash',md5(document::text),'revision',revision::text,'phase','sessions','offset',0,
          'counts',jsonb_build_object('sessions',jsonb_array_length(document->'sessions'),'orders',jsonb_array_length(document->'orders'),'setup',jsonb_array_length(document->'setup')))
        WHERE product_agent_id=$1 RETURNING normalization`,
        [agent],
      );
      return { storage_mode: "converting", normalization: row.rows[0].normalization };
    });
  }
  async page(agent: string) {
    return this.transaction(async (client) => {
      const row = await client.query<{
        normalization: Progress;
        revision: string;
        storage_mode: string;
      }>(
        "SELECT normalization,revision::text,storage_mode FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE",
        [agent],
      );
      const state = row.rows[0];
      if (!state || state.storage_mode !== "converting") {
        throw new PilotError("CONFLICT", "Account is not converting");
      }
      const p = state.normalization;
      if (p.revision !== state.revision) {
        throw new PilotError("CONFLICT", "Legacy revision changed");
      }
      if (p.phase === "ready") {
        return p;
      }
      const phase = p.phase;
      const fields =
        phase === "sessions"
          ? "request_key,status,created_at,margin_micros,document"
          : phase === "orders"
            ? "session_id,request_id,order_type,status,created_at,filled_size,leverage,document"
            : "request_key,kind,status,created_at,amount_micros,document";
      const values =
        phase === "sessions"
          ? "x->>'key',x->>'status',(x->>'createdAt')::bigint,x#>>'{settings,marginMicros}',x"
          : phase === "orders"
            ? "x->>'sessionId',(x#>>'{request,rq}')::bigint,(x#>>'{request,t}')::int,x->>'status',(x->>'createdAt')::bigint,coalesce((x#>>'{evidence,filledSize}')::bigint,0),(x#>>'{request,lv}')::int,x"
            : "x->>'key',x->>'kind',x->>'status',(x->>'createdAt')::bigint,x->>'amountMicros',x";
      const updates = fields
        .split(",")
        .map((field) => `${field}=excluded.${field}`)
        .join(",");
      await client.query(
        `INSERT INTO pickler.${tables[phase]}(product_agent_id,id,${fields})
        SELECT product_agent_id,x->>'id',${values} FROM pickler.perpl_live_accounts,
        LATERAL jsonb_path_query(document->$2::text,format('$[%s to %s]',$3::int,$3::int+99)::jsonpath) x
        WHERE product_agent_id=$1 ON CONFLICT(product_agent_id,id) DO UPDATE SET ${updates}`,
        [agent, phase, p.offset],
      );
      const offset = Math.min(p.counts[phase], p.offset + 100);
      const next: Progress = { ...p, offset };
      if (offset >= p.counts[phase]) {
        next.phase = phase === "sessions" ? "orders" : phase === "orders" ? "setup" : "ready";
        next.offset = 0;
      }
      await client.query(
        "UPDATE pickler.perpl_live_accounts SET normalization=$2 WHERE product_agent_id=$1",
        [agent, next],
      );
      return next;
    });
  }
  async cutover(agent: string) {
    return this.transaction(async (client) => {
      const row = await client.query<{
        normalization: Progress;
        revision: string;
        storage_mode: string;
      }>(
        "SELECT normalization,revision::text,storage_mode FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE",
        [agent],
      );
      const state = row.rows[0];
      if (state?.storage_mode === "split") {
        return { mode: "split" };
      }
      if (
        !state ||
        state.storage_mode !== "converting" ||
        state.normalization.phase !== "ready" ||
        state.normalization.revision !== state.revision
      ) {
        throw new PilotError("CONFLICT", "Conversion pages are incomplete");
      }
      const hash = await client.query(
        "SELECT md5(document::text) AS hash FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
        [agent],
      );
      if (hash.rows[0].hash !== state.normalization.hash) {
        throw new PilotError("CONFLICT", "Original history changed");
      }
      for (const phase of ["sessions", "orders", "setup"] as const) {
        const parity = await client.query(
          `SELECT
          (SELECT count(*) FROM pickler.${tables[phase]} WHERE product_agent_id=$1) AS n,
          (SELECT md5(coalesce(string_agg(md5(document::text),'' ORDER BY sequence),'')) FROM pickler.${tables[phase]} WHERE product_agent_id=$1) AS actual,
          (SELECT md5(coalesce(string_agg(md5(x::text),'' ORDER BY ord),'')) FROM pickler.perpl_live_accounts,
            LATERAL jsonb_array_elements(document->$2::text) WITH ORDINALITY e(x,ord) WHERE product_agent_id=$1) AS original`,
          [agent, phase],
        );
        const p = parity.rows[0];
        if (Number(p.n) !== state.normalization.counts[phase] || p.actual !== p.original) {
          throw new PilotError("PERPL_MIGRATION_PARITY", "Normalized evidence differs");
        }
      }
      const invalid = await client.query(
        `SELECT 1 FROM pickler.perpl_live_orders o LEFT JOIN pickler.perpl_live_sessions s ON s.product_agent_id=o.product_agent_id AND s.id=o.session_id
        JOIN pickler.perpl_live_accounts a ON a.product_agent_id=o.product_agent_id
        WHERE o.product_agent_id=$1 AND (s.id IS NULL OR o.request_id>(a.document->>'nextRequestId')::bigint) LIMIT 1`,
        [agent],
      );
      if (invalid.rowCount) {
        throw new PilotError("PERPL_MIGRATION_PARITY", "Order provenance differs");
      }
      await client.query(
        `UPDATE pickler.perpl_live_sessions s SET order_count=p.n,net_filled=p.net,opening_request_id=coalesce(p.opening,0),
          opening_leverage=(SELECT leverage FROM pickler.perpl_live_orders o WHERE o.product_agent_id=s.product_agent_id AND o.request_id=p.opening)
        FROM (SELECT session_id,count(*) AS n,sum(CASE WHEN order_type<=2 THEN filled_size ELSE -filled_size END) AS net,
          max(request_id) FILTER (WHERE order_type<=2 AND filled_size>0) AS opening
          FROM pickler.perpl_live_orders WHERE product_agent_id=$1 GROUP BY session_id) p
        WHERE s.product_agent_id=$1 AND s.id=p.session_id`,
        [agent],
      );
      await client.query(
        `UPDATE pickler.perpl_live_accounts SET operational=CASE WHEN document->'snapshot' IS NOT NULL AND document->'snapshot'<>'null'::jsonb THEN jsonb_set(document-'sessions'-'orders'-'setup'-'facts','{snapshot,orders}','[]'::jsonb) ELSE document-'sessions'-'orders'-'setup'-'facts' END,storage_mode='split',
        revision=revision+1,next_due=NULL,updated_at=clock_timestamp() WHERE product_agent_id=$1`,
        [agent],
      );
      return { mode: "split", originalHash: state.normalization.hash };
    });
  }
  async abort(agent: string) {
    return this.transaction(async (client) => {
      await client.query(
        "UPDATE pickler.perpl_live_accounts SET storage_mode='legacy' WHERE product_agent_id=$1 AND storage_mode='converting'",
        [agent],
      );
    });
  }
  /** Reconstruct current normalized evidence, never restore the stale pre-cutover document. */
  async rollback(agent: string) {
    return this.transaction(async (client) => {
      const row = await client.query(
        "SELECT storage_mode,operational,(extract(epoch FROM clock_timestamp())*1000)::bigint::text AS now FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE",
        [agent],
      );
      if (row.rows[0]?.storage_mode !== "split") {
        throw new PilotError("CONFLICT", "Account is not split");
      }
      const active = await client.query(
        `SELECT 1 FROM pickler.perpl_live_sessions WHERE product_agent_id=$1 AND (status IN ('active','paused','stopping','frozen') OR net_filled<>0)
        UNION ALL SELECT 1 FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND status IN ('prepared','dispatching','unknown','accepted')
        UNION ALL SELECT 1 FROM pickler.perpl_live_setup WHERE product_agent_id=$1 AND status NOT IN ('confirmed','failed') LIMIT 1`,
        [agent],
      );
      const live = row.rows[0].operational;
      if (
        live?.lease?.expiresAt > Number(row.rows[0].now) ||
        live?.snapshot?.positions?.some((p: { closed: boolean }) => !p.closed)
      ) {
        throw new PilotError(
          "PERPL_SESSION_PENDING",
          "Rollback requires no active lease or positions",
        );
      }
      if (active.rowCount) {
        throw new PilotError("PERPL_SESSION_PENDING", "Rollback requires quiescent accounts");
      }
      const invalid = await client.query(
        `SELECT 1 FROM pickler.perpl_live_orders o
        LEFT JOIN pickler.perpl_live_sessions s ON s.product_agent_id=o.product_agent_id AND s.id=o.session_id
        JOIN pickler.perpl_live_accounts a ON a.product_agent_id=o.product_agent_id
        WHERE o.product_agent_id=$1 AND (s.id IS NULL OR o.request_id>(a.operational->>'nextRequestId')::bigint
          OR o.request_id<>(o.document#>>'{request,rq}')::bigint OR o.session_id<>o.document->>'sessionId'
          OR o.status<>o.document->>'status' OR o.filled_size<>coalesce((o.document#>>'{evidence,filledSize}')::bigint,0)) LIMIT 1`,
        [agent],
      );
      if (invalid.rowCount) {
        throw new PilotError("PERPL_MIGRATION_PARITY", "Current normalized provenance differs");
      }
      const projections = await client.query(
        `WITH totals AS (
        SELECT session_id,count(*) AS n,sum(CASE WHEN order_type<=2 THEN filled_size ELSE -filled_size END) AS net
        FROM pickler.perpl_live_orders WHERE product_agent_id=$1 GROUP BY session_id
      ) SELECT 1 FROM pickler.perpl_live_sessions s LEFT JOIN totals t ON t.session_id=s.id
      WHERE s.product_agent_id=$1 AND (s.order_count<>coalesce(t.n,0) OR s.net_filled<>coalesce(t.net,0)) LIMIT 1`,
        [agent],
      );
      if (projections.rowCount) {
        throw new PilotError("PERPL_MIGRATION_PARITY", "Current fill projection differs");
      }

      await client.query(
        `UPDATE pickler.perpl_live_accounts a SET document=operational||jsonb_build_object(
        'sessions',(SELECT coalesce(jsonb_agg(document ORDER BY sequence),'[]'::jsonb) FROM pickler.perpl_live_sessions WHERE product_agent_id=$1),
        'orders',(SELECT coalesce(jsonb_agg(document ORDER BY sequence),'[]'::jsonb) FROM pickler.perpl_live_orders WHERE product_agent_id=$1),
        'setup',(SELECT coalesce(jsonb_agg(document ORDER BY sequence),'[]'::jsonb) FROM pickler.perpl_live_setup WHERE product_agent_id=$1)),
        storage_mode='legacy',next_due=NULL,updated_at=clock_timestamp()
        WHERE product_agent_id=$1`,
        [agent],
      );
      return { mode: "legacy", writerFence: 2 };
    });
  }
}
