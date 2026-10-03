import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  PilotError,
  assertAdviceAgent,
  type AdviceAgent,
  type AdviceExecutionRepository,
  type AdviceJob,
  type AdviceLane,
  type AdvicePolicy,
  type AdviceSymbol,
  type AdviceUsage,
} from "@pickler/core";
import {
  assertAdvicePolicy,
  adviceForecastBaseUrl,
  adviceReservations,
  adviceTokenCost,
  usdMicros,
} from "@pickler/trading/perps";
const COLUMNS = `id, public_agent_id AS "publicAgentId", tenant_id AS "tenantId", agent_id AS "agentId", user_id AS "userId", symbol, status,
 created_at::double precision AS "createdAt", started_at::double precision AS "startedAt", finished_at::double precision AS "finishedAt", config_version AS "configVersion", config, policy, result, error`;
export class PostgresAdviceStore implements AdviceExecutionRepository {
  private readonly owners = new Map<string, string>();
  constructor(
    readonly pool: Pool,
    private readonly testClock?: () => number,
  ) {}
  private async now(db: Pool | PoolClient) {
    if (this.testClock) {
      return this.testClock();
    }
    return Number(
      (await db.query("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) AS at")).rows[0]
        .at,
    );
  }
  private async transaction<T>(action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtext('agent-advice'))");
      const result = await action(db);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  private async agent(db: Pool | PoolClient, id: string): Promise<AdviceAgent> {
    const row = (
      await db.query(
        `SELECT p.tenant_id AS "tenantId", p.runtime_agent_id AS "agentId", p.product_agent_id AS "publicId",
      r.version, r.config, a.visibility = 'public' AS published,
      (a.status = 'active' AND NOT r.paused AND coalesce(access.enabled, false)) AS enabled
      FROM pickler.product_agents p
      JOIN agents.agents a ON a.id=p.product_agent_id
      JOIN pickler.agents r ON r.tenant_id=p.tenant_id AND r.id=p.runtime_agent_id
      JOIN identity.workspaces w ON w.id=p.workspace_id
      LEFT JOIN pickler.research_access access ON access.user_id=w.owner_user_id
      WHERE p.product_agent_id=$1`,
        [id],
      )
    ).rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return row;
  }
  resolve(id: string) {
    return this.agent(this.pool, id);
  }
  private async read(db: Pool | PoolClient, id: string, lock = false): Promise<AdviceJob> {
    const job = (
      await db.query(
        `SELECT ${COLUMNS} FROM pickler.advice_jobs WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
        [id],
      )
    ).rows[0];
    if (!job) {
      throw new PilotError("NOT_FOUND", "Analysis not found");
    }
    return job;
  }
  async requestReplay(userId: string, publicId: string, key: string): Promise<AdviceJob | null> {
    return (
      (
        await this.pool.query(
          `SELECT ${COLUMNS} FROM pickler.advice_jobs WHERE user_id=$1 AND public_agent_id=$2 AND request_key=$3`,
          [userId, publicId, key],
        )
      ).rows[0] ?? null
    );
  }
  get(id: string) {
    return this.read(this.pool, id);
  }
  async enqueue(
    userId: string,
    publicId: string,
    symbol: AdviceSymbol,
    key: string,
    policy: AdvicePolicy,
  ) {
    assertAdvicePolicy(policy);
    return this.transaction(async (db) => {
      const agent = await this.agent(db, publicId);
      if (!agent.published) {
        throw new PilotError("NOT_FOUND", "Agent not found");
      }
      const replay = (
        await db.query(
          `SELECT ${COLUMNS} FROM pickler.advice_jobs WHERE user_id=$1 AND public_agent_id=$2 AND request_key=$3`,
          [userId, publicId, key],
        )
      ).rows[0];
      if (replay) {
        if (replay.symbol !== symbol) {
          throw new PilotError("CONFLICT", "Idempotency key belongs to another request");
        }
        return replay as AdviceJob;
      }
      assertAdviceAgent(agent, symbol);
      const at = await this.now(db);
      await this.recoverIn(db, at);
      const active = await db.query(
        "SELECT 1 FROM pickler.advice_jobs WHERE status IN ('queued','running') AND (user_id=$1 OR (tenant_id=$2 AND agent_id=$3))",
        [userId, agent.tenantId, agent.agentId],
      );
      if (active.rowCount) {
        throw new PilotError("ADVICE_BUSY", "An analysis is already active");
      }
      const unresolved = await db.query(
        `SELECT 1
      FROM pickler.advice_calls c
      JOIN pickler.advice_jobs j ON j.id=c.job_id
      WHERE j.tenant_id=$1 AND j.agent_id=$2 AND c.status='started' AND c.cost_micros IS NULL`,
        [agent.tenantId, agent.agentId],
      );
      if (unresolved.rowCount) {
        throw new PilotError("ADVICE_COST_UNKNOWN", "Previous costs require reconciliation");
      }
      const web = Boolean(agent.config.sources?.web);
      if (web && usdMicros(policy.webSearchUsd) <= 0n) {
        throw new PilotError(
          "ADVICE_POLICY_INVALID",
          "Web analysis requires a reviewed positive search reservation",
        );
      }
      const amounts = adviceReservations(policy, web);
      const maximum = Object.values(amounts).reduce((sum, n) => sum + BigInt(n), 0n);
      const day = Math.floor(at / 86400000) * 86400000;
      const spent = BigInt(
        (
          await db.query(
            `SELECT coalesce(sum(coalesce(c.cost_micros,c.reserved_micros)),0)::text AS amount
      FROM pickler.advice_calls c
      JOIN pickler.advice_jobs j ON j.id=c.job_id
      WHERE j.tenant_id=$1 AND j.agent_id=$2 AND (coalesce(c.started_at,j.created_at) >= $3 OR c.status = 'reserved') AND c.status <> 'released'`,
            [agent.tenantId, agent.agentId, day],
          )
        ).rows[0].amount,
      );
      if (
        maximum > usdMicros(policy.requestLimitUsd) ||
        maximum + spent > usdMicros(policy.dailyLimitUsd)
      ) {
        throw new PilotError("ADVICE_BUDGET_EXCEEDED", "Analysis budget is exhausted");
      }
      const id = randomUUID();
      await db.query(
        `INSERT INTO pickler.advice_jobs(id,public_agent_id,tenant_id,agent_id,user_id,request_key,symbol,status,created_at,config_version,config,policy)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'queued',$8,$9,$10,$11)`,
        [
          id,
          publicId,
          agent.tenantId,
          agent.agentId,
          userId,
          key,
          symbol,
          at,
          agent.version,
          JSON.stringify(agent.config),
          JSON.stringify(policy),
        ],
      );
      for (const [lane, amount] of Object.entries(amounts)) {
        await db.query(
          `INSERT INTO pickler.advice_calls(job_id,lane,model,provider,status,reserved_micros) VALUES ($1,$2,$3,$5,'reserved',$4)`,
          [
            id,
            lane,
            lane === "jev"
              ? policy.jevModel
              : lane === "deepseek"
                ? policy.deepseekModel
                : "exa-search",
            amount,
            lane === "jev"
              ? "typesafe"
              : lane === "deepseek"
                ? policy.version === 1
                  ? "deepseek"
                  : new URL(adviceForecastBaseUrl(policy)).origin
                : "exa",
          ],
        );
      }
      return this.read(db, id);
    });
  }
  async history(publicId: string, symbol?: AdviceSymbol, cursor?: string) {
    let before: { at: number; id: string } | null = null;
    if (cursor) {
      const match =
        /^(\d{1,16}):([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.exec(cursor);
      if (!match || !Number.isSafeInteger(Number(match[1]))) {
        throw new PilotError("INVALID_INPUT", "Invalid history cursor");
      }
      before = { at: Number(match[1]), id: match[2]! };
    }
    const rows = (
      await this.pool.query(
        `SELECT ${COLUMNS}
      FROM pickler.advice_jobs
      WHERE public_agent_id=$1 AND status='completed' AND ($2::text IS NULL OR symbol=$2) AND ($3::bigint IS NULL OR (created_at,id) < ($3,$4::uuid))
      ORDER BY created_at DESC,id DESC LIMIT 21`,
        [publicId, symbol ?? null, before?.at ?? null, before?.id ?? null],
      )
    ).rows as AdviceJob[];
    const items = rows.slice(0, 20);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > 20 && last ? `${last.createdAt}:${last.id}` : null };
  }
  private async owned(db: PoolClient, job: AdviceJob) {
    const at = await this.now(db);
    const token = this.owners.get(job.id);
    const row = (
      await db.query(
        `SELECT 1
      FROM pickler.advice_jobs
      WHERE id=$1 AND status='running' AND lease_owner=$2 AND lease_expires_at > $3 AND started_at + 180000 > $3 AND tenant_id=$4 AND agent_id=$5 AND public_agent_id=$6 FOR UPDATE`,
        [job.id, token ?? null, at, job.tenantId, job.agentId, job.publicAgentId],
      )
    ).rows[0];
    if (!row) {
      throw new PilotError("LEASE_LOST", "Analysis ownership was lost");
    }
    return at;
  }
  private async admitted(db: PoolClient, job: AdviceJob) {
    const agent = await this.agent(db, job.publicAgentId);
    assertAdviceAgent(agent, job.symbol);
    if (agent.tenantId !== job.tenantId || agent.agentId !== job.agentId) {
      throw new PilotError("FORBIDDEN", "Agent mapping changed");
    }
    if (
      agent.version !== job.configVersion ||
      JSON.stringify(agent.config) !== JSON.stringify(job.config)
    ) {
      throw new PilotError("CONFIG_CHANGED", "Agent configuration changed");
    }
  }
  guard(job: AdviceJob) {
    return this.transaction(async (db) => {
      await this.owned(db, job);
      await this.admitted(db, job);
    });
  }
  renew(job: AdviceJob) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, job);
      await this.admitted(db, job);
      await db.query(
        "UPDATE pickler.advice_jobs SET lease_expires_at=least($2,started_at+180000) WHERE id=$1",
        [job.id, at + 60000],
      );
    });
  }
  async claim() {
    return this.transaction(async (db) => {
      const at = await this.now(db);
      await this.recoverIn(db, at);
      const policy = (
        await db.query(
          "SELECT global_limit,tenant_limit FROM pickler.execution_policy WHERE id=1 FOR UPDATE",
        )
      ).rows[0];
      const jobs = (
        await db.query(
          `SELECT ${COLUMNS} FROM pickler.advice_jobs WHERE status='queued' ORDER BY created_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
        )
      ).rows as AdviceJob[];
      for (const job of jobs) {
        try {
          await this.admitted(db, job);
        } catch {
          await this.fail(db, job.id, "ANALYSIS_FAILED", at);
          continue;
        }
        const counts = (
          await db.query(
            `SELECT count(*)::int AS all_count, count(*) FILTER (WHERE tenant_id=$1)::int AS tenant_count
      FROM (SELECT tenant_id
      FROM pickler.runs
      WHERE status='running'
      UNION ALL SELECT tenant_id
      FROM pickler.preview_runs
      WHERE status='running'
      UNION ALL SELECT tenant_id
      FROM pickler.advice_jobs
      WHERE status='running') active`,
            [job.tenantId],
          )
        ).rows[0];
        if (counts.all_count >= policy.global_limit || counts.tenant_count >= policy.tenant_limit) {
          continue;
        }
        const token = randomUUID();
        await db.query(
          "UPDATE pickler.advice_jobs SET status='running',started_at=$2,lease_owner=$3,lease_expires_at=$4 WHERE id=$1",
          [job.id, at, token, at + 60000],
        );
        this.owners.set(job.id, token);
        return this.read(db, job.id);
      }
      return null;
    });
  }
  event(job: AdviceJob, kind: string, data: unknown) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, job);
      await db.query(
        `INSERT INTO pickler.advice_events(job_id,sequence,at,kind,data) SELECT $1,coalesce(max(sequence),0)+1,$2,$3,$4
      FROM pickler.advice_events
      WHERE job_id=$1`,
        [job.id, at, kind, JSON.stringify(data)],
      );
    });
  }
  startCall(job: AdviceJob, lane: AdviceLane, hash: string) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, job);
      await this.admitted(db, job);
      if (!/^[a-f0-9]{64}$/.test(hash)) {
        throw new PilotError("INVALID_INPUT", "Request hash required");
      }
      const result = await db.query(
        "UPDATE pickler.advice_calls SET status='started',started_at=$3,request_hash=$4 WHERE job_id=$1 AND lane=$2 AND status='reserved'",
        [job.id, lane, at, hash],
      );
      if (result.rowCount !== 1) {
        throw new PilotError("CONFLICT", "Call already started");
      }
    });
  }
  usage(job: AdviceJob, lane: AdviceLane, usage: AdviceUsage) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, job);
      if (
        !/^\d+$/.test(usage.costMicros) ||
        [usage.inputTokens, usage.outputTokens].some(
          (v) => v !== null && (!Number.isSafeInteger(v) || v < 0),
        )
      ) {
        throw new PilotError("MODEL_USAGE_INVALID", "Invalid usage");
      }
      const call = (
        await db.query(
          "SELECT * FROM pickler.advice_calls WHERE job_id=$1 AND lane=$2 FOR UPDATE",
          [job.id, lane],
        )
      ).rows[0];
      if (!call || call.status !== "started" || call.cost_micros !== null) {
        throw new PilotError("CONFLICT", "Usage already recorded or call not started");
      }
      await db.query(
        "UPDATE pickler.advice_calls SET cost_micros=$3,input_tokens=$4,output_tokens=$5,status='completed',finished_at=$6 WHERE job_id=$1 AND lane=$2",
        [job.id, lane, usage.costMicros, usage.inputTokens, usage.outputTokens, at],
      );
    });
  }
  /** Trusted operator-only reconciliation; never mounted on the consumer API. */
  reconcileCall(id: string, lane: AdviceLane, usage: AdviceUsage, evidenceHash: string) {
    return this.transaction(async (db) => {
      if (
        !/^[a-f0-9]{64}$/.test(evidenceHash) ||
        !/^\d+$/.test(usage.costMicros) ||
        [usage.inputTokens, usage.outputTokens].some(
          (n) => n !== null && (!Number.isSafeInteger(n) || n < 0),
        )
      ) {
        throw new PilotError("INVALID_INPUT", "Verified reconciliation evidence is required");
      }
      const job = await this.read(db, id, true);
      if (job.status !== "failed") {
        throw new PilotError("CONFLICT", "Only terminal failed jobs can be reconciled");
      }
      const call = (
        await db.query(
          "SELECT * FROM pickler.advice_calls WHERE job_id=$1 AND lane=$2 FOR UPDATE",
          [id, lane],
        )
      ).rows[0];
      if (!call || call.status !== "started" || call.cost_micros !== null) {
        throw new PilotError("CONFLICT", "Call does not require reconciliation");
      }
      if (lane === "jev" || lane === "deepseek") {
        if (
          usage.inputTokens === null ||
          usage.outputTokens === null ||
          adviceTokenCost(job.policy, lane, usage.inputTokens, usage.outputTokens).toString() !==
            usage.costMicros
        ) {
          throw new PilotError(
            "MODEL_USAGE_INVALID",
            "Reconciliation must use the original reviewed rates",
          );
        }
      }
      const at = await this.now(db);
      await db.query(
        "UPDATE pickler.advice_calls SET cost_micros=$3,input_tokens=$4,output_tokens=$5,status='completed',finished_at=$6 WHERE job_id=$1 AND lane=$2",
        [id, lane, usage.costMicros, usage.inputTokens, usage.outputTokens, at],
      );
      await db.query(
        `INSERT INTO pickler.advice_events(job_id,sequence,at,kind,data) SELECT $1,coalesce(max(sequence),0)+1,$2,'cost_reconciled',$3
      FROM pickler.advice_events
      WHERE job_id=$1`,
        [id, at, JSON.stringify({ lane, evidenceHash, usage })],
      );
    });
  }
  private async fail(db: PoolClient, id: string, error: string, at: number) {
    await db.query(
      "UPDATE pickler.advice_jobs SET status='failed',error=$2,finished_at=$3,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1",
      [id, error, at],
    );
    await db.query(
      "UPDATE pickler.advice_calls SET status='released' WHERE job_id=$1 AND status='reserved'",
      [id],
    );
  }
  finish(job: AdviceJob, result: unknown | null, error?: string) {
    return this.transaction(async (db) => {
      const at = await this.owned(db, job);
      if (result !== null) {
        await this.admitted(db, job);
        const unknown = await db.query(
          "SELECT 1 FROM pickler.advice_calls WHERE job_id=$1 AND status='started'",
          [job.id],
        );
        if (unknown.rowCount) {
          throw new PilotError("ADVICE_COST_UNKNOWN", "Unknown call costs prevent completion");
        }
        await db.query(
          "UPDATE pickler.advice_jobs SET status='completed',result=$2,finished_at=$3,lease_owner=NULL,lease_expires_at=NULL WHERE id=$1",
          [job.id, JSON.stringify(result), at],
        );
        await db.query(
          "UPDATE pickler.advice_calls SET status='released' WHERE job_id=$1 AND status='reserved'",
          [job.id],
        );
      } else {
        await this.fail(db, job.id, error ?? "ANALYSIS_FAILED", at);
      }
      this.owners.delete(job.id);
    });
  }
  private async recoverIn(db: PoolClient, at: number) {
    const expired = (
      await db.query(
        "SELECT id,status FROM pickler.advice_jobs WHERE (status='queued' AND created_at+600000 <= $1) OR (status='running' AND (lease_expires_at <= $1 OR started_at+180000 <= $1)) FOR UPDATE",
        [at],
      )
    ).rows;
    for (const row of expired) {
      await this.fail(
        db,
        row.id,
        row.status === "queued" ? "ANALYSIS_EXPIRED" : "ANALYSIS_INTERRUPTED",
        at,
      );
    }
    return Boolean(
      (await db.query("SELECT 1 FROM pickler.advice_jobs WHERE status='queued' LIMIT 1")).rowCount,
    );
  }
  recover() {
    return this.transaction(async (db) => this.recoverIn(db, await this.now(db)));
  }
}
