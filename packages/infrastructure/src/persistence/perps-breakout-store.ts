import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
  DEFAULT_CONFIG,
  PERP_TOOLS,
  PilotError,
  type AgentRecord,
  type PerpFundingHistory,
} from "@pickler/core";
import {
  BREAKOUT_FINANCIAL_ROLES,
  assertHourlyBreakoutConfig,
  assertBreakoutAcceptance,
  assertBreakoutAccount,
  assertBreakoutMarketIdentity,
  assertBreakoutHead,
  breakoutAccountNamespace,
  breakoutCloseFenced,
  breakoutOpeningIntent,
  breakoutWindowTimes,
  canonicalBreakoutJson,
  type BreakoutAccountState,
  type BreakoutAcknowledgement,
  type BreakoutClockBoundary,
  type BreakoutCloseObligation,
  type BreakoutDiscovery,
  type BreakoutDurableResult,
  type BreakoutFinalSet,
  type BreakoutFinancialReceiptContext,
  type BreakoutFinancialReceiptHooks,
  type BreakoutFinancialRole,
  type BreakoutReservedHead,
  type BreakoutRunAcceptance,
  type BreakoutScreenSnapshot,
  type BreakoutScreenStore,
  type BreakoutUnknownBarrier,
  type HourlyBreakoutVariant,
  type PerpsHourlyBreakoutConfig,
  type PerpsStudyLease,
  type PerpsStudyScope,
} from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  applyPaperFill,
  applyPaperMarks,
  applyPaperPositionFunding,
  assertPerpsPaperAgent,
  finalizePaperObservationDelta,
  initialPaperAccount,
  paperDecimal,
  paperRisk,
  paperUnits,
  simulatePerpsFill,
  selectiveReduction,
  validatePaperFrame,
  validatePaperFrameSet,
  type PerpsPaperAccount,
  type PerpsPaperAttempt,
  type PerpsPaperLease,
  type PerpsPaperMovement,
  type PerpsPaperObservation,
  type PerpsPaperPosition,
  type PerpsPaperScope,
  type PerpsPaperView,
} from "@pickler/trading/perps";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hash = (value: unknown) => sha(canonicalBreakoutJson(value));
const roleVariant: Record<BreakoutFinancialRole, HourlyBreakoutVariant> = {
  C: "hourly-breakout",
  S: "sma-reference",
  L: "hourly-long",
};
const scopeValues = (scope: PerpsStudyScope) => [scope.tenantId, scope.sessionId, scope.network];
const operationKey = (operationId: string) => `breakout-operation:${sha(operationId)}`;
const openingOperation = (head: BreakoutReservedHead) =>
  `${head.discovery.finalOperationId}:open:${head.discovery.role}:${head.discovery.attemptId}`;
const closingOperation = (finalSet: BreakoutFinalSet, obligation: BreakoutCloseObligation) =>
  `${finalSet.operationId}:close:${obligation.role}:${obligation.id}`;
const consumptionKey = (role: BreakoutFinancialRole, episodeKey: string) =>
  `breakout-consumed:${role}:${sha(episodeKey)}`;
const safeCode = (error: unknown) =>
  error instanceof PilotError && /^[A-Z0-9_]{1,80}$/.test(error.code)
    ? error.code
    : "PERSISTENCE_FAILED";

interface AccountIdentity {
  version: 10;
  role: BreakoutFinancialRole;
  protocolDigest: string;
  T0: number;
  namespace: string;
  operatorIdentity: string;
}
export interface PerpsBreakoutFundingState {
  version: 1;
  closed: number;
  pendingClosed: number;
  disputedClosed: number;
  uninitializedClosed: number;
}
interface FundingPositionStatus {
  version: 1;
  pending: boolean;
  disputed: boolean;
  uninitialized: boolean;
}
type BreakoutAccount = PerpsPaperAccount & {
  breakout: AccountIdentity;
  breakoutFundingState: PerpsBreakoutFundingState;
};
interface FundingPosition extends PerpsPaperPosition {
  breakoutFundingStatus?: FundingPositionStatus;
  breakoutFundingDispute?: { sourceKey: string; sourceSha256: string; operationId: string };

  breakoutFunding?: {
    version: 1;
    sourceKey: string;
    sourceSha256: string;
    checkedAt: number;
    operationId: string;
    pending: boolean;
    originalSourceKey: string;
    completeSourceKey: string | null;
    from: number;
    to: number;
    complete: boolean;
  };
}
export interface PerpsBreakoutFundingRequirement {
  key: string;
  role: BreakoutFinancialRole;
  positionId: string;
  symbol: PerpsPaperPosition["symbol"];
  marketId: number;
  from: number;
  to: number;
  previousCheckedAt: number | null;
}
interface CurrentDiscovery {
  operationId: string;
  H: number;
  D: number;
  discoveries: BreakoutDiscovery[];
  resolved: Record<string, string>;
}
export interface PerpsBreakoutStudyRecord {
  config: PerpsHourlyBreakoutConfig;
  metadata: unknown;
  acceptance: BreakoutRunAcceptance;
  agentIds: Record<HourlyBreakoutVariant, string>;
  agentVersions: Record<HourlyBreakoutVariant, number>;
  createdAt: number;
  startedAt: number | null;
  status: "initialized" | "running" | "completed" | "interrupted";
  lastAttemptedSlot: number;
  admissionsClosed: boolean;
  interruption: string | null;
  current: CurrentDiscovery | null;
  closeObligations: BreakoutCloseObligation[];
  unknownBarriers: BreakoutUnknownBarrier[];
  closedFences: BreakoutScreenSnapshot["closedFences"];
}
interface StudyRow {
  id: string;
  document: PerpsBreakoutStudyRecord;
  owner: string | null;
  expires_at: string | null;
}
interface NativePending {
  key: string;
  document: PerpsPaperAttempt;
  owner: string | null;
  expires_at: string | null;
}
interface LockedAccount {
  id: string;
  role: BreakoutFinancialRole;
  scope: PerpsPaperScope;
  account: BreakoutAccount;
  pending: NativePending[];
}
interface TransactionValue<T> {
  value: T;
  replayed?: boolean;
  contexts?: BreakoutFinancialReceiptContext[];
  beforeCommit?: () => Promise<void>;
}
export interface PerpsBreakoutStoreOptions {
  /** The composition root supplies the accepted native financial clock; tests may control it. */
  clock?: () => number;
  receiptClock?: () => number;
  financialReceipts?: BreakoutFinancialReceiptHooks;
}

/** Dedicated v10 persistence; old paper/study stores cannot enter this lifecycle. */
export class PostgresPerpsHourlyBreakoutStore implements BreakoutScreenStore {
  private readonly revoked = new Set<string>();
  private readonly localUnknown = new Set<BreakoutFinancialRole>();
  private openingsUnproved = false;
  private readonly receipts = new Map<string, BreakoutAcknowledgement>();
  private readonly noEffect = new Map<string, BreakoutAcknowledgement>();

  constructor(
    readonly pool: Pool,
    private readonly options: PerpsBreakoutStoreOptions = {},
  ) {}

  async sampleDatabaseClock(): Promise<{ databaseAt: number }> {
    const result = await this.pool.query<{ databaseAt: number }>(
      'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS "databaseAt"',
    );
    return result.rows[0]!;
  }

  private async now(client: PoolClient | Pool) {
    if (this.options.clock) {
      return this.options.clock();
    }
    const result = await client.query<{ now: number }>(
      "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
    );
    return result.rows[0]!.now;
  }

  private receiptNow() {
    return this.options.receiptClock?.() ?? this.options.clock?.() ?? Date.now();
  }

  private active(lease: PerpsStudyLease) {
    lease.assertActive?.();
    if (this.revoked.has(lease.owner)) {
      throw new PilotError("LEASE_LOST", "Hourly breakout ownership was revoked");
    }
  }

  private async study(client: PoolClient, scope: PerpsStudyScope, exclusive = true) {
    const result = await client.query<StudyRow>(
      `SELECT id,document,owner,expires_at FROM pickler.perps_studies
       WHERE tenant_id=$1 AND session_id=$2 AND network=$3${exclusive ? " FOR UPDATE" : ""}`,
      scopeValues(scope),
    );
    const row = result.rows[0];
    if (!row) {
      throw new PilotError("NOT_FOUND", "Hourly breakout study not found");
    }
    assertHourlyBreakoutConfig(row.document.config);
    if (
      !row.document.acceptance ||
      row.document.acceptance.protocolDigest !== row.document.config.researchProtocolSha256 ||
      !Array.isArray(row.document.unknownBarriers)
    ) {
      throw new PilotError("CONFIG_CHANGED", "Study has no accepted financial v10 identity");
    }
    return row;
  }

  private async owned(client: PoolClient, row: StudyRow, lease: PerpsStudyLease) {
    this.active(lease);
    const now = await this.now(client);
    if (row.owner !== lease.owner || Number(row.expires_at) <= now) {
      this.revoked.add(lease.owner);
      throw new PilotError("LEASE_LOST", "Hourly breakout ownership expired");
    }
    this.active(lease);
    return now;
  }

  private async saveStudy(client: PoolClient, row: StudyRow) {
    await client.query("UPDATE pickler.perps_studies SET document=$2 WHERE id=$1", [
      row.id,
      row.document,
    ]);
  }

  private replayAcknowledgement(operationId: string, recordId: string): BreakoutAcknowledgement {
    let journal: BreakoutAcknowledgement | null = null;
    try {
      journal = this.options.financialReceipts?.getAcknowledgement?.(operationId) ?? null;
    } catch {
      // No new sample is taken when an original receipt journal cannot be read.
    }
    return (
      this.receipts.get(operationId) ??
      journal ?? {
        operationId,
        authoritativeRecordId: recordId,
        receivedAt: null,
        receiptStatus: "ORIGINAL_RECEIPT_UNAVAILABLE",
      }
    );
  }

