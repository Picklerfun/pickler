import { exportPerpsAuditParts, observePerpsLabPool } from "@pickler/infrastructure/perps-lab";
import { PilotError } from "@pickler/core";
import { createPtsPartsExport, ptsPartsPayloadHash } from "../src/pts-study/parts.js";
import { digest } from "../src/pts-study/files.js";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
  timeEvaluationPool,
} from "@pickler/infrastructure";
import { createTestStore } from "@pickler/infrastructure/testing";
import { createProfileStudyRunner, type PerpsStudyLease } from "@pickler/trading/evaluation";
import {
  PTS_CATALOG,
  ptsConfigVersion,
  ptsTemporalProfile,
  ptsManagement,
  type PerpsPtsConfig,
} from "@pickler/trading/pts";
import { ptsEvidence, ptsTime } from "@pickler/trading/testing/pts";
import { intradayEvidence, intradayTime } from "@pickler/trading/testing/pts-intraday";
import { fastEvidence, fastTime } from "@pickler/trading/testing/pts-intraday-fast";
import {
  responsiveEvidence,
  responsiveTime,
} from "@pickler/trading/testing/pts-intraday-responsive";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const configuration: PerpsPtsConfig = {
  version: 8,
  protocol: "perps-pts-sma-v1",
  tenantId: "alpha",
  sessionId: "pts-controlled",
  network: "mainnet",
  hours: 336,
  budgetUsd: "5",
  markets: PTS_CATALOG.map((m) => ({ ...m })),
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  candidate: "pts-trend-reversal@0.2.0",
  history: { file: "history.json", sha256: "a".repeat(64) },
  preparedFor: "local-paper-only",
};
async function setup(
  t: Parameters<typeof createTestStore>[0],
  short = false,
  invalidFinal = false,
  version: 8 | 9 | "fast" | "responsive" = 8,
) {
  const intraday = version !== 8;
  const times = { 8: ptsTime, 9: intradayTime, fast: fastTime, responsive: responsiveTime };
  const candidates = {
    9: "pts-intraday@0.1.0",
    fast: "pts-intraday@0.2.0-fast.1",
    responsive: "pts-intraday@0.2.0-fast.2",
  } as const;
  let time = times[version] - (intraday ? 120000 : 0);
  const initialTime = time;
  const config: PerpsPtsConfig =
    version !== 8
      ? {
          ...configuration,
          version: 9,
          protocol: "perps-pts-intraday-sma-v1",
          hours: 24,
          candidate: candidates[version],
        }
      : configuration;
  const db = await createTestStore(t, () => time),
    study = new PostgresPerpsStudyStore(db.pool, () => time);
  const view = await study.initialize(
    { ...config, sessionId: short ? "pts-short" : "pts-long" },
    { commit: "controlled", acquisitionPolicy: configuration.acquisitionPolicy },
  );
  const lease = await study.claim(view.record.config),
    start = (await study.view(view.record.config)).record.startedAt!;
  while (time < start) {
    time = Math.min(start, time + 20000);
    await study.renew(view.record.config, lease);
  }
  const scoped = new PostgresPerpsPaperStore(db.pool, () => time, {
    ...view.record.config,
    owner: lease.owner,
    readPolicy: "pts-snapshot-v1",
  });
  let ratio = "0.40",
    finalCount = 0;
  const factories = {
    8: ptsEvidence,
    9: intradayEvidence,
    fast: fastEvidence,
    responsive: responsiveEvidence,
  };
  const evidence = () => factories[version](time, short, ratio, hash);
  const runner = createProfileStudyRunner({
    study,
    paper: scoped,
    now: () => time,
    data: {
      observe: async () => ({ frames: evidence().frames, funding: [], marksOnly: true }),
      evidence: async () => evidence(),
      prepareEvidence: async () => evidence(),
      execution: async () => evidence().frames,
      finalEvidence: async () => {
        finalCount++;
        const e = evidence();
        if (invalidFinal) {
          e.frames[1]!.book.provenance.providerTimestamp = time - 30001;
        }
        return e;
      },
      reconcile: async () => ({
        frames: [],
        funding: evidence().frames.map((f) => ({
          market: f.snapshot.market,
          from: initialTime - 60000,
          to: time,
          complete: true,
          pages: [f.book.provenance],
          events: [],
        })),
      }),
    },
  });
  return {
    variant: intraday ? ("pts-intraday" as const) : ("pts-basic" as const),
    db,
    study,
    scoped,
    view,
    lease,
    runner,
    evidence,
    get time() {
      return time;
    },
    get finalCount() {
      return finalCount;
    },
    advance: async (value: number, nextRatio = ratio) => {
      time = value;
      ratio = nextRatio;
      await study.renew(view.record.config, lease);
    },
    elapse: (milliseconds: number) => {
      time += milliseconds;
    },
  };
}
for (const version of [8, 9, "fast", "responsive"] as const) {
  test(`v${version}: PTS PostgreSQL: shared real coordinator opens long and short, atomic partials, duplicate races and immutable setups`, async (t) => {
    for (const short of [false, true]) {
      const x = await setup(t, short, false, version),
        scope = { ...x.view.record.config, agentId: x.view.record.agentIds[x.variant]! };
      await x.runner.cycle(x.view.record.config, x.lease, new AbortController().signal);
      assert.equal(x.finalCount, 1);
      let saved = await x.scoped.view(scope);
      assert.equal(
        saved.account.positionPolicy,
        ptsTemporalProfile(ptsConfigVersion(x.view.record.config as PerpsPtsConfig)).accountPolicy,
      );
      const paperBefore = await exportPerpsAudit(x.db.pool, x.view.record.config);
      assert.ok(
        saved.account.positions.length > 0,
        JSON.stringify({
          proposals: paperBefore.study.rounds[0]!.proposals[x.variant]?.map((p) => ({
            action: p.action,
            reason: p.reason,
          })),
          executions: paperBefore.study.events
            .filter((e) => e.kind === "profile-execution")
            .map((e) => e.data),
        }),
      );
      assert.ok(saved.account.positions.every((p) => p.side === (short ? "short" : "long")));
      assert.deepEqual(
        saved.account.consumedPtsSetups,
        saved.account.positions.map((p) => p.pts!.setup.id),
      );
      assert.equal(paperBefore.study.rounds[0]!.executionStatus, "complete");
      assert.deepEqual(paperBefore.study.rounds[0]!.calls, {});
      if (version === 8) {
        assert.ok(paperBefore.accounts["sma-reference"]!.account.positions.length > 0);
      } else {
        assert.equal(paperBefore.accounts["sma-reference"]!.account.positionPolicy, undefined);
        assert.deepEqual(
          paperBefore.accounts["sma-reference"]!.account.consumedPtsSetups,
          undefined,
        );
      }
      for (const [i, ratio] of ["0.61", "0.78", "1"].entries()) {
        await x.advance(x.time + 60000, ratio);
        await x.runner.cycle(x.view.record.config, x.lease, new AbortController().signal);
        saved = await x.scoped.view(scope);
        for (const p of saved.account.positions) {
          assert.deepEqual(
            p.pts!.consumedTargets,
            Array.from({ length: i + 1 }, (_, j) => j + 1),
          );
          assert.equal(p.pts!.reductions.length, i + 1);
        }
      }
      assert.ok(saved.account.positions.every((p) => p.closedAt !== null && p.quantity === "0"));
      const p = saved.account.positions[0]!,
        before = JSON.stringify(saved);
      const key = saved.attempts.find((a) => a.intent.kind === "close")!.key;
      const old = saved.attempts.find((a) => a.key === key)!;
      await Promise.all([
        x.scoped.executeFrame(
          scope,
          key,
          old.intent,
          x.evidence().frames.find((f) => f.snapshot.market.symbol === old.intent.symbol)!,
        ),
        x.scoped.executeFrame(
          scope,
          key,
          old.intent,
          x.evidence().frames.find((f) => f.snapshot.market.symbol === old.intent.symbol)!,
        ),
      ]);
      assert.equal(JSON.stringify(await x.scoped.view(scope)), before);
      assert.equal(ptsManagement(p, p.mark, x.time).reason, "NOT_PTS_POSITION");
      await assert.rejects(
        x.study.guard(x.view.record.config, x.lease, true),
        /cannot access paid/,
      );
      assert.ok(paperBefore.study.rounds.every((r) => Object.keys(r.calls).length === 0));
      const readonly = await exportPerpsAudit(x.db.pool, x.view.record.config);
      assert.equal(JSON.stringify(readonly.accounts[x.variant]), JSON.stringify(saved));
      // A forged account policy cannot escape the account fence.
      await x.db.pool.query(
        "UPDATE pickler.perps_paper_accounts SET document=jsonb_set(document,'{positionPolicy}','\"forged\"') WHERE agent_id=$1",
        [scope.agentId],
      );
      await assert.rejects(
        x.scoped.observe(scope, "forged", {
          frames: x.evidence().frames,
          funding: [],
          marksOnly: true,
        }),
        /policy|policies/i,
      );
      await x.study.release(x.view.record.config, x.lease);
    }
  });
  test(`v${version}: invalid final ETH blocks both variants; ownership expiry rejects writes with no historical cost reset`, async (t) => {
    const x = await setup(t, false, true, version);
    await x.runner.cycle(x.view.record.config, x.lease, new AbortController().signal);
    const exported = await exportPerpsAudit(x.db.pool, x.view.record.config);
    assert.equal(exported.study.rounds[0]!.executionStatus, "skipped_data_unavailable");
    for (const variant of ["sma-reference", x.variant] as const) {
      assert.equal(exported.accounts[variant]!.attempts.length, 0);
    }
    const scope = { ...x.view.record.config, agentId: x.view.record.agentIds[x.variant]! };
    const before = JSON.stringify(exported.accounts);
    const foreign: PerpsStudyLease = { owner: "not-the-owner", expiresAt: x.time + 90000 };
    await assert.rejects(
      x.study.event(x.view.record.config, foreign, "forged", "observation", {}),
      {
        code: "LEASE_LOST",
      },
    );
    await x.study.release(x.view.record.config, x.lease);
    await assert.rejects(
      x.scoped.observe(scope, "after-lease", {
        frames: x.evidence().frames,
        funding: [],
        marksOnly: true,
      }),
      { code: "LEASE_LOST" },
    );
    assert.equal(
      JSON.stringify((await exportPerpsAudit(x.db.pool, x.view.record.config)).accounts),
      before,
    );
  });

  test(`v${version}: concurrent distinct keys consume a PTS target once and preserve setup/basis atomically`, async (t) => {
    const x = await setup(t, false, false, version),
      scope = { ...x.view.record.config, agentId: x.view.record.agentIds[x.variant]! };
    await x.runner.cycle(x.view.record.config, x.lease, new AbortController().signal);
    await x.advance(x.time + 60000, "0.61");
    const evidence = x.evidence();
    await x.scoped.observe(scope, "race-mark", {
      frames: evidence.frames,
      funding: [],
      marksOnly: true,
    });
    const before = await x.scoped.view(scope),
      position = before.account.positions[0]!,
      frame = evidence.frames.find((f) => f.snapshot.market.symbol === position.symbol)!;
    const decision = ptsManagement(position, position.mark, x.time);
    const intent = {
      kind: "close" as const,
      symbol: position.symbol,
      side: position.side,
      notional: "0",
      feeReserve: "1",
      pts: {
        version: ptsConfigVersion(x.view.record.config as PerpsPtsConfig),
        quantity: decision.quantity!,
        targets: decision.targets,
        reason: decision.reason,
      },
    };
    const result = await Promise.allSettled([
      x.scoped.executeFrame(scope, "target-race-a", intent, frame),
      x.scoped.executeFrame(scope, "target-race-b", intent, frame),
    ]);
    const after = await x.scoped.view(scope),
      p = after.account.positions.find((p) => p.id === position.id)!;
    assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(p.pts!.reductions.length, 1);
    assert.deepEqual(p.pts!.consumedTargets, [1]);
    assert.deepEqual(after.account.consumedPtsSetups, before.account.consumedPtsSetups);
    assert.equal(
      after.attempts.filter((a) => a.key.startsWith("target-race") && a.status === "filled").length,
      1,
    );
    await x.study.release(x.view.record.config, x.lease);
  });
  test(`v${version}: PTS has zero paid lanes and leaves two controlled historical unknown reservations unchanged`, async (t) => {
    const { studyConfig, studyEvidence } = await import("./perps-study-fixtures.js");
    const x = await setup(t, false, false, version),
      old = {
        ...studyConfig,
        version: 2 as const,
        protocol: "perps-four-way-v2" as const,
        hours: 2 as const,
        sessionId: "historical-unknown",
      };
    const record = await x.study.initialize(old, { controlled: true }),
      lease = await x.study.claim(old);
    const historicalPaper = new PostgresPerpsPaperStore(x.db.pool, () => x.time);
    const accounts = Object.fromEntries(
      await Promise.all(
        Object.entries(record.record.agentIds).map(async ([variant, agentId]) => [
          variant,
          (await historicalPaper.view({ ...old, agentId: agentId! })).account,
        ]),
      ),
    );
    const round = await x.study.reserve(old, lease, 0, studyEvidence(x.time), accounts, []);
    assert.ok(round);
    for (const lane of ["direct", "review"] as const) {
      await x.study.startCall(old, lease, round.key, lane, {
        sha256: (lane === "direct" ? "a" : "b").repeat(64),
        bytes: 10,
      });
    }
    for (const lane of ["direct", "review"] as const) {
      await x.study.finishCall(old, lease, round.key, lane, null, "MODEL_TIMEOUT");
    }
    await x.study.finishRound(old, lease, round.key, {});
    await x.study.release(old, lease);
    const before = await exportPerpsAudit(x.db.pool, old);
    assert.equal(
      Object.values(before.study.rounds[0]!.calls).filter(
        (c) => c?.status === "failed" && c.costUsd === null && c.reservationUsd !== "0",
      ).length,
      2,
    );
    await x.runner.cycle(x.view.record.config, x.lease, new AbortController().signal);
    assert.equal(JSON.stringify(await exportPerpsAudit(x.db.pool, old)), JSON.stringify(before));
    const pts = await exportPerpsAudit(x.db.pool, x.view.record.config);
    assert.deepEqual(pts.study.rounds[0]!.calls, {});
    await x.study.release(x.view.record.config, x.lease);
  });
}

