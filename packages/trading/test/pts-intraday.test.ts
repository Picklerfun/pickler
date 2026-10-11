import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  analyzePts,
  inspectPtsHistory,
  PTS_CATALOG,
  PTS_INTRADAY_VERSION,
  PTS_INTRADAY_ACCOUNT_POLICY,
  PTS_VERSION,
  ptsTemporalProfile,
  ptsManagement,
  ptsFillAdmissible,
  recoveryPrice,
  replayPtsFinance,
  replayPtsSignals,
  ptsSize,
  ptsPartialSchedule,
  units,
  ptsQuantityAtBlock,
  assertPtsConfig,
  type PerpsPtsIntradayConfig,
} from "../src/pts.js";
import {
  initialPaperAccount,
  applyPaperFill,
  simulatePerpsFill,
  type PerpsPaperAttempt,
} from "../src/perps.js";
import { intradayFixture, intradayEvidence, intradayTime } from "./pts-intraday-fixture.js";
import { ptsFixture, ptsTime } from "./pts-fixture.js";
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

export const intradayConfig: PerpsPtsIntradayConfig = {
  version: 9,
  protocol: "perps-pts-intraday-sma-v1",
  tenantId: "fixture",
  sessionId: "intraday-controlled",
  network: "mainnet",
  hours: 24,
  budgetUsd: "5",
  markets: PTS_CATALOG.map((m) => ({ ...m })),
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  candidate: "pts-intraday@0.1.0",
  history: { file: "history.json", sha256: "a".repeat(64) },
  preparedFor: "local-paper-only",
};

