import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  analyzePts,
  PTS_CATALOG,
  PTS_INTRADAY_RESPONSIVE_VERSION,
  PTS_INTRADAY_RESPONSIVE_ACCOUNT_POLICY,
  PTS_INTRADAY_RESPONSIVE_POLICY,
  ptsTemporalProfile,
  ptsPolicy,
  ptsCandidateVersion,
  ptsNativeMinimum,
  ptsPartialSchedule,
  replayPtsFinance,
} from "../src/pts.js";
import { canonicalAudit } from "../src/evaluation.js";
import {
  responsiveFixture,
  responsiveEvidence,
  responsiveTime,
} from "./pts-intraday-responsive-fixture.js";
const digest = (value: unknown) => createHash("sha256").update(canonicalAudit(value)).digest("hex");
const frameHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

test("responsive candidate changes only primary/channel roles and their required native warmup", () => {
  const profile = ptsTemporalProfile(PTS_INTRADAY_RESPONSIVE_VERSION);
  assert.deepEqual(
    [profile.primary, profile.channel, profile.impulse, profile.correction, profile.entry],
    ["1h", "15m", "15m", "5m", "5m"],
  );
  assert.deepEqual(profile.native, [3600, 900, 300]);
  assert.equal(ptsNativeMinimum(PTS_INTRADAY_RESPONSIVE_VERSION, 900), 240);
  assert.equal(ptsNativeMinimum(PTS_INTRADAY_RESPONSIVE_VERSION, 300), 180);
  assert.throws(() => ptsNativeMinimum(PTS_INTRADAY_RESPONSIVE_VERSION, 14400), {
    code: "INVALID_INPUT",
  });
  assert.equal(ptsPolicy(PTS_INTRADAY_RESPONSIVE_VERSION), PTS_INTRADAY_RESPONSIVE_POLICY);
  assert.equal(ptsCandidateVersion("pts-intraday@0.2.0-fast.2"), PTS_INTRADAY_RESPONSIVE_VERSION);
  const prior = ptsTemporalProfile("0.2.0-fast.1");
  for (const key of [
    "formationMs",
    "triggerMs",
    "correctionMs",
    "maximumHoldingMs",
    "closeAtUtcDayEnd",
  ] as const) {
    assert.equal(profile[key], prior[key]);
  }
});
test("all eleven identities have controlled long and short setups with one shared 15m channel/impulse series", () => {
  for (const market of PTS_CATALOG) {
    for (const short of [false, true]) {
      const history = responsiveFixture(market.symbol, short);
      const analysis = analyzePts(history, responsiveTime, PTS_INTRADAY_RESPONSIVE_VERSION);
      assert.equal(analysis.action, short ? "open-short" : "open-long", JSON.stringify(analysis));
      assert.ok(analysis.setup!.id.startsWith("pts-intraday@0.2.0-fast.2:"));
      assert.ok(analysis.setup!.c.confirmedAt < analysis.setup!.triggerAt);
      assert.equal(history.series.filter((s) => s.resolution === 900).length, 1);
      assert.ok(analysis.checks.some((c) => c.code === "FIFTEEN_MINUTE_ALIGNMENT" && c.passed));
      assert.deepEqual(
        analyzePts(
          { ...history, series: [...history.series].reverse() },
          responsiveTime,
          PTS_INTRADAY_RESPONSIVE_VERSION,
        ),
        analysis,
      );
    }
  }
});
test("responsive gaps, missing common frames and future changes never promote a signal", () => {
  const gap = responsiveFixture();
  gap.series[1]!.candles.splice(100, 1);
  assert.equal(analyzePts(gap, responsiveTime, PTS_INTRADAY_RESPONSIVE_VERSION).action, "hold");
  const missing = responsiveFixture();
  missing.series = missing.series.filter((s) => s.resolution !== 300);
  assert.equal(
    analyzePts(missing, responsiveTime, PTS_INTRADAY_RESPONSIVE_VERSION).reason,
    "HISTORY_COVERAGE",
  );
  const history = responsiveFixture();
  const at = responsiveTime - 600000;
  const before = analyzePts(history, at, PTS_INTRADAY_RESPONSIVE_VERSION);
  for (const series of history.series) {
    for (const bar of series.candles) {
      if (bar.openTime + series.resolution * 1000 > at) {
        Object.assign(bar, { open: "125", close: "125", high: "2000", low: "1" });
      }
    }
  }
  assert.deepEqual(analyzePts(history, at, PTS_INTRADAY_RESPONSIVE_VERSION), before);
});
test("actual coordinator and simulator confirm responsive long/short entries, three partials and final closes", async () => {
  for (const short of [false, true]) {
    const financial = ["0.40", "0.61", "0.78", "1"].map((ratio, index) => {
      const evidence = responsiveEvidence(responsiveTime + index * 60000, short, ratio, frameHash);
      return {
        at: evidence.observedAt,
        frames: evidence.frames,
        funding: evidence.frames.map((frame) => ({
          market: frame.snapshot.market,
          from: responsiveTime - 60000,
          to: evidence.observedAt,
          complete: true,
          pages: [frame.book.provenance],
          events: [],
        })),
      };
    });
    const replay = await replayPtsFinance(
      {
        format: "perps-pts-history-v1",
        candidate: "pts-intraday@0.2.0-fast.2",
        capturedAt: responsiveTime + 600000,
        from: responsiveTime,
        to: responsiveTime + 600000,
        commit: "synthetic-responsive-only",
        markets: PTS_CATALOG.map((market) => responsiveFixture(market.symbol, short)),
        financial,
      },
      digest,
    );
    assert.equal(replay.status, "REPLAYED");
    const account = replay.accounts!["pts-intraday"]!.account;
    assert.equal(account.positionPolicy, PTS_INTRADAY_RESPONSIVE_ACCOUNT_POLICY);
    assert.ok(account.positions.length > 0);
    for (const position of account.positions) {
      assert.equal(position.closedAt === null, false);
      assert.equal(position.quantity, "0");
      assert.deepEqual(position.pts!.consumedTargets, [1, 2, 3]);
      assert.deepEqual(
        position.pts!.reductions.map((r) => r.quantity),
        ptsPartialSchedule(position.pts!.initialQuantity, position.market!.sizeDecimals),
      );
    }
  }
});