test("paged PTS export keeps one read-only snapshot across concurrent fixture writes and sink failures", async (t) => {
  const x = await setup(t, false, false, 9);
  const scope = x.view.record.config;
  await x.runner.cycle(scope, x.lease, new AbortController().signal);
  const before = await exportPerpsAudit(x.db.pool, scope);
  const directory = await mkdtemp(join(tmpdir(), "pts-consistent-parts-"));
  const exporter = await createPtsPartsExport(directory, "controlled-paged-export");
  let inserted = false;
  await exportPerpsAuditParts(x.db.pool, scope, async (part) => {
    if (part.kind === "record" && !inserted) {
      inserted = true;
      await x.study.event(
        scope,
        x.lease,
        "controlled-during-export",
        "controlled-export-marker",
        {},
      );
    }
    await exporter.emit(part);
  });
  const manifest = await exporter.finish();
  assert.equal(manifest.payloadHash, digest(before));
  assert.equal(await ptsPartsPayloadHash(directory, manifest), digest(before));
  const after = await exportPerpsAudit(x.db.pool, scope);
  assert.equal(after.study.events.length, before.study.events.length + 1);
  assert.deepEqual(after.accounts, before.accounts);
  await assert.rejects(
    exportPerpsAuditParts(x.db.pool, scope, async () => {
      throw Error("controlled sink failure");
    }),
    /controlled sink failure/,
  );
  assert.deepEqual(await exportPerpsAudit(x.db.pool, scope), after);
  await x.study.release(scope, x.lease, "controlled-export-complete");
});

