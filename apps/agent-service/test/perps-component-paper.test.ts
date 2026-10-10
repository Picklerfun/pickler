import test from "node:test";
import { PilotError } from "@pickler/core";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  assertPerpsStudyConfig,
  createProfileStudyRunner,
  SMA_REENTRY_VARIANTS,
  type ProfileStudyData,
  type SmaReentryVariant,
} from "@pickler/trading/evaluation";
import {
  COMPONENT_PAPER_POLICY,
  simulatePerpsFill,
  type PerpsPaperFrame,
} from "@pickler/trading/perps";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
  timeEvaluationPool,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { config, at, evidence } from "./perps-reentry-fixtures.js";

const digest = (frame: PerpsPaperFrame) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        snapshot: frame.snapshot,
        book: frame.book,
        streamEvidence: frame.streamEvidence,
      }),
    )
    .digest("hex");
const paperConfig = (sessionId: string) => ({
  ...config,
  sessionId,
  acquisitionPolicy: COMPONENT_PAPER_POLICY,
  captureQualification: { commit: "a".repeat(40), reportSha256: "b".repeat(64) },
});

async function setup(
  t: Parameters<typeof createTestStore>[0],
  sessionId: string,
  side: "long" | "short" = "long",
  receiptOffset = 0,
  queryAdvanceMs = 0,
  capturedExecution = true,
  sharedDb?: Awaited<ReturnType<typeof createTestStore>>,
) {
  let time = at;
  const db = sharedDb ?? (await createTestStore(t, () => time));
  const c = paperConfig(sessionId);
  const study = new PostgresPerpsStudyStore(db.pool, () => time);
  const view = await study.initialize(c, { acquisitionPolicy: COMPONENT_PAPER_POLICY });
  const lease = await study.claim(c);
  const signal = new AbortController().signal;
  let measuredQueries = 0;
  let finalCopiedAt = 0;
  let lastExecutionEndAt = 0;
  let measuring = false;
  let queryHook: ((statement: string) => void) | undefined;
  const pool = timeEvaluationPool(
    db.pool,
    (event) => {
      if (measuring && event.operation === "database-query") {
        measuredQueries++;
        time += queryAdvanceMs;
      }
      if (event.operation === "database-query") {
        queryHook?.(event.statement);
      }
    },
    () => sessionId,
  );
  const paper = new PostgresPerpsPaperStore(
    pool,
    () => time,
    {
      ...c,
      owner: lease.owner,
      signal,
    },
    undefined,
    () => time + receiptOffset,
  );
  if (!capturedExecution) {
    Object.defineProperty(paper, "executeFrame", { value: undefined });
  }
  const advance = async (to: number) => {
    while (time < to) {
      time = Math.min(to, time + 20000);
      await study.renew(c, lease);
    }
  };
  await advance((await study.view(c)).record.startedAt!);
  const fresh = () => {
    const receiptAt = time + receiptOffset;
    const value = evidence(receiptAt);
    for (const frame of value.frames) {
      frame.snapshot.ticker.provenance = {
        ...frame.snapshot.ticker.provenance,
        providerTimestamp: receiptAt - 20000,
      };
      frame.book.provenance = { ...frame.book.provenance, providerTimestamp: receiptAt };
      frame.streamEvidence = {
        policy: COMPONENT_PAPER_POLICY,
        generation: 1,
        copiedAt: receiptAt,
        heartbeatSequence: Math.floor(time / 1000),
        headBlock: Math.floor(time / 1000),
        heartbeatReceivedAt: receiptAt,
      };
      frame.hash = digest(frame);
    }
    if (side === "short") {
      for (const series of value.candles) {
        for (const candle of series.candles.slice(40)) {
          candle.close = "99";
        }
      }
    }
    return value;
  };
  const data: ProfileStudyData = {
    observe: async () => ({ frames: fresh().frames, funding: [], marksOnly: true }),
    evidence: async (_record, observation) => ({ ...fresh(), frames: observation.frames }),
    prepareEvidence: async () => fresh(),
    finalEvidence: async () => {
      const value = fresh();
      finalCopiedAt = time;
      return value;
    },
    execution: async () => fresh().frames,
    reconcile: async () => ({ frames: [], funding: [] }),
  };
  const runner = createProfileStudyRunner({
    study,
    paper,
    data,
    now: () => time + receiptOffset,
    timing: (event) => {
      if (event.operation === "simulation-and-transaction") {
        lastExecutionEndAt = time;
      }
    },
  });
  const scope = (variant: SmaReentryVariant = "sma-reference") => ({
    ...c,
    agentId: view.record.agentIds[variant]!,
  });
  return {
    db,
    c,
    study,
    paper,
    lease,
    signal,
    data,
    runner,
    scope,
    fresh,
    advance,
    startMeasuring: () => {
      measuring = true;
      measuredQueries = 0;
    },
    queries: () => measuredQueries,
    finalExecutionMs: () => lastExecutionEndAt - finalCopiedAt,
    onQuery: (hook?: (statement: string) => void) => {
      queryHook = hook;
    },
    elapse: (ms: number) => {
      time += ms;
    },
    time: () => time,
    expire: () => {
      time += 90001;
    },
  };
}

