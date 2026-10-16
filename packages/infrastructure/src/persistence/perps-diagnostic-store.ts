import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PilotError, type PerpNetwork } from "@pickler/core";
import type { PerpsStudyLease, PerpsStudyScope } from "@pickler/trading/evaluation";

export type PerpsDiagnosticScope = PerpsStudyScope;

export interface PerpsDiagnosticInitialization extends PerpsDiagnosticScope {
  agentId: string;
  protocolId: string;
  protocolSha256: string;
  metadata: unknown;
}

export interface PerpsDiagnosticRecord {
  config: PerpsDiagnosticScope & { version: 10; protocol: "perps-source-journal-diagnostic-v1" };
  diagnosticOnly: true;
  financiallyExecutable: false;
  agentId: string;
  protocolId: string;
  protocolSha256: string;
  metadata: unknown;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  status: "initialized" | "running" | "completed" | "interrupted";
  stopRequested: boolean;
  interruption: string | null;
}

interface DiagnosticRow {
  id: string;
  document: PerpsDiagnosticRecord;
  owner: string | null;
  expires_at: string | null;
}

const LEASE_MS = 90000;
const identity = (scope: PerpsDiagnosticScope) => [scope.tenantId, scope.sessionId, scope.network];
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

/** Local public-source diagnostics. Never initializes or recovers a financial account. */
export class PostgresPerpsDiagnosticStore {
  private readonly revoked = new Set<string>();

  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}

  async sampleDatabaseClock(): Promise<{ databaseAt: number }> {
    const result = await this.pool.query<{ databaseAt: number }>(
      'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS "databaseAt"',
    );
    return result.rows[0]!;
  }

  private async now(client: Pick<Pool, "query"> | Pick<PoolClient, "query">) {
    if (this.clock) {
      return this.clock();
    }
    const result = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
    );
    return result.rows[0]!.now;
  }

  private active(lease: PerpsStudyLease) {
    lease.assertActive?.();
    if (this.revoked.has(lease.owner)) {
      throw new PilotError("LEASE_LOST", "Diagnostic lease has been revoked");
    }
  }

  private async row(client: PoolClient, scope: PerpsDiagnosticScope, lock: boolean) {
    const result = await client.query<DiagnosticRow>(
      `SELECT id,document,owner,expires_at FROM pickler.perps_studies
       WHERE tenant_id=$1 AND session_id=$2 AND network=$3${lock ? " FOR UPDATE" : ""}`,
      identity(scope),
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Diagnostic session not found");
    }
    if (
      row.document.config.version !== 10 ||
      row.document.config.protocol !== "perps-source-journal-diagnostic-v1" ||
      row.document.diagnosticOnly !== true ||
      row.document.financiallyExecutable !== false
    ) {
      throw new PilotError("CONFIG_CHANGED", "Session is not a public-source diagnostic");
    }
    return row;
  }

  private async owned(client: PoolClient, row: DiagnosticRow, lease: PerpsStudyLease) {
    this.active(lease);
    if (row.owner !== lease.owner || Number(row.expires_at) <= (await this.now(client))) {
      this.revoked.add(lease.owner);
      throw new PilotError("LEASE_LOST", "Diagnostic ownership expired");
    }
    this.active(lease);
  }

  private async transaction<T>(
    scope: PerpsDiagnosticScope,
    lease: PerpsStudyLease | undefined,
    action: (client: PoolClient, row: DiagnosticRow) => Promise<T>,
    readOnly = false,
  ) {
    if (lease) {
      this.active(lease);
    }
    const client = await this.pool.connect();
    try {
      await client.query(readOnly ? "BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY" : "BEGIN");
      const row = await this.row(client, scope, !readOnly);
      if (lease) {
        await this.owned(client, row, lease);
      }
      const result = await action(client, row);
      if (lease) {
        await this.owned(client, await this.row(client, scope, false), lease);
      }
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async initialize(input: PerpsDiagnosticInitialization) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(input.sessionId) ||
      !["mainnet", "testnet"].includes(input.network) ||
      !input.agentId ||
      !/^[a-zA-Z0-9][a-zA-Z0-9@._:-]{0,127}$/.test(input.protocolId) ||
      !/^[0-9a-f]{64}$/.test(input.protocolSha256) ||
      Buffer.byteLength(JSON.stringify(input.metadata ?? null)) > 262144
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid diagnostic identity or metadata");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `perps-diagnostic:${identity(input).join(":")}`,
      ]);
      const existing = await client.query<DiagnosticRow>(
        `SELECT id,document,owner,expires_at FROM pickler.perps_studies
         WHERE tenant_id=$1 AND session_id=$2 AND network=$3`,
        identity(input),
      );
      if (existing.rows[0]) {
        const row = await this.row(client, input, false);
        if (
          row.document.agentId !== input.agentId ||
          row.document.protocolId !== input.protocolId ||
          row.document.protocolSha256 !== input.protocolSha256 ||
          canonical(row.document.metadata) !== canonical(input.metadata)
        ) {
          throw new PilotError("CONFLICT", "Diagnostic identity or metadata changed");
        }
        await client.query("COMMIT");
        return row.document;
      }
      const agent = await client.query(
        "SELECT 1 FROM pickler.agents WHERE tenant_id=$1 AND id=$2",
        [input.tenantId, input.agentId],
      );
      if (!agent.rowCount) {
        throw new PilotError("NOT_FOUND", "Explicit diagnostic permission agent not found");
      }
      const accounts = await client.query(
        `SELECT 1 FROM pickler.perps_paper_accounts
         WHERE tenant_id=$1 AND session_id=$2 AND network=$3 LIMIT 1`,
        identity(input),
      );
      if (accounts.rowCount) {
        throw new PilotError(
          "CONFLICT",
          "Diagnostic namespace already contains financial accounts",
        );
      }
      const document: PerpsDiagnosticRecord = {
        config: {
          tenantId: input.tenantId,
          sessionId: input.sessionId,
          network: input.network as PerpNetwork,
          version: 10,
          protocol: "perps-source-journal-diagnostic-v1",
        },
        diagnosticOnly: true,
        financiallyExecutable: false,
        agentId: input.agentId,
        protocolId: input.protocolId,
        protocolSha256: input.protocolSha256,
        metadata: structuredClone(input.metadata),
        createdAt: await this.now(client),
        startedAt: null,
        finishedAt: null,
        status: "initialized",
        stopRequested: false,
        interruption: null,
      };
      await client.query(
        `INSERT INTO pickler.perps_studies(id,tenant_id,session_id,network,document)
         VALUES($1,$2,$3,$4,$5)`,
        [randomUUID(), ...identity(input), document],
      );
      await client.query("COMMIT");
      return document;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(scope: PerpsDiagnosticScope): Promise<PerpsStudyLease> {
    return this.transaction(scope, undefined, async (client, row) => {
      const now = await this.now(client);
      if (row.owner && Number(row.expires_at) > now) {
        throw new PilotError("CONFLICT", "Diagnostic already has a live owner");
      }
      if (row.document.startedAt !== null || row.document.stopRequested) {
        throw new PilotError("STUDY_COMPLETE", "A diagnostic cannot restart or recover");
      }
      const lease = { owner: randomUUID(), expiresAt: now + LEASE_MS };
      const document: PerpsDiagnosticRecord = {
        ...row.document,
        startedAt: now,
        status: "running",
      };
      await client.query(
        "UPDATE pickler.perps_studies SET document=$2,owner=$3,expires_at=$4 WHERE id=$1",
        [row.id, document, lease.owner, lease.expiresAt],
      );
      return lease;
    });
  }

  async renew(scope: PerpsDiagnosticScope, lease: PerpsStudyLease) {
    return this.transaction(scope, lease, async (client, row) => {
      const expiresAt = (await this.now(client)) + LEASE_MS;
      await client.query("UPDATE pickler.perps_studies SET expires_at=$2 WHERE id=$1", [
        row.id,
        expiresAt,
      ]);
      return { owner: lease.owner, expiresAt };
    });
  }

  async guard(scope: PerpsDiagnosticScope, lease: PerpsStudyLease) {
    await this.transaction(
      scope,
      lease,
      async (_client, row) => {
        if (row.document.status !== "running" || row.document.stopRequested) {
          throw new PilotError("STUDY_COMPLETE", "Diagnostic admission is closed");
        }
      },
      true,
    );
  }

  async event(
    scope: PerpsDiagnosticScope,
    lease: PerpsStudyLease,
    key: string,
    kind: string,
    data: unknown,
  ) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key) ||
      !/^[a-z][a-z0-9-]{0,79}$/.test(kind) ||
      Buffer.byteLength(JSON.stringify(data ?? null)) > 262144
    ) {
      throw new PilotError("INVALID_INPUT", "Diagnostic event exceeds its bounded contract");
    }
    await this.transaction(scope, lease, async (client, row) => {
      const previous = await client.query(
        "SELECT kind,data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
        [row.id, key],
      );
      if (previous.rows[0]) {
        if (
          previous.rows[0].kind !== kind ||
          canonical(previous.rows[0].data) !== canonical(data)
        ) {
          throw new PilotError("CONFLICT", "Original diagnostic event changed");
        }
        return;
      }
      await client.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
        [row.id, key, await this.now(client), kind, JSON.stringify(data)],
      );
    });
  }

  async release(scope: PerpsDiagnosticScope, lease: PerpsStudyLease, interruption?: string) {
    if (interruption && !/^[A-Z0-9_]{1,80}$/.test(interruption)) {
      throw new PilotError("INVALID_INPUT", "Use a safe diagnostic interruption code");
    }
    // Final ownership is checked before clearing the owner; never acknowledge this as a renewal.
    this.active(lease);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.row(client, scope, true);
      await this.owned(client, row, lease);
      const document: PerpsDiagnosticRecord = {
        ...row.document,
        status: interruption ? "interrupted" : "completed",
        finishedAt: await this.now(client),
        interruption: interruption ?? null,
      };
      await this.owned(client, row, lease);
      await client.query(
        "UPDATE pickler.perps_studies SET document=$2,owner=null,expires_at=null WHERE id=$1",
        [row.id, document],
      );
      this.active(lease);
      await client.query("COMMIT");
      this.revoked.add(lease.owner);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async stop(scope: PerpsDiagnosticScope, lease: PerpsStudyLease) {
    await this.transaction(scope, lease, async (client, row) => {
      await client.query("UPDATE pickler.perps_studies SET document=$2 WHERE id=$1", [
        row.id,
        { ...row.document, stopRequested: true },
      ]);
    });
  }

  async view(scope: PerpsDiagnosticScope) {
    return this.transaction(
      scope,
      undefined,
      async (client, row) => {
        const counts = await client.query<{ accounts: number; events: number }>(
          `SELECT
          (SELECT count(*)::integer FROM pickler.perps_paper_accounts
           WHERE tenant_id=$1 AND session_id=$2 AND network=$3) AS accounts,
          (SELECT count(*)::integer FROM pickler.perps_study_events WHERE study_id=$4) AS events`,
          [...identity(scope), row.id],
        );
        return {
          record: row.document,
          accountCount: counts.rows[0]!.accounts,
          eventCount: counts.rows[0]!.events,
        };
      },
      true,
    );
  }
}
