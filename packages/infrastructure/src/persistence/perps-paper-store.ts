import {
  historyPage as readHistoryPage,
  position as readHistoryPosition,
} from "./paper-history-read.js";
import type { PaperHistoryEntities, PaperHistoryPageOptions } from "@pickler/trading/perps";
import { randomUUID } from "node:crypto";
import {
  recordMovement,
  recordClosedPosition,
  advanceRecordProjection,
} from "./paper-record-projection.js";
import {
  executionSnapshot as readExecutionSnapshot,
  recordSnapshot as readRecordSnapshot,
  paperLedger,
  scopeValues,
} from "./paper-operational-read.js";
import type { Pool, PoolClient } from "pg";
import { PilotError, type AgentRecord } from "@pickler/core";
import { assertPerpsHourlyReady } from "./perps-hourly-readiness.js";
import {
  applyPaperObservation,
  type PerpsPaperObservation,
  assertPerpsPaperAgent,
  assertPerpsPaperScope,
  initialPaperAccount,
  paperRisk,
  applyPaperFill,
  applyPaperSizeUp,
  assertPaperIntent,
  isProductPaperSession,
  marginOpenedSince,
  PRODUCT_PAPER_SESSION,
  paperDecimal,
  paperOpenReserve,
  paperUnits,
  productFeeReserve,
  proposalRefusal,
  utcDayStart,
  simulatePerpsFill,
  type PerpsDuePosition,
  type PerpsPaperCloseReason,
  type PerpsPaperExits,
  type PerpsPaperFrame,
  type PerpsPaperMark,
  type PerpsPaperPosition,
  type PerpsProductPaperRepository,
  type PerpsPaperScope,
  type PerpsPaperView,
  type PerpsPaperAccount,
  type PerpsPaperAttempt,
  type PerpsPaperIntent,
  type PerpsPaperFill,
  type PerpsPaperLease,
  type PerpsPaperMovement,
  type PerpsProductPaperFence,
  type PaperExecutionState,
} from "@pickler/trading/perps";
/** The least a product account starts with (perpl-paper-runtime-v1 R9). */
export const PRODUCT_PAPER_MINIMUM = "10";
const DECIMAL = /^\d{1,20}(\.\d{1,18})?$/;
interface Locked {
  id: string;
  view: PerpsPaperView;
  agent: AgentRecord;
  now: number;
}
/**
 * Scoped paper repository for operator sessions and the product session of studio agents. All
 * mutations serialize on the agent and account rows.
 */