test("component paper selection requires an exact capture pin and leaves legacy configuration unchanged", () => {
  assertPerpsStudyConfig(config);
  assertPerpsStudyConfig(paperConfig("controlled-policy"));
  const missing = paperConfig("invalid") as typeof config;
  delete missing.captureQualification;
  assert.throws(() => assertPerpsStudyConfig(missing), { code: "INVALID_INPUT" });
  assert.throws(
    () =>
      assertPerpsStudyConfig({
        ...paperConfig("invalid"),
        captureQualification: {
          commit: "a".repeat(40),
          reportSha256: "wrong",
        },
      }),
    { code: "INVALID_INPUT" },
  );
  assert.throws(
    () =>
      assertPerpsStudyConfig({
        ...config,
        captureQualification: paperConfig("unused").captureQualification,
      }),
    { code: "INVALID_INPUT" },
  );
});

for (const side of ["long", "short"] as const) {
  test(`real PostgreSQL coordinator opens ${side}, prioritizes stops and preserves funding pending`, async (t) => {
    const s = await setup(t, `component-${side}`, side);
    await s.runner.cycle(s.c, s.lease, s.signal);
    const opened = await exportPerpsAudit(s.db.pool, s.c);
    assert.equal(opened.study.rounds[0]!.executionStatus, "complete");
    assert.equal(
      opened.study.rounds[0]!.calls && Object.keys(opened.study.rounds[0]!.calls).length,
      0,
    );
    for (const variant of SMA_REENTRY_VARIANTS) {
      const a = opened.accounts[variant]!.account;
      assert.equal(a.marketDataPolicy, COMPONENT_PAPER_POLICY);
      assert.ok(a.positions.length > 0);
      assert.ok(a.positions.every((p) => p.side === side));
      assert.equal(
        a.consumedEntryKeys?.length,
        variant === "sma-once-bar" ? a.positions.length : 0,
      );
    }
    await s.advance(s.time() + 60000);
    s.data.observe = async () => {
      const e = s.fresh();
      for (const frame of e.frames) {
        frame.snapshot.ticker.mark = side === "long" ? "97" : "103";
        frame.hash = digest(frame);
      }
      return { frames: e.frames, funding: [], marksOnly: true };
    };
    await s.runner.cycle(s.c, s.lease, s.signal);
    const closed = await exportPerpsAudit(s.db.pool, s.c);
    for (const variant of SMA_REENTRY_VARIANTS) {
      const a = closed.accounts[variant]!;
      assert.ok(a.account.positions.every((p) => p.closedAt !== null));
      assert.equal(a.account.fundingPending, true);
      assert.ok(a.movements.some((m) => m.kind === "realized-pnl"));
      assert.ok(a.movements.some((m) => m.kind === "fee"));
    }
    assert.equal(closed.study.rounds.flatMap((r) => Object.values(r.calls)).length, 0);
  });
}

