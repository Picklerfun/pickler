import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePts,
  createPtsResearchSession,
  inspectPtsResearch,
  replayPtsResearch,
  ptsResearchEr20,
  ptsResearchPolicy,
  ptsCandidateVersion,
  ptsSeries,
  units,
  decimal,
  type PtsBar,
  type PtsHistory,
  type PtsResearchCandidateId,
} from "../src/pts.js";
import {
  boundResearchSetups,
  researchReadinessOrder,
  type RetainedResearchSetup,
} from "../src/features/pts/research-selection.js";
import { responsiveFixture, responsiveTime } from "./pts-intraday-responsive-fixture.js";

const FIVE = 300000;
const NOW = Math.floor(responsiveTime / FIVE) * FIVE;

/** Extra original synthetic warmup ensures coverage is ready before the controlled correction. */
function fixture(short = false) {
  const history = responsiveFixture("BTC", short);
  for (const series of history.series.filter((value) => value.resolution !== 3600)) {
    const first = series.candles[0]!;
    const count = series.resolution === 300 ? 120 : 100;
    const prefix = Array.from({ length: count }, (_, i) => ({
      ...first,
      openTime: first.openTime - (count - i) * series.resolution * 1000,
    }));
    series.candles.unshift(...prefix);
    series.from = series.candles[0]!.openTime;
  }
  return history;
}

function entryBar(history: PtsHistory, closedAt: number) {
  return history.series
    .find((series) => series.resolution === 300)!
    .candles.find((bar) => bar.openTime + FIVE === closedAt)!;
}

function editEntry(history: PtsHistory, at: number, close: string, low = "130", high = "132") {
  Object.assign(entryBar(history, at), { open: close, close, low, high });
}

function appendEntry(history: PtsHistory, close: string, low = "128", high = "132") {
  const series = history.series.find((value) => value.resolution === 300)!;
  const last = series.candles.at(-1)!;
  const openTime = last.openTime + FIVE;
  series.candles.push({ ...last, openTime, open: close, close, low, high });
  series.to = openTime + FIVE;
  history.capturedAt = Math.max(history.capturedAt, series.to);
  return series.to;
}

function extendNative(history: PtsHistory, until: number, primaryEvents = false) {
  for (const series of history.series) {
    const interval = series.resolution * 1000;
    while (series.candles.at(-1)!.openTime + 2 * interval <= until) {
      const last = series.candles.at(-1)!;
      const openTime = last.openTime + interval;
      const values =
        series.resolution === 300
          ? { open: "131", close: "131", low: "130", high: "132" }
          : series.resolution === 900
            ? { open: "135", close: "135", low: "130", high: "140" }
            : { open: "125", close: "125", low: "124", high: "126" };
      if (primaryEvents && series.resolution === 3600) {
        const offset = (openTime - NOW) / 3600000;
        if (offset === 1) {
          values.low = "110";
        } else if (offset === 8) {
          values.low = "115";
        } else if (offset === 4 || offset === 12) {
          Object.assign(values, {
            open: "130",
            close: "130",
            low: "129",
            high: offset === 4 ? "190" : "210",
          });
        }
      }
      series.candles.push({ ...last, openTime, ...values });
      series.to = openTime + interval;
    }
  }
  history.capturedAt = until;
}

function candidate(history: PtsHistory, at: number, id: PtsResearchCandidateId) {
  return inspectPtsResearch(history, at).candidates.find((value) => value.candidate === id)!;
}

function readyFixture(price = "131", latePrimary = false) {
  const history = fixture();
  const correction = analyzePts(history, NOW, "0.2.0-fast.2").setup!.c.confirmedAt;
  for (const bar of history.series.find((series) => series.resolution === 300)!.candles) {
    if (bar.openTime + FIVE >= correction) {
      Object.assign(bar, { open: "131", close: "131", low: "130", high: "132" });
    }
  }
  editEntry(history, correction, "131", "123", "132");
  editEntry(history, correction + FIVE, price, "130", "135");
  if (latePrimary) {
    const hourly = history.series.find((series) => series.resolution === 3600)!;
    Object.assign(
      hourly.candles.find((bar) => bar.high === "200.0000")!,
      {
        open: "125",
        close: "125",
        high: "126",
        low: "124",
      },
    );
    Object.assign(
      hourly.candles.find((bar) => bar.openTime === NOW - 3 * 3600000)!,
      {
        open: "130",
        close: "130",
        high: "200",
        low: "129",
      },
    );
  }
  return { history, correction, first: correction + FIVE };
}