test("PTS captured final batch rolls back two provisional SMA shorts and both valuations at the observed 5805ms heartbeat age", async (t) => {
  const x = await setup(t, true, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const before = await Promise.all(scopes.map((scope) => x.scoped.view(scope)));
  const frames = x.evidence().frames;
  let provisional = 0;
  const result = await x.scoped.withCapturedFrames(scopes, "round-001", frames, async (context) => {
    await context.paper.observeCommon!(scopes, "round-001:final-marks", {
      frames,
      funding: [],
      marksOnly: true,
    });
    for (const symbol of ["PUMP", "NEAR"] as const) {
      const view = await context.paper.executeFrame!(
        scopes[0]!,
        `round-001:${symbol}`,
        {
          kind: "open",
          symbol,
          side: "short",
          notional: "100",
          feeReserve: "1",
        },
        frames.find((frame) => frame.snapshot.market.symbol === symbol)!,
      );
      provisional = view.account.positions.filter((position) => position.closedAt === null).length;
    }
    await context.event("sma-reference:round-001:PUMP", "profile-execution", { status: "filled" });
    x.elapse(5805);
  });
  assert.equal(provisional, 2);
  assert.equal(result.status, "data_unavailable");
  if (result.status === "data_unavailable") {
    assert.equal(result.rolledBack, true);
    assert.equal(result.validation.reason, "heartbeat-expired-at-receipt-clock");
  }
  assert.deepEqual(await Promise.all(scopes.map((scope) => x.scoped.view(scope))), before);
  const events = await x.db.pool.query(
    "SELECT key FROM pickler.perps_study_events WHERE starts_with(key,'round-001') OR key='sma-reference:round-001:PUMP'",
  );
  assert.equal(events.rowCount, 0);
});

test("PTS captured batch commits once, preserves cloned views, and rejects retained contexts and changed evidence", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const frames = x.evidence().frames;
  let calls = 0;
  let retained: import("@pickler/trading/perps").PerpsCapturedExecutionContext | undefined;
  const work = async (context: import("@pickler/trading/perps").PerpsCapturedExecutionContext) => {
    calls++;
    retained = context;
    const copy = await context.paper.view(scopes[0]!);
    copy.account.cash = "0";
    assert.equal((await context.paper.view(scopes[0]!)).account.cash, "1000");
    await context.paper.observeCommon!(scopes, "round-001:final-marks", {
      frames,
      funding: [],
      marksOnly: true,
    });
    await context.paper.executeFrame!(
      scopes[0]!,
      "round-001:NEAR",
      {
        kind: "open",
        symbol: "NEAR",
        side: "long",
        notional: "100",
        feeReserve: "1",
      },
      frames.find((frame) => frame.snapshot.market.symbol === "NEAR")!,
    );
    await context.event("sma-reference:round-001:NEAR", "profile-execution", { status: "filled" });
  };
  const results = await Promise.all([
    x.scoped.withCapturedFrames(scopes, "round-001", frames, work),
    x.scoped.withCapturedFrames([...scopes].reverse(), "round-001", frames, work),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(
    results.map((value) => value.status),
    ["complete", "complete"],
  );
  assert.equal(results.filter((value) => value.status === "complete" && value.replayed).length, 1);
  const saved = await x.scoped.view(scopes[0]!);
  assert.equal(saved.account.positions.length, 1);
  assert.equal(saved.attempts.filter((attempt) => attempt.status === "filled").length, 1);
  await assert.rejects(retained!.paper.view(scopes[0]!), { code: "LEASE_LOST" });
  assert.throws(() => retained!.assertActive(), { code: "LEASE_LOST" });
  x.elapse(8000);
  const replay = await x.scoped.withCapturedFrames(scopes, "round-001", frames, work);
  assert.equal(replay.status === "complete" && replay.replayed, true);
  assert.equal(calls, 1);
  const changed = structuredClone(frames);
  changed[0]!.book.bids[0]!.size = "90";
  changed[0]!.hash = hash({
    snapshot: changed[0]!.snapshot,
    book: changed[0]!.book,
    streamEvidence: changed[0]!.streamEvidence,
  });
  await assert.rejects(x.scoped.withCapturedFrames(scopes, "round-001", changed, work), {
    code: "INVALID_INPUT",
  });
});

test("PTS captured savepoints remove rejected provisional admissions while later valid trades retain ordinary accounting", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const frames = x.evidence().frames;
  const thin = frames.find((frame) => frame.snapshot.market.symbol === "BTC")!;
  thin.book.asks[0]!.size = "0.000001";
  thin.hash = hash({
    snapshot: thin.snapshot,
    book: thin.book,
    streamEvidence: thin.streamEvidence,
  });
  const result = await x.scoped.withCapturedFrames(scopes, "round-001", frames, async (context) => {
    await context.paper.observeCommon!(scopes, "round-001:final-marks", {
      frames,
      funding: [],
      marksOnly: true,
    });
    await assert.rejects(
      context.paper.executeFrame!(
        scopes[0]!,
        "round-001:BTC",
        {
          kind: "open",
          symbol: "BTC",
          side: "long",
          notional: "100",
          feeReserve: "1",
        },
        thin,
      ),
      { code: "INSUFFICIENT_DEPTH" },
    );
    const view = await context.paper.view(scopes[0]!);
    assert.equal(view.attempts.length, 0);
    assert.equal(view.account.positions.length, 0);
    await context.paper.executeFrame!(
      scopes[0]!,
      "round-001:NEAR",
      {
        kind: "open",
        symbol: "NEAR",
        side: "short",
        notional: "100",
        feeReserve: "1",
      },
      frames.find((frame) => frame.snapshot.market.symbol === "NEAR")!,
    );
  });
  assert.equal(result.status, "complete");
  const saved = await x.scoped.view(scopes[0]!);
  assert.deepEqual(
    saved.attempts.map((attempt) => attempt.key),
    ["round-001:NEAR"],
  );
  assert.equal(saved.account.positions[0]!.side, "short");
  assert.equal(saved.movements.filter((movement) => movement.kind === "fee").length, 1);
});

test("PTS captured ownership expiry is fatal and cannot become an unavailable slot or preserve a provisional fill", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const frames = x.evidence().frames;
  await assert.rejects(
    x.scoped.withCapturedFrames(scopes, "round-001", frames, async (context) => {
      await context.paper.observeCommon!(scopes, "round-001:final-marks", {
        frames,
        funding: [],
        marksOnly: true,
      });
      await context.paper.executeFrame!(
        scopes[0]!,
        "round-001:NEAR",
        {
          kind: "open",
          symbol: "NEAR",
          side: "long",
          notional: "100",
          feeReserve: "1",
        },
        frames.find((frame) => frame.snapshot.market.symbol === "NEAR")!,
      );
      x.elapse(90001);
    }),
    { code: "LEASE_LOST" },
  );
  const attempts = await x.db.pool.query("SELECT document FROM pickler.perps_paper_attempts");
  const observations = await x.db.pool.query("SELECT key FROM pickler.perps_paper_observations");
  assert.equal(attempts.rowCount, 0);
  assert.equal(observations.rowCount, 0);
});