test("invalid common final evidence permits no partial execution and the following slot continues", async (t) => {
  const s = await setup(t, "component-final-fail");
  s.data.finalEvidence = async () => {
    const e = s.fresh();
    e.frames[10]!.book.provenance.providerTimestamp = s.time() - 30001;
    return e;
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  const skipped = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(skipped.study.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.ok(SMA_REENTRY_VARIANTS.every((v) => skipped.accounts[v]!.attempts.length === 0));
  s.data.finalEvidence = async () => s.fresh();
  await s.advance(s.time() + 300000);
  await s.runner.cycle(s.c, s.lease, s.signal);
  const next = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(next.study.rounds[1]!.executionStatus, "complete");
});

test("component accounts reject unowned writes, altered policies and expired study ownership", async (t) => {
  const s = await setup(t, "component-ownership");
  const unowned = new PostgresPerpsPaperStore(s.db.pool, () => s.time());
  await assert.rejects(
    unowned.observe(s.scope(), "unowned", { frames: s.fresh().frames, funding: [] }),
    { code: "LEASE_LOST" },
  );
  await s.db.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document-'marketDataPolicy' WHERE tenant_id=$1 AND session_id=$2 AND agent_id=$3",
    [s.c.tenantId, s.c.sessionId, s.scope().agentId],
  );
  await assert.rejects(
    s.paper.observe(s.scope(), "altered", { frames: s.fresh().frames, funding: [] }),
    { code: "CONFIG_CHANGED" },
  );
  await s.db.pool.query(
    "UPDATE pickler.perps_paper_accounts SET document=document||jsonb_build_object('marketDataPolicy',$3::text) WHERE tenant_id=$1 AND session_id=$2",
    [s.c.tenantId, s.c.sessionId, COMPONENT_PAPER_POLICY],
  );
  const before = await exportPerpsAudit(s.db.pool, s.c);
  s.expire();
  await assert.rejects(
    s.paper.observe(s.scope(), "expired", { frames: s.fresh().frames, funding: [] }),
    { code: "LEASE_LOST" },
  );
  const after = await exportPerpsAudit(s.db.pool, s.c);
  assert.deepEqual(after.accounts, before.accounts);
});

test("transactional close rejects tampered evidence and expired continuity before any fill", async (t) => {
  const s = await setup(t, "component-close-proof");
  await s.runner.cycle(s.c, s.lease, s.signal);
  const state = await s.paper.view(s.scope());
  const p = state.account.positions[0]!;
  const intent = {
    kind: "close",
    symbol: p.symbol,
    side: p.side,
    notional: "0",
    feeReserve: "1",
  } as const;
  const admission = await s.paper.begin(s.scope(), 1, "controlled-close", intent);
  assert.ok(admission.lease);
  const original = s.fresh().frames.find((frame) => frame.snapshot.market.symbol === p.symbol)!;
  const altered = structuredClone(original);
  altered.hash = "f".repeat(64);
  const fill = simulatePerpsFill(state.account, intent, altered, s.time());
  await assert.rejects(s.paper.complete(s.scope(), admission.lease!, fill), {
    code: "INVALID_MARKET_DATA",
  });
  const old = structuredClone(original);
  old.streamEvidence!.heartbeatReceivedAt -= 5001;
  old.hash = digest(old);
  const expired = {
    ...simulatePerpsFill(state.account, intent, original, s.time()),
    evidence: { ...(fill.evidence as object), frame: old },
  };
  await assert.rejects(s.paper.complete(s.scope(), admission.lease!, expired), {
    code: "STALE_MARKET_DATA",
  });
  const unchanged = await s.paper.view(s.scope());
  assert.deepEqual(unchanged.account, state.account);
  assert.deepEqual(unchanged.movements, state.movements);
  const completed = await s.paper.complete(
    s.scope(),
    admission.lease!,
    simulatePerpsFill(state.account, intent, original, s.time()),
  );
  assert.equal(completed.account.positions[0]!.closedAt, s.time());
});

test("owned PostgreSQL financial writes keep receipt and database clocks distinct", async (t) => {
  const s = await setup(t, "component-clock-domains", "long", 23);
  await s.runner.cycle(s.c, s.lease, s.signal);
  const first = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(first.study.rounds[0]!.executionStatus, "complete");
  for (const variant of SMA_REENTRY_VARIANTS) {
    const a = first.accounts[variant]!.account;
    assert.ok(a.positions.length > 0);
    assert.ok(a.positions.every((position) => position.openedAt === s.time()));
    assert.equal(a.lastValuationAt, s.time());
  }
  await s.advance(s.time() + 60000);
  s.data.observe = async () => {
    const value = s.fresh();
    for (const frame of value.frames) {
      frame.snapshot.ticker.mark = "97";
      frame.hash = digest(frame);
    }
    return { frames: value.frames, funding: [], marksOnly: true };
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  const closed = await exportPerpsAudit(s.db.pool, s.c);
  for (const variant of SMA_REENTRY_VARIANTS) {
    const a = closed.accounts[variant]!.account;
    assert.ok(a.positions.every((position) => position.closedAt === s.time()));
    assert.ok(
      closed.accounts[variant]!.movements.some((movement) => movement.kind === "realized-pnl"),
    );
  }
});

test("captured completion is idempotent after its heartbeat expires and racing closes settle once", async (t) => {
  const s = await setup(t, "component-atomic-idempotence");
  await s.runner.cycle(s.c, s.lease, s.signal);
  const original = await s.paper.view(s.scope("sma-once-bar"));
  const opened = original.attempts.find((a) => a.status === "filled")!;
  const frame = s.fresh().frames.find((f) => f.snapshot.market.symbol === opened.intent.symbol)!;
  s.elapse(5001);
  const repeated = await s.paper.executeFrame(
    s.scope("sma-once-bar"),
    opened.key,
    opened.intent,
    frame,
  );
  assert.deepEqual(repeated, original);
  await assert.rejects(
    s.paper.executeFrame(
      s.scope("sma-once-bar"),
      opened.key,
      { ...opened.intent, side: "short" },
      frame,
    ),
    { code: "CONFLICT" },
  );

  const position = original.account.positions.find((p) => p.id === opened.key)!;
  const fresh = s.fresh().frames.find((f) => f.snapshot.market.symbol === position.symbol)!;
  const intent = {
    kind: "close",
    symbol: position.symbol,
    side: position.side,
    notional: "0",
    feeReserve: "1",
  } as const;
  const [first, second] = await Promise.all([
    s.paper.executeFrame(s.scope("sma-once-bar"), "atomic-close", intent, fresh),
    s.paper.executeFrame(s.scope("sma-once-bar"), "atomic-close", intent, fresh),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.attempts.filter((a) => a.key === "atomic-close").length, 1);
  assert.equal(
    first.movements.filter((m) => m.key === "atomic-close:fee" && m.kind === "fee").length,
    1,
  );
  assert.deepEqual(first.account.consumedEntryKeys, original.account.consumedEntryKeys);
});

for (const failure of ["heartbeat", "ownership"] as const) {
  test(`captured transaction rolls back its writes when ${failure} expires before commit`, async (t) => {
    const s = await setup(t, `component-atomic-rollback-${failure}`);
    await s.runner.cycle(s.c, s.lease, s.signal);
    const before = await s.paper.view(s.scope("sma-once-bar"));
    const p = before.account.positions[0]!;
    const frame = s.fresh().frames.find((f) => f.snapshot.market.symbol === p.symbol)!;
    let inserts = 0;
    s.onQuery((statement) => {
      if (statement === "INSERT" && ++inserts === 3) {
        s.elapse(failure === "heartbeat" ? 5001 : 90001);
        s.onQuery();
      }
    });
    await assert.rejects(
      s.paper.executeFrame(
        s.scope("sma-once-bar"),
        "rollback-close",
        {
          kind: "close",
          symbol: p.symbol,
          side: p.side,
          notional: "0",
          feeReserve: "1",
        },
        frame,
      ),
      { code: failure === "heartbeat" ? "STALE_MARKET_DATA" : "LEASE_LOST" },
    );
    assert.equal(inserts, 3);
    const after = await exportPerpsAudit(s.db.pool, s.c);
    assert.deepEqual(after.accounts["sma-once-bar"], before);
  });
}

test("captured failed opening rolls back both the fill and the consumed hourly key", async (t) => {
  const s = await setup(t, "component-atomic-open-rollback");
  const original = s.paper.executeFrame.bind(s.paper);
  s.paper.executeFrame = async (...args) => {
    if (args[0].agentId !== s.scope("sma-once-bar").agentId) {
      return original(...args);
    }
    let inserts = 0;
    s.onQuery((statement) => {
      if (statement === "INSERT" && ++inserts === 3) {
        s.elapse(5001);
        s.onQuery();
      }
    });
    return original(...args);
  };
  await assert.rejects(s.runner.cycle(s.c, s.lease, s.signal), { code: "STALE_MARKET_DATA" });
  const saved = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(saved.accounts["sma-reference"]!.account.positions.length, 4);
  const rejected = saved.accounts["sma-once-bar"]!;
  assert.equal(rejected.account.positions.length, 0);
  assert.equal(rejected.attempts.length, 0);
  assert.equal(rejected.account.consumedEntryKeys?.length, 0);
});

test("captured execution rejects tampered hashes and unbound owners without financial writes", async (t) => {
  const s = await setup(t, "component-atomic-validation");
  await s.runner.cycle(s.c, s.lease, s.signal);
  const before = await s.paper.view(s.scope());
  const p = before.account.positions[0]!;
  const frame = s.fresh().frames.find((f) => f.snapshot.market.symbol === p.symbol)!;
  const intent = {
    kind: "close",
    symbol: p.symbol,
    side: p.side,
    notional: "0",
    feeReserve: "1",
  } as const;
  await assert.rejects(
    s.paper.executeFrame(s.scope(), "bad-hash", intent, { ...frame, hash: "f".repeat(64) }),
    { code: "INVALID_MARKET_DATA" },
  );
  const unowned = new PostgresPerpsPaperStore(s.db.pool, () => s.time());
  await assert.rejects(unowned.executeFrame(s.scope(), "unbound", intent, frame), {
    code: "LEASE_LOST",
  });
  assert.deepEqual(await s.paper.view(s.scope()), before);
});

test("paired controlled query delay compares unchanged financial results and expiry margin", async (t) => {
  const db = await createTestStore(t);
  const measurements: {
    sample: number;
    captured: boolean;
    queryDelayMs: number;
    queries: number;
    simulatedElapsedMs: number;
    simulatedFinalExecutionMs: number;
    measuredElapsedMs: number;
    complete: boolean;
    code: string | null;
    fills: number;
  }[] = [];
  const financial = (view: Awaited<ReturnType<typeof exportPerpsAudit>>) =>
    SMA_REENTRY_VARIANTS.map((v) => {
      const a = view.accounts[v]!.account;
      return {
        cash: a.cash,
        movements: view.accounts[v]!.movements.map((m) => ({ kind: m.kind, delta: m.delta })).sort(
          (a, b) => `${a.kind}:${a.delta}`.localeCompare(`${b.kind}:${b.delta}`),
        ),
        positions: a.positions.map((p) => ({
          symbol: p.symbol,
          side: p.side,
          quantity: p.quantity,
          entryPrice: p.entryPrice,
        })),
      };
    });
  let parity: ReturnType<typeof financial> | undefined;
  for (const queryDelayMs of [0, 10]) {
    for (let sample = 0; sample < 30; sample++) {
      for (const captured of [false, true]) {
        const s = await setup(
          t,
          `benchmark-${queryDelayMs}-${sample}-${captured}`,
          "long",
          0,
          queryDelayMs,
          captured,
          db,
        );
        s.startMeasuring();
        const initial = s.time();
        const started = performance.now();
        let code: string | null = null;
        try {
          await s.runner.cycle(s.c, s.lease, s.signal);
        } catch (error) {
          code = (error as { code?: string }).code ?? "UNEXPECTED_FAILURE";
        }
        const measuredElapsedMs = performance.now() - started;
        const simulatedElapsedMs = s.time() - initial;
        const queries = s.queries();
        const saved = await exportPerpsAudit(db.pool, s.c);
        const complete = saved.study.rounds[0]?.executionStatus === "complete";
        const fills = SMA_REENTRY_VARIANTS.reduce(
          (n, v) => n + saved.accounts[v]!.attempts.filter((a) => a.status === "filled").length,
          0,
        );
        measurements.push({
          sample,
          captured,
          queryDelayMs,
          queries,
          simulatedElapsedMs,
          simulatedFinalExecutionMs: s.finalExecutionMs(),
          measuredElapsedMs,
          complete,
          code,
          fills,
        });
        if (sample === 0) {
          t.diagnostic(`COMPONENT_ATOMIC_SAMPLE=${JSON.stringify(measurements.at(-1))}`);
        }
        if (queryDelayMs === 0) {
          assert.equal(code, null);
          assert.equal(complete, true);
          assert.equal(fills, 8);
          parity ??= financial(saved);
          assert.deepEqual(financial(saved), parity);
        } else if (captured) {
          assert.equal(code, null);
          assert.equal(complete, true);
          assert.equal(fills, 8);
          assert.ok(s.finalExecutionMs() < 5000);
        } else {
          assert.equal(code, "STALE_MARKET_DATA");
          assert.equal(complete, false);
        }
      }
    }
  }
  t.diagnostic(`COMPONENT_ATOMIC_BENCHMARK=${JSON.stringify(measurements)}`);
});

function agingObservation(s: Awaited<ReturnType<typeof setup>>, age = 29694) {
  const value = s.fresh();
  for (const frame of value.frames) {
    frame.snapshot.ticker.provenance.providerTimestamp = s.time() - age;
    frame.book.provenance.providerTimestamp = s.time() - 500;
    frame.streamEvidence!.heartbeatReceivedAt = s.time() - 50;
    frame.hash = digest(frame);
  }
  return { frames: value.frames, funding: [], marksOnly: true };
}
const commonScopes = (s: Awaited<ReturnType<typeof setup>>) =>
  SMA_REENTRY_VARIANTS.map((v) => s.scope(v));

test("recorded 29,694ms to 30,189ms aging reproduces sequential partial valuation", async (t) => {
  const s = await setup(t, "component-observation-old-aging");
  Object.defineProperty(s.paper, "observeCommon", { value: undefined });
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 60000);
  const before = await exportPerpsAudit(s.db.pool, s.c);
  const value = agingObservation(s);
  s.data.observe = async () => value;
  const observe = s.paper.observe.bind(s.paper);
  let valuations = 0;
  s.paper.observe = async (...args) => {
    const result = await observe(...args);
    if (args[1] === `observe-${Math.floor(s.time() / 60000)}` && ++valuations === 1) {
      s.elapse(495);
    }
    return result;
  };
  await assert.rejects(s.runner.cycle(s.c, s.lease, s.signal), { code: "STALE_MARKET_DATA" });
  const after = await exportPerpsAudit(s.db.pool, s.c);
  assert.notDeepEqual(
    after.accounts["sma-reference"]!.account,
    before.accounts["sma-reference"]!.account,
  );
  assert.deepEqual(after.accounts["sma-once-bar"], before.accounts["sma-once-bar"]);
  assert.equal(s.time() - value.frames[0]!.snapshot.ticker.provenance.providerTimestamp!, 30189);
});

test("common valuation expiry rolls back both accounts and skips only its admitted slot", async (t) => {
  const s = await setup(t, "component-observation-common-aging");
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 300000);
  const before = await exportPerpsAudit(s.db.pool, s.c);
  const value = agingObservation(s);
  const minute = Math.floor(s.time() / 60000);
  s.data.observe = async () => value;
  let inserts = 0;
  s.onQuery((statement) => {
    if (statement === "INSERT" && ++inserts === 2) {
      s.elapse(495);
      s.onQuery();
    }
  });
  assert.equal(await s.runner.cycle(s.c, s.lease, s.signal), true);
  const after = await exportPerpsAudit(s.db.pool, s.c);
  assert.deepEqual(after.accounts, before.accounts);
  const failure = after.study.events.find(
    (e) => e.key === `observe-${minute}:valuation-unavailable`,
  )!;
  const detail = failure.data as {
    rolledBack: boolean;
    frameValidation: { financialAt: number; tickerAt: number };
  };
  assert.equal(detail.rolledBack, true);
  assert.equal(detail.frameValidation.financialAt - detail.frameValidation.tickerAt, 30189);
  assert.ok(after.study.events.some((e) => e.key === "slot-1:data-unavailable"));
  assert.equal(after.study.rounds.length, 1);
  assert.equal(
    (
      await s.db.pool.query(
        "SELECT count(*)::int n FROM pickler.perps_paper_observations WHERE key=$1",
        [`observe-${minute}`],
      )
    ).rows[0].n,
    0,
  );
  s.data.observe = async () => ({ frames: s.fresh().frames, funding: [], marksOnly: true });
  await s.runner.cycle(s.c, s.lease, s.signal);
  assert.equal((await s.study.view(s.c)).rounds.length, 1);
  await s.advance(s.time() + 300000);
  await s.runner.cycle(s.c, s.lease, s.signal);
  const continued = await s.study.view(s.c);
  assert.equal(continued.rounds.length, 2);
  assert.equal(continued.rounds[1]!.slot, 2);
  assert.equal(continued.rounds[1]!.executionStatus, "complete");
});

test("common valuation accepts the exact native limit and racing duplicates remain idempotent", async (t) => {
  const s = await setup(t, "component-observation-exact-limit");
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 60000);
  const value = agingObservation(s, 30000);
  const [a, b] = await Promise.all([
    s.paper.observeCommon(commonScopes(s), "common-exact", value),
    s.paper.observeCommon([...commonScopes(s)].reverse(), "common-exact", value),
  ]);
  assert.equal(a.status, "complete");
  assert.equal(b.status, "complete");
  if (a.status !== "complete" || b.status !== "complete") {
    return;
  }
  assert.equal(Number(a.replayed) + Number(b.replayed), 1);
  assert.equal(
    a.accounts[0]!.view.account.lastValuationAt,
    a.accounts[1]!.view.account.lastValuationAt,
  );
  s.elapse(5001);
  const replay = await s.paper.observeCommon(commonScopes(s), "common-exact", value);
  assert.equal(replay.status, "complete");
  if (replay.status === "complete") {
    assert.equal(replay.replayed, true);
  }
  assert.equal(
    (
      await s.db.pool.query(
        "SELECT count(*)::int n FROM pickler.perps_paper_observations WHERE key=$1",
        ["common-exact"],
      )
    ).rows[0].n,
    2,
  );
});

