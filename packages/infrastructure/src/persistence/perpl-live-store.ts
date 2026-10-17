import type { Pool, PoolClient } from "pg";
import { PilotError, type AgentConfig } from "@pickler/core";
import {
  emptyPerplLiveDocument,
  perplLiveOperations,
  type PerplLiveOperationName,
  type PerplLiveOperationInput,
  type PerplLiveOperationResult,
  type PerplLiveAuthority,
  type PerplLiveDocument,
  type PerplLiveOrder,
  type PerplLiveSession,
  type PerplLiveSetup,
  type PerplLiveFacts,
  type PerplLiveRepository,
  type PerplLiveScope,
} from "@pickler/trading/perpl-live";

/** PostgreSQL JSONB reorders object keys; evidence equality must ignore that ordering. */
function sameJson(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) {
    return false;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameJson(a[key], b[key]))
  );
}

function micros(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 10000) {
    return "0";
  }
  const [whole, fraction = ""] = String(value).split(".");
  return (BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0").slice(0, 6))).toString();
}
export class PostgresPerplLiveStore implements PerplLiveRepository {
  private ready: boolean | undefined;
  constructor(private readonly pool: Pool) {}
  private async schemaReady(client: Pool | PoolClient) {
    if (this.ready === undefined) {
      this.ready = Boolean(
        (await client.query("SELECT to_regclass('pickler.perpl_live_orders') IS NOT NULL AS ready"))
          .rows[0].ready,
      );
    }
    return this.ready;
  }
  private async authority(
    client: Pool | PoolClient,
    scope: PerplLiveScope,
    locked: boolean,
  ): Promise<PerplLiveAuthority> {
    const result = await client.query<{
      tenantId: string;
      agentId: string;
      config: AgentConfig;
      configVersion: number;
      enabled: boolean;
      paused: boolean;
      killed: boolean;
      address: string;
      organizationId: string;
    }>(
      `SELECT p.tenant_id AS "tenantId",p.runtime_agent_id AS "agentId",r.config,r.version AS "configVersion",
      coalesce(a.enabled,false) AS enabled,r.paused,(g.killed_at IS NOT NULL) AS killed,
      c.address,w.sub_organization_id AS "organizationId"
      FROM identity.workspaces x
      JOIN pickler.product_agents p ON p.workspace_id=x.id
      JOIN agents.agents g ON g.id=p.product_agent_id
      JOIN pickler.agents r ON r.tenant_id=p.tenant_id AND r.id=p.runtime_agent_id
      JOIN wallets.agent_wallets l ON l.agent_id=g.id
      JOIN wallets.wallets w ON w.wallet_id=l.wallet_id AND w.user_id=x.owner_user_id AND w.kind='agent'
      JOIN wallets.wallet_accounts c ON c.wallet_id=w.wallet_id AND c.chain='monad'
      LEFT JOIN pickler.research_access a ON a.user_id=x.owner_user_id
      WHERE x.owner_user_id=$1 AND x.is_active AND p.product_agent_id=$2
      ORDER BY c.created_at LIMIT 1 ${locked ? "FOR NO KEY UPDATE OF x,p,g,r,w" : ""}`,
      [scope.userId, scope.productAgentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Perpl agent not found");
    }
    const selection = row.config.perpl;
    return {
      scope,
      tenantId: row.tenantId,
      agentId: row.agentId,
      address: row.address.toLowerCase(),
      organizationId: row.organizationId,
      configVersion: row.configVersion,
      enabled: row.enabled,
      paused: row.paused,
      killed: row.killed,
      network: selection?.network ?? "",
      markets: selection?.markets ?? [],
      perCallMicros: micros(row.config.spend?.perCallAusd),
      perDayMicros: micros(row.config.spend?.perDayAusd),
    };
  }
  private connectedAuthority(authority: PerplLiveAuthority, document: PerplLiveDocument | null) {
    if (!document) {
      return authority;
    }
    const external = document.connection?.kind === "key_wallet";
    if (
      document.version !== 1 ||
      document.productAgentId !== authority.scope.productAgentId ||
      !/^0x[a-f\d]{40}$/.test(document.address) ||
      (external
        ? document.connection!.custodyAddress !== authority.address
        : document.address !== authority.address)
    ) {
      throw new PilotError("PERPL_ACCOUNT_CHANGED", "Agent wallet identity changed");
    }
    return { ...authority, custodyAddress: authority.address, address: document.address };
  }
  async read(scope: PerplLiveScope) {
    const authority = await this.authority(this.pool, scope, false);
    const ready = await this.schemaReady(this.pool);
    const r = await this.pool.query<{
      document: PerplLiveDocument;
      storage_mode?: string;
      operational?: PerplLiveDocument;
    }>(
      `SELECT ${ready ? "CASE WHEN storage_mode='split' THEN NULL ELSE document END AS document,storage_mode,operational" : "document"}
      FROM pickler.perpl_live_accounts WHERE product_agent_id=$1`,
      [scope.productAgentId],
    );
    const row = r.rows[0];
    const document =
      row?.storage_mode === "split"
        ? await this.load(this.pool, scope.productAgentId, row.operational!, Date.now(), {}, true)
        : (row?.document ?? null);
    return { authority: this.connectedAuthority(authority, document), document };
  }
  private async change<K extends PerplLiveOperationName>(
    scope: PerplLiveScope,
    operation: K,
    input: PerplLiveOperationInput<K>,
  ): Promise<PerplLiveOperationResult<K>> {
    const apply = perplLiveOperations[operation] as (
      document: PerplLiveDocument,
      authority: PerplLiveAuthority,
      now: number,
      input: PerplLiveOperationInput<K>,
    ) => PerplLiveOperationResult<K>;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const ready = await this.schemaReady(client);
      if (ready) {
        await client.query("SELECT set_config('pickler.perpl_writer_version','2',true)");
      }
      const authority = await this.authority(client, scope, true);
      await client.query(
        `INSERT INTO pickler.perpl_live_accounts(product_agent_id,document${ready ? ",storage_mode,operational,writer_fence" : ""})
        VALUES($1,$2${ready ? ",'split',$2,2" : ""}) ON CONFLICT DO NOTHING`,
        [scope.productAgentId, emptyPerplLiveDocument(authority.address, scope.productAgentId)],
      );
      const row = await client.query<{
        document: PerplLiveDocument;
        now: string;
        storage_mode?: string;
        operational?: PerplLiveDocument;
      }>(
        `SELECT ${ready ? "CASE WHEN storage_mode='split' THEN NULL ELSE document END AS document,storage_mode,operational" : "document"},
        (extract(epoch FROM clock_timestamp())*1000)::bigint::text AS now
        FROM pickler.perpl_live_accounts WHERE product_agent_id=$1 FOR UPDATE`,
        [scope.productAgentId],
      );
      const state = row.rows[0]!;
      if (state.storage_mode === "converting") {
        throw new PilotError("PERPL_MIGRATION_BUSY", "Account conversion is in progress");
      }
      const now = Number(state.now);
      const document =
        state.storage_mode === "split"
          ? await this.load(client, scope.productAgentId, state.operational!, now, input)
          : state.document;
      const previous = structuredClone(document);
      const result = apply(document, this.connectedAuthority(authority, document), now, input);
      this.connectedAuthority(authority, document);
      const identityChanged =
        operation === "connectKey" ||
        document.address !== previous.address ||
        document.accountId !== previous.accountId ||
        !previous.encryptedToken;
      if (document.encryptedToken && document.accountId && identityChanged) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `perpl-account:10143:${document.address}:${document.accountId}`,
        ]);
        const used = await client.query(
          `SELECT 1 FROM pickler.perpl_live_accounts
           WHERE product_agent_id<>$1 AND ${ready ? "coalesce(operational,document)" : "document"}->>'address'=$2
           AND ${ready ? "coalesce(operational,document)" : "document"}->>'accountId'=$3 AND ${ready ? "coalesce(operational,document)" : "document"}->>'encryptedToken' IS NOT NULL LIMIT 1`,
          [scope.productAgentId, document.address, String(document.accountId)],
        );
        if (used.rowCount) {
          throw new PilotError(
            "PERPL_ACCOUNT_IN_USE",
            "This Perpl account is already connected to an agent",
          );
        }
      }
      if (result && typeof (result as { then?: unknown }).then === "function") {
        throw new Error("Perpl mutation callbacks must be synchronous");
      }
      if (state.storage_mode === "split") {
        await this.save(client, scope.productAgentId, previous, document, now, operation);
      } else {
        await client.query(
          "UPDATE pickler.perpl_live_accounts SET document=$2,updated_at=clock_timestamp() WHERE product_agent_id=$1",
          [scope.productAgentId, document],
        );
        if (ready) {
          await this.schedule(client, scope.productAgentId, previous, document, now, operation);
        }
      }
      await client.query("COMMIT");
      return structuredClone(result);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async load(
    client: Pool | PoolClient,
    agent: string,
    compact: PerplLiveDocument,
    now: number,
    rawInput: unknown,
    history = false,
  ): Promise<PerplLiveDocument> {
    const input = rawInput as {
      key?: string;
      id?: string;
      setupId?: string;
      snapshot?: PerplLiveDocument["snapshot"];
    };
    const sessions = await client.query<{
      document: PerplLiveSession;
      order_count: string;
      net_filled: string;
      opening_leverage: number | null;
      opening_request_id: string;
    }>(
      `SELECT document,order_count::text,net_filled::text,opening_leverage,opening_request_id::text FROM pickler.perpl_live_sessions
      WHERE product_agent_id=$1 AND (status IN ('active','paused','stopping','frozen')
        OR sequence=(SELECT max(sequence) FROM pickler.perpl_live_sessions WHERE product_agent_id=$1)
        OR request_key=$2) ORDER BY sequence LIMIT 4`,
      [agent, input.key ?? null],
    );
    if (
      sessions.rows.length > 3 ||
      sessions.rows.filter((r) =>
        ["active", "paused", "stopping", "frozen"].includes(r.document.status),
      ).length > 1
    ) {
      throw new PilotError("PERPL_STATE_BOUNDS", "Active session context exceeds bounds");
    }
    const latest = sessions.rows.at(-1);
    const sessionIds = sessions.rows.map((r) => r.document.id);
    const snapshot = input.snapshot ?? compact.snapshot;
    const requests = [...new Set((snapshot?.positions ?? []).map((p) => p.requestId))];
    const evidenceRequests = [
      ...new Set([...(input.snapshot?.orders ?? []).map((o) => o.requestId), ...requests]),
    ];
    if (requests.length > 4000 || evidenceRequests.length > 4000) {
      throw new PilotError("PERPL_STATE_BOUNDS", "Venue ownership context exceeds bounds");
    }
    const orders = await client.query<{ document: PerplLiveOrder; margin: string }>(
      `SELECT o.document,(SELECT margin_micros FROM pickler.perpl_live_sessions s WHERE s.product_agent_id=o.product_agent_id AND s.id=o.session_id) AS margin FROM pickler.perpl_live_orders o WHERE product_agent_id=$1 AND
       ( ${history ? "sequence IN (SELECT sequence FROM pickler.perpl_live_orders WHERE product_agent_id=$1 ORDER BY sequence DESC LIMIT 100) OR" : ""}
        status IN ('prepared','dispatching','unknown','accepted')
        OR sequence IN (SELECT last.sequence FROM unnest($2::text[]) wanted(id) CROSS JOIN LATERAL (SELECT sequence FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND session_id=wanted.id ORDER BY sequence DESC LIMIT 1) last)
        OR request_id=ANY($3::bigint[])) ORDER BY sequence LIMIT 4201`,
      [agent, sessionIds, evidenceRequests],
    );
    if (
      orders.rows.length > 4200 ||
      orders.rows.filter((r) =>
        ["prepared", "dispatching", "unknown", "accepted"].includes(r.document.status),
      ).length > 100
    ) {
      throw new PilotError("PERPL_STATE_BOUNDS", "Unresolved order context exceeds bounds");
    }
    const setup = await client.query<{ document: PerplLiveSetup }>(
      `SELECT document FROM pickler.perpl_live_setup WHERE product_agent_id=$1 AND (
        ${history ? "sequence IN (SELECT sequence FROM pickler.perpl_live_setup WHERE product_agent_id=$1 ORDER BY sequence DESC LIMIT 100) OR" : ""}
        status IN ('preparing','awaiting_signature','signing','unknown','submitted') OR request_key=$2 OR id=$3)
      ORDER BY sequence LIMIT 203`,
      [agent, input.key ?? null, input.setupId ?? input.id ?? null],
    );
    if (
      setup.rows.length > 202 ||
      setup.rows.filter((r) => !["confirmed", "failed"].includes(r.document.status)).length > 100
    ) {
      throw new PilotError("PERPL_STATE_BOUNDS", "Pending setup context exceeds bounds");
    }
    const day = Math.floor(now / 86400000) * 86400000;
    const totals = await client.query<{
      start: string;
      tick: string;
      funding: string;
      history: boolean;
    }>(
      `SELECT
       (SELECT coalesce(sum(s.margin_micros::numeric),0)::text FROM pickler.perpl_live_orders o JOIN pickler.perpl_live_sessions s ON s.product_agent_id=o.product_agent_id AND s.id=o.session_id
        WHERE o.product_agent_id=$1 AND o.created_at >= $2 AND o.created_at < $2::bigint+86400000 AND o.order_type<=2) AS start,
       (SELECT coalesce(sum(s.margin_micros::numeric),0)::text FROM pickler.perpl_live_orders o JOIN pickler.perpl_live_sessions s ON s.product_agent_id=o.product_agent_id AND s.id=o.session_id
        WHERE o.product_agent_id=$1 AND o.created_at >= $2 AND o.created_at < $2::bigint+86400000 AND o.order_type<=2 AND o.status<>'cancelled') AS tick,
       (SELECT coalesce(sum(amount_micros::numeric),0)::text FROM pickler.perpl_live_setup
        WHERE product_agent_id=$1 AND created_at >= $2 AND created_at < $2::bigint+86400000
          AND kind IN ('create_account','deposit') AND status<>'failed' AND id IS DISTINCT FROM $3) AS funding,
       EXISTS(SELECT 1 FROM pickler.perpl_live_sessions WHERE product_agent_id=$1)
         OR EXISTS(SELECT 1 FROM pickler.perpl_live_orders WHERE product_agent_id=$1)
         OR EXISTS(SELECT 1 FROM pickler.perpl_live_setup WHERE product_agent_id=$1) AS history`,
      [agent, day, input.setupId ?? null],
    );
    const filled = latest
      ? await client.query<{ request_id: string }>(
          `SELECT request_id::text FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND session_id=$2 AND request_id=ANY($3::bigint[]) AND filled_size>0`,
          [agent, latest.document.id, requests],
        )
      : { rows: [] };
    const t = totals.rows[0]!;
    const facts: PerplLiveFacts = {
      hasHistory: t.history,
      orderMargins: Object.fromEntries(orders.rows.map((r) => [r.document.id, r.margin])),
      fundingDayMicros: t.funding,
      entryDayMicros: t.start,
      noncancelledEntryDayMicros: t.tick,
      unresolvedOrders: orders.rows.some((r) =>
        ["prepared", "dispatching", "unknown", "accepted"].includes(r.document.status),
      ),
      pendingSetup: setup.rows.some((r) => !["confirmed", "failed"].includes(r.document.status)),
      session: latest
        ? {
            id: latest.document.id,
            orderCount: Number(latest.order_count),
            remaining: Number(latest.net_filled),
            openingLeverage: latest.opening_leverage,
            openingRequestId: Number(latest.opening_request_id),
            filledRequestIds: filled.rows.map((r) => Number(r.request_id)),
          }
        : null,
    };
    return {
      ...compact,
      sessions: sessions.rows.map((r) => r.document),
      orders: orders.rows.map((r) => r.document),
      setup: setup.rows.map((r) => r.document),
      facts,
    };
  }
  private async save(
    client: PoolClient,
    agent: string,
    previous: PerplLiveDocument,
    document: PerplLiveDocument,
    now: number,
    operation: PerplLiveOperationName,
  ) {
    for (const session of document.sessions) {
      const old = previous.sessions.find((s) => s.id === session.id);
      if (sameJson(old, session)) {
        continue;
      }
      const saved = await client.query(
        `INSERT INTO pickler.perpl_live_sessions(product_agent_id,id,request_key,status,created_at,margin_micros,document)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(product_agent_id,id) DO UPDATE SET status=excluded.status,document=excluded.document
        WHERE perpl_live_sessions.request_key=excluded.request_key AND perpl_live_sessions.margin_micros=excluded.margin_micros
          AND perpl_live_sessions.created_at=excluded.created_at
          AND perpl_live_sessions.document->'settings'=excluded.document->'settings'
          AND perpl_live_sessions.document->'configVersion'=excluded.document->'configVersion'`,
        [
          agent,
          session.id,
          session.key,
          session.status,
          session.createdAt,
          session.settings.marginMicros,
          session,
        ],
      );
      if (saved.rowCount !== 1) {
        throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Immutable session intent changed");
      }
    }
    for (const order of document.orders) {
      const old = previous.orders.find((o) => o.id === order.id);
      if (sameJson(old, order)) {
        continue;
      }
      if (old) {
        const requestChanged =
          Object.keys(old.request).length !== Object.keys(order.request).length ||
          Object.keys(old.request).some((name) => {
            const key = name as keyof typeof old.request;
            if (key === "lb" && old.status === "prepared" && order.status === "dispatching") {
              return false;
            }
            return old.request[key] !== order.request[key];
          });
        if (
          old.sessionId !== order.sessionId ||
          old.createdAt !== order.createdAt ||
          requestChanged ||
          !sameJson(old.market, order.market)
        ) {
          throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Immutable order intent changed");
        }
      }
      const saved = await client.query(
        `INSERT INTO pickler.perpl_live_orders(product_agent_id,id,session_id,request_id,order_type,status,created_at,filled_size,leverage,document)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(product_agent_id,id) DO UPDATE SET status=excluded.status,filled_size=excluded.filled_size,document=excluded.document
        WHERE perpl_live_orders.session_id=excluded.session_id AND perpl_live_orders.request_id=excluded.request_id
          AND perpl_live_orders.order_type=excluded.order_type AND perpl_live_orders.created_at=excluded.created_at
          AND perpl_live_orders.leverage=excluded.leverage
          AND ((perpl_live_orders.document->'request')-'lb')=((excluded.document->'request')-'lb')
          AND perpl_live_orders.document->'market'=excluded.document->'market'
          AND (perpl_live_orders.document#>'{request,lb}'=excluded.document#>'{request,lb}'
            OR (perpl_live_orders.status='prepared' AND excluded.status='dispatching'))`,
        [
          agent,
          order.id,
          order.sessionId,
          order.request.rq,
          order.request.t,
          order.status,
          order.createdAt,
          order.evidence?.filledSize ?? 0,
          order.request.lv,
          order,
        ],
      );
      if (saved.rowCount !== 1) {
        throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Immutable order intent changed");
      }
      const delta = (order.evidence?.filledSize ?? 0) - (old?.evidence?.filledSize ?? 0);
      await client.query(
        `UPDATE pickler.perpl_live_sessions SET order_count=order_count+$3,net_filled=net_filled+$4,
        opening_leverage=CASE WHEN $5::bigint>=opening_request_id AND $6 THEN $7 ELSE opening_leverage END,
        opening_request_id=CASE WHEN $6 THEN greatest(opening_request_id,$5::bigint) ELSE opening_request_id END
        WHERE product_agent_id=$1 AND id=$2`,
        [
          agent,
          order.sessionId,
          old ? 0 : 1,
          order.request.t <= 2 ? delta : -delta,
          order.request.rq,
          order.request.t <= 2 && (order.evidence?.filledSize ?? 0) > 0,
          order.request.lv,
        ],
      );
    }
    for (const setup of document.setup) {
      const old = previous.setup.find((s) => s.id === setup.id);
      if (sameJson(old, setup)) {
        continue;
      }
      if (
        old &&
        (old.key !== setup.key ||
          old.amountMicros !== setup.amountMicros ||
          old.createdAt !== setup.createdAt)
      ) {
        throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Immutable setup intent changed");
      }
      const saved = await client.query(
        `INSERT INTO pickler.perpl_live_setup(product_agent_id,id,request_key,kind,status,created_at,amount_micros,document)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(product_agent_id,id) DO UPDATE SET kind=excluded.kind,status=excluded.status,document=excluded.document
        WHERE perpl_live_setup.request_key=excluded.request_key AND perpl_live_setup.amount_micros=excluded.amount_micros
          AND perpl_live_setup.created_at=excluded.created_at`,
        [
          agent,
          setup.id,
          setup.key,
          setup.kind,
          setup.status,
          setup.createdAt,
          setup.amountMicros,
          setup,
        ],
      );
      if (saved.rowCount !== 1) {
        throw new PilotError("PERPL_EVIDENCE_MISMATCH", "Immutable setup intent changed");
      }
    }
    const {
      sessions: _sessions,
      orders: _orders,
      setup: _setup,
      facts: _facts,
      ...compact
    } = document;
    void _sessions;
    void _orders;
    void _setup;
    void _facts;
    if (compact.snapshot) {
      compact.snapshot = { ...compact.snapshot, orders: [] };
    }
    await client.query(
      "UPDATE pickler.perpl_live_accounts SET operational=$2 WHERE product_agent_id=$1",
      [agent, compact],
    );
    await this.schedule(client, agent, previous, document, now, operation);
  }
  private async schedule(
    client: PoolClient,
    agent: string,
    previous: PerplLiveDocument,
    document: PerplLiveDocument,
    now: number,
    operation: PerplLiveOperationName,
  ) {
    const active = document.sessions.some((s) => ["active", "stopping"].includes(s.status));
    const pending =
      active ||
      document.sessions.some((s) => ["paused", "frozen"].includes(s.status)) ||
      document.setup.some((s) => ["unknown", "submitted"].includes(s.status));
    const immediate = ["startSession", "controlSession", "completeSetup", "rejectSetup"].includes(
      operation,
    );
    const next = pending ? now + (immediate ? 0 : active ? 15000 : 60000) : null;
    const handoff =
      (operation !== "releaseLease" || (previous.lease !== null && document.lease === null)) &&
      [
        "startSession",
        "controlSession",
        "completeSetup",
        "rejectSetup",
        "releaseLease",
        "completeReconciliation",
      ].includes(operation);
    await client.query(
      `UPDATE pickler.perpl_live_accounts SET revision=revision+1,updated_at=clock_timestamp(),
      next_due=CASE WHEN $3 THEN $2 ELSE next_due END,
      wake_generation=wake_generation+CASE WHEN $3 AND $2::bigint IS NOT NULL THEN 1 ELSE 0 END,
      wake_owner=CASE WHEN $3 THEN NULL ELSE wake_owner END,wake_expires_at=CASE WHEN $3 THEN NULL ELSE wake_expires_at END
      WHERE product_agent_id=$1`,
      [agent, next, handoff],
    );
  }
  async verifiedTransactions(scope: PerplLiveScope, requestIds: number[]) {
    await this.authority(this.pool, scope, false);
    if (requestIds.length > 4000 || requestIds.some((r) => !Number.isSafeInteger(r) || r < 0)) {
      throw new PilotError("INVALID_INPUT", "Verification lookup exceeds bounds");
    }
    const ready = await this.schemaReady(this.pool);
    const mode = ready
      ? (
          await this.pool.query(
            "SELECT storage_mode FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
            [scope.productAgentId],
          )
        ).rows[0]?.storage_mode
      : "legacy";
    if (mode !== "split") {
      const { document } = await this.read(scope);
      return (document?.orders ?? [])
        .filter((order) => requestIds.includes(order.request.rq))
        .flatMap((order) => order.verifiedTxHashes);
    }
    const rows = await this.pool.query<{ hash: string }>(
      `SELECT hash FROM pickler.perpl_live_orders o,
      LATERAL jsonb_array_elements_text(o.document->'verifiedTxHashes') hashes(hash)
      WHERE o.product_agent_id=$1 AND request_id=ANY($2::bigint[])`,
      [scope.productAgentId, requestIds],
    );
    return [...new Set(rows.rows.map((r) => r.hash))];
  }
  async requestMembership(scope: PerplLiveScope, requestIds: number[]) {
    await this.authority(this.pool, scope, false);
    if (requestIds.length > 4000 || requestIds.some((r) => !Number.isSafeInteger(r) || r < 0)) {
      throw new PilotError("INVALID_INPUT", "Request membership batch exceeds bounds");
    }
    if (!(await this.schemaReady(this.pool))) {
      const { document } = await this.read(scope);
      return (document?.orders ?? [])
        .filter((o) => requestIds.includes(o.request.rq))
        .map((o) => ({ requestId: o.request.rq, orderType: o.request.t, sessionId: o.sessionId }));
    }
    const mode = await this.pool.query(
      "SELECT storage_mode FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
      [scope.productAgentId],
    );
    if (mode.rows[0]?.storage_mode !== "split") {
      const { document } = await this.read(scope);
      return (document?.orders ?? [])
        .filter((o) => requestIds.includes(o.request.rq))
        .map((o) => ({ requestId: o.request.rq, orderType: o.request.t, sessionId: o.sessionId }));
    }
    const r = await this.pool.query<{ requestId: string; orderType: number; sessionId: string }>(
      `SELECT request_id::text AS "requestId",order_type AS "orderType",session_id AS "sessionId"
      FROM pickler.perpl_live_orders WHERE product_agent_id=$1 AND request_id=ANY($2::bigint[])`,
      [scope.productAgentId, requestIds],
    );
    return r.rows.map((x) => ({ ...x, requestId: Number(x.requestId) }));
  }
  async history(scope: PerplLiveScope, kind: "orders" | "setup" | "sessions", before?: string) {
    await this.authority(this.pool, scope, false);
    if (before !== undefined && !/^[1-9]\d{0,18}$/.test(before)) {
      throw new PilotError("INVALID_INPUT", "Invalid Perpl history cursor");
    }
    const ready = await this.schemaReady(this.pool);
    const mode = ready
      ? (
          await this.pool.query(
            "SELECT storage_mode FROM pickler.perpl_live_accounts WHERE product_agent_id=$1",
            [scope.productAgentId],
          )
        ).rows[0]?.storage_mode
      : "legacy";
    if (mode !== "split") {
      const page = await this.pool.query<{
        document: PerplLiveOrder | PerplLiveSetup | PerplLiveSession;
        sequence: string;
      }>(
        `WITH items AS (
        SELECT document->$2::text AS items FROM pickler.perpl_live_accounts WHERE product_agent_id=$1
      ), bounds AS (
        SELECT items,least(jsonb_array_length(items),coalesce($3::bigint-1,jsonb_array_length(items)))::int-1 AS last FROM items
      ), sliced AS (
        SELECT x.document,(greatest(0,last-100)+x.ord)::text AS sequence FROM bounds,
        LATERAL jsonb_path_query(items,format('$[%s to %s]',greatest(0,last-100),greatest(0,last))::jsonpath) WITH ORDINALITY x(document,ord) WHERE last>=0
      ) SELECT document,sequence FROM sliced ORDER BY sequence::bigint DESC LIMIT 101`,
        [scope.productAgentId, kind, before ?? null],
      );
      return {
        items: page.rows.slice(0, 100).map((r) => r.document),
        nextCursor: page.rows.length > 100 ? page.rows[99]!.sequence : null,
      };
    }
    const table = {
      orders: "perpl_live_orders",
      setup: "perpl_live_setup",
      sessions: "perpl_live_sessions",
    }[kind];
    const r = await this.pool.query<{
      document: PerplLiveOrder | PerplLiveSetup | PerplLiveSession;
      sequence: string;
    }>(
      `SELECT document,h.sequence::text AS sequence FROM pickler.${table} h
      WHERE product_agent_id=$1 AND ($2::bigint IS NULL OR sequence<$2::bigint) ORDER BY h.sequence DESC LIMIT 101`,
      [scope.productAgentId, before ?? null],
    );
    return {
      items: r.rows.slice(0, 100).map((r) => r.document),
      nextCursor: r.rows.length > 100 ? r.rows[99]!.sequence : null,
    };
  }
  async reserveWakeups(owner: string) {
    if (!(await this.schemaReady(this.pool))) {
      return [];
    }
    const r = await this.pool.query<{
      userId: string;
      productAgentId: string;
      generation: string;
      dueAt: string;
    }>(
      `WITH candidates AS (
      SELECT product_agent_id FROM pickler.perpl_live_accounts WHERE storage_mode IN ('split','legacy') AND next_due IS NOT NULL
        AND EXISTS(SELECT 1 FROM pickler.product_agents p JOIN identity.workspaces w ON w.id=p.workspace_id WHERE p.product_agent_id=perpl_live_accounts.product_agent_id AND w.is_active)
        AND (wake_expires_at IS NULL OR wake_expires_at <= (extract(epoch FROM clock_timestamp())*1000)::bigint)
        AND (wake_generation>wake_published_generation OR next_due <= (extract(epoch FROM clock_timestamp())*1000)::bigint)
      ORDER BY next_due,product_agent_id LIMIT 10 FOR UPDATE SKIP LOCKED
    ), reserved AS (
      UPDATE pickler.perpl_live_accounts a SET wake_owner=$1,
        wake_expires_at=greatest(next_due,(extract(epoch FROM clock_timestamp())*1000)::bigint)+30000
      FROM candidates c WHERE a.product_agent_id=c.product_agent_id
      RETURNING a.product_agent_id,a.wake_generation,a.next_due
    ) SELECT w.owner_user_id AS "userId",r.product_agent_id AS "productAgentId",r.wake_generation::text AS generation,r.next_due::text AS "dueAt"
      FROM reserved r JOIN pickler.product_agents p ON p.product_agent_id=r.product_agent_id JOIN identity.workspaces w ON w.id=p.workspace_id WHERE w.is_active`,
      [owner],
    );
    return r.rows.map((r) => ({
      scope: { userId: r.userId, productAgentId: r.productAgentId },
      generation: Number(r.generation),
      dueAt: Number(r.dueAt),
    }));
  }
  async claimWakeup(scope: PerplLiveScope, owner: string, generation: number) {
    const result = await this.pool.query(
      `UPDATE pickler.perpl_live_accounts SET wake_owner=NULL,
      wake_expires_at=(extract(epoch FROM clock_timestamp())*1000)::bigint+60000
      WHERE product_agent_id=$1 AND storage_mode IN ('split','legacy') AND wake_owner=$2 AND wake_generation=$3
        AND next_due <= (extract(epoch FROM clock_timestamp())*1000)::bigint
        AND wake_expires_at > (extract(epoch FROM clock_timestamp())*1000)::bigint
      RETURNING product_agent_id`,
      [scope.productAgentId, owner, generation],
    );
    return result.rowCount === 1;
  }
  async acknowledgeWakeup(scope: PerplLiveScope, owner: string, generation: number) {
    await this.pool.query(
      `UPDATE pickler.perpl_live_accounts SET wake_published_generation=$3
      WHERE product_agent_id=$1 AND wake_owner=$2 AND wake_generation=$3`,
      [scope.productAgentId, owner, generation],
    );
  }

  inspectKeyChange(scope: PerplLiveScope, input: PerplLiveOperationInput<"inspectKeyChange">) {
    return this.change(scope, "inspectKeyChange", input);
  }
  connectKey(scope: PerplLiveScope, input: PerplLiveOperationInput<"connectKey">) {
    return this.change(scope, "connectKey", input);
  }
  reserveSetup(scope: PerplLiveScope, input: PerplLiveOperationInput<"reserveSetup">) {
    return this.change(scope, "reserveSetup", input);
  }
  completePreparation(
    scope: PerplLiveScope,
    input: PerplLiveOperationInput<"completePreparation">,
  ) {
    return this.change(scope, "completePreparation", input);
  }
  failPreparation(scope: PerplLiveScope, input: PerplLiveOperationInput<"failPreparation">) {
    return this.change(scope, "failPreparation", input);
  }
  claimSetup(scope: PerplLiveScope, input: PerplLiveOperationInput<"claimSetup">) {
    return this.change(scope, "claimSetup", input);
  }
  progressSetup(scope: PerplLiveScope, input: PerplLiveOperationInput<"progressSetup">) {
    return this.change(scope, "progressSetup", input);
  }
  completeSetup(scope: PerplLiveScope, input: PerplLiveOperationInput<"completeSetup">) {
    return this.change(scope, "completeSetup", input);
  }
  rejectSetup(scope: PerplLiveScope, input: PerplLiveOperationInput<"rejectSetup">) {
    return this.change(scope, "rejectSetup", input);
  }
  startSession(scope: PerplLiveScope, input: PerplLiveOperationInput<"startSession">) {
    return this.change(scope, "startSession", input);
  }
  controlSession(scope: PerplLiveScope, input: PerplLiveOperationInput<"controlSession">) {
    return this.change(scope, "controlSession", input);
  }
  claimLease(scope: PerplLiveScope, input: PerplLiveOperationInput<"claimLease">) {
    return this.change(scope, "claimLease", input);
  }
  renewLease(scope: PerplLiveScope, input: PerplLiveOperationInput<"renewLease">) {
    return this.change(scope, "renewLease", input);
  }
  progressReconciliation(
    scope: PerplLiveScope,
    input: PerplLiveOperationInput<"progressReconciliation">,
  ) {
    return this.change(scope, "progressReconciliation", input);
  }
  completeReconciliation(
    scope: PerplLiveScope,
    input: PerplLiveOperationInput<"completeReconciliation">,
  ) {
    return this.change(scope, "completeReconciliation", input);
  }
  reserveOrder(scope: PerplLiveScope, input: PerplLiveOperationInput<"reserveOrder">) {
    return this.change(scope, "reserveOrder", input);
  }
  beginDispatch(scope: PerplLiveScope, input: PerplLiveOperationInput<"beginDispatch">) {
    return this.change(scope, "beginDispatch", input);
  }
  completeDispatch(scope: PerplLiveScope, input: PerplLiveOperationInput<"completeDispatch">) {
    return this.change(scope, "completeDispatch", input);
  }
  failTick(scope: PerplLiveScope, input: PerplLiveOperationInput<"failTick">) {
    return this.change(scope, "failTick", input);
  }
  releaseLease(scope: PerplLiveScope, input: PerplLiveOperationInput<"releaseLease">) {
    return this.change(scope, "releaseLease", input);
  }
  async due(limit: number) {
    const ready = await this.schemaReady(this.pool);
    const legacy = `(EXISTS(SELECT 1 FROM jsonb_array_elements(a.document->'sessions') s WHERE s->>'status' IN ('active','paused','stopping','frozen'))
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(a.document->'setup') s WHERE s->>'status' IN ('unknown','submitted')))`;
    const candidates = ready
      ? `(
      (SELECT a.product_agent_id,a.next_due AS due FROM pickler.perpl_live_accounts a WHERE EXISTS(SELECT 1 FROM pickler.product_agents p JOIN identity.workspaces w ON w.id=p.workspace_id WHERE p.product_agent_id=a.product_agent_id AND w.is_active) AND storage_mode='split' AND next_due <= (extract(epoch FROM clock_timestamp())*1000)::bigint ORDER BY next_due,product_agent_id LIMIT 10)
      UNION ALL
      (SELECT a.product_agent_id,coalesce(a.next_due,0) AS due FROM pickler.perpl_live_accounts a WHERE storage_mode='legacy'
        AND EXISTS(SELECT 1 FROM pickler.product_agents p JOIN identity.workspaces w ON w.id=p.workspace_id WHERE p.product_agent_id=a.product_agent_id AND w.is_active)
        AND (next_due IS NULL OR next_due <= (extract(epoch FROM clock_timestamp())*1000)::bigint) AND ${legacy}
        ORDER BY a.updated_at,a.product_agent_id LIMIT 10)
    )`
      : `(SELECT a.product_agent_id,0::bigint AS due FROM pickler.perpl_live_accounts a WHERE EXISTS(SELECT 1 FROM pickler.product_agents p JOIN identity.workspaces w ON w.id=p.workspace_id WHERE p.product_agent_id=a.product_agent_id AND w.is_active) AND ${legacy} ORDER BY a.updated_at,a.product_agent_id LIMIT 10)`;
    const r = await this.pool.query<PerplLiveScope>(
      `WITH candidates AS ${candidates}
      SELECT w.owner_user_id AS "userId",c.product_agent_id AS "productAgentId" FROM candidates c
      JOIN pickler.product_agents p ON p.product_agent_id=c.product_agent_id
      JOIN identity.workspaces w ON w.id=p.workspace_id WHERE w.is_active ORDER BY c.due,c.product_agent_id LIMIT $1`,
      [Math.max(1, Math.min(limit, 10))],
    );
    return r.rows;
  }
}
