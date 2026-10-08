import test from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import {
  assertPerpsStudyConfig,
  SMA_REENTRY_VARIANTS,
  SMA_ENTRY_POLICIES,
  hourlyEntryKey,
  reentryGate,
  assertEntryEvidence,
  profileProposals,
  profileSignal,
  perpsRules,
  nextPriceCycleDelay,
  createProfileStudyRunner,
  EVALUATION_PROTOCOLS,
  canonicalAudit,
  reentryCoverage,
} from "@pickler/trading/evaluation";
import {
  applyPaperObservation,
  applyPaperFill,
  simulatePerpsFill,
  createPerpsPaperService,
  paperRisk,
  type PerpsPaperIntent,
} from "@pickler/trading/perps";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
  timeEvaluationPool,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { createPerpsStudyModels } from "@pickler/agent-runtime/composition/perps-study-model";
import { createReportQueue } from "../src/perps-study/report-queue.js";
import { renderProfileReport } from "../src/perps-study/profiles-report.js";
import { perpsStudyReport } from "../src/perps-study/report.js";
import { config, at, evidence, account, position } from "./perps-reentry-fixtures.js";

test("v7 freezes two public-only variants and preserves hourly business rules", () => {
  assertPerpsStudyConfig(config);
  assert.throws(() => assertPerpsStudyConfig({ ...config, hours: 2 } as never));
  assert.throws(() => assertPerpsStudyConfig({ ...config, jev: {} } as never));
  assert.throws(() => createPerpsStudyModels(config, { deepseek: "", jev: "" }), /model/i);
  assert.deepEqual(EVALUATION_PROTOCOLS[config.protocol].paidCommands, []);
  const e = evidence(),
    a = account(true);
  e.candles.reverse();
  assert.deepEqual(
    profileSignal({ evidence: e, account: a }, "sma-reference", ["BTC"]),
    perpsRules({ evidence: e, account: a }, ["BTC"]),
  );
  assert.deepEqual(
    profileProposals({ evidence: e, account: a }, config, "sma-reference"),
    profileProposals({ evidence: e, account: a }, config, "sma-once-bar"),
  );
});

test("hourly gate follows original ranking, exact bar and side without replacements", () => {
  const e = evidence(),
    a = account(true);
  const selected = profileProposals({ evidence: e, account: a }, config, "sma-once-bar");
  const open = selected.find((p) => p.action === "open-long")!;
  const key = hourlyEntryKey(e, open.symbol, "long");
  a.consumedEntryKeys = [key];
  const gated = reentryGate(selected, a, e, "sma-once-bar");
  assert.equal(
    gated.find((p) => p.symbol === open.symbol)!.reason,
    "HOURLY_ENTRY_ALREADY_CONSUMED",
  );
  assert.equal(
    gated.filter((p) => p.action.startsWith("open-")).length,
    selected.filter((p) => p.action.startsWith("open-")).length - 1,
  );
  assert.equal(
    reentryGate([{ ...open, action: "open-short" }], a, e, "sma-once-bar")[0]!.action,
    "open-short",
  );
  assert.equal(
    reentryGate([open], a, evidence(at + 3600000), "sma-once-bar")[0]!.action,
    "open-long",
  );
  assert.throws(() => reentryGate(selected, a, e, "sma-reference"), /policy/);
  const intent: PerpsPaperIntent = {
    kind: "open",
    symbol: open.symbol,
    side: "long",
    notional: "100",
    feeReserve: "1",
    entryEvidence: {
      roundKey: "round-000",
      resolution: 3600,
      candleOpenTime: e.candles
        .find((s) => s.market.symbol === open.symbol && s.resolution === 3600)!
        .candles.at(-1)!.openTime,
    },
  };
  assert.throws(() => assertEntryEvidence(a, intent, e, at), /consumed/);
  a.consumedEntryKeys = [];
  assert.equal(assertEntryEvidence(a, intent, e, at), key);
  assert.throws(() => assertEntryEvidence(a, intent, e, at + 30001), /fresh/);
});