  private originalAcknowledgement(
    operationId: string,
    recordId: string,
    contexts: readonly BreakoutFinancialReceiptContext[],
    acceptedCertificateIds: readonly string[],
  ): BreakoutAcknowledgement {
    // This is the first code executed after definitive COMMIT success. No event/callback precedes it.
    let receivedAt: number | null = null;
    try {
      receivedAt = this.receiptNow();
    } catch {
      this.openingsUnproved = contexts.length > 0;
    }
    const acknowledgement: BreakoutAcknowledgement = {
      operationId,
      authoritativeRecordId: recordId,
      receivedAt,
    };
    if (contexts.length) {
      const boundaries: BreakoutClockBoundary[] = [];
      try {
        if (!this.options.financialReceipts) {
          throw new PilotError(
            "RECEIPT_PROOF_UNAVAILABLE",
            "Original paired receipt hook is absent",
          );
        }
        for (const context of contexts) {
          const boundary = this.options.financialReceipts.afterCommit(context);
          if (
            !boundary ||
            boundary.kind !== (context.action === "FULL_CLOSE" ? "V_CLOSE" : "V") ||
            !acceptedCertificateIds.includes(boundary.certificateId) ||
            canonicalBreakoutJson([...(boundary.marketIds ?? [])].sort((a, b) => a - b)) !==
              canonicalBreakoutJson([...context.marketIds].sort((a, b) => a - b)) ||
            canonicalBreakoutJson(
              [...(boundary.acceptedRecords ?? [])].sort((a, b) => a.marketId - b.marketId),
            ) !==
              canonicalBreakoutJson(
                context.marketIds
                  .map((marketId) => ({
                    marketId,
                    recordId: context.authoritativeRecordId,
                    sourceIdentity: context.sourceIdentity,
                  }))
                  .sort((a, b) => a.marketId - b.marketId),
              ) ||
            boundary.operationId !== context.operationId ||
            boundary.authoritativeRecordId !== context.authoritativeRecordId ||
            boundary.accountRole !== context.role ||
            boundary.sourceIdentity !== context.sourceIdentity ||
            boundary.acceptedProof !== true
          ) {
            throw new PilotError(
              "RECEIPT_PROOF_UNAVAILABLE",
              "Original paired receipt proof differs",
            );
          }
          boundaries.push(boundary);
        }
        acknowledgement.receipt = boundaries[0]!;
        acknowledgement.valuationReceipts = boundaries;
        acknowledgement.receiptStatus = "QUALIFIED";
      } catch {
        // The effect is known. Failed original journaling cannot turn it into unknown COMMIT.
        acknowledgement.receiptStatus = "KNOWN_EFFECT_V_UNPROVED";
        this.openingsUnproved = true;
      }
    }
    this.receipts.set(operationId, acknowledgement);
    while (this.receipts.size > 128) {
      this.receipts.delete(this.receipts.keys().next().value!);
    }
    return acknowledgement;
  }

  private async journalAcknowledgement(
    client: PoolClient,
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    acknowledgement: BreakoutAcknowledgement,
  ) {
    try {
      await client.query("BEGIN");
      const row = await this.study(client, scope);
      await this.owned(client, row, lease);
      await this.eventRow(
        client,
        row,
        `breakout-ack:${sha(acknowledgement.operationId)}`,
        "breakout-acknowledgement",
        acknowledgement,
      );
      if (acknowledgement.receiptStatus !== "QUALIFIED") {
        row.document.admissionsClosed = true;
        await this.saveStudy(client, row);
      }
      await this.owned(client, row, lease);
      await client.query("COMMIT");
    } catch {
      await client.query("ROLLBACK").catch(() => {});
      acknowledgement.receiptStatus = "KNOWN_EFFECT_V_UNPROVED";
      this.openingsUnproved = true;
    }
  }

  private async mutation<T>(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    operationId: string,
    roles: readonly BreakoutFinancialRole[],
    action: (client: PoolClient, row: StudyRow) => Promise<TransactionValue<T>>,
  ): Promise<BreakoutDurableResult<T>> {
    this.active(lease);
    const client = await this.pool.connect();
    let commitStarted = false;
    let discard = false;
    const recordId = operationKey(operationId);
    try {
      await client.query("BEGIN");
      const row = await this.study(client, scope);
      await this.owned(client, row, lease);
      const result = await action(client, row);
      if (result.replayed && !this.receipts.has(operationId)) {
        const original = await client.query(
          "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2 AND kind='breakout-acknowledgement'",
          [row.id, `breakout-ack:${sha(operationId)}`],
        );
        const acknowledgement = original.rows[0]?.data as BreakoutAcknowledgement | undefined;
        if (
          acknowledgement?.operationId === operationId &&
          acknowledgement.authoritativeRecordId === recordId
        ) {
          this.receipts.set(operationId, acknowledgement);
          while (this.receipts.size > 128) {
            this.receipts.delete(this.receipts.keys().next().value!);
          }
        }
      }
      await this.owned(client, row, lease);
      await result.beforeCommit?.();
      this.active(lease);
      commitStarted = true;
      await client.query("COMMIT");
      const acknowledgement = result.replayed
        ? this.replayAcknowledgement(operationId, recordId)
        : this.originalAcknowledgement(
            operationId,
            recordId,
            result.contexts ?? [],
            row.document.acceptance.acceptedClockCertificateIds,
          );
      if (!result.replayed && result.contexts?.length) {
        await this.journalAcknowledgement(client, scope, lease, acknowledgement);
      }
      return {
        status: "confirmed",
        value: result.value,
        acknowledgement,
        ...(result.replayed ? { replayed: true } : {}),
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        discard = true;
        this.openingsUnproved = true;
        for (const role of roles) {
          this.localUnknown.add(role);
        }
        return { status: "unknown", code: "ROLLBACK_UNPROVED", operationId, affectedRoles: roles };
      }
      if (commitStarted) {
        discard = true;
        this.openingsUnproved = true;
        for (const role of roles) {
          this.localUnknown.add(role);
        }
        return { status: "unknown", code: "UNKNOWN_COMMIT", operationId, affectedRoles: roles };
      }
      if (error instanceof PilotError && error.code === "LEASE_LOST") {
        throw error;
      }
      const acknowledgement: BreakoutAcknowledgement = {
        operationId,
        authoritativeRecordId: `rollback:${sha(operationId)}`,
        receivedAt: this.receiptNow(),
      };
      this.noEffect.set(operationId, acknowledgement);
      while (this.noEffect.size > 16) {
        this.noEffect.delete(this.noEffect.keys().next().value!);
      }
      return { status: "rolled_back", code: safeCode(error), acknowledgement };
    } finally {
      client.release(discard);
    }
  }

  private async eventRow(
    client: PoolClient,
    row: StudyRow,
    key: string,
    kind: string,
    data: unknown,
  ) {
    const previous = await client.query(
      "SELECT kind,data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
      [row.id, key],
    );
    if (previous.rows[0]) {
      if (
        previous.rows[0].kind !== kind ||
        canonicalBreakoutJson(previous.rows[0].data) !== canonicalBreakoutJson(data)
      ) {
        throw new PilotError("CONFLICT", "Immutable original operation changed");
      }
      return false;
    }
    await client.query(
      "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5)",
      [row.id, key, await this.now(client), kind, JSON.stringify(data)],
    );
    return true;
  }

  private async account(
    client: PoolClient,
    row: StudyRow,
    role: BreakoutFinancialRole,
    exclusive = true,
  ): Promise<LockedAccount> {
    const agentId = row.document.agentIds[roleVariant[role]];
    const scope = { ...row.document.config, agentId };
    const agent = await client.query<AgentRecord>(
      `SELECT id,tenant_id AS "tenantId",version,config,paused FROM pickler.agents
       WHERE tenant_id=$1 AND id=$2${exclusive ? " FOR UPDATE" : ""}`,
      [scope.tenantId, scope.agentId],
    );
    if (!agent.rows[0]) {
      throw new PilotError("NOT_FOUND", "Hourly breakout role agent not found");
    }
    assertPerpsPaperAgent(agent.rows[0], scope, row.document.agentVersions[roleVariant[role]]);
    const result = await client.query<{ id: string; document: BreakoutAccount }>(
      `SELECT id,document FROM pickler.perps_paper_accounts
       WHERE tenant_id=$1 AND agent_id=$2 AND session_id=$3 AND network=$4${exclusive ? " FOR UPDATE" : ""}`,
      [scope.tenantId, scope.agentId, scope.sessionId, scope.network],
    );
    const account = result.rows[0];
    if (!account) {
      throw new PilotError("NOT_FOUND", "Hourly breakout role account not found");
    }
    const namespace = breakoutAccountNamespace(row.document.acceptance, role, sha);
    const expected: AccountIdentity = {
      version: 10,
      role,
      protocolDigest: row.document.acceptance.protocolDigest,
      T0: row.document.acceptance.T0,
      namespace,
      operatorIdentity: row.document.acceptance.operator.identity,
    };
    assertBreakoutAccount(account.document);
    if (
      canonicalBreakoutJson(account.document.breakout) !== canonicalBreakoutJson(expected) ||
      canonicalBreakoutJson(account.document.scope) !==
        canonicalBreakoutJson({
          tenantId: scope.tenantId,
          agentId,
          sessionId: scope.sessionId,
          network: scope.network,
        }) ||
      account.id !== namespace ||
      agentId !== `breakout-${namespace.slice(0, 48)}`
    ) {
      throw new PilotError("CONFIG_CHANGED", "Immutable account role, protocol or T0 changed");
    }
    const positions = await client.query<{ document: PerpsPaperPosition }>(
      `SELECT document FROM pickler.perps_paper_positions WHERE account_id=$1 AND closed_at IS NULL
       ORDER BY id LIMIT 6`,
      [account.id],
    );
    if (
      positions.rows.length > 5 ||
      account.document.positions.length !== positions.rows.length ||
      canonicalBreakoutJson(
        [...account.document.positions].sort((a, b) => a.id.localeCompare(b.id)),
      ) !== canonicalBreakoutJson(positions.rows.map((p) => p.document))
    ) {
      throw new PilotError(
        "ACCOUNT_PROJECTION_MISMATCH",
        "Canonical open position inventory differs",
      );
    }
    // The native table is authoritative: never hide another reservation by filtering cached views.
    const pending = await client.query<NativePending>(
      `SELECT key,document,owner,expires_at FROM pickler.perps_paper_attempts
       WHERE account_id=$1 AND (
         document->>'status'='pending' OR owner IS NOT NULL OR expires_at IS NOT NULL OR
         coalesce(document->>'reserved','0')<>'0' OR document#>>'{breakout,outcome}'='UNKNOWN'
       ) ORDER BY key LIMIT 2`,
      [account.id],
    );
    const trustedReservation = (p: NativePending) => {
      const evidence = p.document.evidence as {
        version?: number;
        phase?: string;
        effectStarted?: boolean;
        discovery?: BreakoutDiscovery;
      } | null;
      const outcome = (p.document as PerpsPaperAttempt & { breakout?: { outcome?: string } })
        .breakout?.outcome;
      return (
        outcome !== "UNKNOWN" &&
        evidence?.version === 10 &&
        evidence.phase === "RESERVATION" &&
        evidence.effectStarted === false &&
        evidence.discovery?.role === role &&
        evidence.discovery.attemptId === p.key &&
        p.document.intent.kind === "open" &&
        canonicalBreakoutJson(p.document.intent) ===
          canonicalBreakoutJson(breakoutOpeningIntent(evidence.discovery))
      );
    };
    if (
      pending.rows.length > 1 ||
      pending.rows.some(
        (p) =>
          !trustedReservation(p) ||
          p.key !== p.document.key ||
          p.document.status !== "pending" ||
          !p.owner ||
          !Number.isSafeInteger(Number(p.expires_at)) ||
          (p.document.intent.kind === "open" && p.document.reserved !== "101") ||
          (p.document.intent.kind === "close" && p.document.reserved !== "0"),
      )
    ) {
      throw new PilotError(
        "PENDING_INVENTORY_MISMATCH",
        "Native pending inventory is foreign or inconsistent",
      );
    }
    return {
      id: account.id,
      role,
      scope: {
        tenantId: scope.tenantId,
        agentId,
        sessionId: scope.sessionId,
        network: scope.network,
      },
      account: account.document,
      pending: pending.rows,
    };
  }

