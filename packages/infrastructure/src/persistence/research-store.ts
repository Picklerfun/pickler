import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { and, asc, count, eq, gt, inArray, lte, sql, getTableColumns } from "drizzle-orm";
import {
  DEFAULT_CONFIG,
  effectivePlugins,
  PilotError,
  assertConfig,
  assertCanQueue,
  assertCanSchedule,
  nextOccurrence,
  type AgentConfig,
  type AgentRecord,
  type Scope,
  type RunRecord,
  type Decision,
  type RunEvent,
  type ResearchRepository,
} from "@pickler/core";
import * as schema from "./schema.js";

const { agents, runs, events, metadata, executionPolicy } = schema;
const {
  leaseOwner: _leaseOwner,
  leaseExpiresAt: _leaseExpiresAt,
  ...publicRunColumns
} = getTableColumns(runs);
void _leaseOwner;
void _leaseExpiresAt;
const DAY = 86_400_000;
type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const agentScope = (scope: Scope) =>
  and(eq(agents.tenantId, scope.tenantId), eq(agents.id, scope.agentId));
const runScope = (scope: Scope) =>
  and(eq(runs.tenantId, scope.tenantId), eq(runs.agentId, scope.agentId));

export class PostgresResearchStore implements ResearchRepository {
  readonly pool: Pool;
  readonly db: Database;
  private readonly owners = new Map<string, string>();
  constructor(
    connectionString: string,
    private readonly leaseClock?: () => number,
  ) {
    this.pool = new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 10_000,
      idleTimeoutMillis: 30_000,
    });
    this.pool.on("error", () => {
      console.error("PostgreSQL closed an idle pool connection; it will be replaced.");
    });
    this.db = drizzle(this.pool, { schema });
  }

  /** Migrations are explicit deployment steps; startup only seeds lab presets. */
  async init(): Promise<void> {
    await this.db
      .insert(agents)
      .values(
        ["alpha", "beta"].map((tenantId) => ({
          tenantId,
          id: `pickle-${tenantId}`,
          config: DEFAULT_CONFIG,
        })),
      )
      .onConflictDoNothing();
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private leaseNow() {
    return this.leaseClock
      ? sql`${this.leaseClock()}::bigint`
      : sql`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`;
  }

  private owned(run: RunRecord) {
    const owner = this.owners.get(run.id);
    if (!owner) {
      throw new PilotError("LEASE_LOST", "Execution no longer owns this run");
    }
    return and(
      eq(runs.id, run.id),
      runScope(run),
      eq(runs.status, "running"),
      eq(runs.leaseOwner, owner),
      gt(runs.leaseExpiresAt, this.leaseNow()),
    );
  }

  async assertOwnership(run: RunRecord): Promise<void> {
    const [owned] = await this.db.select({ id: runs.id }).from(runs).where(this.owned(run));
    if (!owned) {
      throw new PilotError("LEASE_LOST", "Execution lease expired");
    }
  }

  async renew(run: RunRecord): Promise<void> {
    try {
      const renewed = await this.db.transaction(async (tx) => {
        await tx
          .select({ id: runs.id })
          .from(runs)
          .where(and(eq(runs.id, run.id), runScope(run)))
          .for("update");
        return tx
          .update(runs)
          .set({ leaseExpiresAt: sql`${this.leaseNow()} + 60000` })
          .where(this.owned(run))
          .returning({ id: runs.id });
      });
      if (!renewed.length) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
    } catch (error) {
      this.owners.delete(run.id);
      throw error;
    }
  }

  async setConcurrency(globalLimit: number, tenantLimit: number): Promise<void> {
    if (
      !Number.isInteger(globalLimit) ||
      !Number.isInteger(tenantLimit) ||
      globalLimit < 1 ||
      globalLimit > 250 ||
      tenantLimit < 1 ||
      tenantLimit > globalLimit
    ) {
      throw new PilotError(
        "INVALID_INPUT",
        "Concurrency limits must be integers: 1 <= tenant <= global <= 250",
      );
    }
    const updated = await this.db
      .update(executionPolicy)
      .set({ globalLimit, tenantLimit })
      .where(eq(executionPolicy.id, 1))
      .returning({ id: executionPolicy.id });
    if (!updated.length) {
      throw new Error("Apply execution policy migration first");
    }
  }

  async bindConnectionIdentity(identity: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(761204, 2)`);
      const [previous] = await tx
        .select()
        .from(metadata)
        .where(eq(metadata.key, "connection_identity"));
      if (previous?.value === identity) {
        return;
      }
      await tx
        .insert(metadata)
        .values([
          { key: "connection_identity", value: identity },
          { key: "connections_checked", value: "false" },
        ])
        .onConflictDoUpdate({ target: metadata.key, set: { value: sql`excluded.value` } });
      await tx.update(agents).set({ scheduleEnabled: false, nextDueAt: null });
      await tx
        .update(runs)
        .set({ status: "cancelled", error: "CONNECTIONS_CHANGED" })
        .where(and(eq(runs.status, "queued"), eq(runs.trigger, "schedule")));
    });
  }

  async agents(tenantId: string): Promise<AgentRecord[]> {
    return this.db.select().from(agents).where(eq(agents.tenantId, tenantId)).orderBy(agents.id);
  }

  private async getAgent(
    scope: Scope,
    db: Database | Transaction = this.db,
    lock = false,
  ): Promise<AgentRecord> {
    const query = db.select().from(agents).where(agentScope(scope));
    const [agent] = await (lock ? query.for("update") : query);
    if (!agent) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return agent;
  }

  agent(scope: Scope): Promise<AgentRecord> {
    return this.getAgent(scope);
  }

  async updateConfig(
    scope: Scope,
    expectedVersion: number,
    config: AgentConfig,
  ): Promise<AgentRecord> {
    assertConfig(config);
    config = { ...config, plugins: effectivePlugins(config) };
    return this.db.transaction(async (tx) => {
      const agent = await this.getAgent(scope, tx, true);
      if (agent.version !== expectedVersion) {
        throw new PilotError("CONFLICT", "Configuration version changed");
      }
      const [updated] = await tx
        .update(agents)
        .set({ config, version: agent.version + 1, scheduleEnabled: false, nextDueAt: null })
        .where(agentScope(scope))
        .returning();
      return updated!;
    });
  }

  async pause(scope: Scope, paused: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.getAgent(scope, tx, true);
      await tx.update(agents).set({ paused }).where(agentScope(scope));
      if (paused) {
        await tx
          .update(runs)
          .set({ status: "cancelled", error: "PAUSED" })
          .where(and(runScope(scope), eq(runs.status, "queued")));
      }
    });
  }

  async schedule(scope: Scope, enabled: boolean, now: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Same lock order as connection identity changes.
      await tx.execute(sql`select pg_advisory_xact_lock(761204, 2)`);
      const agent = await this.getAgent(scope, tx, true);
      if (enabled) {
        const [checked] = await tx
          .select()
          .from(metadata)
          .where(eq(metadata.key, "connections_checked"));
        const success = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(
            and(
              runScope(scope),
              eq(runs.configVersion, agent.version),
              eq(runs.trigger, "manual"),
              eq(runs.status, "completed"),
            ),
          )
          .limit(1);
        assertCanSchedule(agent, checked?.value === "true", success.length > 0);
      }
      await tx
        .update(agents)
        .set({ scheduleEnabled: enabled, nextDueAt: enabled ? nextOccurrence(agent, now) : null })
        .where(agentScope(scope));
      if (!enabled) {
        await tx
          .update(runs)
          .set({ status: "cancelled", error: "SCHEDULE_DISABLED", finishedAt: now })
          .where(and(runScope(scope), eq(runs.status, "queued"), eq(runs.trigger, "schedule")));
      }
    });
  }

  /** Caller holds the agent row lock: admission and rolling quotas serialize per agent. */
  private async insertRun(
    tx: Transaction,
    agent: AgentRecord,
    key: string,
    marketId: string | null,
    now: number,
    trigger: RunRecord["trigger"],
  ): Promise<RunRecord> {
    const scope = { tenantId: agent.tenantId, agentId: agent.id };
    const [old] = await tx
      .select(publicRunColumns)
      .from(runs)
      .where(and(runScope(scope), eq(runs.requestKey, key)));
    if (old) {
      if (old.marketId !== marketId) {
        throw new PilotError("CONFLICT", "Idempotency key has a different payload");
      }
      return old;
    }
    const [usage] = await tx
      .select({ n: count() })
      .from(runs)
      .where(and(runScope(scope), gt(runs.createdAt, now - DAY)));
    assertCanQueue(agent, usage!.n);
    const [run] = await tx
      .insert(runs)
      .values({
        id: randomUUID(),
        ...scope,
        requestKey: key,
        marketId,
        trigger,
        status: "queued",
        createdAt: now,
        configVersion: agent.version,
        config: agent.config,
      })
      .returning(publicRunColumns);
    return run!;
  }

  async enqueue(
    scope: Scope,
    key: string,
    marketId: string | null,
    now: number,
  ): Promise<RunRecord> {
    if (!key || key.length > 128) {
      throw new PilotError("INVALID_INPUT", "Provide an idempotency key of at most 128 characters");
    }
    return this.db.transaction(async (tx) =>
      this.insertRun(tx, await this.getAgent(scope, tx, true), key, marketId, now, "manual"),
    );
  }

  async run(tenantId: string, runId: string): Promise<RunRecord> {
    const [run] = await this.db
      .select(publicRunColumns)
      .from(runs)
      .where(and(eq(runs.tenantId, tenantId), eq(runs.id, runId)));
    if (!run) {
      throw new PilotError("NOT_FOUND", "Run not found");
    }
    return run;
  }

  async events(tenantId: string, runId: string): Promise<RunEvent[]> {
    await this.run(tenantId, runId);
    return this.db
      .select({ id: events.id, type: events.type, data: events.data, createdAt: events.createdAt })
      .from(events)
      .where(eq(events.runId, runId))
      .orderBy(events.id);
  }

  async event(run: RunRecord, type: string, data: unknown, now: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const agent = await this.getAgent(run, tx, true);
      if (agent.version !== run.configVersion || agent.paused) {
        throw new PilotError("CONFIG_CHANGED", "Research authorization changed");
      }
      // Serialize writes with finalization and recovery, then check the current DB time.
      await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, run.id), runScope(run)))
        .for("update");
      const [owned] = await tx.select({ id: runs.id }).from(runs).where(this.owned(run));
      if (!owned) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
      await tx
        .insert(events)
        .values({ runId: run.id, type, data: data ?? sql`'null'::jsonb`, createdAt: now });
    });
  }

  async claim(now: number): Promise<RunRecord | null> {
    const owner = randomUUID();
    const claimed = await this.db.transaction(async (tx) => {
      const [policy] = await tx
        .select()
        .from(executionPolicy)
        .where(eq(executionPolicy.id, 1))
        .for("update");
      if (!policy) {
        throw new Error("Apply execution policy migration first");
      }
      const active = await tx
        .select({ tenantId: runs.tenantId })
        .from(runs)
        .where(eq(runs.status, "running"));
      if (active.length >= policy.globalLimit) {
        return null;
      }
      const candidates = await tx
        .select(publicRunColumns)
        .from(runs)
        .where(eq(runs.status, "queued"))
        .orderBy(asc(runs.createdAt), asc(runs.id));
      for (const next of candidates) {
        if (active.filter((run) => run.tenantId === next.tenantId).length >= policy.tenantLimit) {
          continue;
        }
        const [agent] = await tx
          .select()
          .from(agents)
          .where(agentScope(next))
          .for("update", { skipLocked: true });
        if (!agent || agent.paused) {
          continue;
        }
        if (agent.version !== next.configVersion) {
          await tx
            .update(runs)
            .set({ status: "cancelled", error: "CONFIG_CHANGED", finishedAt: now })
            .where(and(eq(runs.id, next.id), eq(runs.status, "queued")));
          continue;
        }
        const [running] = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(and(runScope(next), eq(runs.status, "running")))
          .limit(1);
        if (running) {
          continue;
        }
        const [result] = await tx
          .update(runs)
          .set({
            status: "running",
            startedAt: now,
            leaseOwner: owner,
            leaseExpiresAt: sql`${this.leaseNow()} + 60000`,
          })
          .where(and(eq(runs.id, next.id), eq(runs.status, "queued")))
          .returning(publicRunColumns);
        if (result) {
          return result;
        }
      }
      return null;
    });
    if (claimed) {
      this.owners.set(claimed.id, owner);
    }
    return claimed;
  }

  async finish(
    run: RunRecord,
    decision: Decision | null,
    error: string | null,
    now: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.getAgent(run, tx, true);
      if (decision && (current.version !== run.configVersion || current.paused)) {
        throw new PilotError("CONFIG_CHANGED", "Research authorization changed");
      }
      await tx.execute(
        sql`select set_config('pickler.execution_owner', ${this.owners.get(run.id) ?? ""}, true)`,
      );
      await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.id, run.id), runScope(run)))
        .for("update");
      const result = await tx
        .update(runs)
        .set({
          status: error ? "failed" : "completed",
          decision,
          error,
          finishedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        })
        .where(this.owned(run))
        .returning({ id: runs.id });
      if (!result.length) {
        throw new PilotError("LEASE_LOST", "Execution lease expired");
      }
    });
    this.owners.delete(run.id);
  }

  async recover(_now: number): Promise<void> {
    await this.db.execute(
      sql`UPDATE pickler.paper_orders SET status = 'interrupted', reason = 'INTERRUPTED', finished_at = ${this.leaseNow()}, lease_owner = NULL, lease_expires_at = NULL WHERE status = 'pending' AND lease_expires_at <= ${this.leaseNow()}`,
    );

    void _now; // The database clock, not the caller clock, owns lease expiration.
    await this.db.transaction(async (tx) => {
      const expired = await tx
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.status, "running"), lte(runs.leaseExpiresAt, this.leaseNow())))
        .for("update", { skipLocked: true });
      for (const run of expired) {
        await tx
          .update(runs)
          .set({
            status: "failed",
            error: "INTERRUPTED",
            finishedAt: this.leaseNow(),
            leaseOwner: null,
            leaseExpiresAt: null,
          })
          .where(
            and(
              eq(runs.id, run.id),
              eq(runs.status, "running"),
              lte(runs.leaseExpiresAt, this.leaseNow()),
            ),
          );
      }
    });
  }

  async tick(now: number): Promise<void> {
    await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(agents)
        .where(
          and(
            eq(agents.scheduleEnabled, true),
            eq(agents.paused, false),
            lte(agents.nextDueAt, now),
          ),
        )
        .orderBy(agents.tenantId, agents.id)
        .for("update", { skipLocked: true });
      for (const agent of due) {
        const scope = { tenantId: agent.tenantId, agentId: agent.id };
        const active = await tx
          .select({ id: runs.id })
          .from(runs)
          .where(and(runScope(scope), inArray(runs.status, ["queued", "running"])))
          .limit(1);
        if (!active.length) {
          try {
            await this.insertRun(
              tx,
              agent,
              `schedule:${agent.version}:${agent.nextDueAt}`,
              null,
              now,
              "schedule",
            );
          } catch (error) {
            if (!(error instanceof PilotError && error.code === "QUOTA")) {
              throw error;
            }
          }
        }
        await tx
          .update(agents)
          .set({ nextDueAt: nextOccurrence(agent, now) })
          .where(agentScope(scope));
      }
    });
  }

  async setConnectionsChecked(ok: boolean): Promise<void> {
    await this.db
      .insert(metadata)
      .values({ key: "connections_checked", value: String(ok) })
      .onConflictDoUpdate({ target: metadata.key, set: { value: String(ok) } });
  }
}
