import test from "node:test";
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
) {
  let time = at;
  const db = await createTestStore(t, () => time);
  const c = paperConfig(sessionId);
  const study = new PostgresPerpsStudyStore(db.pool, () => time);
  const view = await study.initialize(c, { acquisitionPolicy: COMPONENT_PAPER_POLICY });
  const lease = await study.claim(c);
  const signal = new AbortController().signal;
  const paper = new PostgresPerpsPaperStore(
    db.pool,
    () => time,
    {
      ...c,
      owner: lease.owner,
      signal,
    },
    undefined,
    () => time + receiptOffset,
  );
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
    finalEvidence: async () => fresh(),
    execution: async () => fresh().frames,
    reconcile: async () => ({ frames: [], funding: [] }),
  };
  const runner = createProfileStudyRunner({ study, paper, data, now: () => time + receiptOffset });
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