for (const failure of ["heartbeat", "ownership", "rollback", "commit"] as const) {
  test(`common observation ${failure} failure never hides uncertain writes or ownership loss`, async (t) => {
    const s = await setup(t, `component-observation-fence-${failure}`);
    await s.runner.cycle(s.c, s.lease, s.signal);
    const before = await exportPerpsAudit(s.db.pool, s.c);
    const value = s.data.observe
      ? await s.data.observe((await s.study.view(s.c)).record, s.signal, async () => {})
      : agingObservation(s);
    let inserts = 0;
    s.onQuery((statement) => {
      if (statement === "INSERT" && ++inserts === 2) {
        if (failure === "heartbeat") {
          s.elapse(5001);
        }
        if (failure === "ownership") {
          s.elapse(90001);
        }
        if (failure === "rollback") {
          s.elapse(5001);
        }
      }
      if (statement === "ROLLBACK" && failure === "rollback") {
        s.onQuery();
        throw new PilotError("CONTROLLED_ROLLBACK_FAILURE", "Controlled unavailable confirmation");
      }
      if (statement === "COMMIT" && failure === "commit") {
        s.onQuery();
        throw new PilotError("CONTROLLED_COMMIT_FAILURE", "Controlled uncertain commit");
      }
    });
    if (failure === "heartbeat") {
      const result = await s.paper.observeCommon(commonScopes(s), `common-${failure}`, value);
      assert.equal(result.status, "data_unavailable");
      if (result.status === "data_unavailable") {
        assert.equal(result.validation.reason, "heartbeat-expired-at-receipt-clock");
        assert.equal(result.rolledBack, true);
      }
    } else {
      await assert.rejects(s.paper.observeCommon(commonScopes(s), `common-${failure}`, value), {
        code:
          failure === "ownership"
            ? "LEASE_LOST"
            : failure === "rollback"
              ? "PERSISTENCE_FAILED"
              : "CONTROLLED_COMMIT_FAILURE",
      });
    }
    s.onQuery();
    const after = await exportPerpsAudit(s.db.pool, s.c);
    if (failure !== "commit") {
      assert.deepEqual(after.accounts, before.accounts);
    }
  });
}

