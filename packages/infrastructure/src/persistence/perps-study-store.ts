import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DEFAULT_CONFIG, PERP_TOOLS, PilotError, type AgentRecord } from "@pickler/core";
import {
  perpsStrategies,
  type PerpsStudyMap,
  type PerpsStudyStrategy,
  PERPS_INPUT_LIMIT,
  PERPS_OUTPUT_LIMIT,
  assertPerpsStudyConfig,
  perpsCallCost,
  perpsAccountedUsd,
  type PerpsStudyConfig,
  type PerpsStudyScope,
  type PerpsStudyRecord,
  type PerpsStudyView,
  type PerpsStudyLease,
  type PerpsStudyRepository,
  type PerpsRound,
  type PerpsCallLane,
  type PerpsEvidence,
  type PerpsProposal,
} from "@pickler/trading/evaluation";
import { assertPerpsPaperAgent, paperUnits, type PerpsPaperAccount } from "@pickler/trading/perps";
import { PostgresPerpsPaperStore } from "./perps-paper-store.js";
function acquisitionPolicy(metadata: unknown): PerpsStudyRecord["dataPolicy"] {
  const value =
    metadata && typeof metadata === "object"
      ? (metadata as { acquisition?: { policy?: unknown }; acquisitionPolicy?: unknown })
      : {};
  const policy = value.acquisition?.policy ?? value.acquisitionPolicy ?? "coherent-20s-v1";
  if (
    policy !== "coherent-20s-v1" &&
    policy !== "rest-paced-20s-v1" &&
    policy !== "stream-20s-v1"
  ) {
    throw new PilotError("INVALID_INPUT", "Unknown frozen acquisition policy");
  }
  return policy;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
interface Locked {
  id: string;
  record: PerpsStudyRecord;
  owner: string | null;
  expires_at: string | null;
  now: number;
}
export class PostgresPerpsStudyStore implements PerpsStudyRepository {
  private readonly fences = new WeakMap<
    PoolClient,
    { id: string; owner: string; assertActive?: () => void }
  >();
  constructor(
    readonly pool: Pool,
    private readonly clock?: () => number,
  ) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const r = await fn(c);
      const fence = this.fences.get(c);
      if (fence) {
        fence.assertActive?.();
        const current = await c.query(
          "SELECT owner, expires_at FROM pickler.perps_studies WHERE id=$1",
          [fence.id],
        );
        if (
          current.rows[0]?.owner !== fence.owner ||
          Number(current.rows[0]?.expires_at) <= (await this.now(c))
        ) {
          throw new PilotError("LEASE_LOST", "Study ownership expired before commit");
        }
      }
      fence?.assertActive?.();
      await c.query("COMMIT");
      return r;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      this.fences.delete(c);
      c.release();
    }
  }
  private async now(c: PoolClient) {
    if (this.clock) {
      return this.clock();
    }
    return (
      await c.query<{ now: number }>(
        "SELECT floor(extract(epoch FROM clock_timestamp())*1000)::double precision AS now",
      )
    ).rows[0]!.now;
  }
  private async lock(c: PoolClient, scope: PerpsStudyScope): Promise<Locked> {
    const r = await c.query(
      "SELECT id,document,owner,expires_at FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3 FOR UPDATE",
      [scope.tenantId, scope.sessionId, scope.network],
    );
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Study not found");
    }
    return {
      id: r.rows[0].id,
      record: r.rows[0].document,
      owner: r.rows[0].owner,
      expires_at: r.rows[0].expires_at,
      now: await this.now(c),
    };
  }
  private owned(c: PoolClient, x: Locked, lease: PerpsStudyLease) {
    lease.assertActive?.();
    if (x.owner !== lease.owner || Number(x.expires_at) <= x.now) {
      throw new PilotError("LEASE_LOST", "Study ownership expired");
    }
    this.fences.set(c, {
      id: x.id,
      owner: lease.owner,
      ...(lease.assertActive ? { assertActive: lease.assertActive } : {}),
    });
  }
  private async permissions(c: PoolClient, x: Locked) {
    for (const strategy of perpsStrategies(x.record.config)) {
      const agentId = x.record.agentIds[strategy];
      const result = await c.query<AgentRecord>(
        'SELECT id,tenant_id AS "tenantId",version,config,paused FROM pickler.agents WHERE tenant_id=$1 AND id=$2',
        [x.record.config.tenantId, agentId],
      );
      const agent = result.rows[0];
      if (!agent) {
        throw new PilotError("NOT_FOUND", "Study agent missing");
      }
      assertPerpsPaperAgent(
        agent,
        { ...x.record.config, agentId: agentId! },
        x.record.agentVersions[strategy]!,
      );
      if (agent.paused) {
        throw new PilotError("PAUSED", "Study agent paused");
      }
    }
  }
  private save(c: PoolClient, x: Locked) {
    return c.query("UPDATE pickler.perps_studies SET document=$2 WHERE id=$1", [x.id, x.record]);
  }
  private async rounds(c: PoolClient, id: string): Promise<PerpsRound[]> {
    return (
      await c.query<{ document: PerpsRound }>(
        "SELECT document FROM pickler.perps_study_rounds WHERE study_id=$1 ORDER BY key",
        [id],
      )
    ).rows.map((r) => r.document);
  }
  private async round(c: PoolClient, id: string, key: string): Promise<PerpsRound> {
    const r = await c.query<{ document: PerpsRound }>(
      "SELECT document FROM pickler.perps_study_rounds WHERE study_id=$1 AND key=$2",
      [id, key],
    );
    if (!r.rows[0]) {
      throw new PilotError("NOT_FOUND", "Round not found");
    }
    return r.rows[0].document;
  }
  private saveRound(c: PoolClient, id: string, r: PerpsRound) {
    return c.query(
      "UPDATE pickler.perps_study_rounds SET document=$3 WHERE study_id=$1 AND key=$2",
      [id, r.key, r],
    );
  }
  async initialize(config: PerpsStudyConfig, metadata: unknown) {
    assertPerpsStudyConfig(config);
    await this.tx(async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `perps-study:${config.tenantId}:${config.sessionId}:${config.network}`,
      ]);
      const existing = await c.query(
        "SELECT document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
        [config.tenantId, config.sessionId, config.network],
      );
      if (existing.rows[0]) {
        if (
          canonical(existing.rows[0].document.config) !== canonical(config) ||
          canonical(existing.rows[0].document.metadata) !== canonical(metadata)
        ) {
          throw new PilotError("CONFLICT", "Study configuration or model metadata changed");
        }
        return;
      }
      const now = await this.now(c);
      const agentIds = Object.fromEntries(
        perpsStrategies(config).map((s) => [s, `perps-${config.network}-${config.sessionId}-${s}`]),
      ) as PerpsStudyMap<string>;
      for (const strategy of perpsStrategies(config)) {
        await c.query(
          "INSERT INTO pickler.agents(tenant_id,id,version,config,paused,schedule_enabled) VALUES($1,$2,1,$3,false,false)",
          [
            config.tenantId,
            agentIds[strategy],
            {
              ...structuredClone(DEFAULT_CONFIG),
              profile: `Dedicated perpetual simulation: ${strategy}`,
              tools: [...PERP_TOOLS],
              perpl: { version: 1, network: config.network, markets: ["BTC", "ETH"] },
              perpsPaper: { version: 1, policy: "conservative-1x-v1" },
              plugins: { version: 1, enabled: ["perpl", "perps-paper"] },
            },
          ],
        );
      }
      const record: PerpsStudyRecord = {
        config,
        metadata,
        agentIds,
        agentVersions: Object.fromEntries(
          perpsStrategies(config).map((s) => [s, 1]),
        ) as PerpsStudyMap<number>,
        createdAt: now,
        startedAt: null,
        endsAt: null,
        graceUntil: null,
        status: "initialized",
        decisionStopReason: null,
        stopRequested: false,
        lastObservationAt: null,
        lastRoundSlot: -1,
        lastAttemptedSlot: -1,
        dataPolicy: acquisitionPolicy(metadata)!,
      };
      await c.query(
        "INSERT INTO pickler.perps_studies(id,tenant_id,session_id,network,document) VALUES($1,$2,$3,$4,$5)",
        [randomUUID(), config.tenantId, config.sessionId, config.network, record],
      );
    });
    const view = await this.view(config);
    const paper = new PostgresPerpsPaperStore(this.pool, this.clock);
    for (const strategy of perpsStrategies(config)) {
      await paper.initialize({ ...config, agentId: view.record.agentIds[strategy]! }, 1);
    }
    return view;
  }
  async view(scope: PerpsStudyScope): Promise<PerpsStudyView> {
    return this.tx(async (c) => {
      const x = await this.lock(c, scope);
      const events = await c.query(
        "SELECT key,at::double precision AS at,kind,data FROM pickler.perps_study_events WHERE study_id=$1 ORDER BY at,key",
        [x.id],
      );
      return { record: x.record, rounds: await this.rounds(c, x.id), events: events.rows };
    });
  }
  async initializeDiagnostic(source: PerpsStudyScope, sessionId: string, metadata: unknown) {
    const { record } = await this.view(source);
    const config = { ...record.config, sessionId };
    const document: PerpsStudyRecord = {
      ...record,
      config,
      metadata,
      createdAt: Date.now(),
      startedAt: null,
      endsAt: null,
      graceUntil: null,
      status: "initialized",
      stopRequested: false,
      decisionStopReason: "DIAGNOSTIC_ONLY",
      lastRoundSlot: -1,
      lastAttemptedSlot: -1,
      lastObservationAt: null,
      dataPolicy: acquisitionPolicy(metadata)!,
    };
    await this.pool.query(
      "INSERT INTO pickler.perps_studies(id,tenant_id,session_id,network,document) VALUES($1,$2,$3,$4,$5)",
      [randomUUID(), config.tenantId, sessionId, config.network, document],
    );
    return config;
  }
  async claim(scope: PerpsStudyScope): Promise<PerpsStudyLease> {
    return this.tx(async (c) => {
      const x = await this.lock(c, scope);
      if (x.owner && Number(x.expires_at) > x.now) {
        throw new PilotError("CONFLICT", "Study already has a live writer");
      }
      if (
        ["completed", "interrupted"].includes(x.record.status) ||
        (x.record.startedAt === null && x.record.stopRequested)
      ) {
        throw new PilotError("STUDY_COMPLETE", "Study is complete");
      }
      await this.permissions(c, x);
      for (const r of await this.rounds(c, x.id)) {
        if (r.status === "completed" && r.executionStatus === "pending") {
          r.executionStatus = "incomplete";
          x.record.decisionStopReason = "INTERRUPTED_EXECUTION";
          await this.saveRound(c, x.id, r);
        }
        if (r.status === "reserved") {
          r.status = "interrupted";
          r.finishedAt = x.now;
          for (const call of Object.values(r.calls)) {
            if (call.status === "reserved") {
              call.status = "skipped";
            } else if (call.status === "started") {
              call.status = "failed";
              call.error = "INTERRUPTED";
              call.finishedAt = x.now;
            }
          }
          x.record.decisionStopReason = "INTERRUPTED_ROUND";
          await this.saveRound(c, x.id, r);
        }
      }
      if (x.record.startedAt === null) {
        x.record.startedAt = x.now;
        x.record.endsAt = x.now + x.record.config.hours * 3600000;
        x.record.graceUntil = x.record.endsAt + 900000;
      }
      x.record.status = x.record.decisionStopReason ? "monitoring" : "running";
      const lease = { owner: randomUUID(), expiresAt: x.now + 90000 };
      await this.save(c, x);
      await c.query("UPDATE pickler.perps_studies SET owner=$2,expires_at=$3 WHERE id=$1", [
        x.id,
        lease.owner,
        lease.expiresAt,
      ]);
      return lease;
    });
  }
  async claimSlot(scope: PerpsStudyScope, lease: PerpsStudyLease, slot: number) {
    return this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await this.permissions(c, x);
      if (
        x.record.decisionStopReason ||
        x.record.stopRequested ||
        x.record.startedAt === null ||
        x.now >= x.record.endsAt! ||
        !Number.isInteger(slot) ||
        slot !== Math.floor((x.now - x.record.startedAt) / 900000) ||
        (x.now - x.record.startedAt) % 900000 >= 60000 ||
        slot <= Math.max(x.record.lastAttemptedSlot ?? -1, x.record.lastRoundSlot)
      ) {
        return false;
      }
      x.record.lastAttemptedSlot = slot;
      await this.save(c, x);
      await c.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,'slot-attempted',$4)",
        [x.id, `slot-${slot}`, x.now, { slot }],
      );
      return true;
    });
  }
  async renew(scope: PerpsStudyScope, lease: PerpsStudyLease) {
    const expiresAt = await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await c.query("UPDATE pickler.perps_studies SET expires_at=$2 WHERE id=$1", [
        x.id,
        x.now + 90000,
      ]);
      return x.now + 90000;
    });
    lease.expiresAt = expiresAt;
  }
  async release(scope: PerpsStudyScope, lease: PerpsStudyLease) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      if (x.owner === lease.owner) {
        await c.query("UPDATE pickler.perps_studies SET owner=null,expires_at=null WHERE id=$1", [
          x.id,
        ]);
      }
    });
  }
  async guard(scope: PerpsStudyScope, lease: PerpsStudyLease, paid = false) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await this.permissions(c, x);
      if (
        paid &&
        (x.record.stopRequested || x.record.decisionStopReason || x.now >= x.record.endsAt!)
      ) {
        throw new PilotError("DECISIONS_STOPPED", "Study has stopped new decisions");
      }
    });
  }
  async stop(scope: PerpsStudyScope) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      x.record.stopRequested = true;
      x.record.decisionStopReason ??= "OPERATOR_STOP";
      if (x.record.startedAt !== null) {
        x.record.endsAt = Math.min(x.record.endsAt!, x.now);
        x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
      }
      await this.save(c, x);
    });
  }
  async stopDecisions(scope: PerpsStudyScope, lease: PerpsStudyLease, reason: string) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      x.record.decisionStopReason ??= reason;
      x.record.status = x.record.config.version === 2 ? "closing" : "monitoring";
      if (x.record.config.version === 2) {
        x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
      }
      await this.save(c, x);
    });
  }
  async event(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    kind: string,
    data: unknown,
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await c.query(
        "INSERT INTO pickler.perps_study_events(study_id,key,at,kind,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [x.id, key, x.now, kind, data],
      );
      if (kind === "observation") {
        x.record.lastObservationAt = x.now;
        await this.save(c, x);
      }
    });
  }
  async reserve(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    slot: number,
    evidence: PerpsEvidence,
    accounts: PerpsStudyMap<PerpsPaperAccount>,
    rules: PerpsProposal[],
  ) {
    return this.tx(async (c) => {
      // One authorization covers every session in this tenant/network, including history.
      // Serialize admissions before locking a study so concurrent new sessions cannot reset it.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        JSON.stringify(["perps-study-budget", scope.tenantId, scope.network]),
      ]);
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await this.permissions(c, x);
      if (
        x.record.stopRequested ||
        x.record.decisionStopReason ||
        x.now >= x.record.endsAt! ||
        !Number.isInteger(slot) ||
        slot < 0 ||
        slot >= x.record.config.hours * 4 ||
        slot <= x.record.lastRoundSlot
      ) {
        return null;
      }
      const calls = Object.fromEntries(
        (x.record.config.version === 2
          ? (["direct", "jev", "fallback", "review"] as const)
          : (["direct", "jev", "fallback"] as const)
        ).map((lane) => [
          lane,
          {
            lane,
            model:
              lane === "jev" || lane === "review"
                ? x.record.config.jev.model
                : x.record.config.deepseek.model,
            status: "reserved",
            reservationUsd: perpsCallCost(
              x.record.config,
              lane,
              PERPS_INPUT_LIMIT,
              lane === "jev" || lane === "review" ? 0 : PERPS_OUTPUT_LIMIT,
            ),
            costUsd: null,
            inputTokens: null,
            outputTokens: null,
            startedAt: null,
            finishedAt: null,
            error: null,
            result: null,
          },
        ]),
      ) as PerpsRound["calls"];
      if (
        x.record.config.version === 2 &&
        (x.record.metadata as { purpose?: string })?.purpose === "contracts-v2"
      ) {
        calls.fallback.status = "skipped";
        calls.fallback.finishedAt = x.now;
        calls.fallback.reservationUsd = "0";
      }
      const reserved = Object.values(calls).reduce(
        (sum, call) => sum + paperUnits(call.reservationUsd),
        0n,
      );
      const campaign = await c.query<{
        document: PerpsRound;
        session_id: string;
        owner: string | null;
        expires_at: string | null;
      }>(
        `SELECT r.document, s.session_id, s.owner, s.expires_at FROM pickler.perps_study_rounds r
         JOIN pickler.perps_studies s ON s.id = r.study_id
         WHERE s.tenant_id = $1 AND s.network = $2`,
        [scope.tenantId, scope.network],
      );
      const rounds = campaign.rows.map((row) => row.document);
      const acknowledgments =
        x.record.config.version === 2 ? (x.record.config.acknowledgedUnknownCalls ?? []) : [];
      const unknown = campaign.rows.flatMap((row) =>
        Object.values(row.document.calls)
          .filter((call) => call.startedAt !== null && call.costUsd === null)
          .map((call) => ({ row, call })),
      );
      const recognized = (item: (typeof unknown)[number]) =>
        acknowledgments.some(
          (a) =>
            a.sessionId !== scope.sessionId &&
            a.sessionId === item.row.session_id &&
            a.roundKey === item.row.document.key &&
            a.lane === item.call.lane &&
            a.requestHash === item.call.requestHash &&
            a.reservationUsd === item.call.reservationUsd &&
            item.call.status === "failed" &&
            !(item.row.owner && Number(item.row.expires_at) > x.now),
        );
      if (unknown.some((item) => !recognized(item))) {
        x.record.decisionStopReason = "CAMPAIGN_USAGE_UNVERIFIED";
        x.record.status = x.record.config.version === 2 ? "closing" : "monitoring";
        if (x.record.config.version === 2) {
          x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
        }
        await this.save(c, x);
        return null;
      }
      if (x.record.config.version === 2) {
        const v2Calls = await c.query<{ document: PerpsRound }>(
          `SELECT r.document FROM pickler.perps_study_rounds r JOIN pickler.perps_studies s ON s.id=r.study_id WHERE s.tenant_id=$1 AND s.network=$2 AND s.document->'config'->>'protocol'=$3`,
          [scope.tenantId, scope.network, x.record.config.protocol],
        );
        const admitted = v2Calls.rows
          .flatMap((r) => Object.values(r.document.calls))
          .filter((c) => c.status !== "skipped").length;
        const required =
          (x.record.metadata as { purpose?: string })?.purpose === "contracts-v2" ? 3 : 4;
        if (admitted + required > 35) {
          throw new PilotError("CALL_LIMIT_EXCEEDED", "Frozen four-way call ceiling reached");
        }
      }
      if (
        paperUnits(perpsAccountedUsd(rounds)) + reserved >
        paperUnits(x.record.config.budgetUsd)
      ) {
        x.record.decisionStopReason = "BUDGET_EXHAUSTED";
        x.record.status = x.record.config.version === 2 ? "closing" : "monitoring";
        if (x.record.config.version === 2) {
          x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
        }
        await this.save(c, x);
        return null;
      }
      const key = `round-${String(slot).padStart(3, "0")}`;
      const round: PerpsRound = {
        executionStatus: "pending",
        key,
        slot,
        status: "reserved",
        createdAt: x.now,
        finishedAt: null,
        evidence,
        accounts,
        proposals: { rules },
        calls,
      };
      await c.query(
        "INSERT INTO pickler.perps_study_rounds(study_id,key,document) VALUES($1,$2,$3)",
        [x.id, key, round],
      );
      x.record.lastRoundSlot = slot;
      await this.save(c, x);
      return round;
    });
  }
  async startCall(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    request?: { sha256: string; bytes: number },
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      await this.permissions(c, x);
      if (x.record.stopRequested || x.record.decisionStopReason || x.now >= x.record.endsAt!) {
        throw new PilotError("DECISIONS_STOPPED", "New paid calls stopped");
      }
      const r = await this.round(c, x.id, key);
      const call = r.calls[lane];
      if (!call) {
        throw new PilotError("INVALID_INPUT", "Lane unavailable in this protocol");
      }
      if (r.status !== "reserved" || call.status !== "reserved") {
        throw new PilotError("CONFLICT", "Call already started");
      }
      call.status = "started";
      call.startedAt = x.now;
      if (request) {
        call.requestHash = request.sha256;
        call.inputBytes = request.bytes;
      }
      await this.saveRound(c, x.id, r);
    });
  }
  async usage(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    input: number,
    output: number,
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      const r = await this.round(c, x.id, key);
      const call = r.calls[lane];
      if (!call) {
        throw new PilotError("INVALID_INPUT", "Lane unavailable in this protocol");
      }
      if (call.status !== "started" || call.costUsd !== null) {
        throw new PilotError("CONFLICT", "Usage cannot be replaced");
      }
      call.costUsd = perpsCallCost(x.record.config, lane, input, output);
      call.inputTokens = input;
      call.outputTokens = output;
      await this.saveRound(c, x.id, r);
    });
  }
  async finishCall(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    lane: PerpsCallLane,
    result: unknown,
    error: string | null,
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      const r = await this.round(c, x.id, key);
      const call = r.calls[lane];
      if (!call) {
        throw new PilotError("INVALID_INPUT", "Lane unavailable in this protocol");
      }
      if (call.status !== "started") {
        throw new PilotError("CONFLICT", "Only started calls finish");
      }
      if (!error && call.costUsd === null) {
        throw new PilotError("USAGE_UNVERIFIED", "Missing model usage");
      }
      call.status = error ? "failed" : "completed";
      call.error = error;
      call.result = result;
      call.finishedAt = x.now;
      if (error) {
        x.record.decisionStopReason ??= x.record.config.version === 2 ? error : "MODEL_FAILURE";
        x.record.status = x.record.config.version === 2 ? "closing" : "monitoring";
        if (x.record.config.version === 2) {
          x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
        }
        await this.save(c, x);
      }
      await this.saveRound(c, x.id, r);
    });
  }
  async finishRound(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    proposals: Partial<Record<PerpsStudyStrategy, PerpsProposal[]>>,
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      const r = await this.round(c, x.id, key);
      if (r.status !== "reserved") {
        throw new PilotError("CONFLICT", "Round already finished");
      }
      for (const call of Object.values(r.calls)) {
        if (call.status === "reserved") {
          call.status = "skipped";
          call.finishedAt = x.now;
        }
      }
      const routed = r.calls.jev.result as { skip?: boolean } | null;
      const contractProbe = (x.record.metadata as { purpose?: string })?.purpose === "contracts-v2";
      const valid =
        r.calls.direct.status === "completed" &&
        r.calls.jev.status === "completed" &&
        (x.record.config.version === 2
          ? r.calls.review?.status === "completed" &&
            (contractProbe || r.calls.fallback.status === "completed")
          : routed?.skip === true || r.calls.fallback.status === "completed") &&
        perpsStrategies(x.record.config).every((s) => !!proposals[s]) &&
        !Object.values(r.calls).some(
          (call) => call.status === "failed" || call.status === "started",
        );
      r.status = valid ? "completed" : "failed";
      r.proposals = { ...r.proposals, ...proposals };
      r.finishedAt = x.now;
      if (!valid) {
        x.record.decisionStopReason ??= "INCOMPLETE_ROUND";
        x.record.status = x.record.config.version === 2 ? "closing" : "monitoring";
        if (x.record.config.version === 2) {
          x.record.graceUntil = Math.min(x.record.graceUntil!, x.now + 900000);
        }
        await this.save(c, x);
      }
      await this.saveRound(c, x.id, r);
    });
  }
  async finishExecution(
    scope: PerpsStudyScope,
    lease: PerpsStudyLease,
    key: string,
    result: "complete" | "skipped_data_unavailable" | "incomplete",
  ) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      const r = await this.round(c, x.id, key);
      if (r.executionStatus !== "pending") {
        throw new PilotError("CONFLICT", "Execution already finalized");
      }
      r.executionStatus = result;
      if (result === "skipped_data_unavailable") {
        r.executionReason = "DATA_UNAVAILABLE";
      }
      await this.saveRound(c, x.id, r);
    });
  }
  async complete(scope: PerpsStudyScope, lease: PerpsStudyLease) {
    await this.tx(async (c) => {
      const x = await this.lock(c, scope);
      this.owned(c, x, lease);
      x.record.status =
        x.record.config.version === 2 &&
        x.record.decisionStopReason &&
        x.record.decisionStopReason !== "SESSION_END"
          ? "interrupted"
          : "completed";
      await this.save(c, x);
    });
  }
}