export class PostgresPerpsPaperStore implements PerpsProductPaperRepository {
  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
    private readonly studyOwner?: {
      tenantId: string;
      sessionId: string;
      network: string;
      owner: string;
      assertActive?: () => void;
      signal?: AbortSignal;
    },
    private readonly productOwner?: () => PerpsProductPaperFence,
  ) {}
  private async transaction<T>(action: (client: PoolClient) => Promise<T>) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('pickler.paper_writer','2',true)");
      await this.guardStudy(client);
      await this.guardProduct(client);
      const result = await action(client);
      await this.guardStudy(client);
      await this.guardProduct(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  private async guardStudy(client: PoolClient) {
    if (!this.studyOwner) {
      return;
    }
    this.studyOwner.assertActive?.();
    this.studyOwner.signal?.throwIfAborted();
    const scope = this.studyOwner;
    const result = await client.query(
      "SELECT owner,expires_at FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3 FOR UPDATE",
      [scope.tenantId, scope.sessionId, scope.network],
    );
    if (
      result.rows[0]?.owner !== scope.owner ||
      Number(result.rows[0]?.expires_at) <= (await this.now(client))
    ) {
      throw new PilotError("LEASE_LOST", "Study ownership expired before paper mutation");
    }
    this.studyOwner.assertActive?.();
    this.studyOwner.signal?.throwIfAborted();
  }
  private async guardProduct(client: PoolClient) {
    if (!this.productOwner) {
      return;
    }
    const owner = this.productOwner();
    owner.signal?.throwIfAborted();
    const agent = await client.query(
      "SELECT version FROM pickler.agents WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [owner.scope.tenantId, owner.scope.agentId],
    );
    if (agent.rows[0]?.version !== owner.configVersion) {
      throw new PilotError("CONFIG_CHANGED", "Studio configuration changed before financial write");
    }
    const check = await client.query(
      `SELECT 1 FROM pickler.perps_checks WHERE id=$1 AND tenant_id=$2 AND agent_id=$3 AND status='running' AND lease_owner=$4 AND lease_expires_at>$5 FOR UPDATE`,
      [
        owner.lease.checkId,
        owner.scope.tenantId,
        owner.scope.agentId,
        owner.lease.owner,
        await this.now(client),
      ],
    );
    if (!check.rowCount) {
      throw new PilotError("LEASE_LOST", "Studio ownership expired before financial write");
    }
    if (owner.requireReservation) {
      const reservation = await client.query(
        "SELECT 1 FROM pickler.perps_check_reservations WHERE check_id=$1 AND tenant_id=$2 AND agent_id=$3 AND config_version=$4 AND status='active' FOR UPDATE",
        [owner.lease.checkId, owner.scope.tenantId, owner.scope.agentId, owner.configVersion],
      );
      if (!reservation.rowCount) {
        throw new PilotError(
          "COST_RESERVATION_LOST",
          "Studio reservation no longer admits financial writes",
        );
      }
    }
    owner.signal?.throwIfAborted();
  }
  private async agent(client: PoolClient, scope: PerpsPaperScope) {
    if (this.productOwner) {
      const expected = this.productOwner().scope;
      if (
        scope.tenantId !== expected.tenantId ||
        scope.agentId !== expected.agentId ||
        scope.sessionId !== expected.sessionId ||
        scope.network !== expected.network
      ) {
        throw new PilotError("FORBIDDEN", "Financial write crossed its bound Studio identity");
      }
    }
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
  private async now(client: Pool | PoolClient): Promise<number> {
    if (this.clock) {
      return this.clock();
    }
    const result = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
    );
    return result.rows[0]!.now;
  }
  private async lock(
    client: PoolClient,
    scope: PerpsPaperScope,
    attemptKey?: string,
    positionId?: string,
    archive = false,
    reducingLegacy = false,
  ): Promise<Locked> {
    const agent = await this.agent(client, scope);
    const result = await client.query<{ id: string; document: PerpsPaperAccount }>(
      "SELECT id,CASE WHEN $5 THEN document-'positions' ELSE document END AS document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4 FOR UPDATE",
      [scope.tenantId, scope.agentId, scope.sessionId, scope.network, isProductPaperSession(scope)],
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Paper account not found");
    }
    const now = await this.now(client);
    await client.query(
      `UPDATE pickler.perps_paper_attempts SET document = document || jsonb_build_object('status','interrupted','reserved','0','reason','LEASE_EXPIRED','finishedAt',$2::bigint), owner=null, expires_at=null WHERE account_id=$1 AND key IN (SELECT key FROM pickler.perps_paper_attempts WHERE account_id=$1 AND owner IS NOT NULL AND expires_at<=$2 ORDER BY expires_at,key LIMIT 100)`,
      [row.id, now],
    );
    if (isProductPaperSession(scope) && !archive) {
      const storage = await client.query(
        "SELECT mode,coverage_required,coverage_complete FROM pickler.paper_storage WHERE account_id=$1",
        [row.id],
      );
      if (
        storage.rows[0]?.mode !== "operational" &&
        !(reducingLegacy && storage.rows[0]?.mode !== "frozen")
      ) {
        throw new PilotError(
          "PAPER_MIGRATION_REQUIRED",
          "Convert this legacy paper account before financial execution",
        );
      }
      const view = await readExecutionSnapshot(client, scope, now);
      if (
        storage.rows[0] &&
        BigInt(storage.rows[0].coverage_complete) < BigInt(storage.rows[0].coverage_required)
      ) {
        view.account.fundingPending = true;
      }
      if (attemptKey) {
        const target = await client.query<{ document: PerpsPaperAttempt }>(
          "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
          [row.id, attemptKey],
        );
        if (target.rows[0] && !view.attempts.some((item) => item.key === attemptKey)) {
          view.attempts.push(target.rows[0].document);
        }
      }
      if (positionId && !view.account.positions.some((item) => item.id === positionId)) {
        const target = await client.query<{ document: PerpsPaperPosition }>(
          "SELECT document FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2",
          [row.id, positionId],
        );
        if (target.rows[0]) {
          view.account.positions.push(target.rows[0].document);
        }
      }
      return { id: row.id, agent, now, view };
    }
    return { id: row.id, agent, now, view: await this.archiveSnapshot(client, scope) };
  }

  private async archiveSnapshot(
    client: Pool | PoolClient,
    scope: PerpsPaperScope,
  ): Promise<PerpsPaperView> {
    const found = await client.query(
      "SELECT id,document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4",
      scopeValues(scope),
    );
    const row = found.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Paper account not found");
    }
    const positions = await client.query(
      `SELECT p.document || CASE WHEN EXISTS(SELECT 1 FROM pickler.paper_position_sizeups x WHERE x.account_id=p.account_id AND x.position_id=p.id)
      THEN jsonb_build_object('sizeUps',(SELECT jsonb_agg(jsonb_build_object('at',x.at,'margin',trim_scale(x.margin)::text) ORDER BY x.sequence)
        FROM pickler.paper_position_sizeups x WHERE x.account_id=p.account_id AND x.position_id=p.id)) ELSE '{}'::jsonb END AS document
      FROM pickler.perps_paper_positions p WHERE account_id=$1 ORDER BY sequence`,
      [row.id],
    );
    const attempts = await client.query(
      `SELECT CASE WHEN owner IS NOT NULL AND expires_at<=$2
      THEN document||jsonb_build_object('status','interrupted','reserved','0','reason','LEASE_EXPIRED','finishedAt',$2::bigint)
      ELSE document END AS document FROM pickler.perps_paper_attempts WHERE account_id=$1 ORDER BY key`,
      [row.id, await this.now(client)],
    );
    const movements = await client.query(
      `WITH ledger AS (${paperLedger}) SELECT document FROM ledger WHERE account_id=$1 ORDER BY key`,
      [row.id],
    );
    return {
      account: { ...row.document, positions: positions.rows.map((item) => item.document) },
      attempts: attempts.rows.map((item) => item.document),
      movements: movements.rows.map((item) => item.document),
    };
  }

  async closeAdmissions(scope: PerpsPaperScope) {
    await this.transaction(async (client) => {
      const locked = await this.lock(client, scope);
      assertPerpsPaperAgent(locked.agent, scope, locked.view.account.agentVersion);
      locked.view.account.admissionsClosed = true;
      await client.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
        locked.id,
        locked.view.account,
      ]);
    });
  }
  async observed(scope: PerpsPaperScope, key: string) {
    return this.transaction(async (client) => {
      const locked = await this.lock(client, scope);
      const result = await client.query(
        "SELECT 1 FROM pickler.perps_paper_observations WHERE account_id=$1 AND key=$2",
        [locked.id, key],
      );
      return !!result.rowCount;
    });
  }
  async observe(scope: PerpsPaperScope, key: string, observation: PerpsPaperObservation) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key)) {
      throw new PilotError("INVALID_INPUT", "Invalid observation key");
    }
    return this.transaction(async (client) => {
      const locked = await this.lock(client, scope);
      const old = await client.query<{ result: PerpsPaperView }>(
        "SELECT result FROM pickler.perps_paper_observations WHERE account_id=$1 AND key=$2",
        [locked.id, key],
      );
      if (old.rows[0]) {
        return locked.view;
      }
      const supervision = this.productOwner && !this.productOwner().requireReservation;
      if (supervision) {
        assertPerpsPaperScope(locked.agent, scope);
        if (
          observation.frames.some(
            (frame) =>
              !locked.view.account.positions.some(
                (position) => position.symbol === frame.snapshot.market.symbol,
              ),
          )
        ) {
          throw new PilotError(
            "MARKET_NOT_ALLOWED",
            "Public supervision only observes recorded positions",
          );
        }
      } else {
        assertPerpsPaperAgent(locked.agent, scope, locked.view.account.agentVersion);
        for (const frame of observation.frames) {
          if (
            !locked.agent.config.perpl!.markets.some(
              (market) => market === frame.snapshot.market.symbol,
            ) &&
            !locked.view.account.positions.some(
              (position) => position.symbol === frame.snapshot.market.symbol,
            )
          ) {
            throw new PilotError("MARKET_NOT_ALLOWED", "Observation market is not permitted");
          }
        }
      }
      if (isProductPaperSession(scope)) {
        const keys = locked.view.account.positions.flatMap((position) =>
          observation.funding
            .filter((history) => history.market.symbol === position.symbol)
            .flatMap((history) =>
              history.events.map((event) => `funding:${position.id}:${event.eventBlock}`),
            ),
        );
        const existing = await client.query<{ document: PerpsPaperMovement }>(
          `WITH ledger AS (${paperLedger})
          SELECT document FROM ledger WHERE account_id=$1 AND key=ANY($2::text[])`,
          [locked.id, keys],
        );
        locked.view.movements = existing.rows.map((row) => row.document);
      }
      const result = applyPaperObservation(
        locked.view.account,
        locked.view.movements,
        isProductPaperSession(scope) ? { ...observation, incrementalFunding: true } : observation,
        key,
        locked.now,
      );
      await this.persist(client, locked.id, result.account, result.movements);
      const view = (await this.lock(client, scope)).view;
      await client.query(
        "INSERT INTO pickler.perps_paper_observations(account_id,key,document,result) VALUES($1,$2,$3,$4)",
        [locked.id, key, observation, { account: view.account, attempts: [], movements: [] }],
      );
      if (isProductPaperSession(scope)) {
        const before = new Map(locked.view.account.positions.map((p) => [p.id, JSON.stringify(p)]));
        view.changes = {
          positions: result.account.positions.filter((p) => before.get(p.id) !== JSON.stringify(p)),
          attempts: [],
          movements: result.movements,
        };
      }
      return view;
    });
  }
  async initialize(scope: PerpsPaperScope, expectedVersion: number, startingCash?: string) {
    const product = isProductPaperSession(scope);
    if (product !== (startingCash !== undefined)) {
      throw new PilotError("INVALID_INPUT", "Only a product session takes a starting stake");
    }
    if (startingCash !== undefined) {
      if (!DECIMAL.test(startingCash)) {
        throw new PilotError("INVALID_INPUT", "Invalid starting stake");
      }
      if (paperUnits(startingCash) < paperUnits(PRODUCT_PAPER_MINIMUM)) {
        throw new PilotError("WALLET_UNFUNDED", "The agent wallet holds under 10 AUSD");
      }
    }
    return this.transaction(async (client) => {
      const agent = await this.agent(client, scope);
      assertPerpsPaperAgent(agent, scope, expectedVersion);
      const now = await this.now(client);
      const account = initialPaperAccount(scope, expectedVersion, now, startingCash);
      const id = randomUUID();
      const inserted = await client.query(
        "INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,agent_id,session_id,network) DO NOTHING RETURNING id",
        [id, scope.tenantId, scope.agentId, scope.sessionId, scope.network, account],
      );
      if (inserted.rowCount) {
        if (product) {
          await client.query(
            "INSERT INTO pickler.paper_storage(account_id,mode) VALUES($1,'operational')",
            [id],
          );
        }
        await client.query(
          "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,'initial',$2)",
          [
            id,
            {
              key: "initial",
              kind: "initial",
              delta: account.cash,
              at: now,
              evidence: { policy: account.policy },
            },
          ],
        );
      }
      if (inserted.rowCount && product) {
        await recordMovement(client, id, {
          key: "initial",
          kind: "initial",
          delta: account.cash,
          at: now,
        });
        await advanceRecordProjection(client, id);
      }
      const locked = await this.lock(client, scope);
      if (!product && locked.view.account.agentVersion !== expectedVersion) {
        throw new PilotError("CONFIG_CHANGED", "Existing paper session has another config version");
      }
      if (product) {
        locked.view.changes = {
          positions: [],
          attempts: [],
          movements: inserted.rowCount
            ? [
                {
                  key: "initial",
                  kind: "initial",
                  delta: account.cash,
                  at: now,
                  evidence: { policy: account.policy },
                },
              ]
            : [],
        };
      }
      return locked.view;
    });
  }
  async view(scope: PerpsPaperScope) {
    return this.transaction(
      async (client) => (await this.lock(client, scope, undefined, undefined, true)).view,
    );
  }
  /**
   * Admission against the agent's current config. A close checks only the scope (R10, "exits
   * never wait"): an owner's edit to plugins, policy, network or markets can never strand an open
   * position. Operator sessions keep their version pin in `begin`.
   */
  private async allowed(
    client: PoolClient,
    locked: Locked,
    scope: PerpsPaperScope,
    intent: PerpsPaperIntent,
  ) {
    if (intent.kind === "close") {
      assertPerpsPaperScope(locked.agent, scope);
      return;
    }
    if (this.productOwner) {
      const check = await client.query("SELECT trigger FROM pickler.perps_checks WHERE id=$1", [
        this.productOwner().lease.checkId,
      ]);
      if (check.rows[0]?.trigger === "hourly") {
        await assertPerpsHourlyReady(client, scope);
      }
      const denied = await client.query(
        `SELECT 1 FROM pickler.product_agents pa JOIN agents.agents p ON p.id=pa.product_agent_id
        WHERE pa.tenant_id=$1 AND pa.runtime_agent_id=$2 AND p.killed_at IS NOT NULL
        UNION ALL SELECT 1 FROM pickler.perps_check_reservations r WHERE r.tenant_id=$1 AND r.agent_id=$2 AND (r.status='unknown' OR EXISTS
          (SELECT 1 FROM pickler.perps_check_calls c WHERE c.check_id=r.check_id AND c.status IN ('started','unknown'))) LIMIT 1`,
        [scope.tenantId, scope.agentId],
      );
      if (denied.rowCount) {
        throw new PilotError(
          "OPENING_BLOCKED",
          "Revoked agent or unknown usage blocks additional exposure",
        );
      }
      if (
        locked.view.account.fundingPending ||
        (locked.view.account.positions.length > 0 &&
          (locked.view.account.lastFundingAt === undefined ||
            locked.now - locked.view.account.lastFundingAt > 30000))
      ) {
        throw new PilotError("FUNDING_PENDING", "Reconcile funding before additional exposure");
      }
      const config = locked.agent.config;
      if (!config.spend) {
        throw new PilotError("PLUGIN_NOT_CONFIGURED", "Creator caps are required");
      }
      const position =
        locked.view.account.positions.find(
          (p) => p.closedAt === null && p.symbol === intent.symbol,
        ) ?? null;
      const refusal = proposalRefusal({
        kind: position ? "size_up" : "enter",
        instrument: intent.symbol,
        margin: paperDecimal(paperUnits(intent.notional) / BigInt(intent.leverage ?? 1)),
        leverage: intent.leverage ?? 1,
        paused: locked.agent.paused,
        config: { ...config, spend: config.spend },
        open: locked.view.account.positions.filter((p) => p.closedAt === null),
        position,
        newMarginToday:
          locked.view.accounting?.newMarginToday ??
          marginOpenedSince(locked.view.account.positions, utcDayStart(locked.now)),
        realizedToday:
          locked.view.accounting?.realizedToday ??
          paperDecimal(
            locked.view.movements
              .filter((m) => m.kind !== "initial" && m.at >= utcDayStart(locked.now))
              .reduce((sum, m) => sum + paperUnits(m.delta), 0n),
          ),
        freeEquity: null,
        checkAvailable: false,
        takerFee: 0,
      });
      if (refusal) {
        throw new PilotError(refusal.code, refusal.text);
      }
    }
    assertPerpsPaperAgent(locked.agent, scope, locked.view.account.agentVersion);
    if (
      intent.kind === "open" &&
      !locked.agent.config.perpl!.markets.some((market) => market === intent.symbol)
    ) {
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
      const locked = await this.lock(client, scope, key);
      const previous = locked.view.attempts.find((a) => a.key === key);
      if (previous) {
        if (
          previous.intent.kind !== intent.kind ||
          previous.intent.symbol !== intent.symbol ||
          previous.intent.side !== intent.side ||
          paperUnits(previous.intent.notional) !== paperUnits(intent.notional) ||
          paperUnits(previous.intent.feeReserve) !== paperUnits(intent.feeReserve) ||
          previous.intent.leverage !== intent.leverage ||
          previous.intent.checkId !== intent.checkId
        ) {
          throw new PilotError("CONFLICT", "Request key was used with another intent");
        }
        return { attempt: previous, lease: null };
      }
      if (!isProductPaperSession(scope) && locked.view.account.agentVersion !== expectedVersion) {
        throw new PilotError("CONFIG_CHANGED", "Paper session version differs");
      }
      await this.allowed(client, locked, scope, intent);
      const risk = paperRisk(locked.view.account, locked.view.attempts, locked.now, intent);
      const owner = randomUUID();
      const expiresAt = locked.now + 60000;
      const attempt: PerpsPaperAttempt = {
        key,
        intent,
        status: risk.allowed ? "pending" : "rejected",
        reserved: risk.allowed && intent.kind === "open" ? paperOpenReserve(intent) : "0",
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
  private async owned(
    client: PoolClient,
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    releaseOnly = false,
  ) {
    const point = await client.query(
      `SELECT t.document->'intent'->>'kind' AS kind FROM pickler.perps_paper_attempts t
      JOIN pickler.perps_paper_accounts a ON a.id=t.account_id WHERE a.tenant_id=$1 AND a.agent_id=$2
      AND a.session_id=$3 AND a.network=$4 AND t.key=$5`,
      [...scopeValues(scope), lease.key],
    );
    const locked = await this.lock(
      client,
      scope,
      lease.key,
      undefined,
      false,
      releaseOnly || point.rows[0]?.kind === "close",
    );
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
      await this.allowed(client, locked, scope, locked.attempt.intent);
    });
  }
  private async persist(
    client: PoolClient,
    id: string,
    account: PerpsPaperAccount,
    movements: PerpsPaperMovement[],
    positionId?: string,
  ) {
    const product = isProductPaperSession(account.scope);
    const metadata = product
      ? (await client.query("SELECT mode FROM pickler.paper_storage WHERE account_id=$1", [id]))
          .rows[0]
      : null;
    const operational = product && metadata?.mode === "operational";
    if (product && !operational) {
      // Close-only compatibility: preserve legacy parent history on the server until explicit
      // frozen conversion. No historical account document is transferred to this writer.
      const replacements = Object.fromEntries(
        account.positions.map((position) => [position.id, position]),
      );
      await client.query(
        `UPDATE pickler.perps_paper_accounts SET document=jsonb_set($2::jsonb,'{positions}',
        coalesce((SELECT jsonb_agg(coalesce(p||($3::jsonb->(p->>'id')),p)) FROM jsonb_array_elements(document->'positions') p),'[]'::jsonb)) WHERE id=$1`,
        [id, { ...account, positions: [] }, replacements],
      );
    } else {
      await client.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
        id,
        operational ? { ...account, positions: [] } : account,
      ]);
    }
    await client.query("UPDATE pickler.paper_storage SET revision=revision+1 WHERE account_id=$1", [
      id,
    ]);
    for (const p of account.positions) {
      await client.query(
        `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document,check_id,config_version,leverage,margin,stop_price,take_profit_price,exit_due_at,close_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(account_id,id) DO UPDATE SET closed_at=excluded.closed_at,
        document=CASE WHEN $14 THEN excluded.document ELSE perps_paper_positions.document||
          coalesce((SELECT jsonb_build_object('sizeUps',legacy->'sizeUps') FROM pickler.perps_paper_accounts a,
            jsonb_array_elements(a.document->'positions') legacy
            WHERE a.id=$1 AND legacy->>'id'=$2 AND legacy ? 'sizeUps' LIMIT 1),'{}'::jsonb)||excluded.document END,
        check_id=excluded.check_id,config_version=excluded.config_version,leverage=excluded.leverage,margin=excluded.margin,
        stop_price=excluded.stop_price,take_profit_price=excluded.take_profit_price,exit_due_at=excluded.exit_due_at,close_reason=excluded.close_reason`,
        [
          id,
          p.id,
          p.symbol,
          p.closedAt,
          operational
            ? Object.fromEntries(Object.entries(p).filter(([key]) => key !== "sizeUps"))
            : p,
          p.checkId ?? null,
          p.configVersion ?? null,
          p.leverage ?? null,
          p.margin ?? null,
          p.stopPrice ?? null,
          p.takeProfitPrice ?? null,
          p.exitDueAt ?? null,
          p.closeReason ?? null,
          !product || operational,
        ],
      );
    }
    if (operational && positionId) {
      const delta = movements.reduce((sum, item) => sum + paperUnits(item.delta), 0n);
      await client.query(
        `INSERT INTO pickler.paper_position_totals(account_id,position_id,pnl) VALUES($1,$2,$3)
        ON CONFLICT(account_id,position_id) DO UPDATE SET pnl=paper_position_totals.pnl+excluded.pnl`,
        [id, positionId, paperDecimal(delta)],
      );
    }
    if (
      operational &&
      positionId &&
      account.positions.some((position) => position.id === positionId && position.closedAt !== null)
    ) {
      const total = await client.query(
        "SELECT pnl::text FROM pickler.paper_position_totals WHERE account_id=$1 AND position_id=$2",
        [id, positionId],
      );
      await recordClosedPosition(client, id, positionId, total.rows[0]?.pnl ?? "0");
    }
    for (const m of movements) {
      await client.query(
        "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
        [id, m.key, m],
      );
      if (operational) {
        await recordMovement(client, id, m);
      }
      if (operational && m.kind !== "initial") {
        await client.query(
          `INSERT INTO pickler.paper_daily_totals(account_id,day,realized) VALUES($1,$2,$3)
          ON CONFLICT(account_id,day) DO UPDATE SET realized=paper_daily_totals.realized+excluded.realized`,
          [id, utcDayStart(m.at), m.delta],
        );
      }
    }
    if (operational) {
      await advanceRecordProjection(client, id);
    }
  }
  async complete(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    fill: PerpsPaperFill,
    exits?: PerpsPaperExits,
  ) {
    if (exits !== undefined) {
      assertExits(exits, isProductPaperSession(scope));
    }
    return this.transaction(async (client) => {
      const locked = await this.owned(client, scope, lease);
      await this.allowed(client, locked, scope, locked.attempt.intent);
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
      const opened = result.account.positions.find((p) => p.id === lease.key);
      if (isProductPaperSession(scope) && locked.attempt.intent.kind === "open" && opened) {
        // The version it opened on (R9) and its exits (R10), in the same transaction as the fill.
        opened.configVersion = locked.agent.version;
        opened.stopPrice = exits?.stopPrice ?? null;
        opened.takeProfitPrice = exits?.takeProfitPrice ?? null;
        opened.exitDueAt = exits?.exitDueAt ?? null;
      }
      const changed =
        opened ??
        result.account.positions.find(
          (position) =>
            position.closedAt === locked.now && position.symbol === locked.attempt.intent.symbol,
        );
      await this.persist(client, locked.id, result.account, result.movements, changed?.id);
      if (opened && locked.attempt.intent.kind === "open") {
        await client.query(
          `INSERT INTO pickler.paper_daily_totals(account_id,day,margin) VALUES($1,$2,$3)
          ON CONFLICT(account_id,day) DO UPDATE SET margin=paper_daily_totals.margin+excluded.margin`,
          [locked.id, utcDayStart(locked.now), opened.margin ?? opened.entryNotional],
        );
      }
      const attempt: PerpsPaperAttempt = {
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
      const view = isProductPaperSession(scope)
        ? await readExecutionSnapshot(client, scope, locked.now)
        : (await this.lock(client, scope)).view;
      if (isProductPaperSession(scope)) {
        view.changes = {
          positions: changed ? [changed] : [],
          attempts: [attempt],
          movements: result.movements,
        };
      }
      return view;
    });
  }
  async fail(
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    code: string,
    evidence: unknown = null,
  ) {
    if (!/^[A-Z_]{1,80}$/.test(code)) {
      throw new PilotError("INVALID_INPUT", "Use a safe failure code");
    }
    await this.transaction(async (client) => {
      const locked = await this.owned(client, scope, lease, true);
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
            evidence,
          },
        ],
      );
    });
  }
  /**
   * Closes one product position at `frame` outside an attempt lease (exits job, owner, stop-all,
   * day-loss, brief exits). A position already closed answers `closed: false` and changes nothing,
   * so a repeated close (or two racing closers) settles exactly once. Only the scope is checked,
   * never the agent's current plugins, policy, network or markets. Operator sessions are refused
   * (`INVALID_INPUT`): they close through the service's leased attempts.
   */
  async closePosition(
    scope: PerpsPaperScope,
    positionId: string,
    reason: PerpsPaperCloseReason,
    frame: PerpsPaperFrame,
  ) {
    const key = `close:${positionId}`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key)) {
      throw new PilotError("INVALID_INPUT", "Invalid position id");
    }
    if (!isProductPaperSession(scope)) {
      throw new PilotError("INVALID_INPUT", "Only product positions close outside an attempt");
    }
    return this.transaction(async (client) => {
      const locked = await this.lock(client, scope, undefined, positionId, false, true);
      const position = locked.view.account.positions.find((p) => p.id === positionId);
      if (!position) {
        throw new PilotError("NOT_FOUND", "Paper position not found");
      }
      if (position.closedAt !== null) {
        return { closed: false, position, view: locked.view };
      }
      assertPerpsPaperScope(locked.agent, scope);
      const intent: PerpsPaperIntent = {
        kind: "close",
        symbol: position.symbol,
        side: position.side,
        notional: "0",
        feeReserve: "1",
      };
      const fill = simulatePerpsFill(locked.view.account, intent, frame, locked.now);
      const attempt: PerpsPaperAttempt = {
        key,
        intent,
        status: "pending",
        reserved: "0",
        createdAt: locked.now,
        finishedAt: null,
        reason: null,
        evidence: null,
      };
      const result = applyPaperFill(locked.view.account, attempt, fill, locked.now);
      const closed = result.account.positions.find((p) => p.id === positionId)!;
      closed.closeReason = reason;
      await this.persist(client, locked.id, result.account, result.movements, positionId);
      const filled: PerpsPaperAttempt = {
        ...attempt,
        status: "filled",
        finishedAt: locked.now,
        reason,
        evidence: fill.evidence,
      };
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,null,null)",
        [locked.id, key, filled],
      );
      if (
        locked.view.account.fundingPending ||
        locked.view.account.lastFundingAt === undefined ||
        locked.now - locked.view.account.lastFundingAt > 30000
      ) {
        await client.query(
          `UPDATE pickler.paper_storage SET coverage_required=greatest(coverage_required,
          coalesce((SELECT closed_sequence FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2),0)) WHERE account_id=$1`,
          [locked.id, positionId],
        );
      }
      const view = await readExecutionSnapshot(client, scope, locked.now);
      view.changes = { positions: [closed], attempts: [filled], movements: result.movements };
      if (view.accounting) {
        view.accounting.closePnl = paperDecimal(
          result.movements.reduce((sum, item) => sum + paperUnits(item.delta), 0n),
        );
      }
      return {
        closed: true,
        position: closed,
        view,
      };
    });
  }
  /**
   * Open product positions whose exit is due, as trading's `exitDue`: a mark at or beyond the
   * liquidation estimate (entry × (1 ∓ 1 / leverage)) or the stop is `stop`, then the target, then
   * time.
   */
  async openDuePositions(marks: readonly PerpsPaperMark[]): Promise<PerpsDuePosition[]> {
    for (const mark of marks) {
      if (
        !["mainnet", "testnet"].includes(mark.network) ||
        !/^[A-Z0-9][A-Z0-9._-]{0,31}(?![\s\S])/.test(mark.symbol) ||
        !DECIMAL.test(mark.mark)
      ) {
        throw new PilotError("INVALID_INPUT", "Invalid mark");
      }
    }
    const now = await this.now(this.pool);
    const result = await this.pool.query<{
      tenantId: string;
      agentId: string;
      network: PerpsPaperScope["network"];
      productAgentId: string;
      position: PerpsPaperPosition;
      reason: PerpsDuePosition["reason"];
    }>(
      `SELECT * FROM (
        SELECT a.tenant_id AS "tenantId", a.agent_id AS "agentId", a.network,
          pa.product_agent_id::text AS "productAgentId", p.document AS position,
          CASE
            WHEN m.mark IS NOT NULL AND p.leverage IS NOT NULL AND p.leverage >= 1 AND (
              (p.document->>'side' = 'long' AND m.mark <= (p.document->>'entryPrice')::numeric -
                (p.document->>'entryPrice')::numeric / p.leverage) OR
              (p.document->>'side' = 'short' AND m.mark >= (p.document->>'entryPrice')::numeric +
                (p.document->>'entryPrice')::numeric / p.leverage)) THEN 'stop'
            WHEN m.mark IS NOT NULL AND p.stop_price IS NOT NULL AND (
              (p.document->>'side' = 'long' AND m.mark <= p.stop_price) OR
              (p.document->>'side' = 'short' AND m.mark >= p.stop_price)) THEN 'stop'
            WHEN m.mark IS NOT NULL AND p.take_profit_price IS NOT NULL AND (
              (p.document->>'side' = 'long' AND m.mark >= p.take_profit_price) OR
              (p.document->>'side' = 'short' AND m.mark <= p.take_profit_price)) THEN 'take_profit'
            WHEN p.exit_due_at IS NOT NULL AND p.exit_due_at <= $2 THEN 'time'
          END AS reason
        FROM pickler.perps_paper_positions p
        JOIN pickler.perps_paper_accounts a ON a.id = p.account_id
        JOIN pickler.product_agents pa ON pa.tenant_id = a.tenant_id AND pa.runtime_agent_id = a.agent_id
        LEFT JOIN jsonb_to_recordset($1::jsonb) AS m(network text, symbol text, mark numeric)
          ON m.network = a.network AND m.symbol = p.symbol
        WHERE p.closed_at IS NULL AND a.session_id = $3
      ) due
      WHERE reason IS NOT NULL
      ORDER BY (position->>'openedAt')::bigint, position->>'id' LIMIT 100`,
      [JSON.stringify(marks), now, PRODUCT_PAPER_SESSION],
    );
    return result.rows.map((row) => ({
      scope: {
        tenantId: row.tenantId,
        agentId: row.agentId,
        sessionId: PRODUCT_PAPER_SESSION,
        network: row.network,
      },
      productAgentId: row.productAgentId,
      position: row.position,
      reason: row.reason,
    }));
  }
  /**
   * Adds margin to an open product position (R8's size-up), filled at `frame` like an open at the
   * position's leverage. The request key is recorded as a filled attempt, so a repeat changes
   * nothing; free paper cash must cover the margin plus the fee reserve.
   */
  async sizeUp(
    scope: PerpsPaperScope,
    positionId: string,
    input: { key: string; margin: string },
    frame: PerpsPaperFrame,
  ) {
    if (
      !isProductPaperSession(scope) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(input.key) ||
      !DECIMAL.test(input.margin) ||
      paperUnits(input.margin) <= 0n
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid size-up");
    }
    return this.transaction(async (client) => {
      const locked = await this.lock(client, scope, input.key, positionId);
      const position = locked.view.account.positions.find((p) => p.id === positionId);
      if (!position) {
        throw new PilotError("NOT_FOUND", "Paper position not found");
      }
      if (locked.view.attempts.some((a) => a.key === input.key)) {
        return { added: false, position, view: locked.view };
      }
      if (position.closedAt !== null) {
        throw new PilotError("POSITION_CLOSED", "The position is closed");
      }
      const leverage = position.leverage ?? 1;
      const notional = paperDecimal(paperUnits(input.margin) * BigInt(leverage));
      const intent: PerpsPaperIntent = {
        kind: "open",
        symbol: position.symbol,
        side: position.side,
        notional,
        feeReserve: productFeeReserve(notional, frame.book.market.fees.taker),
        leverage,
      };
      assertPaperIntent(intent);
      await this.allowed(client, locked, scope, intent);
      const risk = paperRisk(locked.view.account, locked.view.attempts, locked.now);
      if (
        risk.available === null ||
        paperUnits(paperOpenReserve(intent)) > paperUnits(risk.available)
      ) {
        throw new PilotError("INSUFFICIENT_AVAILABLE", "Not enough free paper AUSD");
      }
      const fill = simulatePerpsFill(locked.view.account, intent, frame, locked.now);
      const result = applyPaperSizeUp(locked.view.account, positionId, input.key, fill, locked.now);
      const addedMargin = result.account.positions
        .find((item) => item.id === positionId)!
        .sizeUps!.at(-1)!.margin;
      await client.query(
        "INSERT INTO pickler.paper_position_sizeups(account_id,position_id,key,at,margin) VALUES($1,$2,$3,$4,$5)",
        [locked.id, positionId, input.key, locked.now, addedMargin],
      );
      await this.persist(client, locked.id, result.account, result.movements, positionId);
      await client.query(
        "UPDATE pickler.paper_position_totals SET sizeup_margin=sizeup_margin+$3::numeric WHERE account_id=$1 AND position_id=$2",
        [locked.id, positionId, addedMargin],
      );
      await client.query(
        `INSERT INTO pickler.paper_daily_totals(account_id,day,margin) VALUES($1,$2,$3)
        ON CONFLICT(account_id,day) DO UPDATE SET margin=paper_daily_totals.margin+excluded.margin`,
        [locked.id, utcDayStart(locked.now), addedMargin],
      );
      const attempt: PerpsPaperAttempt = {
        key: input.key,
        intent,
        status: "filled",
        reserved: "0",
        createdAt: locked.now,
        finishedAt: locked.now,
        reason: "size_up",
        evidence: fill.evidence,
      };
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,null,null)",
        [locked.id, input.key, attempt],
      );
      const view = (await this.lock(client, scope)).view;
      view.changes = {
        positions: result.account.positions.filter((p) => p.id === positionId),
        attempts: [attempt],
        movements: result.movements,
      };
      return {
        added: true,
        position: view.account.positions.find((p) => p.id === positionId)!,
        view,
      };
    });
  }
  async openProductAccounts(productAgentId?: string) {
    await this.pool.query(
      `INSERT INTO pickler.paper_storage(account_id,mode)
      SELECT a.id,'legacy' FROM pickler.perps_paper_accounts a
      JOIN pickler.product_agents pa ON pa.tenant_id=a.tenant_id AND pa.runtime_agent_id=a.agent_id
      WHERE ($2::uuid IS NULL OR pa.product_agent_id=$2) AND a.session_id=$1 AND EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=a.id AND p.closed_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM pickler.paper_storage s WHERE s.account_id=a.id)
      ORDER BY a.id LIMIT 50 FOR UPDATE OF a SKIP LOCKED ON CONFLICT DO NOTHING`,
      [PRODUCT_PAPER_SESSION, productAgentId ?? null],
    );
    const result = await this.pool.query(
      `WITH candidates AS MATERIALIZED (
        SELECT a.id FROM pickler.perps_paper_accounts a
        JOIN pickler.paper_storage s ON s.account_id=a.id
        JOIN pickler.product_agents pa ON pa.tenant_id=a.tenant_id AND pa.runtime_agent_id=a.agent_id
        WHERE a.session_id=$1 AND s.mode<>'frozen' AND ($2::uuid IS NULL OR pa.product_agent_id=$2)
          AND EXISTS(SELECT 1 FROM pickler.perps_paper_positions p WHERE p.account_id=a.id AND p.closed_at IS NULL)
        ORDER BY s.exit_at,a.id LIMIT 50 FOR UPDATE OF s SKIP LOCKED
      ), rotated AS (
        UPDATE pickler.paper_storage SET exit_at=floor(extract(epoch FROM clock_timestamp())*1000)
        WHERE account_id IN (SELECT id FROM candidates) RETURNING account_id
      ) SELECT pa.product_agent_id::text AS "productAgentId",a.tenant_id AS "tenantId",a.agent_id AS "agentId",a.network
        FROM rotated r JOIN pickler.perps_paper_accounts a ON a.id=r.account_id
        JOIN pickler.product_agents pa ON pa.tenant_id=a.tenant_id AND pa.runtime_agent_id=a.agent_id`,
      [PRODUCT_PAPER_SESSION, productAgentId ?? null],
    );
    return result.rows.map((row) => ({
      productAgentId: row.productAgentId,
      scope: {
        tenantId: row.tenantId,
        agentId: row.agentId,
        network: row.network,
        sessionId: PRODUCT_PAPER_SESSION,
      },
    }));
  }
  /** Networks with an open product position. */
  async openNetworks() {
    const result = await this.pool.query<{ network: PerpsPaperScope["network"] }>(
      `SELECT DISTINCT a.network
      FROM pickler.perps_paper_positions p
      JOIN pickler.perps_paper_accounts a ON a.id = p.account_id
      WHERE p.closed_at IS NULL AND a.session_id = $1
      ORDER BY a.network`,
      [PRODUCT_PAPER_SESSION],
    );
    return result.rows.map((row) => row.network);
  }
  /** Margin opened since `since`: positions opened then, plus the size-ups added then. */
  async newMarginSince(scope: PerpsPaperScope, since: number) {
    if (!isProductPaperSession(scope)) {
      return marginOpenedSince((await this.snapshot(scope)).account.positions, since);
    }
    if (!Number.isSafeInteger(since)) {
      throw new PilotError("INVALID_INPUT", "Invalid time");
    }
    if (since === utcDayStart(await this.now(this.pool))) {
      return (await this.executionSnapshot(scope)).accounting.newMarginToday;
    }
    const result = await this.pool.query(
      `SELECT coalesce(sum(value),0)::text AS margin FROM (
      SELECT coalesce(p.document->>'margin',p.document->>'entryNotional')::numeric-
        coalesce((SELECT t.sizeup_margin FROM pickler.paper_position_totals t WHERE t.account_id=a.id AND t.position_id=p.id),0) AS value
      FROM pickler.perps_paper_accounts a JOIN pickler.perps_paper_positions p ON p.account_id=a.id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4
        AND (p.document->>'openedAt')::bigint>=$5
      UNION ALL SELECT x.margin FROM pickler.perps_paper_accounts a JOIN pickler.paper_position_sizeups x ON x.account_id=a.id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4 AND x.at>=$5
    ) margins`,
      [...scopeValues(scope), since],
    );
    return paperDecimal(paperUnits(result.rows[0].margin));
  }
  /**
   * The account as `view` answers it, in one read-only repeatable-read transaction with no row
   * locks and no writes: attempts whose lease lapsed are projected `interrupted` (as `lock` would
   * rewrite them) but stay as stored. For reads; every action goes through `view`'s locks.
   */
  async snapshot(scope: PerpsPaperScope): Promise<PerpsPaperView> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await this.archiveSnapshot(db, scope);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async attemptResult(scope: PerpsPaperScope, key: string): Promise<PerpsPaperAttempt | null> {
    const result = await this.pool.query(
      `SELECT t.document FROM pickler.perps_paper_attempts t
      JOIN pickler.perps_paper_accounts a ON a.id=t.account_id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4 AND t.key=$5`,
      [...scopeValues(scope), key],
    );
    return result.rows[0]?.document ?? null;
  }
  async executionSnapshot(scope: PerpsPaperScope): Promise<PaperExecutionState> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await readExecutionSnapshot(db, scope, await this.now(db));
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async recordSnapshot(scope: PerpsPaperScope, input: { now: number; openPnl: string | null }) {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await readRecordSnapshot(db, scope, input);
      await db.query("COMMIT");
      return result;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  historyPage<K extends keyof PaperHistoryEntities>(
    scope: PerpsPaperScope,
    kind: K,
    options: PaperHistoryPageOptions = {},
  ) {
    return readHistoryPage(this.pool, scope, kind, options);
  }
  position(scope: PerpsPaperScope, id: string) {
    return readHistoryPosition(this.pool, scope, id);
  }
  async closedPositions(scope: PerpsPaperScope, options: { cursor?: string; limit?: number } = {}) {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new PilotError("INVALID_INPUT", "Invalid closed-position page size");
    }
    const found = await this.pool.query(
      `SELECT a.id,s.mode FROM pickler.perps_paper_accounts a
      LEFT JOIN pickler.paper_storage s ON s.account_id=a.id
      WHERE a.tenant_id=$1 AND a.agent_id=$2 AND a.session_id=$3 AND a.network=$4`,
      scopeValues(scope),
    );
    const account = found.rows[0];
    if (!account) {
      throw new PilotError("NOT_FOUND", "Paper account not found");
    }
    if (account.mode !== "operational") {
      return { items: [], nextCursor: null, complete: false };
    }
    const valid = (value: unknown): value is string =>
      typeof value === "string" &&
      /^\d{1,19}$/.test(value) &&
      BigInt(value) <= 9223372036854775807n;
    let cursor: {
      account: string;
      kind: string;
      watermark: string;
      sequence: string;
      v: number;
    } | null = null;
    if (options.cursor !== undefined) {
      try {
        if (!options.cursor || options.cursor.length > 4096) {
          throw new Error("Invalid cursor");
        }
        const value = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
        if (
          value.v !== 1 ||
          value.account !== account.id ||
          value.kind !== "closed" ||
          !valid(value.watermark) ||
          !valid(value.sequence) ||
          BigInt(value.sequence) > BigInt(value.watermark)
        ) {
          throw new Error("Invalid cursor");
        }
        cursor = value;
      } catch {
        throw new PilotError("INVALID_INPUT", "Invalid closed-position cursor");
      }
    }
    const watermark =
      cursor?.watermark ??
      (
        await this.pool.query(
          `SELECT coalesce(max(closed_sequence),0)::text AS watermark
      FROM pickler.perps_paper_positions WHERE account_id=$1 AND closed_at IS NOT NULL`,
          [account.id],
        )
      ).rows[0].watermark;
    const result = await this.pool.query(
      `SELECT p.closed_sequence::text AS sequence,p.document,t.pnl::text AS pnl
      FROM pickler.perps_paper_positions p LEFT JOIN pickler.paper_position_totals t ON t.account_id=p.account_id AND t.position_id=p.id
      WHERE p.account_id=$1 AND p.closed_at IS NOT NULL AND p.closed_sequence<=$2::bigint
        AND ($3::bigint IS NULL OR p.closed_sequence<$3::bigint) ORDER BY p.closed_sequence DESC LIMIT $4`,
      [account.id, watermark, cursor?.sequence ?? null, limit + 1],
    );
    if (result.rows.some((row) => row.pnl === null)) {
      throw new PilotError("DATA_UNAVAILABLE", "Closed-position totals are incomplete");
    }
    const items = result.rows.slice(0, limit);
    const nextCursor =
      result.rows.length > limit
        ? Buffer.from(
            JSON.stringify({
              v: 1,
              account: account.id,
              kind: "closed",
              watermark,
              sequence: items.at(-1)!.sequence,
            }),
          ).toString("base64url")
        : null;
    return {
      items: items.map((row) => ({
        position: row.document as PerpsPaperPosition,
        pnl: paperDecimal(paperUnits(row.pnl)),
      })),
      nextCursor,
      complete: true,
    };
  }
}
function assertExits(exits: PerpsPaperExits, product: boolean) {
  if (
    !product ||
    [exits.stopPrice, exits.takeProfitPrice].some(
      (price) => price !== null && (!DECIMAL.test(price) || paperUnits(price) <= 0n),
    ) ||
    (exits.exitDueAt !== null && !Number.isSafeInteger(exits.exitDueAt))
  ) {
    throw new PilotError("INVALID_INPUT", "Exits are product-only positive prices and a time");
  }
}