test("common observation rejects partial history, altered hashes and cross-study membership", async (t) => {
  const s = await setup(t, "component-observation-membership");
  await s.runner.cycle(s.c, s.lease, s.signal);
  await s.advance(s.time() + 60000);
  const value = agingObservation(s);
  await s.paper.observe(s.scope(), "partial-history", value);
  await assert.rejects(s.paper.observeCommon(commonScopes(s), "partial-history", value), {
    code: "INCOMPLETE_EXECUTION",
  });
  const altered = structuredClone(value);
  altered.frames[0]!.hash = "f".repeat(64);
  await assert.rejects(s.paper.observeCommon(commonScopes(s), "altered-hash", altered), {
    code: "INVALID_MARKET_DATA",
  });
  await assert.rejects(
    s.paper.observeCommon(
      [s.scope(), { ...s.scope("sma-once-bar"), sessionId: "other-study" }],
      "other-study",
      value,
    ),
    { code: "CONFIG_CHANGED" },
  );
  const identity = structuredClone(value);
  identity.frames[0]!.book.market = {
    ...identity.frames[0]!.book.market,
    marketId: identity.frames[0]!.book.market.marketId + 999,
  };
  identity.frames[0]!.hash = digest(identity.frames[0]!);
  await assert.rejects(s.paper.observeCommon(commonScopes(s), "identity", identity), {
    code: "INVALID_MARKET_DATA",
  });
});

