import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  analyzePts,
  inspectPtsHistory,
  ptsSeries,
  ptsTemporalProfile,
  ptsNativeMinimum,
  ptsCandidateVersion,
  ptsConfigVersion,
  PTS_CATALOG,
  PTS_VERSION,
  PTS_INTRADAY_VERSION,
  PTS_INTRADAY_POLICY,
  PTS_INTRADAY_FAST_POLICY,
  PTS_INTRADAY_FAST_VERSION,
  PTS_INTRADAY_FAST_ACCOUNT_POLICY,
  ptsPolicy,
  assertPtsConfig,
  ptsFillAdmissible,
  recoveryPrice,
  replayPtsFinance,
  replayPtsSignals,
  ptsPartialSchedule,
  ptsManagement,
  ptsSize,
  ptsAccountVersion,
  type PerpsPtsIntradayConfig,
} from "../src/pts.js";
import { canonicalAudit } from "../src/evaluation.js";
import {
  initialPaperAccount,
  applyPaperFill,
  simulatePerpsFill,
  type PerpsPaperAttempt,
} from "../src/perps.js";
import { fastFixture, fastEvidence, fastTime } from "./pts-intraday-fast-fixture.js";
import { intradayFixture, intradayTime } from "./pts-intraday-fixture.js";
import { ptsFixture, ptsTime } from "./pts-fixture.js";
const digest = (value: unknown) => createHash("sha256").update(canonicalAudit(value)).digest("hex");
const frameHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const fastConfig: PerpsPtsIntradayConfig = {
  version: 9,
  protocol: "perps-pts-intraday-sma-v1",
  hours: 24,
  budgetUsd: "5",
  tenantId: "fixture",
  sessionId: "fast-controlled",
  network: "mainnet",
  markets: PTS_CATALOG.map((m) => ({ ...m })),
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  candidate: "pts-intraday@0.2.0-fast.1",
  history: { file: "history.json", sha256: "a".repeat(64) },
  preparedFor: "local-paper-only",
};