function hourlyCloses(closes: string[]): PtsBar[] {
  const template = ptsSeries(fixture(), NOW, "0.2.0-fast.2")["1h"][0]!;
  return closes.map((close, i) => ({
    ...template,
    openTime: i * 3600000,
    closeTime: (i + 1) * 3600000,
    close,
  }));
}

test("ER20 uses exactly20 native changes, inclusive exact0.30 and mirrored sign", () => {
  // Thirteen up and seven down steps: |net|/variation = 6/20 = 0.30 exactly.
  const closes = ["100"];
  for (let i = 0; i < 20; i++) {
    closes.push(String(Number(closes.at(-1)!) + (i < 13 ? 1 : -1)));
  }
  const exact = ptsResearchEr20(hourlyCloses(closes));
  assert.equal(exact.trend, "long");
  assert.equal(exact.marginNumerator, "0");
  assert.equal(
    ptsResearchEr20(hourlyCloses(closes.map((close) => String(400 - Number(close))))).trend,
    "short",
  );

  const below = [...closes];
  below[20] = "105.999999999999999999";
  assert.equal(ptsResearchEr20(hourlyCloses(below)).trend, "neutral");
  assert.equal(ptsResearchEr20(hourlyCloses(Array(21).fill("100"))).trend, "neutral");
  assert.equal(ptsResearchEr20(hourlyCloses(closes.slice(1))).trend, "unknown");
  const gap = hourlyCloses(closes);
  gap[10]!.openTime += 3600000;
  assert.equal(ptsResearchEr20(gap).trend, "unknown");
});

test("offline IDs reject unknown versions and never enter executable PTS selectors", () => {
  assert.equal(ptsResearchPolicy("primary-er20").offlineOnly, true);
  assert.throws(() => ptsResearchPolicy("primary-er20", "0.2.0"), { code: "INVALID_INPUT" });
  assert.throws(() => ptsResearchPolicy("invented"), { code: "INVALID_INPUT" });
  assert.throws(() => ptsCandidateVersion("primary-er20@0.1.0"), { code: "INVALID_INPUT" });
});

test("missing, stale and gapped coverage is unverifiable and neutral direction cannot pass dependent gates", () => {
  const missing = fixture();
  missing.series = [];
  const result = inspectPtsResearch(missing, NOW);
  assert.equal(result.baseline.reason, "HISTORY_COVERAGE");
  assert.ok(result.outcomes.every((outcome) => outcome.validationStatus === "NOT_VERIFIABLE"));
  assert.ok(result.candidates.every((outcome) => outcome.reason === "NOT_VERIFIABLE"));
  assert.ok(
    result.outcomes.every(
      (outcome) =>
        outcome.gates.find((gate) => gate.code === "HISTORY_COVERAGE")!.status === "UNKNOWN",
    ),
  );

  const stale = fixture();
  stale.series.find((series) => series.resolution === 300)!.candles.pop();
  assert.ok(
    inspectPtsResearch(stale, NOW).outcomes.every(
      (outcome) => outcome.validationStatus === "NOT_VERIFIABLE",
    ),
  );
  const gap = fixture();
  gap.series.find((series) => series.resolution === 300)!.candles.splice(-20, 1);
  assert.ok(
    inspectPtsResearch(gap, NOW).outcomes.every(
      (outcome) => outcome.validationStatus === "NOT_VERIFIABLE",
    ),
  );

  const neutral = fixture();
  for (const bar of neutral.series.find((series) => series.resolution === 3600)!.candles) {
    Object.assign(bar, { open: "125", high: "126", low: "124", close: "125" });
  }
  for (const outcome of inspectPtsResearch(neutral, NOW).outcomes) {
    assert.equal(outcome.action, "hold");
    assert.ok(
      outcome.gates
        .filter((gate) => !["HISTORY_COVERAGE", "PRIMARY_TREND"].includes(gate.code))
        .every((gate) => gate.status !== "PASS"),
    );
    assert.ok(
      outcome.gates
        .filter((gate) =>
          ["FIFTEEN_MINUTE_ALIGNMENT", "FIFTEEN_MINUTE_IMPULSE", "CONFIRMED_CORRECTION"].includes(
            gate.code,
          ),
        )
        .every((gate) => gate.status === "NOT_EVALUABLE_DEPENDENCY"),
    );
  }
});

