import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  PilotError,
  assertTradingAgent,
  assertTradingRun,
  assertLivePreview,
  moneyMicros,
  type Scope,
  type TradingRepository,
  type TradingAccount,
  type LiveOrder,
  type LivePreview,
  type Reconciliation,
  type AgentRecord,
  type RunRecord,
} from "@pickler/core";
const projection = `id, tenant_id AS "tenantId", agent_id AS "agentId", run_id AS "runId", origin, status,
 config_version AS "configVersion", preview, created_at::double precision AS "createdAt",
 expires_at::double precision AS "expiresAt", order_hash AS "orderHash", reason, fill`;
function mapped<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  ) as T;
}
export class PostgresTradingStore implements TradingRepository {
  private owners = new Map<string, string>();
  constructor(
    private pool: Pool,
    private clock?: () => number,
  ) {}
  private async time(c: PoolClient): Promise<number> {
    return this.clock
      ? this.clock()
      : (
          await c.query(
            "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
          )
        ).rows[0].now;
  }
  private async tx<T>(f: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const value = await f(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      if (typeof e === "object" && e && "code" in e && e.code === "23505") {
        throw new PilotError("CONFLICT", "Trading attempt already exists");
      }
      throw e;
    } finally {
      c.release();
    }
  }
  private async context(c: PoolClient, scope: Scope, lock = true): Promise<AgentRecord> {
    const r = await c.query(
      `SELECT * FROM pickler.agents WHERE tenant_id=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [scope.tenantId, scope.agentId],
    );
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return mapped<AgentRecord>(r.rows[0]);
  }
  agent(scope: Scope) {
    return this.tx((c) => this.context(c, scope, false));
  }
  async run(tenant: string, id: string): Promise<RunRecord> {
    const r = await this.pool.query("SELECT * FROM pickler.runs WHERE tenant_id=$1 AND id=$2", [
      tenant,
      id,
    ]);
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Run not found");
    }
    return mapped<RunRecord>(r.rows[0]);
  }
  async bind(scope: Scope, identity: { wallet: string; signer: string }): Promise<TradingAccount> {
    if (
      scope.tenantId !== "alpha" ||
      scope.agentId !== "pickle-alpha" ||
      !/^0x[0-9a-f]{40}$/i.test(identity.wallet) ||
      !/^0x[0-9a-f]{40}$/i.test(identity.signer)
    ) {
      throw new PilotError("INVALID_INPUT", "Requires the dedicated alpha wallet");
    }
    await this.tx(async (c) => {
      await this.context(c, scope);
      const current = await c.query(
        "SELECT wallet,signer FROM pickler.trading_accounts WHERE tenant_id=$1 AND agent_id=$2",
        [scope.tenantId, scope.agentId],
      );
      if (
        current.rows[0] &&
        (current.rows[0].wallet !== identity.wallet.toLowerCase() ||
          current.rows[0].signer !== identity.signer.toLowerCase())
      ) {
        throw new PilotError("TRADING_IDENTITY_CHANGED", "Rebinding cannot reset a pilot budget");
      }
      await c.query(
        `INSERT INTO pickler.trading_accounts (tenant_id,agent_id,wallet,signer,created_at)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT DO NOTHING`,
        [
          scope.tenantId,
          scope.agentId,
          identity.wallet.toLowerCase(),
          identity.signer.toLowerCase(),
          await this.time(c),
        ],
      );
    });
    return this.account(scope);
  }
  async account(scope: Scope): Promise<TradingAccount> {
    const r = await this.pool.query(
      `SELECT a.wallet,a.signer,
      coalesce(sum(o.budget_micros) FILTER (WHERE o.status IN ('queued','submitting','unknown')),0)::integer AS reserved,
      coalesce(sum(o.budget_micros) FILTER (WHERE o.status='settled'),0)::integer AS spent
      FROM pickler.trading_accounts a LEFT JOIN pickler.live_orders o ON o.tenant_id=a.tenant_id AND o.agent_id=a.agent_id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 GROUP BY a.wallet,a.signer`,
      [scope.tenantId, scope.agentId],
    );
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Trading account not bound");
    }
    return {
      ...scope,
      wallet: r.rows[0].wallet,
      signer: r.rows[0].signer,
      chainId: 137,
      budgetMicros: 10000000,
      reservedMicros: r.rows[0].reserved,
      spentMicros: r.rows[0].spent,
    };
  }
  private async authorized(c: PoolClient, order: LiveOrder, now: number) {
    const agent = await this.context(c, order);
    assertTradingAgent(agent);
    if (agent.version !== order.configVersion || now >= order.expiresAt) {
      throw new PilotError("CONFIG_CHANGED", "Order expired or configuration changed");
    }
    if (order.runId) {
      const row = await c.query("SELECT * FROM pickler.runs WHERE tenant_id=$1 AND id=$2", [
        order.tenantId,
        order.runId,
      ]);
      if (!row.rows[0]) {
        throw new PilotError("NOT_FOUND", "Research not found");
      }
      assertTradingRun(mapped<RunRecord>(row.rows[0]), agent, now);
    }
    return agent;
  }
  async prepare(
    scope: Scope,
    preview: LivePreview,
    key: string,
    runId?: string,
  ): Promise<LiveOrder> {
    if (!key || key.length > 128) {
      throw new PilotError("INVALID_INPUT", "Idempotency key required");
    }
    return this.tx(async (c) => {
      const agent = await this.context(c, scope);
      const existing = await c.query<LiveOrder>(
        `SELECT ${projection} FROM pickler.live_orders WHERE tenant_id=$1 AND request_key=$2`,
        [scope.tenantId, key],
      );
      if (existing.rows[0]) {
        const old = existing.rows[0];
        if (
          old.agentId !== scope.agentId ||
          old.runId !== (runId ?? null) ||
          ["marketId", "outcomeId", "limitPrice", "budget"].some(
            (k) => old.preview[k as keyof LivePreview] !== preview[k as keyof LivePreview],
          )
        ) {
          throw new PilotError("CONFLICT", "Idempotency key reused with different inputs");
        }
        return old;
      }
      const now = await this.time(c);
      assertLivePreview(preview, agent, now);
      if (runId) {
        const row = await c.query(
          "SELECT * FROM pickler.runs WHERE tenant_id=$1 AND agent_id=$2 AND id=$3",
          [scope.tenantId, scope.agentId, runId],
        );
        if (!row.rows[0]) {
          throw new PilotError("NOT_FOUND", "Run not found");
        }
        const expected = assertTradingRun(mapped<RunRecord>(row.rows[0]), agent, now);
        if (Object.entries(expected).some(([k, v]) => preview[k as keyof LivePreview] !== v)) {
          throw new PilotError("INVALID_INPUT", "Order differs from approved research");
        }
        const manual = await c.query(
          `SELECT 1
        FROM pickler.live_orders
        WHERE tenant_id=$1 AND agent_id=$2 AND origin='manual' AND status='settled'`,
          [scope.tenantId, scope.agentId],
        );
        if (!manual.rows.length) {
          throw new PilotError("TRADING_MANUAL_REQUIRED", "Settle the manual pilot first");
        }
      }
      const r = await c.query<LiveOrder>(
        `INSERT INTO pickler.live_orders
        (id,tenant_id,agent_id,run_id,request_key,origin,status,market_id,config_version,preview,budget_micros,created_at,expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,'prepared',$7,$8,$9,$10,$11,$11::bigint+60000) RETURNING ${projection}`,
        [
          randomUUID(),
          scope.tenantId,
          scope.agentId,
          runId ?? null,
          key,
          runId ? "agent" : "manual",
          preview.marketId,
          agent.version,
          JSON.stringify(preview),
          moneyMicros(preview.budget),
          now,
        ],
      );
      return r.rows[0]!;
    });
  }
  async get(tenant: string, id: string): Promise<LiveOrder> {
    const r = await this.pool.query<LiveOrder>(
      `SELECT ${projection} FROM pickler.live_orders WHERE tenant_id=$1 AND id=$2`,
      [tenant, id],
    );
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Order not found");
    }
    return r.rows[0];
  }
  async list(scope: Scope) {
    return (
      await this.pool.query<LiveOrder>(
        `SELECT ${projection} FROM pickler.live_orders WHERE tenant_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 100`,
        [scope.tenantId, scope.agentId],
      )
    ).rows;
  }
  async enqueue(tenant: string, id: string, key: string): Promise<LiveOrder> {
    if (!key || key.length > 128) {
      throw new PilotError("INVALID_INPUT", "Idempotency key required");
    }
    const initial = await this.get(tenant, id);
    return this.tx(async (c) => {
      await this.context(c, initial);
      const row = (
        await c.query<LiveOrder & { submit_key: string | null }>(
          `SELECT ${projection},submit_key FROM pickler.live_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
          [tenant, id],
        )
      ).rows[0]!;
      if (row.status !== "prepared") {
        if (row.submit_key !== key) {
          throw new PilotError("CONFLICT", "Order was already submitted");
        }
        const { submit_key, ...publicOrder } = row;
        void submit_key;
        return publicOrder;
      }
      await this.authorized(c, row, await this.time(c));
      const used = (
        await c.query(
          `SELECT coalesce(sum(budget_micros),0)::integer AS used
        FROM pickler.live_orders
        WHERE tenant_id=$1 AND agent_id=$2 AND status IN ('queued','submitting','unknown','settled')`,
          [tenant, row.agentId],
        )
      ).rows[0].used;
      if (used + moneyMicros(row.preview.budget) > 10000000) {
        throw new PilotError("TRADING_BUDGET", "Pilot budget exhausted");
      }
      return (
        await c.query<LiveOrder>(
          `UPDATE pickler.live_orders SET status='queued',submit_key=$3 WHERE tenant_id=$1 AND id=$2 RETURNING ${projection}`,
          [tenant, id, key],
        )
      ).rows[0]!;
    });
  }
  async claim(): Promise<LiveOrder | null> {
    return this.tx(async (c) => {
      const now = await this.time(c);
      await c.query(
        `UPDATE pickler.live_orders
        SET status='expired',reason='EXPIRED'
        WHERE status IN ('prepared','queued') AND expires_at <= $1`,
        [now],
      );
      const row = (
        await c.query<LiveOrder>(
          `SELECT ${projection} FROM pickler.live_orders WHERE status='queued' AND lease_owner IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`,
        )
      ).rows[0];
      if (!row) {
        return null;
      }
      const owner = randomUUID();
      await c.query(
        "UPDATE pickler.live_orders SET lease_owner=$2,lease_expires_at=$3 WHERE id=$1",
        [row.id, owner, now + 60000],
      );
      this.owners.set(row.id, owner);
      return row;
    });
  }
  private async owned(c: PoolClient, order: LiveOrder, now: number) {
    const r = await c.query(
      `SELECT 1
        FROM pickler.live_orders
        WHERE id=$1 AND status='queued' AND lease_owner=$2 AND lease_expires_at>$3 FOR UPDATE`,
      [order.id, this.owners.get(order.id) ?? "", now],
    );
    if (!r.rows.length) {
      throw new PilotError("LEASE_LOST", "Trading lease unavailable");
    }
  }
  guard(order: LiveOrder) {
    return this.tx(async (c) => {
      const now = await this.time(c);
      await this.authorized(c, order, now);
      await this.owned(c, order, now);
    });
  }
  markSubmitting(order: LiveOrder, hash: string, preview = order.preview) {
    return this.tx(async (c) => {
      if (!/^0x[0-9a-f]{64}$/i.test(hash)) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Missing order identity");
      }
      const now = await this.time(c);
      const agent = await this.authorized(c, order, now);
      await this.owned(c, order, now);
      assertLivePreview(preview, agent, now);
      if (
        ["marketId", "outcomeId", "limitPrice", "budget"].some(
          (k) => preview[k as keyof LivePreview] !== order.preview[k as keyof LivePreview],
        )
      ) {
        throw new PilotError("INVALID_INPUT", "Refreshed order changed its authorized request");
      }
      await c.query(
        "UPDATE pickler.live_orders SET status='submitting',order_hash=$2,preview=$3 WHERE id=$1",
        [order.id, hash, JSON.stringify(preview)],
      );
    });
  }
  async failUnsent(order: LiveOrder, reason: string) {
    await this.tx(async (c) => {
      await this.context(c, order);
      await this.owned(c, order, await this.time(c));
      await c.query("UPDATE pickler.live_orders SET status='failed',reason=$2 WHERE id=$1", [
        order.id,
        reason,
      ]);
    });
    this.owners.delete(order.id);
  }
  async pending() {
    return (
      await this.pool.query<LiveOrder>(
        `SELECT ${projection} FROM pickler.live_orders WHERE status IN ('submitting','unknown') ORDER BY created_at LIMIT 20`,
      )
    ).rows;
  }
  async complete(order: LiveOrder, result: Reconciliation) {
    await this.tx(async (c) => {
      await this.context(c, order);
      if (
        result.status === "settled" &&
        (!result.fill.transactionHashes.length ||
          result.fill.transactionHashes.some((hash) => !/^0x[0-9a-f]{64}$/i.test(hash)) ||
          moneyMicros(result.fill.shares) <= 0 ||
          moneyMicros(result.fill.costUpperBound) > moneyMicros(order.preview.budget))
      ) {
        throw new PilotError("INVALID_PROVIDER_RESPONSE", "Unverified fill");
      }
      await c.query(
        `UPDATE pickler.live_orders
        SET status=$3,fill=$4,lease_owner=NULL,lease_expires_at=NULL
        WHERE id=$1 AND tenant_id=$2 AND order_hash=$5 AND status IN ('submitting','unknown')`,
        [
          order.id,
          order.tenantId,
          result.status,
          result.status === "settled" ? JSON.stringify(result.fill) : null,
          order.orderHash,
        ],
      );
    });
    this.owners.delete(order.id);
  }
  async automaticCandidates(): Promise<RunRecord[]> {
    return this.tx(async (c) => {
      const now = await this.time(c);
      const rows = await c.query(
        `SELECT r.* FROM pickler.runs r JOIN pickler.agents a ON a.tenant_id=r.tenant_id AND a.id=r.agent_id
        WHERE r.tenant_id='alpha' AND r.agent_id='pickle-alpha' AND r.status='completed' AND r.config_version=a.version
        AND a.config->'trading'->>'mode'='automatic' AND NOT a.paused AND r.decision->>'action'='TRADE'
        AND r.decision->'policyEvaluation'->>'finalAction'='TRADE'
        AND (r.decision->>'expiresAt')::timestamptz > to_timestamp($1::double precision / 1000)
        AND a.config->'plugins'->'enabled' ? 'polymarket-trading'
        AND a.config->'plugins'->'enabled' ? 'polymarket'
        AND NOT EXISTS (SELECT 1 FROM pickler.live_orders o WHERE o.run_id=r.id)
        AND EXISTS (SELECT 1 FROM pickler.live_orders o WHERE o.tenant_id=a.tenant_id AND o.agent_id=a.id AND o.origin='manual' AND o.status='settled')
        AND NOT EXISTS (SELECT 1 FROM pickler.live_orders o WHERE o.tenant_id=a.tenant_id AND o.agent_id=a.id AND o.origin='agent' AND o.status IN ('queued','submitting','unknown','settled'))
        ORDER BY r.created_at LIMIT 1`,
        [now],
      );
      return rows.rows.map((r) => mapped<RunRecord>(r));
    });
  }
}
