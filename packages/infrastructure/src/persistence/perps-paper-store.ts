import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import {
  PilotError,
  assertPerpsPaperAgent,
  initialPaperAccount,
  paperRisk,
  applyPaperFill,
  assertPaperIntent,
  paperDecimal,
  paperUnits,
  type AgentRecord,
  type PerpsPaperScope,
  type PerpsPaperView,
  type PerpsPaperAccount,
  type PerpsPaperAttempt,
  type PerpsPaperIntent,
  type PerpsPaperFill,
  type PerpsPaperLease,
  type PerpsPaperMovement,
  type PerpsPaperRepository,
} from "@pickler/core";
interface Locked {
  id: string;
  view: PerpsPaperView;
  agent: AgentRecord;
  now: number;
}
/** Scoped operator repository. All mutations serialize on the agent and account rows. */
export class PostgresPerpsPaperStore implements PerpsPaperRepository {
  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
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
  private async agent(client: PoolClient, scope: PerpsPaperScope) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(scope.sessionId) ||
      !["mainnet", "testnet"].includes(scope.network)
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid paper scope");
    }
    const result = await client.query<AgentRecord>(
      `SELECT id, tenant_id AS "tenantId", version, config, paused, schedule_enabled AS "scheduleEnabled", next_due AS "nextDueAt" FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
      [scope.tenantId, scope.agentId],
    );
    if (!result.rows[0]) {
      throw new PilotError("NOT_FOUND", "Agent not found");
    }
    return result.rows[0];
  }
  private async now(client: PoolClient): Promise<number> {
    if (this.clock) {
      return this.clock();
    }
    const result = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
    );
    return result.rows[0]!.now;
  }
  private async lock(client: PoolClient, scope: PerpsPaperScope): Promise<Locked> {
    const agent = await this.agent(client, scope);
    const result = await client.query<{ id: string; document: PerpsPaperAccount }>(
      "SELECT id,document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4 FOR UPDATE",
      [scope.tenantId, scope.agentId, scope.sessionId, scope.network],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Paper account not found");
    }
    const now = await this.now(client);
    await client.query(
      `UPDATE pickler.perps_paper_attempts SET document = document || jsonb_build_object('status','interrupted','reserved','0','reason','LEASE_EXPIRED','finishedAt',$2::bigint), owner=null, expires_at=null WHERE account_id=$1 AND owner IS NOT NULL AND expires_at <= $2`,
      [row.id, now],
    );
    const attempts = await client.query<{ document: PerpsPaperAttempt }>(
      "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 ORDER BY key",
      [row.id],
    );
    const movements = await client.query<{ document: PerpsPaperMovement }>(
      "SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1 ORDER BY key",
      [row.id],
    );
    return {
      id: row.id,
      agent,
      now,
      view: {
        account: row.document,
        attempts: attempts.rows.map((r) => r.document),
        movements: movements.rows.map((r) => r.document),
      },
    };
  }
  async initialize(scope: PerpsPaperScope, expectedVersion: number) {
    return this.transaction(async (client) => {
      const agent = await this.agent(client, scope);
      assertPerpsPaperAgent(agent, scope, expectedVersion);
      const now = await this.now(client);
      const account = initialPaperAccount(scope, expectedVersion, now);
      const id = randomUUID();
      const inserted = await client.query(
        "INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,agent_id,session_id,network) DO NOTHING RETURNING id",
        [id, scope.tenantId, scope.agentId, scope.sessionId, scope.network, account],
      );
      if (inserted.rowCount) {
        await client.query(
          "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,'initial',$2)",
          [
            id,
            {
              key: "initial",
              kind: "initial",
              delta: "1000",
              at: now,
              evidence: { policy: account.policy },
            },
          ],
        );
      }
      const locked = await this.lock(client, scope);
      if (locked.view.account.agentVersion !== expectedVersion) {
        throw new PilotError("CONFIG_CHANGED", "Existing paper session has another config version");
      }
      return locked.view;
    });
  }
  async view(scope: PerpsPaperScope) {
    return this.transaction(async (client) => (await this.lock(client, scope)).view);
  }
  private allowed(locked: Locked, scope: PerpsPaperScope, intent: PerpsPaperIntent) {
    assertPerpsPaperAgent(locked.agent, scope, locked.view.account.agentVersion);
    if (!locked.agent.config.perpl!.markets.includes(intent.symbol)) {
      throw new PilotError("MARKET_NOT_ALLOWED", "Paper market is not permitted");
    }
    if (locked.agent.paused && intent.kind === "open") {
      throw new PilotError("PAUSED", "Agent is paused");
    }
  }
  async begin(
    scope: PerpsPaperScope,
    expectedVersion: number,
    key: string,
    intent: PerpsPaperIntent,
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key)) {
      throw new PilotError("INVALID_INPUT", "Invalid request key");
    }
    assertPaperIntent(intent);
    return this.transaction(async (client) => {
      const locked = await this.lock(client, scope);
      const previous = locked.view.attempts.find((a) => a.key === key);
      if (previous) {
        if (
          previous.intent.kind !== intent.kind ||
          previous.intent.symbol !== intent.symbol ||
          previous.intent.side !== intent.side ||
          paperUnits(previous.intent.notional) !== paperUnits(intent.notional) ||
          paperUnits(previous.intent.feeReserve) !== paperUnits(intent.feeReserve)
        ) {
          throw new PilotError("CONFLICT", "Request key was used with another intent");
        }
        return { attempt: previous, lease: null };
      }
      if (locked.view.account.agentVersion !== expectedVersion) {
        throw new PilotError("CONFIG_CHANGED", "Paper session version differs");
      }
      this.allowed(locked, scope, intent);
      const risk = paperRisk(locked.view.account, locked.view.attempts, locked.now, intent);
      const owner = randomUUID();
      const expiresAt = locked.now + 60000;
      const attempt: PerpsPaperAttempt = {
        key,
        intent,
        status: risk.allowed ? "pending" : "rejected",
        reserved:
          risk.allowed && intent.kind === "open"
            ? paperDecimal(paperUnits(intent.notional) + paperUnits(intent.feeReserve))
            : "0",
        createdAt: locked.now,
        finishedAt: risk.allowed ? null : locked.now,
        reason: risk.allowed ? null : risk.reasons.join(","),
        evidence: null,
      };
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,$4,$5)",
        [locked.id, key, attempt, risk.allowed ? owner : null, risk.allowed ? expiresAt : null],
      );
      return { attempt, lease: risk.allowed ? { key, owner, expiresAt } : null };
    });
  }
  private async owned(client: PoolClient, scope: PerpsPaperScope, lease: PerpsPaperLease) {
    const locked = await this.lock(client, scope);
    const result = await client.query(
      "SELECT owner,expires_at FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
      [locked.id, lease.key],
    );
    const row = result.rows[0];
    const attempt = locked.view.attempts.find((a) => a.key === lease.key);
    if (
      !attempt ||
      attempt.status !== "pending" ||
      row?.owner !== lease.owner ||
      Number(row.expires_at) <= locked.now
    ) {
      throw new PilotError("LEASE_LOST", "Paper lease expired or changed");
    }
    return { ...locked, attempt };
  }
  async assertLease(scope: PerpsPaperScope, lease: PerpsPaperLease) {
    await this.transaction(async (client) => {
      const locked = await this.owned(client, scope, lease);
      this.allowed(locked, scope, locked.attempt.intent);
    });
  }
  private async persist(
    client: PoolClient,
    id: string,
    account: PerpsPaperAccount,
    movements: PerpsPaperMovement[],
  ) {
    await client.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
      id,
      account,
    ]);
    for (const p of account.positions) {
      await client.query(
        "INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document) VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,id) DO UPDATE SET closed_at=excluded.closed_at,document=excluded.document",
        [id, p.id, p.symbol, p.closedAt, p],
      );
    }
    for (const m of movements) {
      await client.query(
        "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
        [id, m.key, m],
      );
    }
  }
  async complete(scope: PerpsPaperScope, lease: PerpsPaperLease, fill: PerpsPaperFill) {
    return this.transaction(async (client) => {
      const locked = await this.owned(client, scope, lease);
      this.allowed(locked, scope, locked.attempt.intent);
      const risk = paperRisk(
        locked.view.account,
        locked.view.attempts.filter((a) => a.key !== lease.key),
        locked.now,
        locked.attempt.intent,
      );
      if (!risk.allowed) {
        throw new PilotError("RISK_REJECTED", risk.reasons.join(","));
      }
      const result = applyPaperFill(locked.view.account, locked.attempt, fill, locked.now);
      await this.persist(client, locked.id, result.account, result.movements);
      const attempt = {
        ...locked.attempt,
        status: "filled",
        reserved: "0",
        finishedAt: locked.now,
        evidence: fill.evidence,
      };
      await client.query(
        "UPDATE pickler.perps_paper_attempts SET document=$3,owner=null,expires_at=null WHERE account_id=$1 AND key=$2",
        [locked.id, lease.key, attempt],
      );
      return (await this.lock(client, scope)).view;
    });
  }
  async fail(scope: PerpsPaperScope, lease: PerpsPaperLease, code: string) {
    if (!/^[A-Z_]{1,80}$/.test(code)) {
      throw new PilotError("INVALID_INPUT", "Use a safe failure code");
    }
    await this.transaction(async (client) => {
      const locked = await this.owned(client, scope, lease);
      await client.query(
        "UPDATE pickler.perps_paper_attempts SET document=$3,owner=null,expires_at=null WHERE account_id=$1 AND key=$2",
        [
          locked.id,
          lease.key,
          {
            ...locked.attempt,
            status: "failed",
            reserved: "0",
            finishedAt: locked.now,
            reason: code,
          },
        ],
      );
    });
  }
}