test("retracement control changes only equal-width inclusive band, with exact mirrored edges", () => {
  for (const short of [false, true]) {
    for (const ratio of ["0.399999999999999999", "0.40", "0.57", "0.570000000000000001"]) {
      const history = fixture(short);
      const original = analyzePts(history, NOW, "0.2.0-fast.2").setup!;
      const price = decimal(
        units(original.b.price) -
          ((units(original.b.price) - units(original.a.price)) * units(ratio)) / 10n ** 18n,
      );
      const entries = history.series.find((series) => series.resolution === 300)!;
      const center = Number(price) + (short ? -3 : 3);
      const i = entries.candles.findIndex((bar) => bar.openTime === original.c.openTime);
      for (
        let j = entries.candles.findIndex((bar) => bar.openTime >= original.b.closeTime);
        j < entries.candles.length;
        j++
      ) {
        Object.assign(entries.candles[j]!, {
          open: String(center),
          close: String(center),
          high: String(center + 0.1),
          low: String(center - 0.1),
        });
      }
      entries.candles[i]![short ? "high" : "low"] = price;
      const control = candidate(history, NOW, "retracement-control");
      assert.equal(
        control.gates.find((gate) => gate.code === "RETRACEMENT_40_57")!.status,
        ["0.40", "0.57"].includes(ratio) ? "PASS" : "FAIL",
        ratio,
      );
      assert.ok(control.abId);
      assert.ok(control.abcId);
    }
  }
});

test("AB and ABC identities survive unavailable channel geometry and later gates remain dependency-aware", () => {
  const history = fixture();
  const shared = history.series.find((series) => series.resolution === 900)!;
  const firstLow = shared.candles.find((bar) => bar.low === "77.1368")!;
  Object.assign(firstLow, { open: "110", close: "110", low: "100", high: "111" });
  const result = inspectPtsResearch(history, NOW).outcomes[0]!;
  assert.ok(result.abId);
  assert.ok(result.abcId);
  assert.equal(result.episodeId, result.abcId);
  assert.equal(result.gates.find((gate) => gate.code === "FIFTEEN_MINUTE_CHANNEL")!.status, "FAIL");
  assert.equal(result.gates.find((gate) => gate.code === "ATR14")!.status, "PASS");
  assert.equal(
    result.gates.find((gate) => gate.code === "CHANNEL_CONFLUENCE")!.status,
    "NOT_EVALUABLE_DEPENDENCY",
  );
});

test("ready-band adds exactly first later close, retains original TTL and cannot refresh on polling", () => {
  const { history, first } = readyFixture();
  const session = createPtsResearchSession(history);
  const get = (at: number) =>
    session.inspect(at).candidates.find((outcome) => outcome.candidate === "ready-band-entry")!;
  const initial = get(first);
  assert.equal(initial.action, "signal-long");
  assert.equal(initial.signal!.entryKind, "ready-band");
  assert.equal(initial.signal!.triggerAt, first);
  assert.equal(initial.signal!.expiresAt, first + FIVE);
  assert.equal(session.inspect(first).baseline.action, "hold");
  assert.equal(get(first + 1000).signal!.triggerAt, first);
  assert.equal(get(first + FIVE).action, "hold");
  assert.equal(get(first + FIVE).timing.triggerAt, first);

  for (const edge of ["130.222", "133.8905"]) {
    const boundary = readyFixture(edge);
    assert.equal(candidate(boundary.history, boundary.first, "ready-band-entry").action, "hold");
  }
});

test("late primary delays only added band, while unchanged same-time crosses survive", () => {
  const late = readyFixture("131", true);
  assert.equal(candidate(late.history, NOW, "ready-band-entry").action, "hold");
  const next = appendEntry(late.history, "131", "130", "132");
  const ready = candidate(late.history, next, "ready-band-entry");
  assert.equal(ready.action, "signal-long");
  assert.equal(ready.timing.prerequisitesReadyAt, NOW);
  assert.equal(ready.signal!.triggerAt, NOW + FIVE);

  const cross = readyFixture("131", true).history;
  editEntry(cross, NOW - FIVE, "129", "128", "130");
  editEntry(cross, NOW, "131", "130", "132");
  const atReady = inspectPtsResearch(cross, NOW);
  assert.equal(atReady.baseline.action, "open-long");
  assert.equal(
    atReady.candidates.find((outcome) => outcome.candidate === "ready-band-entry")!.signal!
      .triggerAt,
    NOW,
  );
});