test("fast candidate pins genuine native roles; unknown selections fail and historical meanings remain fixed", () => {
  assertPtsConfig(fastConfig);
  assert.equal(ptsConfigVersion(fastConfig), PTS_INTRADAY_FAST_VERSION);
  const profile = ptsTemporalProfile(PTS_INTRADAY_FAST_VERSION);
  assert.deepEqual(
    [profile.primary, profile.channel, profile.impulse, profile.correction, profile.entry],
    ["4h", "1h", "15m", "5m", "5m"],
  );
  assert.deepEqual(profile.native, [14400, 3600, 900, 300]);
  assert.equal(ptsNativeMinimum(PTS_INTRADAY_FAST_VERSION, 300), 180);
  assert.equal(profile.maximumHoldingMs, 6 * 3600000);
  assert.equal(profile.closeAtUtcDayEnd, true);
  assert.throws(() => ptsNativeMinimum(PTS_INTRADAY_FAST_VERSION, 86400), {
    code: "INVALID_INPUT",
  });
  assert.throws(() => ptsCandidateVersion("pts-intraday@unknown"), { code: "INVALID_INPUT" });
  assert.throws(
    () => assertPtsConfig({ ...fastConfig, candidate: "pts-intraday@unknown" } as never),
    { code: "INVALID_INPUT" },
  );
  assert.equal(ptsPolicy(PTS_INTRADAY_VERSION), PTS_INTRADAY_POLICY);
  assert.equal(ptsPolicy(PTS_INTRADAY_FAST_VERSION), PTS_INTRADAY_FAST_POLICY);
  assert.equal(
    digest(PTS_INTRADAY_POLICY),
    "e7e82fa551994ada3d5754b9dae05a19ac4ea6f1d3e7f6de63a823a60870561d",
  );
  assert.equal(analyzePts(ptsFixture(), ptsTime).action, "open-long");
  assert.equal(
    analyzePts(intradayFixture(), intradayTime, PTS_INTRADAY_VERSION).action,
    "open-long",
  );
  assert.equal(ptsCandidateVersion(), PTS_VERSION);
});
test("all eleven identities have controlled long/short recovery signals with one shared 5m correction/entry series", () => {
  for (const market of PTS_CATALOG) {
    for (const short of [false, true]) {
      const history = fastFixture(market.symbol, short);
      const analysis = analyzePts(history, fastTime, PTS_INTRADAY_FAST_VERSION);
      assert.equal(analysis.action, short ? "open-short" : "open-long", JSON.stringify(analysis));
      assert.ok(analysis.setup!.id.startsWith("pts-intraday@0.2.0-fast.1:"));
      assert.ok(analysis.setup!.c.confirmedAt < analysis.setup!.triggerAt);
      assert.deepEqual(
        analysis.coverage.map((c) => [c.period, c.required]),
        [
          ["4h", 24],
          ["1h", 104],
          ["15m", 240],
          ["5m", 180],
        ],
      );
      assert.equal(history.series.filter((s) => s.resolution === 300).length, 1);
      assert.ok(analysis.checks.some((c) => c.code === "HOURLY_ALIGNMENT" && c.passed));
      assert.ok(analysis.checks.some((c) => c.code === "FIFTEEN_MINUTE_IMPULSE" && c.passed));
      assert.deepEqual(
        analyzePts(
          { ...history, series: [...history.series].reverse() },
          fastTime,
          PTS_INTRADAY_FAST_VERSION,
        ),
        analysis,
      );
      for (const ratio of ["0.38", "0.495"]) {
        assert.equal(
          ptsFillAdmissible(
            analysis.setup!,
            recoveryPrice(analysis.setup!.c.price, analysis.setup!.b.price, ratio),
            fastTime,
          ),
          false,
        );
      }
      assert.equal(
        analyzePts(history, analysis.setup!.expiresAt, PTS_INTRADAY_FAST_VERSION).action,
        "hold",
      );
    }
  }
});
test("fast native gaps, ambiguous revisions, insufficient 5m warmup and neutral primary are never promoted", () => {
  const insufficient = fastFixture();
  insufficient.series[3]!.candles.shift();
  assert.equal(
    analyzePts(insufficient, fastTime, PTS_INTRADAY_FAST_VERSION).reason,
    "HISTORY_COVERAGE",
  );
  const neutral = fastFixture();
  neutral.series[0]!.candles[18]!.low = "70";
  assert.equal(analyzePts(neutral, fastTime, PTS_INTRADAY_FAST_VERSION).reason, "PRIMARY_TREND");
  const duplicate = fastFixture();
  duplicate.series.push(structuredClone(duplicate.series[3]!));
  assert.throws(() => analyzePts(duplicate, fastTime, PTS_INTRADAY_FAST_VERSION), {
    code: "INVALID_MARKET_DATA",
  });
  const missing = fastFixture();
  missing.series = missing.series.filter((s) => s.resolution !== 900);
  assert.equal(analyzePts(missing, fastTime, PTS_INTRADAY_FAST_VERSION).action, "hold");
  const earlier = fastTime - 600000;
  const history = fastFixture();
  const before = analyzePts(history, earlier, PTS_INTRADAY_FAST_VERSION);
  for (const series of history.series) {
    for (const candle of series.candles) {
      if (candle.openTime + series.resolution * 1000 > earlier) {
        Object.assign(candle, { open: "125", close: "125", high: "2000", low: "1" });
      }
    }
  }
  assert.deepEqual(analyzePts(history, earlier, PTS_INTRADAY_FAST_VERSION), before);
  const invalid = fastFixture();
  invalid.series[0]!.candles[0]!.high = "1";
  const inspected = inspectPtsHistory(invalid, fastTime, PTS_INTRADAY_FAST_VERSION);
  assert.equal(inspected.validationStatus, "NOT_VERIFIABLE");
  assert.equal(inspected.action, "hold");
  assert.equal(inspected.reason, "NOT_VERIFIABLE");
  assert.equal(
    inspected.coverage.some((c) => c.period === "1d"),
    false,
  );
  assert.deepEqual(ptsSeries(fastFixture(), fastTime, PTS_INTRADAY_FAST_VERSION)["1d"], []);
});
test("actual shared coordinator confirms fast opens, partials and final closes; fixtures are not profitability evidence", async () => {
  for (const short of [false, true]) {
    const financial = ["0.40", "0.61", "0.78", "1"].map((ratio, i) => {
      const evidence = fastEvidence(fastTime + i * 60000, short, ratio, frameHash);
      return {
        at: evidence.observedAt,
        frames: evidence.frames,
        funding: evidence.frames.map((frame) => ({
          market: frame.snapshot.market,
          from: fastTime - 60000,
          to: evidence.observedAt,
          complete: true,
          pages: [frame.book.provenance],
          events: [],
        })),
      };
    });
    const result = await replayPtsFinance(
      {
        format: "perps-pts-history-v1",
        candidate: fastConfig.candidate,
        capturedAt: fastTime + 600000,
        from: fastTime,
        to: fastTime + 600000,
        commit: "synthetic-fast-only",
        markets: PTS_CATALOG.map((m) => fastFixture(m.symbol, short)),
        financial,
      },
      digest,
    );
    assert.equal(result.status, "REPLAYED");
    const account = result.accounts!["pts-intraday"]!.account;
    assert.equal(account.positionPolicy, PTS_INTRADAY_FAST_ACCOUNT_POLICY);
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
    assert.equal(result.modelCalls, 0);
    assert.equal(result.study!.record.config.version, 9);
    assert.equal(
      (result.study!.record.config as PerpsPtsIntradayConfig).candidate,
      fastConfig.candidate,
    );
    assert.ok(result.metrics!.every((metric) => metric.status === "VERIFIED_RECORDED_LEDGER"));
  }
});
test("immutable fast account rejects old intraday intents, while six-hour and day-end exits stay unchanged", () => {
  const setup = analyzePts(fastFixture(), fastTime, PTS_INTRADAY_FAST_VERSION).setup!;
  const frame = fastEvidence(fastTime, false, "0.40", frameHash).frames[0]!;
  const account = initialPaperAccount(
    { tenantId: "fixture", agentId: "fast", sessionId: "fast-test", network: "mainnet" },
    1,
    fastTime,
  );
  account.positionPolicy = PTS_INTRADAY_FAST_ACCOUNT_POLICY;
  account.riskManagement = "buffered-selective-1x-v1";
  account.consumedPtsSetups = [];
  assert.equal(ptsAccountVersion(account), PTS_INTRADAY_FAST_VERSION);
  const sized = ptsSize(
    account,
    setup,
    frame.snapshot.ticker.mark,
    frame.book.market.fees.taker,
    "1000",
    4,
  )!;
  const attempt: PerpsPaperAttempt = {
    key: "entry",
    intent: {
      kind: "open",
      symbol: "BTC",
      side: "long",
      notional: "100",
      feeReserve: "1",
      pts: { version: PTS_INTRADAY_FAST_VERSION, setup, quantity: sized.quantity },
    },
    status: "pending",
    reserved: "101",
    createdAt: fastTime,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const position = applyPaperFill(
    account,
    attempt,
    simulatePerpsFill(account, attempt.intent, frame, fastTime),
    fastTime,
  ).account.positions[0]!;
  assert.equal(
    ptsManagement(position, position.entryPrice, fastTime + 6 * 3600000 - 1).reason,
    "PTS_POSITION_INTACT",
  );
  assert.equal(
    ptsManagement(position, position.entryPrice, fastTime + 6 * 3600000).reason,
    "PTS_MAX_DURATION",
  );
  assert.equal(
    ptsManagement(
      { ...position, openedAt: Date.UTC(2026, 9, 11, 23, 59) },
      position.entryPrice,
      Date.UTC(2026, 9, 12),
    ).reason,
    "PTS_UTC_DAY_END",
  );
  const wrong = {
    ...attempt,
    intent: { ...attempt.intent, pts: { ...attempt.intent.pts!, version: PTS_INTRADAY_VERSION } },
  };
  const simulated = simulatePerpsFill(account, wrong.intent, frame, fastTime);
  assert.throws(() => applyPaperFill(account, wrong, simulated, fastTime), {
    code: "PTS_ENTRY_REJECTED",
  });
  assert.deepEqual(account.consumedPtsSetups, []);
});
test("offline fast replay preserves its independent policy, deterministic hashes and absent financial evidence", async () => {
  const packet = {
    format: "perps-pts-history-v1" as const,
    candidate: fastConfig.candidate,
    capturedAt: fastTime + 600000,
    from: fastTime,
    to: fastTime + 600000,
    commit: "synthetic",
    markets: [fastFixture()],
  };
  const result = replayPtsSignals(packet, digest);
  assert.equal(result.policy, fastConfig.candidate);
  assert.equal(result.financialResult, "NOT_VERIFIABLE");
  assert.equal(result.rows.length, 2);
  assert.equal(Object.keys(result.analyses).length, 2);
  assert.deepEqual(replayPtsSignals(packet, digest), result);
  assert.equal((await replayPtsFinance(packet, digest)).status, "NOT_VERIFIABLE");
});
