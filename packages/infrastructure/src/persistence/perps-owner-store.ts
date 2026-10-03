import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import {
  PERPS_CHECK_QUEUE_MS,
  PRODUCT_PAPER_SESSION,
  type PerpsCheck,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import { PostgresPerpsRuntimeStore } from "./perps-runtime-store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;

/**
 * What the owner's paper actions need beside `PostgresPerpsRuntimeStore` (perpl-paper-runtime-v1
 * R8, R12): an `owner` check row that holds the agent's lease while the research worker approves a
 * proposal or closes positions, the owner of a paper position, and the record's all-time counts.
 *
 * `startOwnerCheck` follows `startCheck`'s rules (agent row locked first, lapsed checks recovered,
 * one queued or running check per agent: `CHECK_RUNNING`), so an owner action never runs beside a
 * check; it is a separate class only so the runtime store's file stays as it is.
 */
export class PostgresPerpsOwnerStore {
  private readonly checks: PostgresPerpsRuntimeStore;

  constructor(
    readonly pool: Pool,
    private readonly testClock?: () => number,
  ) {
    this.checks = new PostgresPerpsRuntimeStore(pool, testClock);
  }

  private async now(db: Pool | PoolClient) {
    if (this.testClock) {
      return this.testClock();
    }
    const result = await db.query<{ at: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS at",
    );
    return result.rows[0]!.at;
  }

  /**
   * Queues an `owner` check for the agent; `requestKey` replays the same row. `CHECK_RUNNING`
   * while another check is queued or running; `NOT_FOUND` for an unknown agent.
   */
  async startOwnerCheck(input: {
    productAgentId: string;
    requestKey?: string | null;
  }): Promise<PerpsCheck> {
    const requestKey = input.requestKey ?? null;
    if (!UUID.test(input.productAgentId)) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    if (requestKey !== null && !KEY.test(requestKey)) {
      throw new PilotError("INVALID_INPUT", "Invalid request key");
    }
    const db = await this.pool.connect();
    let id: string;
    try {
      await db.query("BEGIN");
      const mapped = await db.query<{ tenantId: string; agentId: string }>(
        `SELECT p.tenant_id AS "tenantId", p.runtime_agent_id AS "agentId"
        FROM pickler.product_agents p
        JOIN pickler.agents r ON r.tenant_id = p.tenant_id AND r.id = p.runtime_agent_id
        WHERE p.product_agent_id = $1
        FOR UPDATE OF r`,
        [input.productAgentId],
      );
      const agent = mapped.rows[0];
      if (!agent) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      const replay =
        requestKey === null
          ? null
          : await db.query<{ id: string; trigger: string }>(
              `SELECT id::text, trigger FROM pickler.perps_checks
              WHERE product_agent_id = $1 AND request_key = $2`,
              [input.productAgentId, requestKey],
            );
      if (replay?.rows[0]) {
        if (replay.rows[0].trigger !== "owner") {
          throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
        }
        id = replay.rows[0].id;
      } else {
        const at = await this.now(db);
        await db.query(
          `UPDATE pickler.perps_checks
          SET status = 'finished', outcome = 'failed', finished_at = $3, lease_owner = NULL, lease_expires_at = NULL,
            error = CASE WHEN status = 'queued' THEN 'CHECK_EXPIRED' ELSE 'CHECK_INTERRUPTED' END,
            outcome_text = CASE WHEN status = 'queued' THEN 'Expired' ELSE 'Interrupted' END
          WHERE tenant_id = $1 AND agent_id = $2 AND (
            (status = 'queued' AND created_at + $4 <= $3) OR
            (status = 'running' AND lease_expires_at <= $3))`,
          [agent.tenantId, agent.agentId, at, PERPS_CHECK_QUEUE_MS],
        );
        const active = await db.query(
          `SELECT 1 FROM pickler.perps_checks
          WHERE tenant_id = $1 AND agent_id = $2 AND status IN ('queued', 'running')`,
          [agent.tenantId, agent.agentId],
        );
        if (active.rowCount) {
          throw new PilotError("CHECK_RUNNING", "A check is already queued or running");
        }
        id = randomUUID();
        await db.query(
          `INSERT INTO pickler.perps_checks(id, product_agent_id, tenant_id, agent_id, trigger, request_key, status, created_at)
          VALUES ($1, $2, $3, $4, 'owner', $5, 'queued', $6)`,
          [id, input.productAgentId, agent.tenantId, agent.agentId, requestKey, at],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
    return (await this.checks.getCheck(id))!;
  }

  /** The product agent and paper account holding a position; null when no product account does. */
  async findPosition(
    positionId: string,
  ): Promise<{ productAgentId: string; scope: PerpsPaperScope } | null> {
    if (!KEY.test(positionId)) {
      return null;
    }
    const result = await this.pool.query<{
      productAgentId: string;
      tenantId: string;
      agentId: string;
      network: PerpsPaperScope["network"];
    }>(
      `SELECT pa.product_agent_id::text AS "productAgentId", a.tenant_id AS "tenantId",
        a.agent_id AS "agentId", a.network
      FROM pickler.perps_paper_positions p
      JOIN pickler.perps_paper_accounts a ON a.id = p.account_id
      JOIN pickler.product_agents pa ON pa.tenant_id = a.tenant_id AND pa.runtime_agent_id = a.agent_id
      WHERE p.id = $1 AND a.session_id = $2
      ORDER BY a.network
      LIMIT 1`,
      [positionId, PRODUCT_PAPER_SESSION],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      productAgentId: row.productAgentId,
      scope: {
        tenantId: row.tenantId,
        agentId: row.agentId,
        sessionId: PRODUCT_PAPER_SESSION,
        network: row.network,
      },
    };
  }

  /** All-time hourly and manual checks, and the checks that entered, for the record (R13). */
  async counts(productAgentId: string): Promise<{ checks: number; entries: number }> {
    if (!UUID.test(productAgentId)) {
      return { checks: 0, entries: 0 };
    }
    const result = await this.pool.query<{ checks: number; entries: number }>(
      `SELECT
        count(*) FILTER (WHERE trigger IN ('hourly', 'manual'))::int AS checks,
        count(*) FILTER (WHERE outcome = 'entered')::int AS entries
      FROM pickler.perps_checks
      WHERE product_agent_id = $1`,
      [productAgentId],
    );
    return result.rows[0]!;
  }
}
