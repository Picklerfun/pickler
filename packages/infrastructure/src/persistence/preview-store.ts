import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  PREVIEW_RATE,
  PREVIEW_TTL_MS,
  PilotError,
  PreviewRateLimited,
  previewRetryAt,
  type AgentConfig,
  type AgentRecord,
  type Decision,
  type PreviewRepository,
  type PreviewRun,
  type ResearchRepository,
  type RunEvent,
  type RunRecord,
  type Scope,
} from "@pickler/core";
import { eventFailure } from "./event-failure.js";

const LEASE_MS = 60_000;
const COLUMNS = `id, tenant_id AS "tenantId", status,
  created_at::double precision AS "createdAt", started_at::double precision AS "startedAt",
  finished_at::double precision AS "finishedAt", expires_at::double precision AS "expiresAt",
  config, decision, error, adopted_at IS NOT NULL AS adopted`;

interface PreviewRow {
  id: string;
  tenantId: string;
  status: RunRecord["status"];
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  expiresAt: number;
  config: AgentConfig;
  decision: Decision | null;
  error: string | null;
  adopted: boolean;
}

/** A preview as the runner sees it: its own agent, at version 1, never paused. */
function toRun(row: PreviewRow): RunRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    agentId: row.id,
    trigger: "manual",
    marketId: null,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    configVersion: 1,
    config: row.config,
    decision: row.decision,
    error: row.error,
  };
}

function toPreview(row: PreviewRow): PreviewRun {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    expiresAt: row.expiresAt,
    adopted: row.adopted,
    decision: row.decision,
    error: row.error,
  };
}

/** What the executor needs from a preview: the runner's four calls, and claim/renew/recover. */
export type PreviewExecutionRepository = Pick<
  ResearchRepository,
  "agent" | "event" | "finish" | "assertOwnership" | "claim" | "renew" | "recover"
>;

/**
 * Preview runs (docs/specs/studio-brief-v1.md §4): the owner's create/read, and the runner's
 * repository for a run that has no `pickler.agents` row. The config snapshot stands in for the
 * agent; nothing can change it mid-run, so the runner's version and pause guards always hold.
 */
export class PostgresPreviewStore implements PreviewRepository, PreviewExecutionRepository {
  private readonly owners = new Map<string, string>();
  constructor(
    private readonly pool: Pool,
    private readonly leaseClock?: () => number,
  ) {}

  /** The lease clock: the database's, unless a test pins it. */
  private async clock(client: Pool | PoolClient): Promise<number> {
    if (this.leaseClock) {
      return this.leaseClock();
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
      throw error;
    } finally {
      client.release();
    }
  }

  /** This process holds an unexpired lease, and the owner still has research access. */
  private async owned(client: Pool | PoolClient, run: RunRecord): Promise<boolean> {
    const owner = this.owners.get(run.id);
    if (!owner) {
      throw new PilotError("LEASE_LOST", "Execution no longer owns this run");
    }
    const result = await client.query(
      `SELECT 1 FROM pickler.preview_runs p
      WHERE p.id = $1 AND p.status = 'running' AND p.lease_owner = $2 AND p.lease_expires_at > $3
        AND coalesce((SELECT a.enabled FROM pickler.research_access a WHERE a.user_id = p.user_id), false)`,
      [run.id, owner, await this.clock(client)],
    );
    return result.rows.length > 0;
  }

  async create(
    input: {
      userId: string;
      workspaceId: string;
      tenantId: string;
      config: AgentConfig;
      fingerprint: string;
    },
    now: number,
  ): Promise<{ id: string }> {
    return this.transaction(async (client) => {
      // One caller's creations serialize, so two tabs cannot both take the fifth slot.
      await client.query("SELECT pg_advisory_xact_lock(761205, hashtext($1))", [input.userId]);
      const recent = await client.query<{ createdAt: number }>(
        `SELECT created_at::double precision AS "createdAt" FROM pickler.preview_runs
        WHERE user_id = $1 AND created_at > $2`,
        [input.userId, now - PREVIEW_RATE.windowMs],
      );
      const retryAt = previewRetryAt(
        recent.rows.map((row) => row.createdAt),
        now,
      );
      if (retryAt !== null) {
        throw new PreviewRateLimited(retryAt);
      }
      const id = randomUUID();
      await client.query(
        `INSERT INTO pickler.preview_runs
          (id, user_id, workspace_id, tenant_id, status, created_at, expires_at, config, fingerprint)
        VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7::jsonb, $8)`,
        [
          id,
          input.userId,
          input.workspaceId,
          input.tenantId,
          now,
          now + PREVIEW_TTL_MS,
          JSON.stringify(input.config),
          input.fingerprint,
        ],
      );
      return { id };
    });
  }

