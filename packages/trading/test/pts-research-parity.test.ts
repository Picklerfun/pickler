import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalAudit } from "../src/evaluation.js";
import {
  analyzePts,
  createPtsResearchSession,
  inspectPtsResearch,
  PTS_CATALOG,
  PTS_INTRADAY_RESPONSIVE_VERSION,
} from "../src/pts.js";
import { responsiveFixture, responsiveTime } from "./pts-intraday-responsive-fixture.js";

function hash(value: unknown) {
  return createHash("sha256").update(canonicalAudit(value)).digest("hex");
}

test("cached causal research preserves the entire reference trace for eleven markets and both directions", () => {
  for (const market of PTS_CATALOG) {
    for (const short of [false, true]) {
      const history = responsiveFixture(market.symbol, short);
      const originalHash = hash(history);
      const session = createPtsResearchSession(history);

      for (const offset of [-1800000, -600000, -300000, 0, 240000, 300000]) {
        const at = responsiveTime + offset;
        const original = analyzePts(history, at, PTS_INTRADAY_RESPONSIVE_VERSION);
        const research = session.inspect(at);

        assert.deepEqual(research.baseline, original, `${market.symbol}/${short}/${offset}`);
        assert.equal(hash(research.baseline), hash(original));
        assert.equal(research.outcomes[0]!.reason, original.reason);
        assert.equal(
          research.outcomes[0]!.action,
          original.action === "open-long"
            ? "signal-long"
            : original.action === "open-short"
              ? "signal-short"
              : "hold",
        );
      }

      assert.equal(hash(history), originalHash, "research must not mutate original evidence");
    }
  }
});

test("future native bars cannot alter any candidate or the reference at an earlier clock", () => {
  for (const short of [false, true]) {
    const history = responsiveFixture("BTC", short);
    const at = responsiveTime - 600000;
    const before = inspectPtsResearch(history, at);
    const changed = structuredClone(history);

    for (const series of changed.series) {
      for (const bar of series.candles) {
        if (bar.openTime + series.resolution * 1000 > at) {
          Object.assign(bar, { open: "125", close: "125", high: "2000", low: "1" });
        }
      }
    }

    assert.deepEqual(inspectPtsResearch(changed, at), before);
  }
});

test("the first returned research snapshot cannot mutate the session cache or later decisions", () => {
  const history = responsiveFixture();
  const session = createPtsResearchSession(history);
  const first = session.inspect(responsiveTime);
  const original = hash(first);

  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.outcomes));
  assert.throws(() => {
    first.outcomes[0]!.reason = "FORGED";
  }, TypeError);
  assert.equal(hash(session.inspect(responsiveTime)), original);
  assert.deepEqual(
    session.inspect(responsiveTime + 300000),
    createPtsResearchSession(history).inspect(responsiveTime + 300000),
  );
});

test("an earlier non-bar inspection cannot inherit retirement from a later requested clock", () => {
  const history = responsiveFixture();
  const session = createPtsResearchSession(history);
  const original = analyzePts(history, responsiveTime, PTS_INTRADAY_RESPONSIVE_VERSION);
  const expiry = original.setup!.c.confirmedAt + 86400000;

  session.inspect(expiry);
  const earlier = session.inspect(responsiveTime + 300001);
  const independent = createPtsResearchSession(history).inspect(responsiveTime + 300001);

  assert.deepEqual(earlier, independent);
});