test("overlapping captured operations poison the batch even if their immediate error is caught", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const frames = x.evidence().frames;
  await assert.rejects(
    x.scoped.withCapturedFrames(scopes, "round-001", frames, async (context) => {
      const work = ["PUMP", "NEAR"].map((symbol) =>
        context.paper.executeFrame!(
          scopes[0]!,
          `round-001:${symbol}`,
          {
            kind: "open",
            symbol: symbol as "PUMP" | "NEAR",
            side: "short",
            notional: "100",
            feeReserve: "1",
          },
          frames.find((frame) => frame.snapshot.market.symbol === symbol)!,
        ),
      );
      await assert.rejects(Promise.all(work), { code: "INCOMPLETE_EXECUTION" });
    }),
    { code: "INCOMPLETE_EXECUTION" },
  );
  assert.equal((await x.scoped.view(scopes[0]!)).attempts.length, 0);
  const value = await x.db.pool.query(
    "SELECT 1 FROM pickler.perps_study_events WHERE kind='captured-execution'",
  );
  assert.equal(value.rowCount, 0);
});

for (const failure of ["rollback", "commit"] as const) {
  test(`captured ${failure} acknowledgement uncertainty remains fatal rather than an omission`, async (t) => {
    const x = await setup(t, false, false, "fast");
    const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
      ...x.view.record.config,
      agentId: x.view.record.agentIds[variant]!,
    }));
    const frames = x.evidence().frames;
    let armed = false;
    const pool = timeEvaluationPool(
      x.db.pool,
      (event) => {
        if (
          armed &&
          event.operation === "database-query" &&
          event.statement === failure.toUpperCase()
        ) {
          armed = false;
          throw new PilotError(
            `CONTROLLED_${failure.toUpperCase()}_FAILURE`,
            "Controlled acknowledgement failure",
          );
        }
      },
      () => "captured-uncertainty",
    );
    const paper = new PostgresPerpsPaperStore(pool, () => x.time, {
      ...x.view.record.config,
      owner: x.lease.owner,
    });
    await assert.rejects(
      paper.withCapturedFrames(scopes, "round-001", frames, async (context) => {
        await context.paper.observeCommon!(scopes, "round-001:final-marks", {
          frames,
          funding: [],
          marksOnly: true,
        });
        await context.paper.executeFrame!(
          scopes[0]!,
          "round-001:NEAR",
          {
            kind: "open",
            symbol: "NEAR",
            side: "short",
            notional: "100",
            feeReserve: "1",
          },
          frames.find((frame) => frame.snapshot.market.symbol === "NEAR")!,
        );
        if (failure === "rollback") {
          x.elapse(5805);
        }
        armed = true;
      }),
      { code: failure === "rollback" ? "PERSISTENCE_FAILED" : "CONTROLLED_COMMIT_FAILURE" },
    );
    const saved = await x.scoped.view(scopes[0]!);
    // Actual fixture server state is inspected separately; an unknown acknowledgement never
    // licenses a retry or claims the financial outcome.
    assert.equal(saved.attempts.length, failure === "commit" ? 1 : 0);
  });
}