  async read(
    userId: string,
    id: string,
    now: number,
  ): Promise<{ run: PreviewRun; events: RunEvent[] }> {
    const found = await this.pool.query<PreviewRow>(
      `SELECT ${COLUMNS} FROM pickler.preview_runs WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const row = found.rows[0];
    if (!row || row.expiresAt <= now) {
      throw new PilotError("NOT_FOUND", "Paper run not found");
    }
    const events = await this.pool.query<RunEvent>(
      `SELECT id::double precision AS id, type, data, created_at::double precision AS "createdAt"
      FROM pickler.preview_events WHERE preview_run_id = $1 ORDER BY id`,
      [id],
    );
    return { run: toPreview(row), events: events.rows };
  }

  async agent(scope: Scope): Promise<AgentRecord> {
    const found = await this.pool.query<{ config: AgentConfig }>(
      "SELECT config FROM pickler.preview_runs WHERE id = $1 AND tenant_id = $2",
      [scope.agentId, scope.tenantId],
    );
    const row = found.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Paper run not found");
    }
    return {
      id: scope.agentId,
      tenantId: scope.tenantId,
      version: 1,
      config: row.config,
      paused: false,
      scheduleEnabled: false,
      nextDueAt: null,
    };
  }

  async claim(now: number): Promise<RunRecord | null> {
    const owner = randomUUID();
    const claimed = await this.transaction(async (client) => {
      const policy = await client.query<{ globalLimit: number }>(
        `SELECT global_limit AS "globalLimit" FROM pickler.execution_policy WHERE id = 1`,
      );
      const running = await client.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM pickler.preview_runs WHERE status = 'running'",
      );
      if (running.rows[0]!.n >= (policy.rows[0]?.globalLimit ?? 5)) {
        return null;
      }
      const queued = await client.query<PreviewRow & { userId: string }>(
        `SELECT ${COLUMNS}, user_id AS "userId" FROM pickler.preview_runs
        WHERE status = 'queued' ORDER BY created_at, id LIMIT 20 FOR UPDATE SKIP LOCKED`,
      );
      for (const next of queued.rows) {
        const allowed = await client.query<{ enabled: boolean }>(
          `SELECT coalesce((SELECT enabled FROM pickler.research_access WHERE user_id = $1), false) AS enabled`,
          [next.userId],
        );
        let cancel: string | null = null;
        if (next.expiresAt <= now) {
          cancel = "EXPIRED";
        } else if (!allowed.rows[0]!.enabled) {
          cancel = "RESEARCH_ACCESS_DENIED";
        }
        if (cancel) {
          await client.query(
            `UPDATE pickler.preview_runs SET status = 'cancelled', error = $2, finished_at = $3
            WHERE id = $1 AND status = 'queued'`,
            [next.id, cancel, now],
          );
          continue;
        }
        const started = await client.query<PreviewRow>(
          `UPDATE pickler.preview_runs
          SET status = 'running', started_at = $2, lease_owner = $3, lease_expires_at = $4
          WHERE id = $1 AND status = 'queued' RETURNING ${COLUMNS}`,
          [next.id, now, owner, (await this.clock(client)) + LEASE_MS],
        );
        if (started.rows[0]) {
          return toRun(started.rows[0]);
        }
      }
      return null;
    });
    if (claimed) {
      this.owners.set(claimed.id, owner);
    }
    return claimed;
  }

  async assertOwnership(run: RunRecord): Promise<void> {
    if (!(await this.owned(this.pool, run))) {
      throw new PilotError("LEASE_LOST", "Execution lease expired");
    }
  }

  async renew(run: RunRecord): Promise<void> {
    try {
      const renewed = await this.transaction(async (client) => {
        await client.query("SELECT id FROM pickler.preview_runs WHERE id = $1 FOR UPDATE", [
          run.id,
        ]);
        if (!(await this.owned(client, run))) {
          return false;
        }
        await client.query("UPDATE pickler.preview_runs SET lease_expires_at = $2 WHERE id = $1", [
          run.id,
          (await this.clock(client)) + LEASE_MS,
        ]);
        return true;
      });
      if (!renewed) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
    } catch (error) {
      this.owners.delete(run.id);
      throw error;
    }
  }

  async event(run: RunRecord, type: string, data: unknown, now: number): Promise<void> {
    await this.transaction(async (client) => {
      // Serialize with finish and recovery, then check the lease on the current clock.
      await client.query("SELECT id FROM pickler.preview_runs WHERE id = $1 FOR UPDATE", [run.id]);
      if (!(await this.owned(client, run))) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
      await client.query(
        `INSERT INTO pickler.preview_events (preview_run_id, type, data, created_at)
        VALUES ($1, $2, $3::jsonb, $4)`,
        [run.id, type, JSON.stringify(data ?? null), now],
      );
    }).catch((error: unknown) => {
      throw eventFailure(error, type);
    });
  }

  async finish(
    run: RunRecord,
    decision: Decision | null,
    error: string | null,
    now: number,
  ): Promise<void> {
    await this.transaction(async (client) => {
      await client.query("SELECT id FROM pickler.preview_runs WHERE id = $1 FOR UPDATE", [run.id]);
      if (!(await this.owned(client, run))) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
      await client.query(
        `UPDATE pickler.preview_runs
        SET status = $2, decision = $3::jsonb, error = $4, finished_at = $5,
          lease_owner = NULL, lease_expires_at = NULL
        WHERE id = $1`,
        [
          run.id,
          error ? "failed" : "completed",
          decision ? JSON.stringify(decision) : null,
          error,
          now,
        ],
      );
    });
    this.owners.delete(run.id);
  }

  /** Interrupted leases fail; expired previews nobody adopted are deleted with their events. */
  async recover(now: number): Promise<void> {
    const leaseNow = await this.clock(this.pool);
    await this.pool.query(
      `UPDATE pickler.preview_runs
      SET status = 'failed', error = 'INTERRUPTED', finished_at = $1, lease_owner = NULL, lease_expires_at = NULL
      WHERE status = 'running' AND lease_expires_at <= $1`,
      [leaseNow],
    );
    await this.pool.query(
      `DELETE FROM pickler.preview_runs
      WHERE expires_at <= $1 AND adopted_at IS NULL AND status <> 'running'`,
      [now],
    );
  }
}