  private view(account: LockedAccount): PerpsPaperView {
    return {
      account: structuredClone(account.account),
      attempts: account.pending.map((p) => structuredClone(p.document)),
      movements: [],
    };
  }

  private affected(row: StudyRow, role: BreakoutFinancialRole) {
    return (
      this.localUnknown.has(role) ||
      row.document.unknownBarriers.some((barrier) => barrier.affectedRoles.includes(role))
    );
  }

  private assertOpening(row: StudyRow) {
    if (
      this.openingsUnproved ||
      this.localUnknown.size ||
      row.document.admissionsClosed ||
      row.document.unknownBarriers.length
    ) {
      throw new PilotError("ADMISSIONS_CLOSED", "Unproved outcome stops all new admissions");
    }
  }

  private currentHead(row: StudyRow, discovery: BreakoutDiscovery) {
    const current = row.document.current;
    const original = current?.discoveries.find((d) => d.attemptId === discovery.attemptId);
    if (
      !current ||
      !original ||
      canonicalBreakoutJson(original) !== canonicalBreakoutJson(discovery) ||
      original.state !== "QUEUED"
    ) {
      throw new PilotError(
        "ORIGINAL_HEAD_REQUIRED",
        "Only the immutable original queued allocation is executable",
      );
    }
    const first = current.discoveries
      .filter(
        (d) => d.role === discovery.role && d.state === "QUEUED" && !current.resolved[d.attemptId],
      )
      .sort((a, b) => a.rank - b.rank)[0];
    if (first?.attemptId !== discovery.attemptId) {
      throw new PilotError(
        "ORIGINAL_HEAD_REQUIRED",
        "A later queued allocation cannot skip its original head",
      );
    }
  }

  private async persistAccount(
    client: PoolClient,
    account: LockedAccount,
    changed: PerpsPaperAccount,
    movements: readonly PerpsPaperMovement[],
  ) {
    const fundingState = (changed as BreakoutAccount).breakoutFundingState;
    for (const rawPosition of changed.positions) {
      const position = rawPosition as FundingPosition;
      const previous = account.account.positions.find((p) => p.id === position.id);
      if (!position.breakoutFundingStatus) {
        position.breakoutFundingStatus = {
          version: 1,
          pending: position.closedAt !== null,
          disputed: false,
          uninitialized: true,
        };
      }
      if (position.closedAt !== null && previous?.closedAt === null) {
        const source = position.breakoutFunding;
        if (
          !source ||
          !source.complete ||
          source.from > position.openedAt ||
          source.to < position.closedAt - 30000
        ) {
          position.breakoutFundingStatus.pending = true;
          position.breakoutFundingStatus.uninitialized = !source;
        }
        fundingState.closed++;
        fundingState.pendingClosed += Number(position.breakoutFundingStatus.pending);
        fundingState.disputedClosed += Number(position.breakoutFundingStatus.disputed);
        fundingState.uninitializedClosed += Number(position.breakoutFundingStatus.uninitialized);
      }
      await client.query(
        `INSERT INTO pickler.perps_paper_positions(account_id,id,symbol,closed_at,document)
         VALUES($1,$2,$3,$4,$5) ON CONFLICT(account_id,id) DO UPDATE
         SET closed_at=excluded.closed_at,document=excluded.document`,
        [account.id, position.id, position.symbol, position.closedAt, position],
      );
    }
    if (
      fundingState.pendingClosed ||
      fundingState.disputedClosed ||
      fundingState.uninitializedClosed
    ) {
      changed.fundingPending = true;
    }
    const compact = {
      ...changed,
      positions: changed.positions.filter((p) => p.closedAt === null),
    } as BreakoutAccount;
    await client.query("UPDATE pickler.perps_paper_accounts SET document=$2 WHERE id=$1", [
      account.id,
      compact,
    ]);
    for (const movement of movements) {
      await client.query(
        "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
        [account.id, movement.key, movement],
      );
    }
    account.account = compact;
  }

  private assertAcquisition(input: { financialAt: number; sourceDeadlineAt: number }) {
    if (
      !Number.isSafeInteger(input.financialAt) ||
      !Number.isSafeInteger(input.sourceDeadlineAt) ||
      input.financialAt > input.sourceDeadlineAt
    ) {
      throw new PilotError(
        "SOURCE_ACQUISITION_DEADLINE",
        "Original source acquisition exceeded its fixed deadline",
      );
    }
  }

  private assertFrames(
    row: StudyRow,
    observation: { frames: readonly PerpsPaperObservation["frames"][number][] },
  ) {
    const identities = new Set<number>();
    for (const frame of observation.frames) {
      const market = frame.snapshot.market;
      assertBreakoutMarketIdentity(market);
      const digest = sha(
        JSON.stringify({
          snapshot: frame.snapshot,
          book: frame.book,
          streamEvidence: frame.streamEvidence,
        }),
      );
      if (
        frame.hash !== digest ||
        identities.has(market.marketId) ||
        !row.document.config.markets.some(
          (m) => m.marketId === market.marketId && m.symbol === market.symbol,
        )
      ) {
        throw new PilotError(
          "INVALID_MARKET_DATA",
          "Exact copied frame hash and frozen unique cohort required",
        );
      }
      identities.add(market.marketId);
    }
  }

