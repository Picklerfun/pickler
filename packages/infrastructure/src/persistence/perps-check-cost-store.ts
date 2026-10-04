import { createHash } from "node:crypto";
import { PilotError } from "@pickler/core";
import type { Pool, PoolClient } from "pg";
import {
  assertStudioCostPolicy,
  studioMaximumCost,
  studioTokenCost,
  type StudioCallPlan,
  type StudioCostPolicy,
  type StudioCostRepository,
  type StudioCostScope,
} from "@pickler/trading/perps";
import type { PerpsStrategySelection } from "@pickler/trading/strategies";

/** Agent/check lock order matches financial writes; started calls are never replayed. */
export class PostgresPerpsCheckCostStore implements StudioCostRepository {
  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}
  private async now(db: PoolClient): Promise<number> {
    if (this.clock) {
      return this.clock();
    }
    const result = await db.query(
      "SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::double precision AS now",
    );
    return result.rows[0].now;
  }
  private async transaction<T>(
    scope: StudioCostScope,
    operation: (db: PoolClient, at: number) => Promise<T>,
  ): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const at = await this.guard(db, scope);
      const result = await operation(db, at);
      await this.guard(db, scope);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }
  private async guard(db: PoolClient, scope: StudioCostScope): Promise<number> {
    const agent = await db.query(
      "SELECT version FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [scope.tenantId, scope.agentId],
    );
    if (agent.rows[0]?.version !== scope.configVersion) {
      throw new PilotError("CONFIG_CHANGED", "Studio configuration changed");
    }
    const at = await this.now(db);
    const owned = await db.query(
      `SELECT config_version FROM pickler.perps_checks
      WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 AND status='running'
        AND lease_owner=$4 AND lease_expires_at>$5 FOR UPDATE`,
      [scope.checkId, scope.tenantId, scope.agentId, scope.lease.owner, at],
    );
    if (scope.checkId !== scope.lease.checkId || !owned.rowCount) {
      throw new PilotError("LEASE_LOST", "Studio check no longer owns this execution");
    }
    if (
      owned.rows[0].config_version !== null &&
      owned.rows[0].config_version !== scope.configVersion
    ) {
      throw new PilotError("CONFIG_CHANGED", "Queued Studio configuration is stale");
    }
    return at;
  }
  async reserve(
    scope: StudioCostScope,
    strategy: PerpsStrategySelection,
    policy: StudioCostPolicy,
    plans: readonly StudioCallPlan[],
  ) {
    const maximum = assertStudioCostPolicy(policy, plans);
    return this.transaction(scope, async (db, at) => {
      const existing = await db.query(
        "SELECT strategy,policy,reserved_micros::text AS maximum FROM pickler.perps_check_reservations WHERE check_id=$1",
        [scope.checkId],
      );
      if (existing.rowCount) {
        throw new PilotError("CHECK_INTERRUPTED", "An admitted check cannot restart its call plan");
      }
      const blocked = await db.query(
        `SELECT 1 FROM pickler.perps_check_reservations r
        WHERE r.tenant_id=$1 AND r.agent_id=$2 AND (r.status='unknown' OR EXISTS
          (SELECT 1 FROM pickler.perps_check_calls c WHERE c.check_id=r.check_id AND c.status IN ('started','unknown'))) LIMIT 1`,
        [scope.tenantId, scope.agentId],
      );
      if (blocked.rowCount) {
        throw new PilotError("COST_UNKNOWN", "Prior usage must be reconciled before admission");
      }
      const day = new Date(at).toISOString().slice(0, 10);
      const used = await db.query(
        "SELECT coalesce(sum(accounted_micros),0)::text AS used FROM pickler.perps_check_reservations WHERE tenant_id=$1 AND agent_id=$2 AND day=$3",
        [scope.tenantId, scope.agentId, day],
      );
      if (BigInt(used.rows[0].used) + BigInt(maximum) > BigInt(policy.perDayMicros)) {
        throw new PilotError("COST_BUDGET_EXCEEDED", "Daily Studio USD ceiling reached");
      }
      await db.query(
        `INSERT INTO pickler.perps_check_reservations(check_id,tenant_id,agent_id,config_version,day,strategy,policy,reserved_micros,accounted_micros,status,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,'active',$9)`,
        [
          scope.checkId,
          scope.tenantId,
          scope.agentId,
          scope.configVersion,
          day,
          strategy,
          policy,
          maximum,
          at,
        ],
      );
      for (const plan of plans) {
        await db.query(
          "INSERT INTO pickler.perps_check_calls(check_id,key,plan,status,reserved_micros) VALUES($1,$2,$3,'reserved',$4)",
          [scope.checkId, plan.key, plan, studioMaximumCost(plan)],
        );
      }
      return { checkId: scope.checkId, reservedMicros: maximum, strategy };
    });
  }
  async start(scope: StudioCostScope, key: string, request: { sha256: string; bytes: number }) {
    if (
      !/^[a-f0-9]{64}$/.test(request.sha256) ||
      !Number.isSafeInteger(request.bytes) ||
      request.bytes < 1 ||
      request.bytes > 120000
    ) {
      throw new PilotError("MODEL_INPUT_TOO_LARGE", "Invalid request identity or bound");
    }
    await this.transaction(scope, async (db, at) => {
      const revoked = await db.query(
        `SELECT 1 FROM pickler.product_agents pa JOIN agents.agents p ON p.id=pa.product_agent_id
        JOIN pickler.agents a ON a.tenant_id=pa.tenant_id AND a.id=pa.runtime_agent_id
        WHERE pa.tenant_id=$1 AND pa.runtime_agent_id=$2 AND (p.killed_at IS NOT NULL OR a.paused)`,
        [scope.tenantId, scope.agentId],
      );
      if (revoked.rowCount) {
        throw new PilotError("AGENT_REVOKED", "Paused or revoked agent cannot start a paid call");
      }
      const result = await db.query(
        `UPDATE pickler.perps_check_calls SET status='started',request_sha256=$3,request_bytes=$4,started_at=$5
        WHERE check_id=$1 AND key=$2 AND status='reserved' AND EXISTS
          (SELECT 1 FROM pickler.perps_check_reservations r WHERE r.check_id=$1 AND r.status='active')`,
        [scope.checkId, key, request.sha256, request.bytes, at],
      );
      if (!result.rowCount) {
        throw new PilotError(
          "CALL_ALREADY_STARTED",
          "Missing reservation or previously started call",
        );
      }
    });
  }
  async complete(
    scope: StudioCostScope,
    key: string,
    usage: { input: number; output: number } | { costMicros: string },
  ) {
    await this.transaction(scope, async (db, at) => {
      const result = await db.query(
        "SELECT plan,reserved_micros::text AS maximum FROM pickler.perps_check_calls WHERE check_id=$1 AND key=$2 AND status='started' FOR UPDATE",
        [scope.checkId, key],
      );
      const row = result.rows[0] as { plan: StudioCallPlan; maximum: string } | undefined;
      if (!row) {
        throw new PilotError(
          "CALL_ALREADY_FINISHED",
          "Usage cannot overwrite a completed or missing call",
        );
      }
      const cost =
        "costMicros" in usage
          ? usage.costMicros
          : studioTokenCost(row.plan, usage.input, usage.output);
      if (!/^\d{1,24}$/.test(cost) || BigInt(cost) > BigInt(row.maximum)) {
        throw new PilotError("MODEL_USAGE_INVALID", "Charge exceeds the call's reservation");
      }
      await db.query(
        `UPDATE pickler.perps_check_calls SET status='completed',cost_micros=$3,input_tokens=$4,output_tokens=$5,finished_at=$6 WHERE check_id=$1 AND key=$2`,
        [
          scope.checkId,
          key,
          cost,
          "input" in usage ? usage.input : null,
          "output" in usage ? usage.output : null,
          at,
        ],
      );
    });
  }
  async unknown(scope: StudioCostScope, key: string) {
    await this.transaction(scope, async (db, at) => {
      const result = await db.query(
        "UPDATE pickler.perps_check_calls SET status='unknown',finished_at=$3 WHERE check_id=$1 AND key=$2 AND status='started'",
        [scope.checkId, key, at],
      );
      if (result.rowCount) {
        await db.query(
          "UPDATE pickler.perps_check_reservations SET status='unknown' WHERE check_id=$1",
          [scope.checkId],
        );
      }
    });
  }
  async finish(scope: StudioCostScope) {
    return this.transaction(scope, async (db, at) => {
      await db.query(
        "UPDATE pickler.perps_check_calls SET status='skipped',finished_at=$2 WHERE check_id=$1 AND status='reserved'",
        [scope.checkId, at],
      );
      const result = await db.query(
        `SELECT coalesce(sum(CASE WHEN status='completed' THEN cost_micros WHEN status IN ('started','unknown') THEN reserved_micros ELSE 0 END),0)::text AS accounted,
        coalesce(bool_or(status IN ('started','unknown')),false) AS unknown FROM pickler.perps_check_calls WHERE check_id=$1`,
        [scope.checkId],
      );
      const row = result.rows[0];
      await db.query(
        "UPDATE pickler.perps_check_reservations SET accounted_micros=$2,status=$3 WHERE check_id=$1",
        [scope.checkId, row.accounted, row.unknown ? "unknown" : "closed"],
      );
      return {
        costMicros: row.unknown ? null : (row.accounted as string),
        accountedMicros: row.accounted as string,
      };
    });
  }
  /** Trusted operator reconciliation only; no HTTP route and never a provider retry. */
  async reconcileCall(input: {
    tenantId: string;
    agentId: string;
    checkId: string;
    key: string;
    requestSha256: string;
    evidence: string;
    usage: { input: number; output: number } | { costMicros: string };
  }) {
    if (
      !input.evidence.trim() ||
      input.evidence.length > 4000 ||
      !/^[a-f0-9]{64}$/.test(input.requestSha256)
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Verified charge evidence and original request hash are required",
      );
    }
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT 1 FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [
        input.tenantId,
        input.agentId,
      ]);
      const active = await db.query(
        "SELECT 1 FROM pickler.perps_checks WHERE tenant_id=$1 AND agent_id=$2 AND status IN ('queued','running')",
        [input.tenantId, input.agentId],
      );
      const check = await db.query(
        "SELECT 1 FROM pickler.perps_checks WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 AND status='finished' AND outcome='failed' FOR UPDATE",
        [input.checkId, input.tenantId, input.agentId],
      );
      if (active.rowCount || !check.rowCount) {
        throw new PilotError(
          "RECONCILIATION_NOT_ALLOWED",
          "Reconciliation requires a failed terminal check and no active owner",
        );
      }
      const call = await db.query(
        "SELECT plan,reserved_micros::text AS maximum,status,request_sha256 FROM pickler.perps_check_calls WHERE check_id=$1 AND key=$2 FOR UPDATE",
        [input.checkId, input.key],
      );
      const row = call.rows[0];
      if (
        !row ||
        !["started", "unknown"].includes(row.status) ||
        row.request_sha256 !== input.requestSha256
      ) {
        throw new PilotError(
          "RECONCILIATION_NOT_ALLOWED",
          "Original unknown call identity must match",
        );
      }
      const cost =
        "costMicros" in input.usage
          ? input.usage.costMicros
          : studioTokenCost(row.plan, input.usage.input, input.usage.output);
      if (!/^\d{1,24}$/.test(cost) || BigInt(cost) > BigInt(row.maximum)) {
        throw new PilotError(
          "MODEL_USAGE_INVALID",
          "Verified charge exceeds the frozen reservation",
        );
      }
      const at = await this.now(db);
      const document = {
        key: input.key,
        requestSha256: input.requestSha256,
        evidence: input.evidence,
        usage: input.usage,
        costMicros: cost,
      };
      await db.query(
        "INSERT INTO pickler.perps_check_evidence(check_id,key,sha256,document,created_at) VALUES($1,$2,$3,$4,$5)",
        [
          input.checkId,
          `reconciliation:${input.key}`,
          createHash("sha256").update(JSON.stringify(document)).digest("hex"),
          JSON.stringify(document),
          at,
        ],
      );
      await db.query(
        "UPDATE pickler.perps_check_calls SET status='completed',cost_micros=$3,input_tokens=$4,output_tokens=$5 WHERE check_id=$1 AND key=$2",
        [
          input.checkId,
          input.key,
          cost,
          "input" in input.usage ? input.usage.input : null,
          "output" in input.usage ? input.usage.output : null,
        ],
      );
      await db.query(
        "UPDATE pickler.perps_check_calls SET status='skipped',finished_at=$2 WHERE check_id=$1 AND status='reserved'",
        [input.checkId, at],
      );
      const total = await db.query(
        `SELECT coalesce(sum(CASE WHEN status='completed' THEN cost_micros WHEN status IN ('started','unknown') THEN reserved_micros ELSE 0 END),0)::text AS accounted, coalesce(bool_or(status IN ('started','unknown')),false) AS unknown FROM pickler.perps_check_calls WHERE check_id=$1`,
        [input.checkId],
      );
      await db.query(
        "UPDATE pickler.perps_check_reservations SET accounted_micros=$2,status=$3 WHERE check_id=$1",
        [input.checkId, total.rows[0].accounted, total.rows[0].unknown ? "unknown" : "closed"],
      );
      await db.query("UPDATE pickler.perps_checks SET cost_micros=$2 WHERE id=$1", [
        input.checkId,
        total.rows[0].unknown ? null : total.rows[0].accounted,
      ]);
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      db.release();
    }
  }

  async evidence(scope: StudioCostScope, key: string, hash: string, document: unknown) {
    if (hash !== createHash("sha256").update(JSON.stringify(document)).digest("hex")) {
      throw new PilotError(
        "EVIDENCE_HASH_INVALID",
        "Evidence hash does not match the preserved document",
      );
    }
    await this.transaction(scope, async (db, at) => {
      const result = await db.query(
        "INSERT INTO pickler.perps_check_evidence(check_id,key,sha256,document,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [scope.checkId, key, hash, JSON.stringify(document), at],
      );
      if (!result.rowCount) {
        throw new PilotError(
          "EVIDENCE_ALREADY_RECORDED",
          "Immutable evidence cannot be overwritten",
        );
      }
    });
  }
}