test("mark-only refresh preserves pending funding including after a confirmed close", () => {
  const a = account(true),
    e = evidence();
  position(a, "BTC");
  a.fundingPending = true;
  const marked = applyPaperObservation(
    a,
    [],
    { frames: e.frames, funding: [], marksOnly: true },
    "mark",
    at,
  ).account;
  assert.equal(marked.fundingPending, true);
  assert.ok(paperRisk(marked, [], at).reasons.includes("FUNDING_PENDING"));
  const intent: PerpsPaperIntent = {
    kind: "close",
    symbol: "BTC",
    side: "long",
    notional: "0",
    feeReserve: "1",
  };
  const attempt = {
    key: "exit",
    intent,
    status: "pending" as const,
    reserved: "1",
    createdAt: at,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const closed = applyPaperFill(
    marked,
    attempt,
    simulatePerpsFill(marked, intent, e.frames[0]!, at),
    at,
  ).account;
  assert.equal(closed.positions[0]!.closedAt, at);
  const pending = applyPaperObservation(
    closed,
    [],
    { frames: [], funding: [] },
    "funding",
    at,
  ).account;
  assert.equal(pending.fundingPending, true);
  const reconciled = applyPaperObservation(
    pending,
    [],
    {
      frames: [],
      funding: [
        {
          market: e.frames[0]!.snapshot.market,
          from: at - 1,
          to: at,
          complete: true,
          events: [],
          pages: [],
        },
      ],
    },
    "reconcile",
    at,
  ).account;
  assert.equal(reconciled.fundingPending, false);
});

test("minute overrun gets an immediate observation and reports coalesce independently", async () => {
  assert.equal(nextPriceCycleDelay(365000, 5), 1);
  assert.equal(nextPriceCycleDelay(300001, 5), 60099);
  let release!: () => void,
    calls = 0,
    overlap = 0,
    maximum = 0;
  const reports = createReportQueue(
    async () => {
      maximum = Math.max(maximum, ++overlap);
      calls++;
      if (calls === 1) {
        await new Promise<void>((r) => {
          release = r;
        });
      }
      overlap--;
    },
    (e) => {
      throw e;
    },
  );
  reports.request();
  reports.request();
  reports.request();
  assert.equal(calls, 1);
  release();
  await reports.flush();
  assert.equal(calls, 2);
  assert.equal(maximum, 1);
});

async function setup(t: Parameters<typeof createTestStore>[0], name: string) {
  let time = at;
  const db = await createTestStore(t, () => time);
  const timings: unknown[] = [];
  const pool = timeEvaluationPool(
    db.pool,
    (v) => timings.push(v),
    () => "test-cycle",
  );
  const study = new PostgresPerpsStudyStore(pool, () => time),
    paper = new PostgresPerpsPaperStore(pool, () => time);
  const c = { ...config, sessionId: name };
  const view = await study.initialize(c, {}),
    lease = await study.claim(c);
  const start = (await study.view(c)).record.startedAt!;
  while (time < start) {
    time = Math.min(start, time + 20000);
    await study.renew(c, lease);
  }
  const signal = new AbortController().signal;
  const data: import("@pickler/trading/evaluation").ProfileStudyData = {
    observe: async () => ({ frames: evidence(time).frames, funding: [], marksOnly: true }),
    evidence: async (_record, observation) => ({ ...evidence(time), frames: observation.frames }),
    prepareEvidence: async () => evidence(time),
    finalEvidence: async () => evidence(time),
    execution: async () => evidence(time).frames,
    reconcile: async () => ({ frames: [], funding: [] }),
  };
  const runner = createProfileStudyRunner({ study, paper, data, now: () => time });
  return {
    db,
    study,
    paper,
    c,
    view,
    lease,
    signal,
    data,
    runner,
    timings,
    time: () => time,
    advance: async (to: number) => {
      while (time < to) {
        time = Math.min(to, time + 20000);
        await study.renew(c, lease);
      }
    },
  };
}

test("PostgreSQL confirms opens and hourly keys atomically; rejects second bar reuse and changed fill", async (t) => {
  const s = await setup(t, "key-atomic");
  await s.runner.cycle(s.c, s.lease, s.signal);
  const exported = await exportPerpsAudit(s.db.pool, s.c);
  for (const v of SMA_REENTRY_VARIANTS) {
    const a = exported.accounts[v]!.account;
    assert.equal(a.entryPolicy, SMA_ENTRY_POLICIES[v]);
    assert.ok(a.positions.length > 0);
    assert.equal(a.consumedEntryKeys?.length, v === "sma-once-bar" ? a.positions.length : 0);
  }
  const scope = { ...s.c, agentId: s.view.record.agentIds["sma-once-bar"]! };
  const original = await s.paper.view(scope);
  const p = original.account.positions[0]!;
  const service = createPerpsPaperService(
    s.paper,
    {
      frame: async () => {
        throw Error("extra fetch forbidden");
      },
      observation: async () => ({ frames: [], funding: [] }),
    },
    s.time,
  );
  await service.trade(
    scope,
    "controlled-close",
    "close",
    p.symbol,
    p.side,
    s.signal,
    evidence(s.time()).frames.find((f) => f.snapshot.market.symbol === p.symbol)!,
  );
  const after = await s.paper.view(scope);
  assert.deepEqual(after.account.consumedEntryKeys, original.account.consumedEntryKeys);
  const hourly = evidence(s.time())
    .candles.find((x) => x.market.symbol === p.symbol && x.resolution === 3600)!
    .candles.at(-1)!.openTime;
  await assert.rejects(
    s.paper.begin(scope, 1, "reopen", {
      kind: "open",
      symbol: p.symbol,
      side: p.side,
      notional: "100",
      feeReserve: "1",
      entryEvidence: { roundKey: "round-000", resolution: 3600, candleOpenTime: hourly },
    }),
    /consumed/,
  );
  assert.ok(
    s.timings.some((v) => (v as { operation: string }).operation === "database-transaction"),
  );
  assert.ok(!JSON.stringify(s.timings).includes("postgresql"));
  const rendered = renderProfileReport(
    exported,
    perpsStudyReport(exported.study, exported.accounts),
    "active",
  );
  assert.equal(rendered.rows.length, 1584);
  const worker = new Worker(
    new URL("../src/perps-study/reentry-report-worker.mjs", import.meta.url),
    {
      workerData: {
        snapshot: exported,
        summary: perpsStudyReport(exported.study, exported.accounts),
        state: "active",
      },
    },
  );
  const background = await new Promise<typeof rendered>((resolve, reject) => {
    worker.once("message", resolve);
    worker.once("error", reject);
  });
  assert.equal(background.csv, rendered.csv);
  const coverage = reentryCoverage(exported.study, exported.accounts);
  assert.equal(coverage.completeRounds, 1);
  assert.equal(coverage.operationallyValid, false);
});

test("common final-data failure admits no fills and next slot continues without repeats", async (t) => {
  const s = await setup(t, "common-final-fail");
  s.data.finalEvidence = async () => {
    const e = evidence(s.time());
    e.frames[1]!.book.provenance.providerTimestamp = s.time() - 30001;
    return e;
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  const skipped = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(skipped.study.rounds[0]!.executionStatus, "skipped_data_unavailable");
  for (const v of SMA_REENTRY_VARIANTS) {
    assert.equal(skipped.accounts[v]!.attempts.length, 0);
  }
  s.data.finalEvidence = async () => evidence(s.time());
  await s.advance(s.time() + 300000);
  await s.runner.cycle(s.c, s.lease, s.signal);
  const next = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(next.study.rounds.length, 2);
  assert.equal(next.study.rounds[1]!.executionStatus, "complete");
  assert.equal(next.study.rounds.flatMap((r) => Object.values(r.calls)).length, 0);
});

test("price stop exits precede funding and candle preparation", async (t) => {
  const s = await setup(t, "price-priority");
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 60000);
  s.data.observe = async () => {
    const e = evidence(s.time());
    for (const f of e.frames) {
      f.snapshot.ticker.mark = "97";
    }
    return { frames: e.frames, funding: [], marksOnly: true };
  };
  let inspected = false;
  s.data.reconcile = async () => {
    for (const v of SMA_REENTRY_VARIANTS) {
      const state = await s.paper.view({ ...s.c, agentId: s.view.record.agentIds[v]! });
      assert.equal(state.account.positions.filter((p) => p.closedAt === null).length, 0);
    }
    inspected = true;
    return { frames: [], funding: [] };
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  assert.equal(inspected, true);
  const state = await s.study.view(s.c);
  const e = state.events.find((e) => e.kind === "exit-detected")!;
  assert.equal((e.data as { firstExecutableObservedAt: number }).firstExecutableObservedAt, e.at);
});

test("expired study ownership rejects fills, consumed keys and late cleanup writes", async (t) => {
  const s = await setup(t, "expired-key");
  await s.runner.cycle(s.c, s.lease, s.signal);
  const before = await exportPerpsAudit(s.db.pool, s.c);
  await s.db.pool.query(
    "UPDATE pickler.perps_studies SET expires_at=$1 WHERE tenant_id=$2 AND session_id=$3",
    [s.time() - 1, s.c.tenantId, s.c.sessionId],
  );
  const owned = new PostgresPerpsPaperStore(s.db.pool, s.time, { ...s.c, owner: s.lease.owner });
  const scope = { ...s.c, agentId: s.view.record.agentIds["sma-once-bar"]! };
  await assert.rejects(
    owned.observe(scope, "late", {
      frames: evidence(s.time()).frames,
      funding: [],
      marksOnly: true,
    }),
    /ownership/,
  );
  await s.study.release(s.c, s.lease, "LEASE_LOST");
  const after = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(canonicalAudit(before.accounts), canonicalAudit(after.accounts));
  assert.equal(before.study.events.length, after.study.events.length);
});

test("concurrent admissions serialize; failed fill leaves key untouched, successful fill consumes once", async (t) => {
  const s = await setup(t, "key-concurrency");
  const scope = { ...s.c, agentId: s.view.record.agentIds["sma-once-bar"]! };
  const e = evidence(s.time()),
    selected = profileProposals(
      { evidence: e, account: (await s.paper.view(scope)).account },
      s.c,
      "sma-once-bar",
    );
  const proposal = selected.find((p) => p.action === "open-long")!;
  await s.study.event(s.c, s.lease, "round-000:final-evidence", "execution-input", { evidence: e });
  await s.study.event(s.c, s.lease, "round-000:sma-once-bar:final-gate", "final-gate", {
    initial: selected,
    final: selected,
  });
  const intent: PerpsPaperIntent = {
    kind: "open",
    symbol: proposal.symbol,
    side: "long",
    notional: "100",
    feeReserve: "1",
    entryEvidence: {
      roundKey: "round-000",
      resolution: 3600,
      candleOpenTime: e.candles
        .find((c) => c.market.symbol === proposal.symbol && c.resolution === 3600)!
        .candles.at(-1)!.openTime,
    },
  };
  const admissions = await Promise.allSettled([
    s.paper.begin(scope, 1, "a", intent),
    s.paper.begin(scope, 1, "b", intent),
  ]);
  const accepted = admissions.filter((x) => x.status === "fulfilled" && x.value.lease);
  assert.equal(accepted.length, 1);
  const admitted = (
    accepted[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof s.paper.begin>>>
  ).value;
  const initial = await s.paper.view(scope);
  const fill = simulatePerpsFill(
    initial.account,
    intent,
    e.frames.find((f) => f.snapshot.market.symbol === intent.symbol)!,
    s.time(),
  );
  await assert.rejects(
    s.paper.complete(scope, admitted.lease!, { ...fill, fee: "1" }),
    /shared persisted final/,
  );
  assert.deepEqual((await s.paper.view(scope)).account.consumedEntryKeys, []);
  await s.db.pool.query(
    "CREATE FUNCTION pickler.controlled_fill_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'CONTROLLED_FILL_FAILURE'; END $$",
  );
  await s.db.pool.query(
    "CREATE TRIGGER controlled_fill_failure BEFORE INSERT ON pickler.perps_paper_movements FOR EACH ROW EXECUTE FUNCTION pickler.controlled_fill_failure()",
  );
  await assert.rejects(s.paper.complete(scope, admitted.lease!, fill), /CONTROLLED_FILL_FAILURE/);
  const rolledBack = await s.paper.view(scope);
  assert.equal(rolledBack.account.positions.length, 0);
  assert.deepEqual(rolledBack.account.consumedEntryKeys, []);
  assert.equal(rolledBack.account.cash, "1000");
  await s.db.pool.query("DROP TRIGGER controlled_fill_failure ON pickler.perps_paper_movements");
  await s.paper.complete(scope, admitted.lease!, fill);
  const confirmed = await s.paper.view(scope);
  assert.equal(confirmed.account.consumedEntryKeys?.length, 1);
  assert.equal(confirmed.account.positions.length, 1);
  const repeat = await s.paper.begin(scope, 1, admitted.attempt.key, intent);
  assert.equal(repeat.lease, null);
  assert.equal((await s.paper.view(scope)).account.consumedEntryKeys?.length, 1);
  const changed = {
    ...intent,
    entryEvidence: {
      ...intent.entryEvidence!,
      candleOpenTime: intent.entryEvidence!.candleOpenTime - 3600000,
    },
  };
  await assert.rejects(s.paper.begin(scope, 1, admitted.attempt.key, changed), {
    code: "CONFLICT",
  });
});

test("no executable exit is invented when depth is absent; pre-maintenance positions remain in coverage", async (t) => {
  const s = await setup(t, "exit-depth");
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 60000);
  s.data.observe = async () => {
    const e = evidence(s.time());
    for (const f of e.frames) {
      f.snapshot.ticker.mark = "97";
      f.book.bids = [];
    }
    return { frames: e.frames, funding: [], marksOnly: true };
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  const packet = await exportPerpsAudit(s.db.pool, s.c);
  const exits = packet.study.events.filter((e) => e.kind === "exit-detected");
  assert.ok(exits.length);
  assert.ok(
    exits.every(
      (e) =>
        (e.data as { firstExecutableObservedAt: number | null }).firstExecutableObservedAt === null,
    ),
  );
  assert.ok(packet.accounts["sma-once-bar"]!.account.positions.some((p) => p.closedAt === null));
  assert.ok(reentryCoverage(packet.study, packet.accounts).exposedObservations > 0);
  const missing = structuredClone(packet);
  for (const event of missing.study.events.filter((e) => e.kind === "observation")) {
    const states = (event.data as { beforeMaintenance: Record<string, { evidence: unknown[] }> })
      .beforeMaintenance;
    for (const state of Object.values(states)) {
      state.evidence = [];
    }
  }
  assert.ok(
    reentryCoverage(missing.study, missing.accounts).valuedObservations <
      reentryCoverage(packet.study, packet.accounts).valuedObservations,
  );
});

test("lease renewal never overlaps during slow work; failure aborts and suspension is not recovery", async (t) => {
  const { startLeaseHeartbeat } = await import("@pickler/trading/evaluation");
  t.mock.timers.enable({ apis: ["setInterval"] });
  let time = at,
    mono = 10,
    calls = 0,
    release!: () => void;
  const events: { durationMs: number; kind: string }[] = [];
  const heartbeat = startLeaseHeartbeat({
    lease: { expiresAt: at + 90000 },
    now: () => time,
    monotonic: () => mono,
    diagnostic: (e) => events.push(e),
    renew: async () => {
      calls++;
      await new Promise<void>((r) => {
        release = r;
      });
      throw new Error("controlled PostgreSQL wait failed");
    },
  });
  time += 20000;
  t.mock.timers.tick(20000);
  time += 20000;
  t.mock.timers.tick(20000);
  assert.equal(calls, 1);
  mono += 25;
  release();
  await heartbeat.stop();
  assert.equal(heartbeat.signal.aborted, true);
  assert.equal(events[0]!.durationMs, 25);
  assert.throws(() => heartbeat.assertActive());
  const suspended = startLeaseHeartbeat({
    lease: { expiresAt: time + 90000 },
    now: () => time,
    renew: async () => {
      throw Error("no replacement lease");
    },
  });
  time += 90001;
  assert.throws(() => suspended.assertActive(), { code: "PROCESS_INTERRUPTED" });
  await suspended.stop();
});
