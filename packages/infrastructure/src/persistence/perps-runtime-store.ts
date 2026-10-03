import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { LEVERAGE_BOUNDS, PilotError } from "@pickler/core";
import {
  CHECK_OUTCOMES,
  PERPS_CHECK_LEASE_MS,
  PERPS_CHECK_MAX_STEPS,
  PERPS_CHECK_PAGE,
  PERPS_CHECK_QUEUE_MS,
  PERPS_CHECK_TRIGGERS,
  PROPOSAL_TTL_MS,
  paperDecimal,
  paperUnits,
  utcDayStart,
  type PerpsCheck,
  type PerpsCheckFinish,
  type PerpsCheckLease,
  type PerpsCheckOutcome,
  type PerpsCheckPage,
  type PerpsCheckRecord,
  type PerpsDueAgent,
  type PerpsProposal,
  type PerpsProposalInput,
  type PerpsRuntimeRepository,
} from "@pickler/trading/perps";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const CODE = /^[A-Z_]{1,80}$/;
const DECIMAL = /^\d{1,20}(\.\d{1,18})?$/;
const HOUR = 3_600_000;
/** An hourly check missed by more than this waits for the agent's next slot (keeps the stagger). */
const HOURLY_WINDOW_MS = 600_000;
/** An approval still `approving` this long past the proposal's expiry was abandoned. */
const APPROVAL_GRACE_MS = 300_000;
/** Ends queued checks nobody claimed in time and running checks whose lease lapsed. */
const RECOVER = `UPDATE pickler.perps_checks
  SET status = 'finished', outcome = 'failed', finished_at = $1, lease_owner = NULL, lease_expires_at = NULL,
    error = CASE WHEN status = 'queued' THEN 'CHECK_EXPIRED' ELSE 'CHECK_INTERRUPTED' END,
    outcome_text = CASE WHEN status = 'queued' THEN 'Expired' ELSE 'Interrupted' END
  WHERE status IN ('queued', 'running') AND (
    (status = 'queued' AND created_at + $2 <= $1) OR
    (status = 'running' AND lease_expires_at <= $1))`;

const CHECK = `id::text, product_agent_id::text AS "productAgentId", tenant_id AS "tenantId", agent_id AS "agentId",
 trigger, status, created_at::double precision AS "createdAt", started_at::double precision AS "startedAt",
 finished_at::double precision AS "finishedAt", config_version AS "configVersion", inputs, decision, outcome,
 outcome_text AS "outcomeText", steps, cost_micros::text AS "costMicros", error`;
const PROPOSAL = `id::text, check_id::text AS "checkId", product_agent_id::text AS "productAgentId",
 tenant_id AS "tenantId", agent_id AS "agentId", instrument, side, margin::text AS margin, leverage, kind, status,
 created_at::double precision AS "createdAt", expires_at::double precision AS "expiresAt",
 decided_at::double precision AS "decidedAt", position_id AS "positionId"`;

interface Mapping {
  productAgentId: string;
  tenantId: string;
  agentId: string;
  perpl: boolean;
}

const proposalRow = (row: PerpsProposal): PerpsProposal => ({
  ...row,
  margin: paperDecimal(paperUnits(row.margin)),
});
const checkRow = (row: PerpsCheck): PerpsCheck => ({
  ...row,
  decision: row.decision ?? null,
});

function stepText(text: string) {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > 200) {
    throw new PilotError("INVALID_INPUT", "A step is one line of 1–200 characters");
  }
  return trimmed;
}
function stepMs(ms: number | null | undefined) {
  if (ms === undefined || ms === null) {
    return null;
  }
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new PilotError("INVALID_INPUT", "A step's duration is whole milliseconds");
  }
  return ms;
}
function assertFinish(result: PerpsCheckFinish) {
  const text = result.outcomeText.trim();
  if (
    !(CHECK_OUTCOMES as readonly string[]).includes(result.outcome) ||
    text.length < 1 ||
    text.length > 200 ||
    (result.costMicros != null && !/^\d{1,30}$/.test(result.costMicros)) ||
    (result.error != null && !CODE.test(result.error)) ||
    (result.configVersion != null &&
      (!Number.isSafeInteger(result.configVersion) || result.configVersion < 1))
  ) {
    throw new PilotError("INVALID_INPUT", "Invalid check result");
  }
}
const json = (value: unknown) =>
  value === undefined || value === null ? null : JSON.stringify(value);