test("expired common final valuation preserves proposals and consumption without any execution", async (t) => {
  const s = await setup(t, "component-observation-final-aging");
  const final = s.data.finalEvidence.bind(s.data);
  s.data.finalEvidence = async (...args) => {
    const value = await final(...args);
    const aged = agingObservation(s);
    let inserts = 0;
    s.onQuery((statement) => {
      if (statement === "INSERT" && ++inserts === 2) {
        s.elapse(495);
        s.onQuery();
      }
    });
    return { ...value, frames: aged.frames };
  };
  await s.runner.cycle(s.c, s.lease, s.signal);
  const state = await exportPerpsAudit(s.db.pool, s.c);
  assert.equal(state.study.rounds[0]!.executionStatus, "skipped_data_unavailable");
  assert.equal(Object.keys(state.study.rounds[0]!.calls).length, 0);
  assert.ok(state.study.rounds[0]!.proposals);
  for (const v of SMA_REENTRY_VARIANTS) {
    assert.equal(state.accounts[v]!.attempts.length, 0);
    assert.equal(state.accounts[v]!.account.positions.length, 0);
  }
});

test(
  "controlled six-hour coordinator records 72 slots, continues after aging and closes both portfolios",
  { timeout: 600000 },
  async (t) => {
    const s = await setup(t, "component-observation-six-hours");
    const record = (await s.study.view(s.c)).record;
    const start = record.startedAt!;
    s.data.reconcile = async () => ({
      frames: [],
      funding: s.fresh().frames.map((frame) => ({
        market: frame.snapshot.market,
        from: record.createdAt,
        to: s.time(),
        events: [],
        complete: true,
        pages: [frame.book.provenance],
      })),
    });
    for (let minute = 0; minute <= 360; minute++) {
      await s.advance(start + minute * 60000);
      const expired = minute === 40 || minute === 320;
      if (expired) {
        const value = agingObservation(s);
        s.data.observe = async () => value;
        let inserts = 0;
        s.onQuery((statement) => {
          if (statement === "INSERT" && ++inserts === 2) {
            s.elapse(495);
            s.onQuery();
          }
        });
      } else {
        s.data.observe = async () => ({ frames: s.fresh().frames, funding: [], marksOnly: true });
      }
      const active = await s.runner.cycle(s.c, s.lease, s.signal);
      assert.equal(active, minute < 360);
    }
    const state = await exportPerpsAudit(s.db.pool, s.c);
    assert.equal(state.study.record.status, "completed");
    assert.equal(
      state.study.events.filter((e) => e.kind === "slot-attempted").length +
        state.study.events.filter((e) => e.kind === "slot-missed").length,
      72,
    );
    assert.equal(state.study.rounds.length, 70);
    assert.equal(state.study.rounds.filter((r) => r.executionStatus === "complete").length, 70);
    assert.equal(state.study.events.filter((e) => e.kind === "data-unavailable").length, 2);
    for (const v of SMA_REENTRY_VARIANTS) {
      const portfolio = state.accounts[v]!;
      assert.ok(portfolio.attempts.some((a) => a.status === "filled" && a.intent.kind === "open"));
      assert.ok(portfolio.attempts.some((a) => a.status === "filled" && a.intent.kind === "close"));
      assert.ok(portfolio.account.positions.every((p) => p.closedAt !== null));
      assert.equal(portfolio.account.fundingPending, false);
    }
    assert.ok(state.study.rounds.every((r) => Object.keys(r.calls).length === 0));
    t.diagnostic(
      "Controlled clocks and synthetic prices: 72 slots, 70 complete, 2 confirmed common rollbacks, both portfolios opened/closed, no provider calls. This does not establish prospective availability or profitability.",
    );
  },
);