test("ready-band preserves the historical channel gate when B confirms after C", () => {
  const history = fixture();
  const entries = history.series.find((series) => series.resolution === 300)!;
  for (const bar of entries.candles) {
    if (bar.openTime >= NOW - 70 * 60000) {
      Object.assign(bar, { open: "129", close: "129", low: "128", high: "132" });
    }
  }
  // C is confirmed before B's two right neighbours; the channel exists but its trend is unknown.
  editEntry(history, NOW - 50 * 60000, "129", "118.1", "132");
  editEntry(history, NOW, "131", "128", "132");

  const result = inspectPtsResearch(history, NOW);
  const ready = result.candidates.find((outcome) => outcome.candidate === "ready-band-entry")!;
  const channel = ready.gates.find((gate) => gate.code === "FIFTEEN_MINUTE_CHANNEL")!;

  assert.equal(result.baseline.reason, "FIFTEEN_MINUTE_CHANNEL");
  assert.equal(
    ready.gates.find((gate) => gate.code === "FIFTEEN_MINUTE_ALIGNMENT")!.status,
    "PASS",
  );
  assert.equal(channel.status, "FAIL");
  assert.equal((channel.values as { trendAtCorrection: string }).trendAtCorrection, "unknown");
  assert.equal(ready.action, "hold");
  assert.equal(ready.reason, "FIFTEEN_MINUTE_CHANNEL");
  assert.equal(ready.signal, null);
  assert.equal(
    ready.gates.find((gate) => gate.code === "RECOVERY_CROSS_38")!.status,
    "NOT_EVALUABLE_DEPENDENCY",
  );
});

test("persistence retains frozen old ABC when latest correction supersedes it", () => {
  const history = fixture();
  editEntry(history, NOW - 5 * FIVE, "129", "128", "132");
  editEntry(history, NOW - 4 * FIVE, "129", "128", "131");
  editEntry(history, NOW - 3 * FIVE, "130", "129", "134");
  editEntry(history, NOW - 2 * FIVE, "129", "125", "130");
  editEntry(history, NOW - FIVE, "129", "128", "132");
  editEntry(history, NOW, "131", "130", "134");
  const result = inspectPtsResearch(history, NOW);
  const retained = result.candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.equal(result.baseline.reason, "RETRACEMENT_61_78");
  assert.equal(retained.action, "signal-long");
  assert.equal(retained.signal!.geometry.c.price, "118.1000");
  assert.ok(retained.timing.admittedAt! < NOW);
  assert.equal(retained.signal!.geometry.channel.frozenAt, retained.signal!.geometry.c.confirmedAt);
});

test("persistence starts lifecycle at full readiness and preserves crossing above diagnostic fill band", () => {
  const late = readyFixture("131", true).history;
  editEntry(late, NOW - FIVE, "129", "128", "130");
  editEntry(late, NOW, "131", "130", "132");
  const admitted = candidate(late, NOW, "persistent-setups");
  assert.equal(admitted.action, "signal-long");
  assert.equal(admitted.timing.admittedAt, NOW);
  assert.equal(admitted.validationStatus, "VALID");

  const outside = fixture();
  editEntry(outside, NOW, "134.05", "128", "135");
  const result = inspectPtsResearch(outside, NOW);
  const retained = result.candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.equal(result.baseline.action, "open-long");
  assert.equal(retained.action, "signal-long");
  assert.equal(retained.gates.find((gate) => gate.code === "ENTRY_BAND")!.status, "FAIL");
});

test("closed stop touch retires persistence; only confirmed fixture IDs consume later crosses", () => {
  const stopped = fixture();
  const stop = analyzePts(stopped, NOW, "0.2.0-fast.2").setup!.initialStop;
  const correction = analyzePts(stopped, NOW, "0.2.0-fast.2").setup!.c.confirmedAt;
  editEntry(stopped, correction + FIVE, "131", stop, "132");
  const hit = inspectPtsResearch(stopped, correction + FIVE);
  assert.equal(hit.baseline.action, "open-long");
  assert.equal(
    hit.candidates.find((outcome) => outcome.candidate === "persistent-setups")!.action,
    "hold",
  );

  const history = fixture();
  const first = candidate(history, NOW, "persistent-setups").signal!;
  appendEntry(history, "129", "128", "130");
  const next = appendEntry(history, "131", "128", "132");
  assert.equal(candidate(history, next, "persistent-setups").action, "signal-long");
  const consumed = createPtsResearchSession(history, {
    confirmedFixtureSignalIds: [first.id],
  }).inspect(next);
  assert.equal(
    consumed.candidates.find((outcome) => outcome.candidate === "persistent-setups")!.action,
    "hold",
  );
  const rejected = createPtsResearchSession(history, {
    confirmedFixtureSignalIds: ["unconfirmed-proposal-id"],
  }).inspect(next);
  assert.equal(
    rejected.candidates.find((outcome) => outcome.candidate === "persistent-setups")!.action,
    "signal-long",
  );
});

