import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePts,
  ptsSeries,
  ptsPivots,
  ptsTrend,
  ptsCoverage,
  ptsFillAdmissible,
  recoveryPrice,
  periodStart,
  nextPeriod,
  PTS_CATALOG,
  DAY,
} from "../src/pts.js";
import { ptsFixture, ptsTime, ptsSetup } from "./pts-fixture.js";
test("PTS native closed history produces mirrored deterministic long/shorts for all eleven identities", () => {
  for (const m of PTS_CATALOG) {
    for (const short of [false, true]) {
      const history = ptsFixture(m.symbol, short);
      const result = analyzePts(history, ptsTime);
      assert.equal(
        result.action,
        short ? "open-short" : "open-long",
        JSON.stringify(result.checks),
      );
      assert.ok(result.setup);
      assert.equal(result.setup.marketId, m.marketId);
      assert.deepEqual(analyzePts(history, ptsTime), result);
    }
  }
});
test("closed months, Monday weeks and required history never synthesize missing days", () => {
  const h = ptsFixture(),
    data = ptsSeries(h, ptsTime);
  assert.equal(periodStart(Date.UTC(2024, 1, 29), "1M"), Date.UTC(2024, 1, 1));
  assert.equal(nextPeriod(Date.UTC(2024, 1, 1), "1M"), Date.UTC(2024, 2, 1));
  assert.equal(periodStart(Date.UTC(2026, 9, 10), "1w"), Date.UTC(2026, 9, 5));
  assert.equal(data["1M"].at(-1)!.closeTime, Date.UTC(2026, 9, 1));
  h.series[0]!.candles = h.series[0]!.candles.filter((c) => c.openTime !== Date.UTC(2026, 8, 5));
  assert.equal(analyzePts(h, ptsTime).reason, "HISTORY_COVERAGE");
  assert.ok(ptsCoverage(ptsSeries(h, ptsTime), ptsTime).some((c) => !c.eligible));
});
test("pivots become knowable after two later closes; future bytes cannot alter an earlier result", () => {
  const h = ptsFixture(),
    bars = ptsSeries(h, ptsTime)["4h"];
  const c = bars.find((b) => b.openTime === Date.UTC(2026, 9, 9, 8))!;
  const before = ptsPivots(bars, c.closeTime + 4 * 3600000);
  assert.ok(!before.pivots.some((p) => p.openTime === c.openTime));
  const after = ptsPivots(bars, c.closeTime + 8 * 3600000);
  assert.ok(after.pivots.some((p) => p.openTime === c.openTime));
  const historical = analyzePts(h, ptsTime - DAY);
  for (const s of h.series) {
    s.candles = s.candles.map((c) =>
      c.openTime + s.resolution * 1000 > ptsTime - DAY
        ? { ...c, high: "1000", low: "1", open: "100", close: "100" }
        : c,
    );
  }
  assert.deepEqual(analyzePts(h, ptsTime - DAY), historical);
  assert.equal(ptsTrend([]), "unknown");
});
test("strict entry interval and expiry preserve exact decimal boundaries in both directions", () => {
  for (const short of [false, true]) {
    const setup = ptsSetup(short);
    assert.equal(
      ptsFillAdmissible(setup, recoveryPrice(setup.c.price, setup.b.price, "0.38"), ptsTime),
      false,
    );
    assert.equal(
      ptsFillAdmissible(setup, recoveryPrice(setup.c.price, setup.b.price, "0.40"), ptsTime),
      true,
    );
    assert.equal(
      ptsFillAdmissible(setup, recoveryPrice(setup.c.price, setup.b.price, "0.495"), ptsTime),
      false,
    );
    assert.equal(
      ptsFillAdmissible(
        setup,
        recoveryPrice(setup.c.price, setup.b.price, "0.40"),
        setup.expiresAt,
      ),
      false,
    );
  }
});

test("neutral direction and missing mandatory history reject PTS for every frozen market", () => {
  for (const m of PTS_CATALOG) {
    for (const short of [false, true]) {
      const h = ptsFixture(m.symbol, short),
        day = h.series
          .find((s) => s.resolution === 86400)!
          .candles.find((c) => c.openTime === Date.UTC(2026, 5, 10))!;
      day[short ? "high" : "low"] = short ? "345" : "55";
      const result = analyzePts(h, ptsTime);
      assert.equal(result.action, "hold");
      assert.equal(result.reason, "PRIMARY_TREND");
      assert.equal(
        (result.checks.find((c) => c.code === "PRIMARY_TREND")!.values as { trend: string }).trend,
        "neutral",
      );
      const absent = ptsFixture(m.symbol, short);
      absent.series = absent.series.filter((s) => s.resolution !== 3600);
      assert.equal(analyzePts(absent, ptsTime).reason, "HISTORY_COVERAGE");
    }
  }
});