test("captured batches reject prior serial gates, cross-account reads and frame replacement", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  const frames = x.evidence().frames;
  await x.study.event(
    x.view.record.config,
    x.lease,
    "round-001:sma-reference:final-gate",
    "final-gate",
    { controlled: true },
  );
  await assert.rejects(
    x.scoped.withCapturedFrames(scopes, "round-001", frames, async () => {
      assert.fail("a historical partial phase must not resume");
    }),
    { code: "INCOMPLETE_EXECUTION" },
  );
  const result = await x.scoped.withCapturedFrames(scopes, "round-002", frames, async (context) => {
    await assert.rejects(context.paper.view({ ...scopes[0]!, tenantId: "beta" }), {
      code: "FORBIDDEN",
    });
    const changed = structuredClone(frames[0]!);
    changed.book.bids[0]!.size = "95";
    changed.hash = hash({
      snapshot: changed.snapshot,
      book: changed.book,
      streamEvidence: changed.streamEvidence,
    });
    await assert.rejects(
      context.paper.executeFrame!(
        scopes[0]!,
        "round-002:BTC",
        {
          kind: "open",
          symbol: changed.snapshot.market.symbol,
          side: "long",
          notional: "100",
          feeReserve: "1",
        },
        changed,
      ),
      { code: "INVALID_MARKET_DATA" },
    );
  });
  assert.equal(result.status, "complete");
  assert.equal((await x.scoped.view(scopes[0]!)).attempts.length, 0);
});

