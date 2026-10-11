import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  PostgresPerpsStudyStore,
  PostgresPerpsPaperStore,
  exportPerpsAudit,
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
  version: 8 | 9 = 8,
) {
  let time = version === 9 ? intradayTime - 120000 : ptsTime;
  const initialTime = time;
  const config: PerpsPtsConfig =
    version === 9
      ? {
          ...configuration,
          version: 9,
          protocol: "perps-pts-intraday-sma-v1",
          hours: 24,
          candidate: "pts-intraday@0.1.0",
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
  });
  let ratio = "0.40",
    finalCount = 0;
  const evidence = () => (version === 9 ? intradayEvidence : ptsEvidence)(time, short, ratio, hash);
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
    variant: version === 9 ? ("pts-intraday" as const) : ("pts-basic" as const),
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
  };
}
for (const version of [8, 9] as const) {
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
      assert.ok(saved.account.positions.length > 0);
      assert.ok(saved.account.positions.every((p) => p.side === (short ? "short" : "long")));
      assert.deepEqual(
        saved.account.consumedPtsSetups,
        saved.account.positions.map((p) => p.pts!.setup.id),
      );
      const paperBefore = await exportPerpsAudit(x.db.pool, x.view.record.config);
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