test("native intraday roles produce mirrored confirmed long/short setups for every frozen identity", () => {
  assertPtsConfig(intradayConfig);
  for (const market of PTS_CATALOG) {
    for (const short of [false, true]) {
      const history = intradayFixture(market.symbol, short);
      const result = analyzePts(history, intradayTime, PTS_INTRADAY_VERSION);
      assert.equal(result.action, short ? "open-short" : "open-long", JSON.stringify(result));
      assert.ok(result.setup!.id.startsWith("pts-intraday@0.1.0:"));
      assert.equal(result.setup!.version, "0.1.0");
      assert.deepEqual(
        result.coverage.map((c) => c.period),
        ["1d", "4h", "1h", "15m", "5m"],
      );
      assert.ok(result.setup!.c.confirmedAt < result.setup!.triggerAt);
      assert.deepEqual(
        analyzePts(
          { ...history, series: [...history.series].reverse() },
          intradayTime,
          PTS_INTRADAY_VERSION,
        ),
        result,
      );
    }
  }
});
test("intraday unknown history, neutral trends, gaps and invalid native bars cannot open", () => {
  for (const m of PTS_CATALOG) {
    const history = intradayFixture(m.symbol);
    history.series = history.series.filter((s) => s.resolution !== 300);
    assert.equal(
      analyzePts(history, intradayTime, PTS_INTRADAY_VERSION).reason,
      "HISTORY_COVERAGE",
    );
    const neutral = intradayFixture(m.symbol);
    neutral.series[0]!.candles[18]!.low = "70";
    assert.equal(analyzePts(neutral, intradayTime, PTS_INTRADAY_VERSION).reason, "PRIMARY_TREND");
    const invalid = intradayFixture(m.symbol);
    invalid.series[4]!.candles[0]!.low = "0";
    assert.equal(
      inspectPtsHistory(invalid, intradayTime, PTS_INTRADAY_VERSION).validationStatus,
      "NOT_VERIFIABLE",
    );
    const gap = intradayFixture(m.symbol);
    gap.series[4]!.candles.splice(20, 1);
    assert.equal(analyzePts(gap, intradayTime, PTS_INTRADAY_VERSION).reason, "HISTORY_COVERAGE");
  }
});
test("basic remains the default and intraday does not relabel basic history", () => {
  assert.deepEqual(
    analyzePts(ptsFixture(), ptsTime),
    analyzePts(ptsFixture(), ptsTime, PTS_VERSION),
  );
  assert.equal(analyzePts(ptsFixture(), ptsTime, PTS_INTRADAY_VERSION).reason, "HISTORY_COVERAGE");
  assert.equal(analyzePts(intradayFixture(), intradayTime).reason, "HISTORY_COVERAGE");
  assert.equal(ptsTemporalProfile().maximumHoldingMs, 7 * 86400000);
});
test("entry thresholds and intraday expiry remain strict; future closes cannot alter an earlier analysis", () => {
  for (const short of [false, true]) {
    const h = intradayFixture("BTC", short),
      result = analyzePts(h, intradayTime, PTS_INTRADAY_VERSION),
      setup = result.setup!;
    assert.equal(
      ptsFillAdmissible(setup, recoveryPrice(setup.c.price, setup.b.price, "0.38"), intradayTime),
      false,
    );
    assert.equal(
      ptsFillAdmissible(setup, recoveryPrice(setup.c.price, setup.b.price, "0.495"), intradayTime),
      false,
    );
    assert.equal(setup.expiresAt - setup.triggerAt, 300000);
    assert.equal(analyzePts(h, setup.expiresAt, PTS_INTRADAY_VERSION).action, "hold");
    const earlier = intradayTime - 600000,
      before = analyzePts(h, earlier, PTS_INTRADAY_VERSION);
    for (const s of h.series) {
      for (const c of s.candles) {
        if (c.openTime + s.resolution * 1000 > earlier) {
          Object.assign(c, { open: "125", close: "125", high: "2000", low: "1" });
        }
      }
    }
    assert.deepEqual(analyzePts(h, earlier, PTS_INTRADAY_VERSION), before);
  }
});
test("actual shared coordinator and simulator confirm intraday entries and all partial targets independently", async () => {
  for (const short of [false, true]) {
    const captures = ["0.40", "0.61", "0.78", "1"].map((ratio, i) => {
      const e = intradayEvidence(intradayTime + i * 60000, short, ratio, hash);
      return {
        at: e.observedAt,
        frames: e.frames,
        funding: e.frames.map((f) => ({
          market: f.snapshot.market,
          from: intradayTime - 60000,
          to: e.observedAt,
          complete: true,
          pages: [f.book.provenance],
          events: [],
        })),
      };
    });
    const result = await replayPtsFinance(
      {
        format: "perps-pts-history-v1",
        candidate: "pts-intraday@0.1.0",
        capturedAt: intradayTime + 600000,
        from: intradayTime,
        to: intradayTime + 600000,
        commit: "synthetic-only",
        markets: PTS_CATALOG.map((m) => intradayFixture(m.symbol, short)),
        financial: captures,
      },
      hash,
    );
    assert.equal(result.status, "REPLAYED");
    const account = result.accounts!["pts-intraday"]!.account;
    assert.ok(account.positions.length > 0, JSON.stringify(result.study!.events));
    assert.ok(account.positions.every((p) => p.closedAt !== null && p.quantity === "0"));
    for (const p of account.positions) {
      assert.deepEqual(p.pts!.consumedTargets, [1, 2, 3]);
      assert.deepEqual(
        p.pts!.reductions.map((r) => r.quantity),
        ptsPartialSchedule(p.pts!.initialQuantity, p.market!.sizeDecimals),
      );
      assert.equal(
        p.pts!.reductions.reduce((n, r) => n + units(r.costBasis), 0n),
        units(p.pts!.initialNotional),
      );
      assert.equal(ptsQuantityAtBlock(p, 104), "0");
    }
    assert.equal(result.modelCalls, 0);
    assert.ok(!("pts-basic" in result.accounts!));
  }
});
test("UTC day end and exact six-hour expiry close only intraday positions; rejected openings preserve setup", () => {
  const setup = analyzePts(intradayFixture(), intradayTime, PTS_INTRADAY_VERSION).setup!;
  const evidence = intradayEvidence(intradayTime, false, "0.40", hash);
  const frame = evidence.frames[0]!;
  const account = initialPaperAccount(
    { tenantId: "fixture", agentId: "intraday", sessionId: "isolated", network: "mainnet" },
    1,
    intradayTime,
  );
  account.positionPolicy = PTS_INTRADAY_ACCOUNT_POLICY;
  account.riskManagement = "buffered-selective-1x-v1";
  account.consumedPtsSetups = [];
  const size = ptsSize(
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
      pts: { version: PTS_INTRADAY_VERSION, setup, quantity: size.quantity },
    },
    status: "pending",
    reserved: "101",
    createdAt: intradayTime,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const position = applyPaperFill(
    account,
    attempt,
    simulatePerpsFill(account, attempt.intent, frame, intradayTime),
    intradayTime,
  ).account.positions[0]!;
  assert.equal(
    ptsManagement(position, position.entryPrice, intradayTime + 6 * 3600000 - 1).reason,
    "PTS_POSITION_INTACT",
  );
  assert.equal(
    ptsManagement(position, position.entryPrice, intradayTime + 6 * 3600000).reason,
    "PTS_MAX_DURATION",
  );
  const nearEnd = { ...position, openedAt: Date.UTC(2026, 9, 11, 23, 59) };
  assert.equal(
    ptsManagement(nearEnd, position.entryPrice, Date.UTC(2026, 9, 12)).reason,
    "PTS_UTC_DAY_END",
  );
  assert.deepEqual(account.consumedPtsSetups, []);
  assert.throws(
    () =>
      simulatePerpsFill(
        { ...account, positionPolicy: undefined },
        attempt.intent,
        frame,
        intradayTime,
      ),
    { code: "INVALID_INPUT" },
  );
});
test("offline intraday replay re-evaluates each closed five-minute bar, never inventing financial profit", () => {
  const packet = {
    format: "perps-pts-history-v1" as const,
    candidate: "pts-intraday@0.1.0" as const,
    capturedAt: intradayTime + 600000,
    from: intradayTime,
    to: intradayTime + 600000,
    commit: "synthetic",
    markets: [intradayFixture()],
  };
  const replay = replayPtsSignals(packet, hash);
  assert.equal(replay.policy, "pts-intraday@0.1.0");
  assert.equal(replay.financialResult, "NOT_VERIFIABLE");
  assert.equal(replay.rows.length, 2);
  assert.equal(Object.keys(replay.analyses).length, 2);
  assert.deepEqual(replayPtsSignals(packet, hash), replay);
});
