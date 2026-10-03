import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PilotError } from "@pickler/core";
import {
  PERPS_ACTION_LEASE_MS,
  PERPS_ACTION_MAX_ATTEMPTS,
  PERPS_ACTION_REDRIVE_MS,
  PERPS_CHECK_LEASE_MS,
  PERPS_OWNER_ACTION_KINDS,
  PRODUCT_PAPER_SESSION,
  type PerpsCheckFinish,
  type PerpsCheckLease,
  type PerpsOwnerAction,
  type PerpsOwnerActionClaim,
  type PerpsOwnerActionKind,
  type PerpsOwnerActionRepository,
  type PerpsPaperScope,
} from "@pickler/trading/perps";
import { PostgresPerpsRuntimeStore } from "./perps-runtime-store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const CODE = /^[A-Z_]{1,80}$/;

const ACTION = `id::text, product_agent_id::text AS "productAgentId", kind, position_id AS "positionId",
 proposal_id::text AS "proposalId", status, attempts, last_error AS "lastError", check_id::text AS "checkId",
 created_at::double precision AS "createdAt", updated_at::double precision AS "updatedAt"`;

/**
 * The owner's side of the Perpl paper runtime (perpl-paper-runtime-v1 R8, R12, R13), on top of the
 * runtime store so a check row is started in one place (`insertCheck`: lapsed checks recovered,
 * one queued or running check per agent, `CHECK_RUNNING`).
 *
 * Owner actions (`pickler.perps_owner_actions`, migration 0027) are durable: the API writes the row
 * in the request (`createAction`, idempotent by request key), and the research worker claims it
 * (`claimAction`, one claim at a time, `PERPS_ACTION_LEASE_MS`), starts its `owner` check already
 * holding the agent's lease after re-checking the claim in the same transaction
 * (`startActionCheck`), and ends check and action together (`finishAction`). A busy agent puts the
 * action back to `pending` (`releaseAction`); the minute Cron re-drives what `pendingActions`
 * answers. Beside them: the owner of a paper position and the record's all-time counts.
 */