test("readiness selection and32-per-direction eviction use distinct clocks and stable ID ties", () => {
  const geometry = candidate(fixture(), NOW, "persistent-setups").signal!.geometry;
  const state = (
    id: string,
    confirmedAt: number,
    admittedAt: number,
    direction: "long" | "short" = "long",
  ): RetainedResearchSetup => ({
    geometry: { ...geometry, abcId: id, direction, c: { ...geometry.c, confirmedAt } },
    admittedAt,
  });
  const earlierC = state("earlier-c-later-ready", 10, 40);
  const laterC = state("later-c-earlier-ready", 20, 30);
  assert.equal([earlierC, laterC].sort(researchReadinessOrder)[0], laterC);
  const entries = new Map<string, RetainedResearchSetup>();
  for (let i = 0; i < 33; i++) {
    entries.set(`long-${i}`, state(`long-${i}`, i === 0 ? 0 : 1, 100 - i));
    entries.set(`short-${i}`, state(`short-${i}`, i === 0 ? 0 : 1, 100 - i, "short"));
  }
  assert.deepEqual(boundResearchSetups(entries), ["long-0", "short-0"]);
  assert.equal(entries.size, 64);
  assert.deepEqual(boundResearchSetups(entries), []);
});

test("one band attempt survives temporary coverage failure and lifecycle gaps stay unknown after rolling warmup recovers", () => {
  const ready = readyFixture("130.222");
  extendNative(ready.history, NOW + 16 * 3600000);
  const entries = ready.history.series.find((series) => series.resolution === 300)!;
  entries.candles.splice(
    entries.candles.findIndex((bar) => bar.openTime + FIVE === NOW + 2 * FIVE),
    1,
  );
  const result = inspectPtsResearch(ready.history, NOW + 15 * 3600000 + 3 * FIVE);
  const band = result.candidates.find((outcome) => outcome.candidate === "ready-band-entry")!;
  assert.equal(band.gates.find((gate) => gate.code === "HISTORY_COVERAGE")!.status, "PASS");
  assert.equal(band.action, "hold");
  assert.equal(band.timing.prerequisitesReadyAt, ready.correction);
  const persistent = result.candidates.find(
    (outcome) => outcome.candidate === "persistent-setups",
  )!;
  assert.equal(persistent.validationStatus, "NOT_VERIFIABLE");
  assert.equal(persistent.gates.find((gate) => gate.code === "SETUP_LIFECYCLE")!.status, "UNKNOWN");
});

test("verified neutral primary permanently retires a retained episode before its fixed24h expiry", () => {
  const history = fixture();
  extendNative(history, NOW + 16 * 3600000, true);
  const session = createPtsResearchSession(history);
  const prior = session
    .inspect(NOW + 6 * 3600000)
    .candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.ok(prior.activeSetups > 0);
  const neutral = session
    .inspect(NOW + 7 * 3600000)
    .candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.equal(neutral.direction, "neutral");
  assert.equal(neutral.activeSetups, 0);
  const recovered = session
    .inspect(NOW + 15 * 3600000)
    .candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.equal(recovered.direction, "long");
  assert.equal(recovered.activeSetups, 0);
});

test("retained correction expires exactly24h from C rather than from later admission", () => {
  const history = fixture();
  const expiresAt = analyzePts(history, NOW, "0.2.0-fast.2").setup!.c.confirmedAt + 86400000;
  extendNative(history, expiresAt + FIVE);
  const session = createPtsResearchSession(history);
  const before = session
    .inspect(expiresAt - FIVE)
    .candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.ok(before.activeSetups > 0);
  const expired = session
    .inspect(expiresAt)
    .candidates.find((outcome) => outcome.candidate === "persistent-setups")!;
  assert.equal(expired.activeSetups, 0);
});

test("chronological replay reports unique episodes and both gained and lost signals without financial results", () => {
  const ready = readyFixture();
  const replay = replayPtsResearch(ready.history, {
    from: ready.first - FIVE,
    to: ready.first + FIVE,
  });
  const comparison = replay.comparisons.find((item) => item.candidate === "ready-band-entry")!;
  assert.equal(replay.windows, 3);
  assert.ok(comparison.gained.length > 0);
  assert.equal(comparison.uniqueEpisodes, 1);
  assert.equal(replay.interpretation, "OFFLINE_SIGNALS_ONLY_NO_FINANCIAL_RESULTS");
  assert.equal("profit" in replay, false);

  const reference = replayPtsResearch(fixture(), { from: NOW - FIVE, to: NOW });
  assert.ok(
    reference.comparisons.find((item) => item.candidate === "retracement-control")!.lost.length > 0,
  );
  assert.deepEqual(
    replayPtsResearch(ready.history, { from: ready.first - FIVE, to: ready.first + FIVE }),
    replay,
  );
});