test("captured final execution reads its already locked study record once and preserves both account policies", async (t) => {
  const x = await setup(t, false, false, "fast");
  const scopes = (["sma-reference", "pts-intraday"] as const).map((variant) => ({
    ...x.view.record.config,
    agentId: x.view.record.agentIds[variant]!,
  }));
  let sourceReads = 0;
  const sourceHashes = new Set(
    [
      "SELECT id,document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
      "SELECT document FROM pickler.perps_studies WHERE tenant_id=$1 AND session_id=$2 AND network=$3",
    ].map((sql) => createHash("sha256").update(sql).digest("hex")),
  );
  const pool = observePerpsLabPool(x.db.pool, (event) => {
    if (
      event.phase === "finished" &&
      event.operation === "client-query" &&
      event.sqlHash !== null &&
      sourceHashes.has(event.sqlHash)
    ) {
      sourceReads++;
    }
  });
  const paper = new PostgresPerpsPaperStore(pool, () => x.time, {
    ...x.view.record.config,
    owner: x.lease.owner,
  });
  const frames = x.evidence().frames;
  const result = await paper.withCapturedFrames(scopes, "round-001", frames, async (context) => {
    await context.paper.observeCommon!(scopes, "round-001:final-marks", {
      frames,
      funding: [],
      marksOnly: true,
    });
    for (const scope of scopes) {
      const view = await context.paper.view(scope);
      assert.equal(view.account.riskManagement, "buffered-selective-1x-v1");
    }
  });
  assert.equal(result.status, "complete");
  assert.equal(sourceReads, 1);
  assert.equal(
    (await x.scoped.view(scopes[1]!)).account.positionPolicy,
    "pts-intraday-1x-0.2.0-fast.1",
  );
});