  async viewRecord(scope: PerpsStudyScope) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const row = await this.study(client, scope, false);
      const pendingCounts = { C: 0, S: 0, L: 0 };
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        const namespace = breakoutAccountNamespace(row.document.acceptance, role, sha);
        const attempts = await client.query(
          `SELECT key FROM pickler.perps_paper_attempts WHERE account_id=$1 AND (
            document->>'status'='pending' OR owner IS NOT NULL OR expires_at IS NOT NULL OR
            coalesce(document->>'reserved','0')<>'0'
          ) ORDER BY key LIMIT 2`,
          [namespace],
        );
        pendingCounts[role] = attempts.rows.length;
      }
      await client.query("COMMIT");
      return {
        record: row.document,
        pendingCounts,
        pendingInventoryValid: Object.values(pendingCounts).every((count) => count <= 1),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  /** Explicit operator control: cooperative admission latch, preserving every liability and lease. */
  async stopAdmissionsExternal(scope: PerpsStudyScope) {
    if (this.revoked.size) {
      throw new PilotError(
        "LEASE_LOST",
        "A revoked executor cannot acquire operator write authority",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.study(client, scope);
      row.document.admissionsClosed = true;
      await this.saveStudy(client, row);
      await this.eventRow(
        client,
        row,
        "breakout-external-admission-stop",
        "breakout-admissions-closed",
        { source: "explicit-operator" },
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async initialize(
    config: PerpsHourlyBreakoutConfig,
    metadata: unknown,
    acceptance: BreakoutRunAcceptance,
  ): Promise<BreakoutScreenSnapshot> {
    assertHourlyBreakoutConfig(config);
    if (acceptance.protocolDigest !== config.researchProtocolSha256) {
      throw new PilotError(
        "CONFIG_CHANGED",
        "Run acceptance must bind the frozen research protocol",
      );
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const now = await this.now(client);
      assertBreakoutAcceptance(acceptance, now);
      if (acceptance.T0 <= now) {
        throw new PilotError(
          "INVALID_INPUT",
          "Financial v10 accounts require an explicitly accepted future T0",
        );
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `perps-breakout:${scopeValues(config).join(":")}`,
      ]);
      const existing = await client.query(
        "SELECT 1 FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
        scopeValues(config),
      );
      if (existing.rowCount) {
        throw new PilotError("CONFLICT", "A v10 financial namespace must be genuinely new");
      }
      const agentIds = {} as Record<HourlyBreakoutVariant, string>;
      const accounts: BreakoutAccountState[] = [];
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        const namespace = breakoutAccountNamespace(acceptance, role, sha);
        const agentId = `breakout-${namespace.slice(0, 48)}`;
        agentIds[roleVariant[role]] = agentId;
        await client.query(
          `INSERT INTO pickler.agents(tenant_id,id,version,config,paused,schedule_enabled)
           VALUES($1,$2,1,$3,false,false)`,
          [
            config.tenantId,
            agentId,
            {
              ...structuredClone(DEFAULT_CONFIG),
              profile: `Dedicated accepted hourly breakout paper role ${role}`,
              tools: [...PERP_TOOLS],
              perpl: {
                version: 2,
                network: config.network,
                markets: config.markets.map((m) => m.symbol),
              },
              perpsPaper: { version: 1, policy: "conservative-1x-v1" },
              plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
            },
          ],
        );
        const scope: PerpsPaperScope = {
          tenantId: config.tenantId,
          agentId,
          sessionId: config.sessionId,
          network: config.network,
        };
        const account: BreakoutAccount = {
          ...initialPaperAccount(scope, 1, acceptance.T0),
          riskManagement: "buffered-selective-1x-v1",
          marketDataPolicy: COMPONENT_PAPER_POLICY,
          breakoutFundingState: {
            version: 1,
            closed: 0,
            pendingClosed: 0,
            disputedClosed: 0,
            uninitializedClosed: 0,
          },
          breakout: {
            version: 10,
            role,
            protocolDigest: acceptance.protocolDigest,
            T0: acceptance.T0,
            namespace,
            operatorIdentity: acceptance.operator.identity,
          },
        };
        assertBreakoutAccount(account);
        await client.query(
          `INSERT INTO pickler.perps_paper_accounts(id,tenant_id,agent_id,session_id,network,document)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [namespace, config.tenantId, agentId, config.sessionId, config.network, account],
        );
        const initial: PerpsPaperMovement = {
          key: "initial",
          kind: "initial",
          delta: "1000",
          at: acceptance.T0,
          evidence: {
            policy: account.policy,
            protocolDigest: acceptance.protocolDigest,
            role,
            T0: acceptance.T0,
          },
        };
        await client.query(
          "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
          [namespace, initial.key, initial],
        );
        accounts.push({ role, scope, view: { account, attempts: [], movements: [initial] } });
      }
      const document: PerpsBreakoutStudyRecord = {
        config: structuredClone(config),
        metadata: structuredClone(metadata),
        acceptance: structuredClone(acceptance),
        agentIds,
        agentVersions: { "hourly-breakout": 1, "sma-reference": 1, "hourly-long": 1 },
        createdAt: now,
        startedAt: null,
        status: "initialized",
        lastAttemptedSlot: -1,
        admissionsClosed: false,
        interruption: null,
        current: null,
        closeObligations: [],
        unknownBarriers: [],
        closedFences: [],
      };
      await client.query(
        "INSERT INTO pickler.perps_studies(id,tenant_id,session_id,network,document) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), ...scopeValues(config), document],
      );
      await client.query("COMMIT");
      return {
        accounts,
        discoveries: [],
        closeObligations: [],
        unknownBarriers: [],
        closedFences: [],
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async claim(scope: PerpsStudyScope): Promise<PerpsStudyLease> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.study(client, scope);
      const now = await this.now(client);
      if (row.owner && Number(row.expires_at) > now) {
        throw new PilotError("CONFLICT", "Hourly breakout already has a live owner");
      }
      if (row.document.startedAt !== null || row.document.status !== "initialized") {
        throw new PilotError("LEASE_LOST", "V10 never recovers or replays an expired process");
      }
      if (now >= row.document.acceptance.T0 + 30000) {
        throw new PilotError("STUDY_COMPLETE", "Original initial claim window elapsed");
      }
      const lease = { owner: randomUUID(), expiresAt: now + 90000 };
      row.document.startedAt = now;
      row.document.status = "running";
      await client.query(
        "UPDATE pickler.perps_studies SET document=$2,owner=$3,expires_at=$4 WHERE id=$1",
        [row.id, row.document, lease.owner, lease.expiresAt],
      );
      await client.query("COMMIT");
      return lease;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async guard(scope: PerpsStudyScope, lease: PerpsStudyLease) {
    this.active(lease);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      const row = await this.study(client, scope, false);
      await this.owned(client, row, lease);
      if (row.document.status !== "running") {
        throw new PilotError("STUDY_COMPLETE", "Hourly breakout process ended");
      }
      await this.owned(client, await this.study(client, scope, false), lease);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async renew(scope: PerpsStudyScope, lease: PerpsStudyLease) {
    const result = await this.mutation(
      scope,
      lease,
      `renew:${lease.owner}:${randomUUID()}`,
      [],
      async (client, row) => {
        await client.query("UPDATE pickler.perps_studies SET expires_at=$2 WHERE id=$1", [
          row.id,
          (await this.now(client)) + 90000,
        ]);
        row.expires_at = String((await this.now(client)) + 90000);
        return { value: undefined };
      },
    );
    if (result.status !== "confirmed") {
      this.revoked.add(lease.owner);
      throw new PilotError("LEASE_LOST", "Renewal was not definitively acknowledged");
    }
  }

  async release(scope: PerpsStudyScope, lease: PerpsStudyLease, interruption?: string) {
    this.active(lease);
    if (interruption && !/^[A-Z0-9_]{1,80}$/.test(interruption)) {
      throw new PilotError("INVALID_INPUT", "Use a safe interruption code");
    }
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.study(client, scope);
      await this.owned(client, row, lease);
      row.document.status = interruption ? "interrupted" : "completed";
      row.document.interruption = interruption ?? null;
      row.document.admissionsClosed = true;
      await this.owned(client, row, lease);
      await client.query(
        "UPDATE pickler.perps_studies SET document=$2,owner=null,expires_at=null WHERE id=$1",
        [row.id, row.document],
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

  async claimSlot(scope: PerpsStudyScope, lease: PerpsStudyLease, slot: number) {
    const result = await this.mutation(scope, lease, `slot:${slot}`, [], async (client, row) => {
      const now = await this.now(client);
      const due = row.document.acceptance.T0 + slot * 300000;
      if (
        !Number.isSafeInteger(slot) ||
        slot < 0 ||
        slot >= 8064 ||
        now < due ||
        now >= due + 30000 ||
        slot <= row.document.lastAttemptedSlot
      ) {
        return { value: false };
      }
      row.document.lastAttemptedSlot = slot;
      await this.saveStudy(client, row);
      return { value: true };
    });
    if (result.status !== "confirmed") {
      throw new PilotError(result.code, "Original slot claim was not confirmed");
    }
    return result.value;
  }

  async snapshot(scope: PerpsStudyScope, lease: PerpsStudyLease): Promise<BreakoutScreenSnapshot> {
    this.active(lease);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      const row = await this.study(client, scope, false);
      await this.owned(client, row, lease);
      const accounts: BreakoutAccountState[] = [];
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        const account = await this.account(client, row, role, false);
        accounts.push({ role, scope: account.scope, view: this.view(account) });
      }
      await this.owned(client, await this.study(client, scope, false), lease);
      await client.query("COMMIT");
      return {
        accounts,
        discoveries: row.document.current?.discoveries ?? [],
        closeObligations: row.document.closeObligations,
        unknownBarriers: row.document.unknownBarriers,
        closedFences: row.document.closedFences,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async fundingRequirements(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    options: { after?: string; limit?: number } = {},
  ): Promise<{ rows: PerpsBreakoutFundingRequirement[]; nextCursor: string | null }> {
    this.active(lease);
    const limit = options.limit ?? 32;
    const afterRole = options.after?.slice(0, 1) as BreakoutFinancialRole | undefined;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 64 ||
      (options.after !== undefined &&
        (!afterRole || !BREAKOUT_FINANCIAL_ROLES.includes(afterRole) || options.after[1] !== ":"))
    ) {
      throw new PilotError("INVALID_INPUT", "Bounded canonical funding cursor required");
    }
    await this.guard(scope, lease);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const study = await this.study(client, scope, false);
      const now = await this.now(client);
      const rows: PerpsBreakoutFundingRequirement[] = [];
      let nextCursor: string | null = null;
      let started = options.after === undefined;
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        if (role === afterRole) {
          started = true;
        }
        if (!started) {
          continue;
        }
        const account = await this.account(client, study, role, false);
        const cursor = role === afterRole ? options.after!.slice(2) : null;
        const page: QueryResult<{ id: string; document: FundingPosition }> = await client.query(
          `WITH page AS MATERIALIZED (
             SELECT id FROM pickler.perps_paper_positions
             WHERE account_id=$1${cursor === null ? "" : " AND id>$3"} ORDER BY id LIMIT $2
           ) SELECT source.id,source.document FROM page
           JOIN pickler.perps_paper_positions source ON source.account_id=$1 AND source.id=page.id
           ORDER BY page.id`,
          cursor === null
            ? [account.id, limit - rows.length]
            : [account.id, limit - rows.length, cursor],
        );
        for (const item of page.rows) {
          if (item.document.market?.marketId === undefined) {
            throw new PilotError(
              "POSITION_IDENTITY_MISMATCH",
              "Canonical funding position lacks its market identity",
            );
          }
          const key = `${role}:${item.id}`;
          rows.push({
            key,
            role,
            positionId: item.id,
            symbol: item.document.symbol,
            marketId: item.document.market.marketId,
            from: item.document.openedAt,
            to: item.document.closedAt ?? now,
            previousCheckedAt: item.document.breakoutFunding?.checkedAt ?? null,
          });
          nextCursor = key;
        }
        if (rows.length === limit) {
          break;
        }
      }
      await client.query("COMMIT");
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      await this.owned(client, await this.study(client, scope, false), lease);
      await client.query("COMMIT");
      return { rows, nextCursor: rows.length === limit ? nextCursor : null };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async hasDiscoveryOperation(scope: PerpsStudyScope, lease: PerpsStudyLease, operationId: string) {
    this.active(lease);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY");
      const row = await this.study(client, scope, false);
      await this.owned(client, row, lease);
      const result = await client.query(
        "SELECT 1 FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2 AND kind='breakout-discovery'",
        [row.id, operationKey(operationId)],
      );
      await this.owned(client, await this.study(client, scope, false), lease);
      await client.query("COMMIT");
      return result.rowCount === 1;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async closeAdmissions(scope: PerpsStudyScope, lease: PerpsStudyLease, operationId: string) {
    return this.mutation(scope, lease, operationId, [], async (client, row) => {
      const replayed = row.document.admissionsClosed;
      row.document.admissionsClosed = true;
      await this.eventRow(client, row, operationKey(operationId), "breakout-admissions-closed", {
        operationId,
      });
      await this.saveStudy(client, row);
      return { value: undefined, replayed };
    });
  }

  async commitDiscovery(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["commitDiscovery"]>[2],
  ) {
    input = structuredClone(input);
    return this.mutation(scope, lease, input.operationId, [], async (client, row) => {
      if (
        input.discoveries.length > 33 ||
        new Set(input.discoveries.map((d) => d.attemptId)).size !== input.discoveries.length
      ) {
        throw new PilotError("INVALID_INPUT", "Original discovery cohort is bounded and unique");
      }
      const key = operationKey(input.operationId);
      const previous = await client.query(
        "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
        [row.id, key],
      );
      if (previous.rows[0]) {
        if (canonicalBreakoutJson(previous.rows[0].data) !== canonicalBreakoutJson(input)) {
          throw new PilotError("CONFLICT", "Original discovery evidence changed");
        }
        return { value: input.discoveries, replayed: true };
      }
      for (const discovery of input.discoveries) {
        const market = row.document.config.markets.find(
          (m) => m.marketId === discovery.marketId && m.symbol === discovery.symbol,
        );
        if (
          !market ||
          discovery.variant !== roleVariant[discovery.role] ||
          discovery.H !== input.H ||
          discovery.D !== input.D ||
          discovery.initialOperationId !== input.operationId ||
          discovery.reserved !== "0" ||
          !["QUEUED", "INITIAL_BLOCKED"].includes(discovery.state)
        ) {
          throw new PilotError("INVALID_INPUT", "Discovery escaped its frozen original cohort");
        }
        if (
          (this.localUnknown.size ||
            row.document.unknownBarriers.length ||
            this.openingsUnproved) &&
          discovery.state === "QUEUED"
        ) {
          throw new PilotError(
            "ADMISSIONS_CLOSED",
            "Unknown outcomes cannot allocate another opening",
          );
        }
        const consumed = await client.query(
          "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
          [row.id, consumptionKey(discovery.role, discovery.episodeKey)],
        );
        if (consumed.rowCount) {
          throw new PilotError(
            "EPISODE_CONSUMED",
            "The original known episode is already consumed",
          );
        }
        await this.eventRow(
          client,
          row,
          consumptionKey(discovery.role, discovery.episodeKey),
          "breakout-consumption",
          discovery,
        );
      }
      await this.eventRow(client, row, key, "breakout-discovery", input);
      row.document.current = {
        operationId: input.operationId,
        H: input.H,
        D: input.D,
        discoveries: structuredClone([...input.discoveries]),
        resolved: {},
      };
      await this.saveStudy(client, row);
      return { value: input.discoveries };
    });
  }

  async latchCloses(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    obligations: readonly BreakoutCloseObligation[],
  ) {
    obligations = structuredClone(obligations);
    const operationId = `latch:${hash(obligations)}`;
    return this.mutation(scope, lease, operationId, [], async (client, row) => {
      const result: BreakoutCloseObligation[] = [];
      for (const obligation of obligations) {
        const account = await this.account(client, row, obligation.role);
        const position = account.account.positions.find((p) => p.id === obligation.positionId);
        if (
          !position ||
          position.symbol !== obligation.symbol ||
          position.side !== obligation.side ||
          position.quantity !== obligation.quantity ||
          position.market?.marketId !== obligation.marketId
        ) {
          throw new PilotError(
            "POSITION_IDENTITY_MISMATCH",
            "Close obligation must identify the exact held position",
          );
        }
        const existing = row.document.closeObligations.find(
          (o) => o.role === obligation.role && o.positionId === obligation.positionId,
        );
        const next: BreakoutCloseObligation = {
          ...(existing ?? structuredClone(obligation)),
          reasons: [...new Set([...(existing?.reasons ?? []), ...obligation.reasons])],
          state: this.affected(row, obligation.role)
            ? "BLOCKED_UNKNOWN"
            : account.pending.length
              ? "BLOCKED_PENDING"
              : "DUE",
        };
        row.document.closeObligations = row.document.closeObligations.filter(
          (o) =>
            !(
              o.role === next.role &&
              (o.positionId === next.positionId ||
                (o.state === "CONFIRMED" && o.symbol === next.symbol))
            ),
        );
        row.document.closeObligations.push(next);
        result.push(next);
      }
      if (row.document.closeObligations.filter((o) => o.state !== "CONFIRMED").length > 15) {
        throw new PilotError(
          "ACCOUNT_PROJECTION_MISMATCH",
          "Required reductions exceed held canonical positions",
        );
      }
      await this.eventRow(
        client,
        row,
        operationKey(operationId),
        "breakout-close-latch",
        obligations,
      );
      await this.saveStudy(client, row);
      return { value: result };
    });
  }

  async reconcileSelective(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["reconcileSelective"]>[2],
  ) {
    input = structuredClone(input);
    return this.mutation(scope, lease, input.operationId, [], async (client, row) => {
      this.assertFrames(row, input.observation);
      const at = await this.now(client);
      const retired: { obligation: BreakoutCloseObligation; evidence: unknown }[] = [];
      for (const role of BREAKOUT_FINANCIAL_ROLES) {
        const selective = row.document.closeObligations.filter(
          (o) =>
            o.role === role &&
            o.state !== "CONFIRMED" &&
            o.reasons.length === 1 &&
            o.reasons[0] === "SELECTIVE_EXPOSURE",
        );
        if (!selective.length || this.affected(row, role)) {
          continue;
        }
        const account = await this.account(client, row, role);
        if (account.pending.length) {
          continue;
        }
        const marked = applyPaperMarks(
          account.account,
          input.observation.frames,
          at,
          this.receiptNow(),
        );
        const mandatory = row.document.closeObligations.filter(
          (o) =>
            o.role === role &&
            o.state !== "CONFIRMED" &&
            o.reasons.some((reason) => reason !== "SELECTIVE_EXPOSURE"),
        );
        const plan = mandatory.length
          ? null
          : selectiveReduction(marked, input.observation.frames, at);
        if (plan?.status === "pending") {
          continue;
        }
        for (const obligation of selective) {
          if (mandatory.length || !plan?.symbols.includes(obligation.symbol)) {
            retired.push({
              obligation,
              evidence: {
                at,
                mandatoryIds: mandatory.map((o) => o.id),
                plan,
                risk: paperRisk(marked, [], at),
                sourceIdentity: hash(input.observation.frames),
              },
            });
          }
        }
      }
      if (retired.length) {
        const stateDigest = hash(retired);
        await this.eventRow(
          client,
          row,
          operationKey(`${input.operationId}:${stateDigest}`),
          "breakout-selective-retired",
          { operationId: input.operationId, stateDigest, retired },
        );
        const retiredIds = new Set(retired.map(({ obligation }) => obligation.id));
        row.document.closeObligations = row.document.closeObligations.filter(
          (o) => !retiredIds.has(o.id),
        );
        await this.saveStudy(client, row);
      }
      return { value: undefined };
    });
  }

  async reserveHead(scope: PerpsStudyScope, lease: PerpsStudyLease, discovery: BreakoutDiscovery) {
    discovery = structuredClone(discovery);
    return this.mutation(
      scope,
      lease,
      `reserve:${discovery.attemptId}`,
      [discovery.role],
      async (client, row) => {
        this.assertOpening(row);
        this.currentHead(row, discovery);
        const account = await this.account(client, row, discovery.role);
        const now = await this.now(client);
        const prior = await client.query<NativePending>(
          "SELECT key,document,owner,expires_at FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
          [account.id, discovery.attemptId],
        );
        if (prior.rows[0]) {
          const p = prior.rows[0];
          if (
            p.document.status !== "pending" ||
            account.pending.length !== 1 ||
            account.pending[0]?.key !== p.key ||
            !p.owner ||
            Number(p.expires_at) <= now ||
            canonicalBreakoutJson(p.document.intent) !==
              canonicalBreakoutJson(breakoutOpeningIntent(discovery))
          ) {
            throw new PilotError(
              "ORIGINAL_HEAD_REQUIRED",
              "A terminal or foreign opening cannot reserve again",
            );
          }
          return {
            value: {
              discovery,
              attempt: p.document,
              lease: { key: p.key, owner: p.owner, expiresAt: Number(p.expires_at) },
            },
            replayed: true,
          };
        }
        const endpoints = breakoutWindowTimes(row.document.acceptance.T0);
        if (
          now < endpoints.T0 ||
          now >= endpoints.TA ||
          row.document.closeObligations.some(
            (o) => o.role === discovery.role && o.state !== "CONFIRMED",
          ) ||
          breakoutCloseFenced(
            {
              accounts: [],
              discoveries: [],
              closeObligations: row.document.closeObligations,
              unknownBarriers: [],
              closedFences: row.document.closedFences,
            },
            discovery.role,
            discovery.symbol,
            now,
          )
        ) {
          throw new PilotError(
            "EXIT_REQUIRED",
            "Required reductions or a close fence precede opening",
          );
        }
        const intent = breakoutOpeningIntent(discovery);
        const risk = paperRisk(
          account.account,
          account.pending.map((p) => p.document),
          now,
          intent,
        );
        if (!risk.allowed) {
          throw new PilotError("RISK_REJECTED", risk.reasons.join(","));
        }
        const attempt: PerpsPaperAttempt = {
          key: discovery.attemptId,
          intent,
          status: "pending",
          reserved: "101",
          createdAt: now,
          finishedAt: null,
          reason: null,
          evidence: { version: 10, discovery, phase: "RESERVATION", effectStarted: false },
        };
        const nativeLease = { key: attempt.key, owner: randomUUID(), expiresAt: now + 60000 };
        await client.query(
          "INSERT INTO pickler.perps_paper_attempts(account_id,key,document,owner,expires_at) VALUES($1,$2,$3,$4,$5)",
          [account.id, attempt.key, attempt, nativeLease.owner, nativeLease.expiresAt],
        );
        await this.eventRow(
          client,
          row,
          operationKey(`reserve:${attempt.key}`),
          "breakout-reservation",
          { discovery, attempt },
        );
        return { value: { discovery, attempt, lease: nativeLease } };
      },
    );
  }

  private ownedHead(
    account: LockedAccount,
    head: BreakoutReservedHead,
    now: number,
    allowExpiredNoEffect = false,
  ): PerpsPaperLease {
    const pending = account.pending[0];
    if (
      account.pending.length !== 1 ||
      !pending ||
      pending.key !== head.attempt.key ||
      pending.owner !== head.lease.owner ||
      pending.document.key !== head.discovery.attemptId ||
      Number(pending.expires_at) !== head.lease.expiresAt ||
      (!allowExpiredNoEffect && Number(pending.expires_at) <= now) ||
      canonicalBreakoutJson(pending.document) !== canonicalBreakoutJson(head.attempt)
    ) {
      throw new PilotError("LEASE_LOST", "Exact owned native head is required for completion");
    }
    return { key: pending.key, owner: pending.owner!, expiresAt: Number(pending.expires_at) };
  }

  async executeHead(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["executeHead"]>[2],
  ) {
    input = structuredClone(input);
    const { head, finalSet } = input;
    const operationId = openingOperation(head);
    return this.mutation(scope, lease, operationId, [head.discovery.role], async (client, row) => {
      const account = await this.account(client, row, head.discovery.role);
      const previous = await client.query<{ document: PerpsPaperAttempt }>(
        "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
        [account.id, head.attempt.key],
      );
      const originalInputHash = hash({
        finalSet,
        deadline: input.deadline,
        expectedWindowDigest: input.expectedWindowDigest,
      });
      if (previous.rows[0]?.document.status === "filled") {
        const original = await client.query(
          "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
          [row.id, operationKey(operationId)],
        );
        if (original.rows[0]?.data?.originalInputHash !== originalInputHash) {
          throw new PilotError("CONFLICT", "Confirmed opening's original final input changed");
        }
        return {
          value: { ...this.view(account), attempts: [previous.rows[0].document] },
          replayed: true,
        };
      }
      this.assertOpening(row);
      this.currentHead(row, head.discovery);
      this.assertAcquisition(finalSet);
      this.assertFrames(row, finalSet);
      const nativeLease = this.ownedHead(account, head, await this.now(client));
      const context: BreakoutFinancialReceiptContext = {
        operationId,
        action: "OPEN",
        role: head.discovery.role,
        marketIds: [head.discovery.marketId],
        sourceIdentity:
          finalSet.frames.find(
            (frame) => frame.snapshot.market.marketId === head.discovery.marketId,
          )?.hash ?? "",
        authoritativeRecordId: operationKey(operationId),
      };
      if (!this.options.financialReceipts) {
        throw new PilotError("RECEIPT_PROOF_UNAVAILABLE", "A trusted pre-effect hook is mandatory");
      }
      // Original A precedes the native economic opening clock as well as irreversible COMMIT.
      const beforeEffect = this.options.financialReceipts.beforeEffect(context);
      if (
        !beforeEffect ||
        beforeEffect.kind !== "A_BEFORE_EFFECT" ||
        beforeEffect.operationId !== operationId ||
        beforeEffect.accountRole !== head.discovery.role ||
        beforeEffect.sourceIdentity !== context.sourceIdentity ||
        beforeEffect.authoritativeRecordId !== context.authoritativeRecordId ||
        canonicalBreakoutJson(beforeEffect.marketIds) !==
          canonicalBreakoutJson(context.marketIds) ||
        beforeEffect.acceptedProof !== true ||
        !row.document.acceptance.acceptedClockCertificateIds.includes(beforeEffect.certificateId)
      ) {
        throw new PilotError(
          "RECEIPT_PROOF_UNAVAILABLE",
          "Original pre-effect paired anchor is unproved",
        );
      }
      const now = await this.owned(client, row, lease);
      if (
        input.expectedWindowDigest !== head.discovery.windowDigest ||
        now >= input.deadline ||
        now >= breakoutWindowTimes(row.document.acceptance.T0).TA
      ) {
        throw new PilotError(
          "BREAKOUT_FINAL_WINDOW_REJECTED",
          "The original final input or admission deadline differs",
        );
      }
      await this.observedAccount(
        client,
        row,
        account,
        finalSet.observation,
        `${operationId}:final-valuation`,
        now,
        this.receiptNow(),
      );
      const original = structuredClone(account.account);
      const attempts = account.pending.map((pending) => pending.document);
      const check = (at: number, receiptAt: number) =>
        assertBreakoutHead({
          account: original,
          attempts,
          head,
          authoritativeLease: nativeLease,
          finalSet,
          financialAt: at,
          receiptAt,
          digest: sha,
          config: row.document.config,
          unknownBarrier: row.document.unknownBarriers.length > 0 || this.localUnknown.size > 0,
          closeFenced: breakoutCloseFenced(
            {
              accounts: [],
              discoveries: [],
              closeObligations: row.document.closeObligations,
              unknownBarriers: [],
              closedFences: row.document.closedFences,
            },
            head.discovery.role,
            head.discovery.symbol,
            at,
          ),
        });
      const result = check(now, this.receiptNow());
      await this.persistAccount(client, account, result.result.account, result.result.movements);
      const attempt: PerpsPaperAttempt = {
        ...head.attempt,
        status: "filled",
        reserved: "0",
        finishedAt: now,
        evidence: result.fill.evidence,
      };
      await client.query(
        "UPDATE pickler.perps_paper_attempts SET document=$3,owner=null,expires_at=null WHERE account_id=$1 AND key=$2",
        [account.id, head.attempt.key, attempt],
      );
      row.document.current!.resolved[head.attempt.key] = "FILLED";
      await this.saveStudy(client, row);
      await this.eventRow(client, row, operationKey(operationId), "breakout-financial", {
        action: "OPEN",
        discovery: head.discovery,
        fill: result.fill,
        attemptId: head.attempt.key,
        originalInputHash,
        sourceOperationId: finalSet.operationId,
        beforeEffect,
      });
      return {
        value: {
          account: structuredClone(account.account),
          attempts: [attempt],
          movements: result.result.movements,
        },
        contexts: [context],
        beforeCommit: async () => {
          const foreign = await client.query(
            `SELECT key FROM pickler.perps_paper_attempts WHERE account_id=$1 AND
             (document->>'status'='pending' OR owner IS NOT NULL OR expires_at IS NOT NULL OR coalesce(document->>'reserved','0')<>'0') ORDER BY key LIMIT 2`,
            [account.id],
          );
          if (foreign.rowCount) {
            throw new PilotError(
              "PENDING_INVENTORY_MISMATCH",
              "Another native pending appeared before COMMIT",
            );
          }
          const at = await this.owned(client, row, lease);
          if (
            at >= input.deadline ||
            at >= breakoutWindowTimes(row.document.acceptance.T0).TA ||
            new Date(at).toISOString().slice(0, 10) !== original.day
          ) {
            throw new PilotError(
              "BREAKOUT_FINAL_WINDOW_REJECTED",
              "Original admission deadline or day changed before COMMIT",
            );
          }
          check(at, this.receiptNow());
        },
      };
    });
  }

  async rejectHead(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["rejectHead"]>[2],
  ) {
    input = structuredClone(input);
    const { head } = input;
    return this.mutation(
      scope,
      lease,
      `reject:${head.discovery.attemptId}`,
      [head.discovery.role],
      async (client, row) => {
        if (this.affected(row, head.discovery.role)) {
          throw new PilotError(
            "UNKNOWN_ACCOUNT_OUTCOME",
            "Unknown opening cannot be released as no-fill",
          );
        }
        const proof = input.noEffectAcknowledgement
          ? this.noEffect.get(input.noEffectAcknowledgement.operationId)
          : undefined;
        const knownUnexecuted =
          input.knownUnexecuted === true && input.noEffectAcknowledgement === null;
        if (
          (!knownUnexecuted &&
            (!proof ||
              canonicalBreakoutJson(proof) !==
                canonicalBreakoutJson(input.noEffectAcknowledgement) ||
              proof.operationId !== openingOperation(head))) ||
          !/^[A-Z0-9_]{1,80}$/.test(input.code)
        ) {
          throw new PilotError(
            "NO_EFFECT_PROOF_REQUIRED",
            "A confirmed original rollback proof is required",
          );
        }
        const account = await this.account(client, row, head.discovery.role);
        const prior = await client.query<{ document: PerpsPaperAttempt }>(
          "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
          [account.id, head.attempt.key],
        );
        if (prior.rows[0]?.document.status === "rejected") {
          if (prior.rows[0].document.reason !== input.code) {
            throw new PilotError("CONFLICT", "Original terminal rejection reason changed");
          }
          return {
            value: { account: account.account, attempts: [prior.rows[0].document], movements: [] },
            replayed: true,
          };
        }
        const now = await this.now(client);
        this.currentHead(row, head.discovery);
        this.ownedHead(account, head, now, true);
        if (knownUnexecuted) {
          const financial = await client.query(
            "SELECT 1 FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
            [row.id, operationKey(openingOperation(head))],
          );
          if (
            financial.rowCount ||
            (head.attempt.evidence as { effectStarted?: unknown } | null)?.effectStarted !==
              false ||
            this.noEffect.has(openingOperation(head))
          ) {
            throw new PilotError(
              "NO_EFFECT_PROOF_REQUIRED",
              "Known-unexecuted release requires an untouched reservation",
            );
          }
        }
        const noEffectAcknowledgement = proof ?? {
          operationId: openingOperation(head),
          authoritativeRecordId: `unexecuted:${head.discovery.attemptId}`,
          receivedAt: now,
        };
        const attempt: PerpsPaperAttempt = {
          ...head.attempt,
          status: "rejected",
          reserved: "0",
          reason: input.code,
          finishedAt: now,
          evidence: { noEffectAcknowledgement, knownUnexecuted },
        };
        await client.query(
          "UPDATE pickler.perps_paper_attempts SET document=$3,owner=null,expires_at=null WHERE account_id=$1 AND key=$2",
          [account.id, attempt.key, attempt],
        );
        row.document.current!.resolved[attempt.key] = "TERMINAL_REJECTED";
        row.document.closeObligations = row.document.closeObligations.map((o) =>
          o.role === head.discovery.role && o.state === "BLOCKED_PENDING"
            ? { ...o, state: "DUE" }
            : o,
        );
        await this.eventRow(
          client,
          row,
          operationKey(`reject:${attempt.key}`),
          "breakout-terminal-rejection",
          { attemptId: attempt.key, code: input.code, noEffectAcknowledgement, knownUnexecuted },
        );
        await this.saveStudy(client, row);
        return { value: { account: account.account, attempts: [attempt], movements: [] } };
      },
    );
  }

  async close(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["close"]>[2],
  ) {
    input = structuredClone(input);
    const { obligation, finalSet } = input;
    const operationId = closingOperation(finalSet, obligation);
    return this.mutation(scope, lease, operationId, [obligation.role], async (client, row) => {
      const original = await client.query(
        "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2 AND kind='breakout-financial'",
        [row.id, operationKey(operationId)],
      );
      if (original.rows[0]) {
        if (original.rows[0].data?.originalInputHash !== hash(input)) {
          throw new PilotError("CONFLICT", "Confirmed close's original final input changed");
        }
        const account = await this.account(client, row, obligation.role);
        const attempt = await client.query<{ document: PerpsPaperAttempt }>(
          "SELECT document FROM pickler.perps_paper_attempts WHERE account_id=$1 AND key=$2",
          [account.id, original.rows[0].data.attemptId],
        );
        if (attempt.rows[0]?.document.status !== "filled") {
          throw new PilotError("ATTEMPT_INVENTORY_MISMATCH", "Confirmed close attempt is absent");
        }
        return {
          value: { ...this.view(account), attempts: [attempt.rows[0].document] },
          replayed: true,
        };
      }
      if (this.affected(row, obligation.role)) {
        throw new PilotError(
          "UNKNOWN_ACCOUNT_OUTCOME",
          "Affected unknown account cannot receive a financial mutation",
        );
      }
      const current = row.document.closeObligations.find((o) => o.id === obligation.id);
      if (
        !current ||
        current.state === "CONFIRMED" ||
        current.positionId !== obligation.positionId ||
        current.role !== obligation.role
      ) {
        throw new PilotError(
          "ORIGINAL_CLOSE_REQUIRED",
          "The original latched full-close intent is required",
        );
      }
      const account = await this.account(client, row, obligation.role);
      this.assertAcquisition(finalSet);
      this.assertFrames(row, finalSet);
      const now = await this.now(client);
      const { TV } = breakoutWindowTimes(row.document.acceptance.T0);
      if (now > TV) {
        throw new PilotError("CLOSING_WINDOW_CLOSED", "The immutable closing endpoint has passed");
      }
      await this.observedAccount(
        client,
        row,
        account,
        finalSet.observation,
        `${operationId}:final-valuation`,
        now,
        this.receiptNow(),
      );
      const position = account.account.positions.find((p) => p.id === obligation.positionId);
      if (
        !position ||
        position.quantity !== obligation.quantity ||
        position.market?.marketId !== obligation.marketId ||
        account.pending.length
      ) {
        throw new PilotError(
          "ATTEMPT_PENDING",
          "Required close retains exact native pending and position gates",
        );
      }
      const intent = {
        kind: "close" as const,
        symbol: position.symbol,
        side: position.side,
        notional: "0",
        feeReserve: "1",
      };
      const risk = paperRisk(
        account.account,
        account.pending.map((p) => p.document),
        now,
        intent,
      );
      if (!risk.allowed) {
        throw new PilotError("RISK_REJECTED", risk.reasons.join(","));
      }
      const frame = finalSet.frames.find((f) => f.snapshot.market.marketId === obligation.marketId);
      if (!frame) {
        throw new PilotError("DATA_UNAVAILABLE", "Original full-close frame is absent");
      }
      validatePaperFrameSet(
        [...finalSet.frames],
        scope.network,
        now,
        account.account.marketDataPolicy,
        this.receiptNow(),
      );
      const attempt: PerpsPaperAttempt = {
        key: `close:${hash([obligation.id, finalSet.operationId])}`,
        intent,
        status: "pending",
        reserved: "0",
        createdAt: now,
        finishedAt: null,
        reason: null,
        evidence: { obligationId: obligation.id },
      };
      const fill = simulatePerpsFill(account.account, intent, frame, now, this.receiptNow());
      const result = applyPaperFill(account.account, attempt, fill, now);
      await this.persistAccount(client, account, result.account, result.movements);
      const terminal = { ...attempt, status: "filled", finishedAt: now, evidence: fill.evidence };
      await client.query(
        "INSERT INTO pickler.perps_paper_attempts(account_id,key,document) VALUES($1,$2,$3)",
        [account.id, attempt.key, terminal],
      );
      current.state = "CONFIRMED";
      row.document.closedFences = [
        ...row.document.closedFences.filter(
          (f) => !(f.role === obligation.role && f.symbol === obligation.symbol),
        ),
        {
          role: obligation.role,
          symbol: obligation.symbol,
          originatingAt: obligation.scheduledAt,
          confirmedAt: now,
        },
      ];
      await this.eventRow(client, row, operationKey(operationId), "breakout-financial", {
        action: "FULL_CLOSE",
        sourceOperationId: finalSet.operationId,
        originalOperationId: obligation.originalOperationId,
        originalInputHash: hash(input),
        obligation: current,
        fill,
        attemptId: attempt.key,
      });
      await this.saveStudy(client, row);
      const context: BreakoutFinancialReceiptContext = {
        operationId,
        action: "FULL_CLOSE",
        role: obligation.role,
        marketIds: [obligation.marketId],
        sourceIdentity: frame.hash,
        authoritativeRecordId: operationKey(operationId),
      };
      return {
        value: {
          account: account.account,
          attempts: [terminal as PerpsPaperAttempt],
          movements: result.movements,
        },
        contexts: [context],
        beforeCommit: async () => {
          const at = await this.owned(client, row, lease);
          if (at > TV) {
            throw new PilotError(
              "CLOSING_WINDOW_CLOSED",
              "The immutable closing endpoint has passed",
            );
          }
          validatePaperFrame(
            frame,
            scope.network,
            obligation.symbol,
            at,
            account.account.marketDataPolicy,
            this.receiptNow(),
            true,
          );
        },
      };
    });
  }

  private positionFundingStatus(position: FundingPosition): FundingPositionStatus {
    return (
      position.breakoutFundingStatus ?? {
        version: 1,
        pending: true,
        disputed: false,
        uninitialized: true,
      }
    );
  }

  private async verifyFundingInventory(client: PoolClient, account: LockedAccount) {
    const result = await client.query<PerpsBreakoutFundingState>(
      `SELECT 1 AS version,count(*)::integer AS closed,
        count(*) FILTER (WHERE coalesce((document#>>'{breakoutFundingStatus,pending}')::boolean,true))::integer AS "pendingClosed",
        count(*) FILTER (WHERE coalesce((document#>>'{breakoutFundingStatus,disputed}')::boolean,false))::integer AS "disputedClosed",
        count(*) FILTER (WHERE coalesce((document#>>'{breakoutFundingStatus,uninitialized}')::boolean,true))::integer AS "uninitializedClosed"
       FROM pickler.perps_paper_positions WHERE account_id=$1 AND closed_at IS NOT NULL`,
      [account.id],
    );
    if (
      canonicalBreakoutJson(result.rows[0]) !==
      canonicalBreakoutJson(account.account.breakoutFundingState)
    ) {
      throw new PilotError(
        "FUNDING_INVENTORY_MISMATCH",
        "Canonical archive funding counters differ",
      );
    }
  }

  private async observedAccount(
    client: PoolClient,
    study: StudyRow,
    account: LockedAccount,
    observation: PerpsPaperObservation,
    operationId: string,
    at: number,
    receiptAt: number,
  ) {
    let marked = applyPaperMarks(
      account.account,
      observation.frames,
      at,
      receiptAt,
    ) as BreakoutAccount;
    let pending = observation.marksOnly ? marked.fundingPending : (marked.fundingDisputed ?? false);
    let delta = 0n;
    if (!observation.marksOnly) {
      await this.verifyFundingInventory(client, account);
      const supplied = new Map<
        string,
        { history: PerpFundingHistory; key: string; sha256: string }
      >();
      for (const history of observation.funding) {
        const sha256 = hash(history);
        const key = `breakout-funding-source:${sha256}`;
        await this.eventRow(client, study, key, "breakout-funding-source", {
          version: 1,
          sha256,
          history,
        });
        supplied.set(sha256, { history, key, sha256 });
      }
      const originalPositions = structuredClone(marked.positions);
      const originalState = structuredClone(marked.breakoutFundingState);
      let firstDispute: {
        position: FundingPosition;
        source: { key: string; sha256: string } | undefined;
      } | null = null;
      await client.query("SAVEPOINT breakout_funding");
      const process = async (
        position: FundingPosition,
        retainedSources: Map<string, PerpFundingHistory>,
      ) => {
        const oldStatus = this.positionFundingStatus(position);
        const end = position.closedAt ?? at;
        const candidates = [...supplied.values()].filter(
          ({ history }) =>
            history.market.symbol === position.symbol &&
            history.from <= end &&
            history.to >= position.openedAt,
        );
        const fresh =
          candidates.find(
            ({ history }) => history.from <= position.openedAt && history.to >= end - 30000,
          ) ?? candidates[0];
        let history = fresh?.history;
        if (!history && position.breakoutFunding) {
          const source = position.breakoutFunding;
          history = retainedSources.get(source.sourceKey);
          if (!history) {
            const saved = await client.query(
              "SELECT kind,data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
              [study.id, source.sourceKey],
            );
            const data = saved.rows[0]?.data as
              { sha256?: string; history?: PerpFundingHistory } | undefined;
            if (
              saved.rows[0]?.kind !== "breakout-funding-source" ||
              !data?.history ||
              data.sha256 !== source.sourceSha256 ||
              hash(data.history) !== source.sourceSha256
            ) {
              throw new PilotError(
                "FUNDING_SOURCE_MISMATCH",
                "Actual retained funding source is missing or changed",
              );
            }
            history = data.history;
            retainedSources.set(source.sourceKey, history);
          }
        }
        const keys =
          history?.events.map((event) => `funding:${position.id}:${event.eventBlock}`) ?? [];
        const previous = keys.length
          ? await client.query<{ document: PerpsPaperMovement }>(
              "SELECT document FROM pickler.perps_paper_movements WHERE account_id=$1 AND key=ANY($2::text[])",
              [account.id, keys],
            )
          : { rows: [] };
        const result = applyPaperPositionFunding(
          marked,
          position,
          previous.rows.map((m) => m.document),
          history,
          at,
        );
        const status: FundingPositionStatus = {
          version: 1,
          pending: result.pending || (!fresh && oldStatus.pending),
          disputed: result.disputed || oldStatus.disputed,
          uninitialized: history === undefined,
        };
        position.breakoutFundingStatus = status;
        if (result.disputed) {
          marked.fundingDisputed = true;
          firstDispute = { position: structuredClone(position), source: fresh };
          return;
        }
        for (const movement of result.movements) {
          await client.query(
            "INSERT INTO pickler.perps_paper_movements(account_id,key,document) VALUES($1,$2,$3)",
            [account.id, movement.key, movement],
          );
          delta += paperUnits(movement.delta);
        }
        if (fresh) {
          position.breakoutFunding = {
            version: 1,
            sourceKey: fresh.key,
            sourceSha256: fresh.sha256,
            checkedAt: at,
            operationId,
            pending: result.pending,
            originalSourceKey: position.breakoutFunding?.originalSourceKey ?? fresh.key,
            completeSourceKey:
              !result.pending && fresh.history.complete
                ? fresh.key
                : (position.breakoutFunding?.completeSourceKey ?? null),
            from: fresh.history.from,
            to: fresh.history.to,
            complete: fresh.history.complete,
          };
        }
        if (position.closedAt !== null) {
          marked.breakoutFundingState.pendingClosed +=
            Number(status.pending) - Number(oldStatus.pending);
          marked.breakoutFundingState.disputedClosed +=
            Number(status.disputed) - Number(oldStatus.disputed);
          marked.breakoutFundingState.uninitializedClosed +=
            Number(status.uninitialized) - Number(oldStatus.uninitialized);
          await client.query(
            "UPDATE pickler.perps_paper_positions SET document=$3 WHERE account_id=$1 AND id=$2",
            [account.id, position.id, position],
          );
        } else {
          pending ||= status.pending || status.disputed || status.uninitialized;
        }
      };
      const liveSources = new Map<string, PerpFundingHistory>();
      for (const position of marked.positions as FundingPosition[]) {
        await process(position, liveSources);
        if (firstDispute) {
          break;
        }
      }
      const ranges = [...supplied.values()].map(({ history }) => ({
        symbol: history.market.symbol,
        from_at: history.from,
        to_at: history.to,
      }));
      let cursor: string | null = null;
      while (ranges.length && !firstDispute) {
        const page: QueryResult<{ id: string; document: FundingPosition }> = await client.query(
          `WITH page AS MATERIALIZED (
             SELECT p.id FROM pickler.perps_paper_positions p WHERE p.account_id=$1 AND p.closed_at IS NOT NULL
             ${cursor === null ? "" : "AND p.id>$4"}
             AND EXISTS (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS r(symbol text,from_at bigint,to_at bigint)
               WHERE p.symbol=r.symbol AND p.closed_at>=r.from_at AND (p.document->>'openedAt')::bigint<=r.to_at)
             ORDER BY p.id LIMIT $3
           ) SELECT p.id,p.document FROM page JOIN pickler.perps_paper_positions p
             ON p.account_id=$1 AND p.id=page.id ORDER BY p.id`,
          cursor === null
            ? [account.id, JSON.stringify(ranges), 32]
            : [account.id, JSON.stringify(ranges), 32, cursor],
        );
        if (!page.rows.length) {
          break;
        }
        const retainedSources = new Map<string, PerpFundingHistory>();
        for (const row of page.rows) {
          await process(row.document, retainedSources);
          cursor = row.id;
          if (firstDispute) {
            break;
          }
        }
      }
      if (marked.fundingDisputed) {
        await client.query("ROLLBACK TO SAVEPOINT breakout_funding");
        delta = 0n;
        pending = true;
        marked.positions = originalPositions;
        marked.breakoutFundingState = originalState;
        if (firstDispute) {
          const disputed = firstDispute as {
            position: FundingPosition;
            source: { key: string; sha256: string } | undefined;
          };
          const original = await client.query<{ document: FundingPosition }>(
            "SELECT document FROM pickler.perps_paper_positions WHERE account_id=$1 AND id=$2",
            [account.id, disputed.position.id],
          );
          const position = original.rows[0]?.document;
          if (!position) {
            throw new PilotError(
              "POSITION_IDENTITY_MISMATCH",
              "Disputed canonical position disappeared",
            );
          }
          const oldStatus = this.positionFundingStatus(position);
          position.breakoutFundingStatus = { ...oldStatus, pending: true, disputed: true };
          if (disputed.source) {
            position.breakoutFundingDispute = {
              sourceKey: disputed.source.key,
              sourceSha256: disputed.source.sha256,
              operationId,
            };
          }
          if (position.closedAt !== null) {
            marked.breakoutFundingState.pendingClosed += Number(!oldStatus.pending);
            marked.breakoutFundingState.disputedClosed += Number(!oldStatus.disputed);
            await client.query(
              "UPDATE pickler.perps_paper_positions SET document=$3 WHERE account_id=$1 AND id=$2",
              [account.id, position.id, position],
            );
          } else {
            const live = marked.positions.find((p) => p.id === position.id) as
              FundingPosition | undefined;
            if (live) {
              Object.assign(live, {
                breakoutFundingStatus: position.breakoutFundingStatus,
                ...(position.breakoutFundingDispute
                  ? { breakoutFundingDispute: position.breakoutFundingDispute }
                  : {}),
              });
            }
          }
        }
      }
      await client.query("RELEASE SAVEPOINT breakout_funding");
      const state = marked.breakoutFundingState;
      pending ||=
        state.pendingClosed > 0 || state.disputedClosed > 0 || state.uninitializedClosed > 0;
    }
    marked = finalizePaperObservationDelta(
      marked,
      paperDecimal(delta),
      pending,
      observation.marksOnly === true,
      operationId,
      at,
    ).account as BreakoutAccount;
    await this.persistAccount(client, account, marked, []);
    return this.view(account);
  }

  async observe(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    input: Parameters<BreakoutScreenStore["observe"]>[2],
  ) {
    input = structuredClone(input);
    return this.mutation(scope, lease, input.operationId, input.roles, async (client, row) => {
      if (!input.roles.length || new Set(input.roles).size !== input.roles.length) {
        throw new PilotError("INVALID_INPUT", "Observation roles must be explicit and distinct");
      }
      const prior = await client.query(
        "SELECT data FROM pickler.perps_study_events WHERE study_id=$1 AND key=$2",
        [row.id, operationKey(input.operationId)],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].data?.originalInputHash !== hash(input)) {
          throw new PilotError("CONFLICT", "Original observation changed on duplicate delivery");
        }
        const value: BreakoutAccountState[] = [];
        for (const role of input.roles) {
          const account = await this.account(client, row, role);
          value.push({ role, scope: account.scope, view: this.view(account) });
        }
        return { value, replayed: true };
      }
      this.assertAcquisition(input);
      const now = await this.now(client);
      const { TF } = breakoutWindowTimes(row.document.acceptance.T0);
      if (!input.observation.marksOnly && now > TF) {
        throw new PilotError("FUNDING_WINDOW_CLOSED", "The immutable funding endpoint has passed");
      }
      this.assertFrames(row, input.observation);
      const value: BreakoutAccountState[] = [];
      const contexts: BreakoutFinancialReceiptContext[] = [];
      for (const role of input.roles) {
        if (this.affected(row, role)) {
          throw new PilotError(
            "UNKNOWN_ACCOUNT_OUTCOME",
            "Affected unknown account cannot be valued or funded",
          );
        }
        const account = await this.account(client, row, role);
        const view = await this.observedAccount(
          client,
          row,
          account,
          input.observation,
          input.operationId,
          now,
          this.receiptNow(),
        );
        value.push({ role, scope: account.scope, view });
        if (input.observation.frames.length) {
          contexts.push({
            operationId: input.operationId,
            action: "OBSERVE",
            role,
            marketIds: input.observation.frames.map((f) => f.snapshot.market.marketId),
            sourceIdentity: hash(input.observation.frames),
            authoritativeRecordId: operationKey(input.operationId),
          });
        }
      }
      await this.eventRow(client, row, operationKey(input.operationId), "breakout-observation", {
        roles: input.roles,
        financialAt: now,
        originalFinancialAt: input.financialAt,
        originalInputHash: hash(input),
        receiptAt: input.receiptAt,
        observation: input.observation,
      });
      return {
        value,
        contexts,
        beforeCommit: async () => {
          const at = await this.owned(client, row, lease);
          if (!input.observation.marksOnly && at > TF) {
            throw new PilotError(
              "FUNDING_WINDOW_CLOSED",
              "The immutable funding endpoint has passed",
            );
          }
          validatePaperFrameSet(
            input.observation.frames,
            scope.network,
            at,
            COMPONENT_PAPER_POLICY,
            this.receiptNow(),
          );
          for (const frame of input.observation.frames) {
            validatePaperFrame(
              frame,
              scope.network,
              frame.snapshot.market.symbol,
              at,
              COMPONENT_PAPER_POLICY,
              this.receiptNow(),
            );
          }
        },
      };
    });
  }

  async recordBarrier(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    barrier: BreakoutUnknownBarrier,
  ) {
    this.active(lease);
    for (const role of barrier.affectedRoles) {
      this.localUnknown.add(role);
    }
    const result = await this.mutation(
      scope,
      lease,
      `barrier:${barrier.operationId}`,
      [],
      async (client, row) => {
        row.document.admissionsClosed = true;
        const newlyAffected = barrier.affectedRoles.filter(
          (role) => !row.document.unknownBarriers.some((b) => b.affectedRoles.includes(role)),
        );
        if (newlyAffected.length) {
          row.document.unknownBarriers.push({ ...barrier, affectedRoles: newlyAffected });
        }
        row.document.closeObligations = row.document.closeObligations.map((o) =>
          barrier.affectedRoles.includes(o.role) && o.state !== "CONFIRMED"
            ? { ...o, state: "BLOCKED_UNKNOWN" }
            : o,
        );
        await this.eventRow(
          client,
          row,
          operationKey(`barrier:${barrier.operationId}`),
          "breakout-unknown-barrier",
          barrier,
        );
        await this.saveStudy(client, row);
        return { value: undefined };
      },
    );
    if (result.status !== "confirmed") {
      throw new PilotError(result.code, "Unknown barrier persistence was not confirmed");
    }
  }

  async event(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    kind: string,
    data: unknown,
  ) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(key) || !/^[a-z][a-z0-9-]{0,79}$/.test(kind)) {
      throw new PilotError("INVALID_INPUT", "Safe original event identity required");
    }
    const result = await this.mutation(scope, lease, `event:${key}`, [], async (client, row) => {
      const inserted = await this.eventRow(client, row, key, kind, data);
      return { value: undefined, replayed: !inserted };
    });
    if (result.status !== "confirmed") {
      throw new PilotError(result.code, "Diagnostic event was not confirmed");
    }
  }
}
