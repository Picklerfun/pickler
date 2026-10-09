import {
  assertEntryEvidence,
  canonicalAudit,
  SMA_ENTRY_POLICIES,
  type SmaReentryVariant,
  type PerpsEvidence,
} from "@pickler/trading/evaluation";
import { randomUUID, createHash } from "node:crypto";
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
  validatePaperFrame,
  COMPONENT_PAPER_POLICY,
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
    private readonly receiptClock?: () => number,
  ) {}
  private receiptNow() {
    return this.receiptClock?.() ?? this.clock?.() ?? Date.now();
  }
  private async transaction<T>(
    action: (client: PoolClient) => Promise<T>,
    beforeCommit?: (client: PoolClient) => Promise<void>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.guardStudy(client);
      await this.guardProduct(client);
      const result = await action(client);
      await this.guardStudy(client);
      await this.guardProduct(client);
      await beforeCommit?.(client);
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
    await this.checkDataPolicy(client, scope, row.document);
    const now = await this.now(client);
    if (row.document.marketDataPolicy !== COMPONENT_PAPER_POLICY || this.studyOwner) {
      await client.query(
        `UPDATE pickler.perps_paper_attempts SET document = document || jsonb_build_object('status','interrupted','reserved','0','reason','LEASE_EXPIRED','finishedAt',$2::bigint), owner=null, expires_at=null WHERE account_id=$1 AND owner IS NOT NULL AND expires_at <= $2`,
        [row.id, now],
      );
    }
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
  private async checkDataPolicy(
    client: PoolClient,
    scope: PerpsPaperScope,
    account: PerpsPaperAccount,
    requireOwner = false,
  ) {
    const result = await client.query<{
      document: import("@pickler/trading/evaluation").PerpsStudyRecord;
    }>(
      "SELECT document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
      [scope.tenantId, scope.sessionId, scope.network],
    );
    const record = result.rows[0]?.document;
    const expected =
      record?.config.version === 7 && record.config.acquisitionPolicy === COMPONENT_PAPER_POLICY
        ? COMPONENT_PAPER_POLICY
        : undefined;
    if (
      account.marketDataPolicy !== expected ||
      (expected &&
        (!Object.values(record!.agentIds).includes(scope.agentId) ||
          record!.dataPolicy !== expected ||
          isProductPaperSession(scope)))
    ) {
      throw new PilotError("CONFIG_CHANGED", "Trusted account market-data policy changed");
    }
    if (
      expected &&
      requireOwner &&
      (!this.studyOwner ||
        this.studyOwner.tenantId !== scope.tenantId ||
        this.studyOwner.sessionId !== scope.sessionId ||
        this.studyOwner.network !== scope.network)
    ) {
      throw new PilotError(
        "LEASE_LOST",
        "Component-policy financial writes require their study owner",
      );
    }
  }
  async closeAdmissions(scope: PerpsPaperScope) {
    await this.transaction(async (client) => {
      const locked = await this.lock(client, scope);
      await this.checkDataPolicy(client, scope, locked.view.account, true);
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
      await this.checkDataPolicy(client, scope, locked.view.account, true);
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
          if (!locked.agent.config.perpl!.markets.includes(frame.snapshot.market.symbol)) {
            throw new PilotError("MARKET_NOT_ALLOWED", "Observation market is not permitted");
          }
        }
      }
      const result = applyPaperObservation(
        locked.view.account,
        locked.view.movements,
        observation,
        key,
        locked.now,
        this.receiptNow(),
      );
      await this.persist(client, locked.id, result.account, result.movements);
      const view = (await this.lock(client, scope)).view;
      await client.query(
        "INSERT INTO pickler.perps_paper_observations(account_id,key,document,result) VALUES($1,$2,$3,$4)",
        [locked.id, key, observation, { account: view.account, attempts: [], movements: [] }],
      );
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
      const study = await client.query<{
        document: import("@pickler/trading/evaluation").PerpsStudyRecord;
      }>(
        "SELECT document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
        [scope.tenantId, scope.sessionId, scope.network],
      );
      const record = study.rows[0]?.document;
      if (record?.config.version === 6 || record?.config.version === 7) {
        const variant = Object.entries(record.agentIds).find(([, id]) => id === scope.agentId)?.[0];
        if (!variant) {
          throw new PilotError("FORBIDDEN", "Account is not a profile study member");
        }
        account.riskManagement =
          record.config.version === 7 || variant.endsWith("-selective")
            ? "buffered-selective-1x-v1"
            : "legacy-1x-v1";
      }
      if (record?.config.version === 7) {
        const variant = Object.entries(record.agentIds).find(
          ([, id]) => id === scope.agentId,
        )?.[0] as SmaReentryVariant;
        account.entryPolicy = SMA_ENTRY_POLICIES[variant];
        account.consumedEntryKeys = [];
        if (record.config.acquisitionPolicy === COMPONENT_PAPER_POLICY) {
          account.marketDataPolicy = COMPONENT_PAPER_POLICY;
        }
      }
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
              delta: account.cash,
              at: now,
              evidence: { policy: account.policy },
            },
          ],
        );
      }
      const locked = await this.lock(client, scope);
      if (!product && locked.view.account.agentVersion !== expectedVersion) {
        throw new PilotError("CONFIG_CHANGED", "Existing paper session has another config version");
      }
      return locked.view;
    });
  }
  async view(scope: PerpsPaperScope) {
    return this.transaction(async (client) => (await this.lock(client, scope)).view);
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
    await this.checkDataPolicy(client, scope, locked.view.account, true);
    const study = await client.query<{
      document: import("@pickler/trading/evaluation").PerpsStudyRecord;
    }>(
      "SELECT document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
      [scope.tenantId, scope.sessionId, scope.network],
    );
    const record = study.rows[0]?.document;
    if (record?.config.version === 6 || record?.config.version === 7) {
      const variant = Object.entries(record.agentIds).find(([, id]) => id === scope.agentId)?.[0];
      const expected =
        record.config.version === 7 || variant?.endsWith("-selective")
          ? "buffered-selective-1x-v1"
          : "legacy-1x-v1";
      if (!variant || locked.view.account.riskManagement !== expected) {
        throw new PilotError("CONFIG_CHANGED", "Trusted account risk management changed");
      }
      if (
        intent.kind === "open" &&
        locked.view.account.positions.filter((p) => p.closedAt === null).length >= 5
      ) {
        throw new PilotError("RISK_REJECTED", "Maximum five positions");
      }
    }
    if (record?.config.version === 7) {
      const variant = Object.entries(record.agentIds).find(
        ([, id]) => id === scope.agentId,
      )?.[0] as SmaReentryVariant;
      if (
        !SMA_ENTRY_POLICIES[variant] ||
        locked.view.account.entryPolicy !== SMA_ENTRY_POLICIES[variant]
      ) {
        throw new PilotError("CONFIG_CHANGED", "Account entry policy is immutable");
      }
      if (intent.kind === "open") {
        await this.entryKey(client, locked, scope, intent);
      }
    } else if (intent.entryEvidence !== undefined) {
      throw new PilotError("INVALID_INPUT", "Entry evidence is restricted to the v7 laboratory");
    }
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
        newMarginToday: marginOpenedSince(locked.view.account.positions, utcDayStart(locked.now)),
        realizedToday: paperDecimal(
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
    if (!locked.agent.config.perpl!.markets.includes(intent.symbol)) {
      throw new PilotError("MARKET_NOT_ALLOWED", "Paper market is not permitted");
    }
    if (locked.agent.paused && intent.kind === "open") {
      throw new PilotError("PAUSED", "Agent is paused");
    }
  }
  private async entryKey(
    client: PoolClient,
    locked: Locked,
    scope: PerpsPaperScope,
    intent: PerpsPaperIntent,
    fill?: PerpsPaperFill,
  ) {
    const ref = intent.entryEvidence;
    if (!ref || !/^round-[0-9]{3}$/.test(ref.roundKey)) {
      throw new PilotError("DATA_UNAVAILABLE", "Persisted final round required");
    }
    const saved = await client.query(
      `SELECT e.data FROM pickler.perps_study_events e
      JOIN pickler.perps_studies s ON s.id=e.study_id
      WHERE s.tenant_id=$1 AND s.session_id=$2 AND s.network=$3 AND e.key=$4`,
      [scope.tenantId, scope.sessionId, scope.network, `${ref.roundKey}:final-evidence`],
    );
    const document = saved.rows[0]?.data as
      { evidence?: PerpsEvidence; data?: { evidence?: PerpsEvidence } } | undefined;
    const evidence = document?.evidence ?? document?.data?.evidence;
    if (!evidence) {
      throw new PilotError("DATA_UNAVAILABLE", "Trusted final snapshot absent");
    }
    const key = assertEntryEvidence(locked.view.account, intent, evidence, locked.now);
    const variant =
      locked.view.account.entryPolicy === "once-hourly-bar-v1" ? "sma-once-bar" : "sma-reference";
    const gate = await client.query(
      "SELECT data FROM pickler.perps_study_events WHERE study_id=(SELECT id FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3) AND key=$4",
      [scope.tenantId, scope.sessionId, scope.network, `${ref.roundKey}:${variant}:final-gate`],
    );
    const decision = gate.rows[0]?.data as
      | {
          initial?: { symbol: string; action: string }[];
          final?: { symbol: string; action: string }[];
        }
      | undefined;
    const action = intent.side === "long" ? "open-long" : "open-short";
    if (
      !decision?.initial?.some((p) => p.symbol === intent.symbol && p.action === action) ||
      !decision?.final?.some((p) => p.symbol === intent.symbol && p.action === action)
    ) {
      throw new PilotError(
        "RISK_REJECTED",
        "Opening must match both persisted proposal and final admission",
      );
    }
    if (fill) {
      const frame = evidence.frames.find((f) => f.snapshot.market.symbol === intent.symbol)!;
      const expected = simulatePerpsFill(
        locked.view.account,
        intent,
        frame,
        locked.now,
        this.receiptNow(),
      );
      if (canonicalAudit(fill) !== canonicalAudit(expected)) {
        throw new PilotError(
          "INVALID_MARKET_DATA",
          "Fill must use the shared persisted final evidence",
        );
      }
    }
    return key;
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
    return this.transaction(async (client) =>
      this.beginLocked(client, await this.lock(client, scope), scope, expectedVersion, key, intent),
    );
  }
  private async beginLocked(
    client: PoolClient,
    locked: Locked,
    scope: PerpsPaperScope,
    expectedVersion: number,
    key: string,
    intent: PerpsPaperIntent,
  ) {
    const previous = locked.view.attempts.find((a) => a.key === key);
    if (previous) {
      if (
        previous.intent.kind !== intent.kind ||
        previous.intent.symbol !== intent.symbol ||
        previous.intent.side !== intent.side ||
        paperUnits(previous.intent.notional) !== paperUnits(intent.notional) ||
        paperUnits(previous.intent.feeReserve) !== paperUnits(intent.feeReserve) ||
        previous.intent.leverage !== intent.leverage ||
        previous.intent.checkId !== intent.checkId ||
        JSON.stringify(previous.intent.entryEvidence) !== JSON.stringify(intent.entryEvidence)
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
  }
  async executeFrame(
    scope: PerpsPaperScope,
    key: string,
    intent: PerpsPaperIntent,
    frame: PerpsPaperFrame,
    onSimulation?: (durationMs: number) => void,
  ): Promise<PerpsPaperView> {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key)) {
      throw new PilotError("INVALID_INPUT", "Invalid request key");
    }
    assertPaperIntent(intent);
    const captured = structuredClone(frame);
    let attemptExpiresAt: number | null = null;
    return this.transaction(
      async (client) => {
        const locked = await this.lock(client, scope);
        if (
          isProductPaperSession(scope) ||
          locked.view.account.marketDataPolicy !== COMPONENT_PAPER_POLICY
        ) {
          throw new PilotError("INVALID_INPUT", "Captured execution is component-paper only");
        }
        await this.checkDataPolicy(client, scope, locked.view.account, true);
        const admitted = await this.beginLocked(
          client,
          locked,
          scope,
          locked.view.account.agentVersion,
          key,
          intent,
        );
        if (!locked.view.attempts.some((a) => a.key === key)) {
          locked.view.attempts.push(admitted.attempt);
        }
        if (!admitted.lease) {
          return locked.view;
        }
        attemptExpiresAt = admitted.lease.expiresAt;
        locked.now = await this.now(client);
        if (locked.now >= attemptExpiresAt) {
          throw new PilotError("LEASE_LOST", "Paper lease expired during captured execution");
        }
        const started = performance.now();
        const fill = simulatePerpsFill(
          locked.view.account,
          intent,
          captured,
          locked.now,
          this.receiptNow(),
        );
        onSimulation?.(performance.now() - started);
        return this.completeLocked(
          client,
          { ...locked, attempt: admitted.attempt },
          scope,
          admitted.lease,
          fill,
          undefined,
          true,
        );
      },
      async (client) => {
        if (attemptExpiresAt === null) {
          return;
        }
        const financialAt = await this.now(client);
        if (financialAt >= attemptExpiresAt) {
          throw new PilotError("LEASE_LOST", "Paper lease expired during captured execution");
        }
        validatePaperFrame(
          captured,
          scope.network,
          intent.symbol,
          financialAt,
          COMPONENT_PAPER_POLICY,
          this.receiptNow(),
        );
      },
    );
  }
  private async owned(client: PoolClient, scope: PerpsPaperScope, lease: PerpsPaperLease) {
    const locked = await this.lock(client, scope);
    await this.checkDataPolicy(client, scope, locked.view.account, true);
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
  ) {
    await client.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
      id,
      account,
    ]);
    for (const p of account.positions) {
      await client.query(
        `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document,check_id,config_version,leverage,margin,stop_price,take_profit_price,exit_due_at,close_reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(account_id,id) DO UPDATE SET closed_at=excluded.closed_at,document=excluded.document,
        check_id=excluded.check_id,config_version=excluded.config_version,leverage=excluded.leverage,margin=excluded.margin,
        stop_price=excluded.stop_price,take_profit_price=excluded.take_profit_price,exit_due_at=excluded.exit_due_at,close_reason=excluded.close_reason`,
        [
          id,
          p.id,
          p.symbol,
          p.closedAt,
          p,
          p.checkId ?? null,
          p.configVersion ?? null,
          p.leverage ?? null,
          p.margin ?? null,
          p.stopPrice ?? null,
          p.takeProfitPrice ?? null,
          p.exitDueAt ?? null,
          p.closeReason ?? null,
        ],
      );
    }
    for (const m of movements) {
      await client.query(
        "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
        [id, m.key, m],
      );
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
    return this.transaction(async (client) =>
      this.completeLocked(
        client,
        await this.owned(client, scope, lease),
        scope,
        lease,
        fill,
        exits,
      ),
    );
  }
  private async completeLocked(
    client: PoolClient,
    locked: Locked & { attempt: PerpsPaperAttempt },
    scope: PerpsPaperScope,
    lease: PerpsPaperLease,
    fill: PerpsPaperFill,
    exits?: PerpsPaperExits,
    inlineView = false,
  ) {
    await this.allowed(client, locked, scope, locked.attempt.intent);
    if (locked.view.account.marketDataPolicy === COMPONENT_PAPER_POLICY) {
      const frame = (fill.evidence as { frame?: PerpsPaperFrame } | null)?.frame;
      if (!frame) {
        throw new PilotError("INVALID_MARKET_DATA", "A component-policy fill requires its frame");
      }
      const digest = createHash("sha256")
        .update(
          JSON.stringify({
            snapshot: frame.snapshot,
            book: frame.book,
            streamEvidence: frame.streamEvidence,
          }),
        )
        .digest("hex");
      if (
        digest !== frame.hash ||
        canonicalAudit(
          simulatePerpsFill(
            locked.view.account,
            locked.attempt.intent,
            frame,
            locked.now,
            this.receiptNow(),
          ),
        ) !== canonicalAudit(fill)
      ) {
        throw new PilotError("INVALID_MARKET_DATA", "Component-policy fill evidence changed");
      }
    }
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
    if (
      locked.attempt.intent.kind === "open" &&
      result.account.riskManagement === "buffered-selective-1x-v1"
    ) {
      const projected = paperRisk(result.account, [], locked.now);
      if (
        projected.equity === null ||
        projected.exposure === null ||
        paperUnits(projected.exposure) * 5n > paperUnits(projected.equity) * 2n
      ) {
        throw new PilotError("RISK_REJECTED", "Post-fill exposure exceeds buffered target");
      }
    }
    const opened = result.account.positions.find((p) => p.id === lease.key);
    if (isProductPaperSession(scope) && locked.attempt.intent.kind === "open" && opened) {
      // The version it opened on (R9) and its exits (R10), in the same transaction as the fill.
      opened.configVersion = locked.agent.version;
      opened.stopPrice = exits?.stopPrice ?? null;
      opened.takeProfitPrice = exits?.takeProfitPrice ?? null;
      opened.exitDueAt = exits?.exitDueAt ?? null;
    }
    if (locked.attempt.intent.kind === "open" && result.account.entryPolicy) {
      const entryKey = await this.entryKey(client, locked, scope, locked.attempt.intent, fill);
      if (result.account.entryPolicy === "once-hourly-bar-v1" && entryKey) {
        result.account.consumedEntryKeys = [...(result.account.consumedEntryKeys ?? []), entryKey];
      }
    }
    await this.persist(client, locked.id, result.account, result.movements);
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
    if (!inlineView) {
      return (await this.lock(client, scope)).view;
    }
    const byKey = (a: { key: string }, b: { key: string }) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    return {
      account: result.account,
      attempts: locked.view.attempts.map((a) => (a.key === lease.key ? attempt : a)).sort(byKey),
      movements: [...locked.view.movements, ...result.movements].sort(byKey),
    };
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
      const locked = await this.lock(client, scope);
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
      const fill = simulatePerpsFill(
        locked.view.account,
        intent,
        frame,
        locked.now,
        this.receiptNow(),
      );
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
      await this.persist(client, locked.id, result.account, result.movements);
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,null,null)",
        [
          locked.id,
          key,
          {
            ...attempt,
            status: "filled",
            finishedAt: locked.now,
            reason,
            evidence: fill.evidence,
          },
        ],
      );
      const view = (await this.lock(client, scope)).view;
      return {
        closed: true,
        position: view.account.positions.find((p) => p.id === positionId)!,
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
        !["BTC", "ETH"].includes(mark.symbol) ||
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
      ORDER BY (position->>'openedAt')::bigint, position->>'id'`,
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
      const locked = await this.lock(client, scope);
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
      const fill = simulatePerpsFill(
        locked.view.account,
        intent,
        frame,
        locked.now,
        this.receiptNow(),
      );
      const result = applyPaperSizeUp(locked.view.account, positionId, input.key, fill, locked.now);
      await this.persist(client, locked.id, result.account, result.movements);
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,null,null)",
        [
          locked.id,
          input.key,
          {
            key: input.key,
            intent,
            status: "filled",
            reserved: "0",
            createdAt: locked.now,
            finishedAt: locked.now,
            reason: "size_up",
            evidence: fill.evidence,
          },
        ],
      );
      const view = (await this.lock(client, scope)).view;
      return {
        added: true,
        position: view.account.positions.find((p) => p.id === positionId)!,
        view,
      };
    });
  }
  async openProductAccounts() {
    const result = await this.pool.query(
      `SELECT DISTINCT pa.product_agent_id::text AS "productAgentId", a.tenant_id AS "tenantId", a.agent_id AS "agentId", a.network
      FROM pickler.perps_paper_accounts a JOIN pickler.perps_paper_positions p ON p.account_id=a.id
      JOIN pickler.product_agents pa ON pa.tenant_id=a.tenant_id AND pa.runtime_agent_id=a.agent_id
      WHERE a.session_id=$1 AND p.closed_at IS NULL`,
      [PRODUCT_PAPER_SESSION],
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
    if (!Number.isSafeInteger(since)) {
      throw new PilotError("INVALID_INPUT", "Invalid time");
    }
    return marginOpenedSince((await this.snapshot(scope)).account.positions, since);
  }
  /**
   * The account as `view` answers it, in one read-only repeatable-read transaction with no row
   * locks and no writes: attempts whose lease lapsed are projected `interrupted` (as `lock` would
   * rewrite them) but stay as stored. For reads; every action goes through `view`'s locks.
   */
  async snapshot(scope: PerpsPaperScope): Promise<PerpsPaperView> {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(scope.sessionId) ||
      !["mainnet", "testnet"].includes(scope.network)
    ) {
      throw new PilotError("INVALID_INPUT", "Invalid paper scope");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await client.query<{ id: string; document: PerpsPaperAccount }>(
        "SELECT id,document FROM pickler.perps_paper_accounts WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4",
        [scope.tenantId, scope.agentId, scope.sessionId, scope.network],
      );
      const row = result.rows[0];
      if (!row) {
        throw new PilotError("NOT_FOUND", "Paper account not found");
      }
      const now = await this.now(client);
      const attempts = await client.query<{
        document: PerpsPaperAttempt;
        lapsed: boolean;
      }>(
        "SELECT document, (owner IS NOT NULL AND expires_at <= $2) AS lapsed FROM pickler.perps_paper_attempts WHERE account_id=$1 ORDER BY key",
        [row.id, now],
      );
      const movements = await client.query<{ document: PerpsPaperMovement }>(
        "SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1 ORDER BY key",
        [row.id],
      );
      await client.query("COMMIT");
      return {
        account: row.document,
        attempts: attempts.rows.map((r) =>
          r.lapsed
            ? {
                ...r.document,
                status: "interrupted",
                reserved: "0",
                reason: "LEASE_EXPIRED",
                finishedAt: now,
              }
            : r.document,
        ),
        movements: movements.rows.map((r) => r.document),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
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