test(
  "paired thirty-sample common valuation benchmark preserves financial results",
  { timeout: 600000 },
  async (t) => {
    const db = await createTestStore(t, () => at);
    const samples: {
      common: boolean;
      sample: number;
      durationMs: number;
      queries: number;
      fills: number;
    }[] = [];
    let parity: unknown;
    for (let sample = 0; sample < 30; sample++) {
      for (const common of [false, true]) {
        const s = await setup(t, `common-timing-${sample}-${common}`, "long", 0, 0, true, db);
        if (!common) {
          Object.defineProperty(s.paper, "observeCommon", { value: undefined });
        }
        s.startMeasuring();
        const start = performance.now();
        await s.runner.cycle(s.c, s.lease, s.signal);
        const durationMs = performance.now() - start;
        const saved = await exportPerpsAudit(s.db.pool, s.c);
        const financial = SMA_REENTRY_VARIANTS.map((v) => {
          const a = saved.accounts[v]!;
          return {
            cash: a.account.cash,
            fundingPending: a.account.fundingPending,
            positions: a.account.positions.map((p) => ({
              symbol: p.symbol,
              side: p.side,
              quantity: p.quantity,
              entryPrice: p.entryPrice,
              entryNotional: p.entryNotional,
              closedAt: p.closedAt,
            })),
            movements: a.movements
              .map((m) => ({ kind: m.kind, delta: m.delta }))
              .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
          };
        });
        parity ??= financial;
        assert.deepEqual(financial, parity);
        assert.equal(saved.study.rounds[0]!.executionStatus, "complete");
        const fills = SMA_REENTRY_VARIANTS.reduce(
          (n, v) => n + saved.accounts[v]!.attempts.filter((a) => a.status === "filled").length,
          0,
        );
        samples.push({ common, sample, durationMs, queries: s.queries(), fills });
      }
    }
    const summary = [false, true].map((common) => {
      const a = samples.filter((s) => s.common === common);
      const times = a.map((s) => s.durationMs).sort((a, b) => a - b);
      return {
        common,
        n: a.length,
        medianMs: (times[14]! + times[15]!) / 2,
        p95Ms: times[28]!,
        queries: a.reduce((n, s) => n + s.queries, 0),
        complete: a.length,
        fills: a.map((s) => s.fills),
      };
    });
    t.diagnostic(
      `COMPONENT_COMMON_VALUATION_BENCHMARK=${JSON.stringify({ version: 1, clockDelayMs: 0, method: "paired inputs, actual monotonic total cycle timings, nearest-rank p95", summary, samples })}`,
    );
  },
);