/**
 * The Perpl paper runtime's checks, proposals and per-agent leases (perpl-paper-runtime-v1 R1, R2,
 * R8, R14, R15; migration 0027). A check row holds its agent's lease while it runs; the partial
 * unique index on queued/running rows keeps one check per agent at a time, and every write that
 * starts or claims a check locks the runtime agent row first, then the check.
 */
export class PostgresPerpsRuntimeStore implements PerpsRuntimeRepository {
  constructor(
    readonly pool: Pool,
    private readonly testClock?: () => number,
  ) {}

  private async now(db: Pool | PoolClient) {
    if (this.testClock) {
      return this.testClock();
    }
    const result = await db.query<{ at: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS at",
    );
    return result.rows[0]!.at;
  }

  private async transaction<T>(action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const result = await action(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  /** The product agent's runtime mapping, locking the runtime agent row when `lock`. */
  private async mapping(db: PoolClient, productAgentId: string, lock: boolean): Promise<Mapping> {
    if (!UUID.test(productAgentId)) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    const result = await db.query<Mapping>(
      `SELECT p.product_agent_id::text AS "productAgentId", p.tenant_id AS "tenantId",
        p.runtime_agent_id AS "agentId", jsonb_typeof(r.config->'perpl') = 'object' AS perpl
      FROM pickler.product_agents p
      JOIN pickler.agents r ON r.tenant_id = p.tenant_id AND r.id = p.runtime_agent_id
      WHERE p.product_agent_id = $1
      ${lock ? "FOR UPDATE OF r" : ""}`,
      [productAgentId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return row;
  }

  private async lockAgent(db: PoolClient, tenantId: string, agentId: string) {
    await db.query("SELECT 1 FROM pickler.agents WHERE tenant_id = $1 AND id = $2 FOR UPDATE", [
      tenantId,
      agentId,
    ]);
  }

  /** Ends the agent's queued checks nobody claimed in time and running checks whose lease lapsed. */
  private async recover(db: PoolClient, tenantId: string, agentId: string, at: number) {
    await db.query(`${RECOVER} AND tenant_id = $3 AND agent_id = $4`, [
      at,
      PERPS_CHECK_QUEUE_MS,
      tenantId,
      agentId,
    ]);
  }

  /**
   * The minute Cron's sweep across agents (a paused or draft agent's crashed check is never
   * started or claimed again, so per-agent recovery alone would leave it `running`). Uses the
   * partial index on queued/running rows.
   */
  async recoverChecks() {
    const at = await this.now(this.pool);
    const result = await this.pool.query(RECOVER, [at, PERPS_CHECK_QUEUE_MS]);
    return result.rowCount ?? 0;
  }

  private async read(db: Pool | PoolClient, id: string): Promise<PerpsCheck | null> {
    if (!UUID.test(id)) {
      return null;
    }
    const result = await db.query<PerpsCheck>(
      `SELECT ${CHECK} FROM pickler.perps_checks WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? checkRow(result.rows[0]) : null;
  }

  /** Locks the leased check row; `LEASE_LOST` unless this lease still holds it. */
  private async owned(db: PoolClient, lease: PerpsCheckLease) {
    const at = await this.now(db);
    const valid = UUID.test(lease.checkId) && UUID.test(lease.owner);
    const result = valid
      ? await db.query(
          `SELECT 1 FROM pickler.perps_checks
          WHERE id = $1 AND status = 'running' AND lease_owner = $2 AND lease_expires_at > $3
          FOR UPDATE`,
          [lease.checkId, lease.owner, at],
        )
      : { rowCount: 0 };
    if (!result.rowCount) {
      throw new PilotError("LEASE_LOST", "The check's lease was lost");
    }
    return at;
  }

  async startCheck(input: {
    productAgentId: string;
    trigger: "hourly" | "manual";
    requestKey?: string | null;
  }): Promise<PerpsCheck> {
    const requestKey = input.requestKey ?? null;
    if (
      !["hourly", "manual"].includes(input.trigger) ||
      (requestKey !== null && !KEY.test(requestKey))
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid check request");
    }
    return this.transaction(async (db) => {
      const agent = await this.mapping(db, input.productAgentId, true);
      if (requestKey !== null) {
        const replay = await db.query<PerpsCheck>(
          `SELECT ${CHECK} FROM pickler.perps_checks WHERE product_agent_id = $1 AND request_key = $2`,
          [agent.productAgentId, requestKey],
        );
        if (replay.rows[0]) {
          if (replay.rows[0].trigger !== input.trigger) {
            throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
          }
          return checkRow(replay.rows[0]);
        }
      }
      if (!agent.perpl) {
        throw new PilotError("NOT_A_PERPL_AGENT", "This agent does not trade on Perpl");
      }
      const at = await this.now(db);
      await this.recover(db, agent.tenantId, agent.agentId, at);
      const active = await db.query(
        `SELECT 1 FROM pickler.perps_checks
        WHERE tenant_id = $1 AND agent_id = $2 AND status IN ('queued', 'running')`,
        [agent.tenantId, agent.agentId],
      );
      if (active.rowCount) {
        throw new PilotError("CHECK_RUNNING", "A check is already queued or running");
      }
      const id = randomUUID();
      await db.query(
        `INSERT INTO pickler.perps_checks(id, product_agent_id, tenant_id, agent_id, trigger, request_key, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7)`,
        [id, agent.productAgentId, agent.tenantId, agent.agentId, input.trigger, requestKey, at],
      );
      return (await this.read(db, id))!;
    });
  }

  async claimAgent(checkId: string) {
    const queued = await this.read(this.pool, checkId);
    if (!queued || queued.status !== "queued") {
      return null;
    }
    return this.transaction(async (db) => {
      await this.lockAgent(db, queued.tenantId, queued.agentId);
      const at = await this.now(db);
      await this.recover(db, queued.tenantId, queued.agentId, at);
      const current = await db.query<{ status: string }>(
        "SELECT status FROM pickler.perps_checks WHERE id = $1 FOR UPDATE",
        [checkId],
      );
      if (current.rows[0]?.status !== "queued") {
        return null;
      }
      const running = await db.query(
        `SELECT 1 FROM pickler.perps_checks
        WHERE tenant_id = $1 AND agent_id = $2 AND status = 'running'`,
        [queued.tenantId, queued.agentId],
      );
      if (running.rowCount) {
        return null;
      }
      const lease: PerpsCheckLease = {
        checkId,
        owner: randomUUID(),
        expiresAt: at + PERPS_CHECK_LEASE_MS,
      };
      await db.query(
        `UPDATE pickler.perps_checks
        SET status = 'running', started_at = $2, lease_owner = $3, lease_expires_at = $4
        WHERE id = $1`,
        [checkId, at, lease.owner, lease.expiresAt],
      );
      return { check: (await this.read(db, checkId))!, lease };
    });
  }

  renewAgent(lease: PerpsCheckLease) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      const expiresAt = at + PERPS_CHECK_LEASE_MS;
      await db.query("UPDATE pickler.perps_checks SET lease_expires_at = $2 WHERE id = $1", [
        lease.checkId,
        expiresAt,
      ]);
      return { ...lease, expiresAt };
    });
  }

  appendStep(lease: PerpsCheckLease, step: { text: string; ms?: number | null }) {
    const text = stepText(step.text);
    const ms = stepMs(step.ms);
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      const updated = await db.query(
        `UPDATE pickler.perps_checks
        SET steps = steps || jsonb_build_array(jsonb_build_object('at', $2::bigint, 'text', $3::text, 'ms', $4::bigint))
        WHERE id = $1 AND jsonb_array_length(steps) < $5`,
        [lease.checkId, at, text, ms, PERPS_CHECK_MAX_STEPS],
      );
      if (!updated.rowCount) {
        throw new PilotError("INVALID_INPUT", "A check keeps at most 50 steps");
      }
    });
  }

  private async finish(db: PoolClient, id: string, at: number, result: PerpsCheckFinish) {
    await db.query(
      `UPDATE pickler.perps_checks
      SET status = 'finished', finished_at = $2, outcome = $3, outcome_text = $4, decision = $5,
        inputs = coalesce($6, inputs), config_version = coalesce($7, config_version), cost_micros = $8, error = $9,
        lease_owner = NULL, lease_expires_at = NULL
      WHERE id = $1`,
      [
        id,
        at,
        result.outcome,
        result.outcomeText.trim(),
        json(result.decision),
        json(result.inputs),
        result.configVersion ?? null,
        result.costMicros ?? null,
        result.error ?? null,
      ],
    );
    return (await this.read(db, id))!;
  }

  finishCheck(lease: PerpsCheckLease, result: PerpsCheckFinish) {
    assertFinish(result);
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      return this.finish(db, lease.checkId, at, result);
    });
  }

  releaseAgent(lease: PerpsCheckLease, code = "CHECK_RELEASED") {
    if (!CODE.test(code)) {
      throw new PilotError("INVALID_INPUT", "Use a safe failure code");
    }
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      return this.finish(db, lease.checkId, at, {
        outcome: "failed",
        outcomeText: "Failed",
        error: code,
      });
    });
  }

  private async insertFinished(db: PoolClient, agent: Mapping, record: PerpsCheckRecord) {
    const at = await this.now(db);
    const steps = (record.steps ?? []).map((step) => ({
      at,
      text: stepText(step.text),
      ms: stepMs(step.ms),
    }));
    if (steps.length > PERPS_CHECK_MAX_STEPS) {
      throw new PilotError("INVALID_INPUT", "A check keeps at most 50 steps");
    }
    const id = randomUUID();
    await db.query(
      `INSERT INTO pickler.perps_checks(id, product_agent_id, tenant_id, agent_id, trigger, status, created_at,
        started_at, finished_at, config_version, inputs, decision, outcome, outcome_text, steps, cost_micros, error)
      VALUES ($1, $2, $3, $4, $5, 'finished', $6, $6, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        agent.productAgentId,
        agent.tenantId,
        agent.agentId,
        record.trigger,
        at,
        record.configVersion ?? null,
        json(record.inputs),
        json(record.decision),
        record.outcome,
        record.outcomeText.trim(),
        JSON.stringify(steps),
        record.costMicros ?? null,
        record.error ?? null,
      ],
    );
    return (await this.read(db, id))!;
  }

  recordCheck(record: PerpsCheckRecord) {
    assertFinish(record);
    if (!(PERPS_CHECK_TRIGGERS as readonly string[]).includes(record.trigger)) {
      throw new PilotError("INVALID_INPUT", "Invalid check trigger");
    }
    return this.transaction(async (db) => {
      const agent = await this.mapping(db, record.productAgentId, false);
      return this.insertFinished(db, agent, record);
    });
  }

  pauseAgent(productAgentId: string, outcomeText: string) {
    const record: PerpsCheckRecord = {
      productAgentId,
      trigger: "system",
      outcome: "system",
      outcomeText,
    };
    assertFinish(record);
    return this.transaction(async (db) => {
      const agent = await this.mapping(db, productAgentId, true);
      await db.query("UPDATE pickler.agents SET paused = true WHERE tenant_id = $1 AND id = $2", [
        agent.tenantId,
        agent.agentId,
      ]);
      return this.insertFinished(db, agent, record);
    });
  }

  getCheck(id: string) {
    return this.read(this.pool, id);
  }

  async listChecks(
    productAgentId: string,
    options: { before?: string | null; outcomes?: readonly PerpsCheckOutcome[] } = {},
  ): Promise<PerpsCheckPage> {
    let before: { at: number; id: string } | null = null;
    if (options.before) {
      const match = /^(\d{1,16}):([0-9a-f-]{36})$/.exec(options.before);
      if (!match || !Number.isSafeInteger(Number(match[1])) || !UUID.test(match[2]!)) {
        throw new PilotError("INVALID_INPUT", "Invalid checks cursor");
      }
      before = { at: Number(match[1]), id: match[2]! };
    }
    const outcomes = options.outcomes?.length ? [...options.outcomes] : null;
    if (outcomes?.some((o) => !(CHECK_OUTCOMES as readonly string[]).includes(o))) {
      throw new PilotError("INVALID_INPUT", "Invalid outcome filter");
    }
    if (!UUID.test(productAgentId)) {
      return { items: [], nextCursor: null };
    }
    const result = await this.pool.query<PerpsCheck>(
      `SELECT ${CHECK}
      FROM pickler.perps_checks
      WHERE product_agent_id = $1
        AND ($2::text[] IS NULL OR outcome = ANY($2::text[]))
        AND ($3::bigint IS NULL OR (created_at, id) < ($3, $4::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $5`,
      [productAgentId, outcomes, before?.at ?? null, before?.id ?? null, PERPS_CHECK_PAGE + 1],
    );
    const items = result.rows.slice(0, PERPS_CHECK_PAGE).map(checkRow);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        result.rows.length > PERPS_CHECK_PAGE && last ? `${last.createdAt}:${last.id}` : null,
    };
  }

  /**
   * Published (public, not killed), unpaused agents with a Perpl config whose hourly slot opened
   * under ten minutes ago with no hourly check since, and no live check. An agent's slot is the
   * minute of the hour `perpsCheckMinute` gives its product id; each answer carries its slot so
   * the dispatcher can key the check `hourly:<slot>` (exactly one per slot, by the request index).
   * The "since" test reads `perps_checks_feed` (product agent, created at).
   */
  async dueAgents(limit = 50): Promise<PerpsDueAgent[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new PilotError("INVALID_INPUT", "Invalid limit");
    }
    const at = await this.now(this.pool);
    const result = await this.pool.query<PerpsDueAgent>(
      `SELECT p.product_agent_id::text AS "productAgentId", p.tenant_id AS "tenantId", p.runtime_agent_id AS "agentId",
        s.slot::double precision AS slot
      FROM pickler.product_agents p
      JOIN agents.agents a ON a.id = p.product_agent_id
      JOIN pickler.agents r ON r.tenant_id = p.tenant_id AND r.id = p.runtime_agent_id
      CROSS JOIN LATERAL (
        SELECT (('x' || substr(replace(p.product_agent_id::text, '-', ''), 1, 8))::bit(32)::bigint % 60) * 60000 AS offset_ms
      ) o
      CROSS JOIN LATERAL (
        SELECT $1::bigint - ((($1::bigint - o.offset_ms) % $3) + $3) % $3 AS slot
      ) s
      WHERE a.visibility = 'public' AND a.killed_at IS NULL AND NOT r.paused
        AND jsonb_typeof(r.config->'perpl') = 'object'
        AND $1::bigint - s.slot < $4
        AND NOT EXISTS (
          SELECT 1 FROM pickler.perps_checks c
          WHERE c.product_agent_id = p.product_agent_id AND c.created_at >= s.slot
            AND c.trigger = 'hourly')
        AND NOT EXISTS (
          SELECT 1 FROM pickler.perps_checks c
          WHERE c.tenant_id = p.tenant_id AND c.agent_id = p.runtime_agent_id AND (
            (c.status = 'queued' AND c.created_at + $5 > $1::bigint) OR
            (c.status = 'running' AND c.lease_expires_at > $1::bigint)))
      ORDER BY s.slot, p.product_agent_id
      LIMIT $2`,
      [at, limit, HOUR, HOURLY_WINDOW_MS, PERPS_CHECK_QUEUE_MS],
    );
    return result.rows;
  }

  createProposal(lease: PerpsCheckLease, input: PerpsProposalInput) {
    const positionId = input.positionId ?? null;
    if (
      !["BTC", "ETH"].includes(input.instrument) ||
      !["long", "short"].includes(input.side) ||
      !["enter", "size_up"].includes(input.kind) ||
      !DECIMAL.test(input.margin) ||
      paperUnits(input.margin) <= 0n ||
      !Number.isInteger(input.leverage) ||
      input.leverage < LEVERAGE_BOUNDS.min ||
      input.leverage > LEVERAGE_BOUNDS.max ||
      (positionId !== null && !KEY.test(positionId))
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid proposal");
    }
    return this.transaction(async (db) => {
      const at = await this.owned(db, lease);
      const id = randomUUID();
      const result = await db.query<PerpsProposal>(
        `INSERT INTO pickler.perps_proposals(id, check_id, product_agent_id, tenant_id, agent_id, instrument, side,
          margin, leverage, kind, status, created_at, expires_at, position_id)
        SELECT $1, c.id, c.product_agent_id, c.tenant_id, c.agent_id, $3, $4, $5, $6, $7, 'pending', $8, $9, $10
        FROM pickler.perps_checks c
        WHERE c.id = $2
        RETURNING ${PROPOSAL}`,
        [
          id,
          lease.checkId,
          input.instrument,
          input.side,
          input.margin,
          input.leverage,
          input.kind,
          at,
          at + PROPOSAL_TTL_MS,
          positionId,
        ],
      );
      return proposalRow(result.rows[0]!);
    });
  }

  async getProposal(id: string) {
    if (!UUID.test(id)) {
      return null;
    }
    const result = await this.pool.query<PerpsProposal>(
      `SELECT ${PROPOSAL} FROM pickler.perps_proposals WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? proposalRow(result.rows[0]) : null;
  }

  async listProposals(productAgentId: string) {
    if (!UUID.test(productAgentId)) {
      return [];
    }
    const at = await this.now(this.pool);
    const result = await this.pool.query<PerpsProposal>(
      `SELECT ${PROPOSAL} FROM pickler.perps_proposals
      WHERE product_agent_id = $1 AND status = 'pending' AND expires_at > $2
      ORDER BY created_at DESC, id DESC`,
      [productAgentId, at],
    );
    return result.rows.map(proposalRow);
  }

  async decideProposal(id: string, decision: "approved" | "skipped") {
    if (!["approved", "skipped"].includes(decision) || !UUID.test(id)) {
      throw new PilotError("INVALID_INPUT", "Invalid decision");
    }
    const outcome = await this.transaction(async (db) => {
      const current = await db.query<PerpsProposal>(
        `SELECT ${PROPOSAL} FROM pickler.perps_proposals WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const proposal = current.rows[0];
      if (!proposal) {
        throw new PilotError("NOT_FOUND", "Proposal not found");
      }
      if (proposal.status !== "pending") {
        throw new PilotError("PROPOSAL_DECIDED", "This proposal was already decided");
      }
      const at = await this.now(db);
      // An approval is `approving` until the host settles it with the paper action's result.
      const status =
        proposal.expiresAt <= at ? "expired" : decision === "approved" ? "approving" : "skipped";
      const updated = await db.query<PerpsProposal>(
        `UPDATE pickler.perps_proposals SET status = $2, decided_at = $3 WHERE id = $1 RETURNING ${PROPOSAL}`,
        [id, status, at],
      );
      return proposalRow(updated.rows[0]!);
    });
    // The expiry is committed before it is reported.
    if (outcome.status === "expired") {
      throw new PilotError("PROPOSAL_EXPIRED", "This proposal expired");
    }
    return outcome;
  }

  async settleProposal(id: string, opened: boolean) {
    if (!UUID.test(id) || typeof opened !== "boolean") {
      throw new PilotError("INVALID_INPUT", "Invalid settlement");
    }
    return this.transaction(async (db) => {
      const current = await db.query<{ status: string }>(
        "SELECT status FROM pickler.perps_proposals WHERE id = $1 FOR UPDATE",
        [id],
      );
      if (!current.rows[0]) {
        throw new PilotError("NOT_FOUND", "Proposal not found");
      }
      if (current.rows[0].status !== "approving") {
        throw new PilotError("PROPOSAL_DECIDED", "This proposal is not being approved");
      }
      const at = await this.now(db);
      const updated = await db.query<PerpsProposal>(
        `UPDATE pickler.perps_proposals
        SET status = $2, decided_at = $3
        WHERE id = $1 RETURNING ${PROPOSAL}`,
        [id, opened ? "approved" : "pending", opened ? at : null],
      );
      return proposalRow(updated.rows[0]!);
    });
  }

  async expireProposals() {
    const at = await this.now(this.pool);
    const result = await this.pool.query<PerpsProposal>(
      `UPDATE pickler.perps_proposals SET status = 'expired', decided_at = $1
      WHERE (status = 'pending' AND expires_at <= $1)
        OR (status = 'approving' AND expires_at + $2 <= $1)
      RETURNING ${PROPOSAL}`,
      [at, APPROVAL_GRACE_MS],
    );
    return result.rows
      .map(proposalRow)
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  private async count(productAgentId: string | null, triggers: readonly string[]) {
    if (productAgentId !== null && !UUID.test(productAgentId)) {
      return 0;
    }
    const day = utcDayStart(await this.now(this.pool));
    const result = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pickler.perps_checks
      WHERE created_at >= $1 AND trigger = ANY($2::text[]) AND ($3::uuid IS NULL OR product_agent_id = $3)`,
      [day, triggers, productAgentId],
    );
    return result.rows[0]!.n;
  }

  /** Hourly and manual checks started today (UTC): the ones that ask the model. */
  checksToday(productAgentId: string) {
    return this.count(productAgentId, ["hourly", "manual"]);
  }

  manualChecksToday(productAgentId: string) {
    return this.count(productAgentId, ["manual"]);
  }

  /** Every agent's hourly and manual checks today (UTC), for `PERPL_RUNTIME_DAILY_CHECKS`. */
  globalChecksToday() {
    return this.count(null, ["hourly", "manual"]);
  }

  /** Known model cost of the agent's checks today (UTC), in micro-USD; unknown costs add nothing. */
  async costToday(productAgentId: string) {
    if (!UUID.test(productAgentId)) {
      return "0";
    }
    const day = utcDayStart(await this.now(this.pool));
    const result = await this.pool.query<{ total: string }>(
      `SELECT coalesce(sum(cost_micros), 0)::text AS total FROM pickler.perps_checks
      WHERE product_agent_id = $1 AND created_at >= $2`,
      [productAgentId, day],
    );
    return result.rows[0]!.total;
  }
}
