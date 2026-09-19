import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  PilotError,
  assertPaperAllowed,
  assertPaperFillCurrent,
  type PaperRepository,
  type PaperOrder,
  type PaperFill,
  type AgentRecord,
  type RunRecord,
} from "@pickler/core";

const projection = `id, tenant_id AS "tenantId", agent_id AS "agentId", run_id AS "runId", market_id AS "marketId", outcome_id AS "outcomeId", status, '10' AS "virtualBudget", created_at::double precision AS "createdAt", finished_at::double precision AS "finishedAt", reason, fill`;
/** JSONB business documents stay unchanged; only database column names are mapped. */
function camelColumns<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      value,
    ]),
  ) as T;
}
export class PostgresPaperStore implements PaperRepository {
  private owners = new Map<string, string>();
  constructor(
    private readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}
  private async now(client: PoolClient): Promise<number> {
    if (this.clock) {
      return this.clock();
    }
    const result = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS now",
    );
    return result.rows[0]!.now;
  }
  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await action(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      if (typeof error === "object" && error && "code" in error && error.code === "23505") {
        throw new PilotError("CONFLICT", "Paper request or position already exists");
      }
      throw error;
    } finally {
      client.release();
    }
  }
  private async context(client: PoolClient, tenantId: string, runId: string) {
    const result = await client.query<{
      run: Record<string, unknown>;
      agent: Record<string, unknown>;
    }>(
      `SELECT to_jsonb(r) AS run, to_jsonb(a) AS agent FROM pickler.runs r JOIN pickler.agents a ON a.tenant_id = r.tenant_id AND a.id = r.agent_id WHERE r.tenant_id = $1 AND r.id = $2 FOR UPDATE OF a`,
      [tenantId, runId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Research not found");
    }
    return { run: camelColumns<RunRecord>(row.run), agent: camelColumns<AgentRecord>(row.agent) };
  }
  private async recover(client: PoolClient, tenantId: string, agentId: string, now: number) {
    await client.query(
      `UPDATE pickler.paper_orders SET status = 'interrupted', reason = 'INTERRUPTED', finished_at = $3, lease_owner = NULL, lease_expires_at = NULL WHERE tenant_id = $1 AND agent_id = $2 AND status = 'pending' AND lease_expires_at <= $3`,
      [tenantId, agentId, now],
    );
  }
  async begin(tenantId: string, runId: string, key: string) {
    if (!key || key.length > 128) {
      throw new PilotError("INVALID_INPUT", "Idempotency-Key is required (max 128 characters)");
    }
    return this.transaction(async (client) => {
      const context = await this.context(client, tenantId, runId);
      const now = await this.now(client);
      await this.recover(client, tenantId, context.run.agentId, now);
      const existing = await client.query<PaperOrder & { request_key: string }>(
        `SELECT ${projection}, request_key FROM pickler.paper_orders WHERE tenant_id = $1 AND run_id = $2`,
        [tenantId, runId],
      );
      if (existing.rows[0]) {
        const { request_key, ...order } = existing.rows[0];
        if (request_key !== key) {
          throw new PilotError("CONFLICT", "Only one paper attempt per research is allowed");
        }
        return { order, owned: false };
      }
      assertPaperAllowed(context.run, context.agent, now);
      const id = randomUUID();
      const owner = randomUUID();
      const decision = context.run.decision!;
      const result = await client.query<PaperOrder>(
        `INSERT INTO pickler.paper_orders (id, tenant_id, agent_id, run_id, market_id, outcome_id, request_key, config_version, status, created_at, snapshot, lease_owner, lease_expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10::jsonb,$11,$9::bigint+60000) RETURNING ${projection}`,
        [
          id,
          tenantId,
          context.run.agentId,
          runId,
          decision.marketId,
          decision.outcomeId,
          key,
          context.run.configVersion,
          now,
          JSON.stringify({
            config: context.run.config,
            decision,
            plugin: { id: "paper-trading", version: "1.0.0" },
          }),
          owner,
        ],
      );
      this.owners.set(id, owner);
      return { order: result.rows[0]!, owned: true };
    });
  }
  async get(tenantId: string, runId: string): Promise<PaperOrder> {
    return this.transaction(async (client) => {
      const context = await this.context(client, tenantId, runId);
      await this.recover(client, tenantId, context.run.agentId, await this.now(client));
      const result = await client.query<PaperOrder>(
        `SELECT ${projection} FROM pickler.paper_orders WHERE tenant_id = $1 AND run_id = $2`,
        [tenantId, runId],
      );
      if (!result.rows[0]) {
        throw new PilotError("NOT_FOUND", "Paper order not found");
      }
      return result.rows[0];
    });
  }
  private async owned(client: PoolClient, order: PaperOrder, now: number) {
    const result = await client.query(
      `SELECT id FROM pickler.paper_orders WHERE id = $1 AND tenant_id = $2 AND run_id = $3 AND status = 'pending' AND lease_owner = $4 AND lease_expires_at > $5 FOR UPDATE`,
      [order.id, order.tenantId, order.runId, this.owners.get(order.id) ?? "", now],
    );
    if (!result.rows.length) {
      throw new PilotError(
        "LEASE_LOST",
        "Paper reservation expired or belongs to another executor",
      );
    }
  }
  async guard(order: PaperOrder) {
    return this.transaction(async (client) => {
      const context = await this.context(client, order.tenantId, order.runId);
      const now = await this.now(client);
      await this.owned(client, order, now);
      assertPaperAllowed(context.run, context.agent, now);
      return context;
    });
  }
  async finish(
    order: PaperOrder,
    status: "filled" | "not_filled" | "failed",
    fill: PaperFill | null,
    reason: string | null,
  ) {
    const result = await this.transaction(async (client) => {
      const context = await this.context(client, order.tenantId, order.runId);
      const now = await this.now(client);
      await this.owned(client, order, now);
      if (status !== "failed") {
        assertPaperAllowed(context.run, context.agent, now);
      }
      if (
        status === "filled" &&
        (!fill ||
          now - Date.parse(fill.book.observedAt) > 30000 ||
          now - Date.parse(fill.conditions.observedAt) > 30000)
      ) {
        throw new PilotError("PAPER_STALE_QUOTE", "Quote expired before commit");
      }
      if (status === "filled" && fill) {
        assertPaperFillCurrent(fill, context.run, now);
      }
      const updated = await client.query<PaperOrder>(
        `UPDATE pickler.paper_orders SET status = $3, fill = $4::jsonb, reason = $5, finished_at = $6, lease_owner = NULL, lease_expires_at = NULL WHERE tenant_id = $1 AND id = $2 RETURNING ${projection}`,
        [order.tenantId, order.id, status, fill ? JSON.stringify(fill) : null, reason, now],
      );
      return updated.rows[0]!;
    });
    this.owners.delete(order.id);
    return result;
  }
}