export class PostgresPerpsOwnerStore
  extends PostgresPerpsRuntimeStore
  implements PerpsOwnerActionRepository
{
  private async readAction(db: Pool | PoolClient, id: string) {
    if (!UUID.test(id)) {
      return null;
    }
    const result = await db.query<PerpsOwnerAction>(
      `SELECT ${ACTION} FROM pickler.perps_owner_actions WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async createAction(input: {
    productAgentId: string;
    kind: PerpsOwnerActionKind;
    positionId?: string | null;
    proposalId?: string | null;
    requestKey: string;
  }): Promise<PerpsOwnerAction> {
    const positionId = input.positionId ?? null;
    const proposalId = input.proposalId ?? null;
    if (
      !(PERPS_OWNER_ACTION_KINDS as readonly string[]).includes(input.kind) ||
      !KEY.test(input.requestKey) ||
      (input.kind === "close") !== (positionId !== null) ||
      (input.kind === "approve") !== (proposalId !== null) ||
      (positionId !== null && !KEY.test(positionId)) ||
      (proposalId !== null && !UUID.test(proposalId))
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid owner action");
    }
    return this.transaction(async (db) => {
      const agent = await this.mapping(db, input.productAgentId, true);
      const replay = await db.query<PerpsOwnerAction>(
        `SELECT ${ACTION} FROM pickler.perps_owner_actions
        WHERE product_agent_id = $1 AND request_key = $2`,
        [agent.productAgentId, input.requestKey],
      );
      const found = replay.rows[0];
      if (found) {
        if (
          found.kind !== input.kind ||
          found.positionId !== positionId ||
          found.proposalId !== proposalId
        ) {
          throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
        }
        return found;
      }
      if (input.kind === "approve" && agent.killed) {
        throw new PilotError("AGENT_KILLED", "This agent was killed");
      }
      const at = await this.now(db);
      const id = randomUUID();
      await db.query(
        `INSERT INTO pickler.perps_owner_actions(id, product_agent_id, kind, position_id, proposal_id, request_key,
          status, attempts, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, $7, $7)`,
        [id, agent.productAgentId, input.kind, positionId, proposalId, input.requestKey, at],
      );
      return (await this.readAction(db, id))!;
    });
  }

  getAction(id: string) {
    return this.readAction(this.pool, id);
  }

  async claimAction(id: string) {
    if (!UUID.test(id)) {
      return null;
    }
    return this.transaction(async (db) => {
      const at = await this.now(db);
      const current = await db.query<{ status: string; attempts: number; expired: boolean }>(
        `SELECT status, attempts, coalesce(lease_expires_at <= $2, false) AS expired
        FROM pickler.perps_owner_actions WHERE id = $1 FOR UPDATE`,
        [id, at],
      );
      const row = current.rows[0];
      const claimable =
        row && (row.status === "pending" || (row.status === "running" && row.expired));
      if (!claimable) {
        return null;
      }
      if (row.attempts >= PERPS_ACTION_MAX_ATTEMPTS) {
        await db.query(
          `UPDATE pickler.perps_owner_actions
          SET status = 'failed', last_error = 'TOO_MANY_ATTEMPTS', lease_owner = NULL, lease_expires_at = NULL,
            updated_at = $2
          WHERE id = $1`,
          [id, at],
        );
        return null;
      }
      const claim: PerpsOwnerActionClaim = {
        actionId: id,
        owner: randomUUID(),
        attempt: row.attempts + 1,
        expiresAt: at + PERPS_ACTION_LEASE_MS,
      };
      await db.query(
        `UPDATE pickler.perps_owner_actions
        SET status = 'running', attempts = $2, lease_owner = $3, lease_expires_at = $4, updated_at = $5
        WHERE id = $1`,
        [id, claim.attempt, claim.owner, claim.expiresAt, at],
      );
      return { action: (await this.readAction(db, id))!, claim };
    });
  }

  async startActionCheck(claim: PerpsOwnerActionClaim) {
    if (!UUID.test(claim.actionId) || !UUID.test(claim.owner)) {
      return null;
    }
    const action = await this.readAction(this.pool, claim.actionId);
    if (!action) {
      return null;
    }
    return this.transaction(async (db) => {
      // The agent row first, then the action and the checks, as every start and claim locks.
      const agent = await this.mapping(db, action.productAgentId, true);
      const at = await this.now(db);
      const held = await db.query(
        `SELECT 1 FROM pickler.perps_owner_actions
        WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND lease_expires_at > $3
        FOR UPDATE`,
        [claim.actionId, claim.owner, at],
      );
      if (!held.rowCount) {
        return null;
      }
      const lease: PerpsCheckLease = {
        checkId: "",
        owner: randomUUID(),
        expiresAt: at + PERPS_CHECK_LEASE_MS,
      };
      lease.checkId = await this.insertCheck(db, agent, {
        trigger: "owner",
        requestKey: `action:${claim.actionId}:${claim.attempt}`,
        at,
        lease,
      });
      await db.query(
        "UPDATE pickler.perps_owner_actions SET check_id = $2, updated_at = $3 WHERE id = $1",
        [claim.actionId, lease.checkId, at],
      );
      return { check: (await this.read(db, lease.checkId))!, lease, killed: agent.killed };
    });
  }

  async releaseAction(claim: PerpsOwnerActionClaim, code: string) {
    if (!CODE.test(code)) {
      throw new PilotError("INVALID_INPUT", "Use a safe failure code");
    }
    if (!UUID.test(claim.actionId) || !UUID.test(claim.owner)) {
      return;
    }
    const at = await this.now(this.pool);
    await this.pool.query(
      `UPDATE pickler.perps_owner_actions
      SET status = 'pending', last_error = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = $4
      WHERE id = $1 AND status = 'running' AND lease_owner = $2`,
      [claim.actionId, claim.owner, code, at],
    );
  }

  finishAction(
    lease: PerpsCheckLease,
    actionId: string,
    result: PerpsCheckFinish,
    status: "done" | "failed" | "pending",
  ) {
    if (!["done", "failed", "pending"].includes(status) || !UUID.test(actionId)) {
      throw new PilotError("INVALID_INPUT", "Invalid action result");
    }
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      const check = await this.finish(db, lease.checkId, at, result);
      // Whichever claim holds it now: the check that held the agent is the one that acted.
      await db.query(
        `UPDATE pickler.perps_owner_actions
        SET status = $2, last_error = $3, lease_owner = NULL, lease_expires_at = NULL, updated_at = $4
        WHERE id = $1 AND status IN ('pending', 'running')`,
        [actionId, status, result.error ?? null, at],
      );
      return check;
    });
  }

  async pendingActions(limit = 50) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new PilotError("INVALID_INPUT", "Invalid limit");
    }
    const at = await this.now(this.pool);
    const result = await this.pool.query<{ id: string }>(
      `SELECT id::text FROM pickler.perps_owner_actions
      WHERE (status = 'pending' AND updated_at <= $1) OR (status = 'running' AND lease_expires_at <= $2)
      ORDER BY created_at, id
      LIMIT $3`,
      [at - PERPS_ACTION_REDRIVE_MS, at, limit],
    );
    return result.rows.map((row) => row.id);
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
