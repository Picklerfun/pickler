import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzePts,
  ptsSeries,
  ptsPivots,
  ptsTrend,
  ptsAtr,
  ptsChannel,
  recoveryPrice,
  units,
  decimal,
  PTS_CATALOG,
  ptsProposals,
  ptsFinal,
  ptsPlannedLoss,
  ptsSize,
  PTS_ACCOUNT_POLICY,
  type PerpsPtsConfig,
  type PtsPivot,
} from "../src/pts.js";
import { initialPaperAccount, simulatePerpsFill, applyPaperFill } from "../src/perps.js";
import { ptsFixture, ptsTime, ptsSetup, ptsEvidence } from "./pts-fixture.js";
const config: PerpsPtsConfig = {
  version: 8,
  protocol: "perps-pts-sma-v1",
  tenantId: "fixture",
  sessionId: "pts-bounds",
  network: "mainnet",
  hours: 336,
  budgetUsd: "5",
  markets: PTS_CATALOG.map((m) => ({ ...m })),
  acquisitionPolicy: "stream-universe-component-paper-20s-v1",
  candidate: "pts-trend-reversal@0.2.0",
  history: { file: "history.json", sha256: "a".repeat(64) },
  preparedFor: "local-paper-only",
};
test("61/78 retracement inclusivity and one decimal unit outside, mirrored directions", () => {
  for (const short of [false, true]) {
    for (const ratio of ["0.609999999999999999", "0.61", "0.78", "0.780000000000000001"]) {
      const h = ptsFixture("BTC", short),
        setup = ptsSetup(short),
        s = h.series.find((s) => s.resolution === 14400)!;
      const price = decimal(
        units(setup.b.price) -
          ((units(setup.b.price) - units(setup.a.price)) * units(ratio)) / 10n ** 18n,
      );
      const center = Number(price) + (short ? -3 : 3),
        target = s.candles.findIndex((c) => c.openTime === setup.c.openTime);
      for (let i = target - 2; i <= target + 2; i++) {
        Object.assign(s.candles[i]!, {
          open: String(center),
          close: String(center),
          high: String(center + 0.1),
          low: String(center - 0.1),
        });
      }
      s.candles[target]![short ? "high" : "low"] = price;
      const result = analyzePts(h, ptsTime);
      const check = result.checks.find((c) => c.code === "RETRACEMENT_61_78");
      assert.equal(
        check?.passed,
        ["0.61", "0.78"].includes(ratio),
        ratio + JSON.stringify(result.checks),
      );
    }
  }
});
test("equal and ambiguous extremes, normalized replacements have discovery clocks; neutral conflicts never imply trend", () => {
  const bars = ptsSeries(ptsFixture(), ptsTime)["4h"].slice(-10);
  for (const b of bars) {
    b.high = "10";
    b.low = "5";
    b.open = "7";
    b.close = "7";
  }
  bars[2]!.high = "12";
  bars[2]!.low = "4";
  assert.equal(ptsPivots(bars, ptsTime).events[0]!.kind, "ambiguous");
  bars[2]!.low = "5";
  bars[6]!.high = "13";
  const result = ptsPivots(bars, ptsTime);
  assert.equal(result.pivots.length, 1);
  assert.equal(result.pivots[0]!.price, "13");
  assert.equal(result.events.at(-1)!.kind, "replaced");
  const before = ptsPivots(bars, bars[6]!.closeTime);
  assert.equal(before.pivots[0]!.price, "12");
  bars[3]!.high = "12";
  assert.equal(ptsPivots(bars, bars[4]!.closeTime).pivots.length, 0);
  const pivot = (kind: "high" | "low", price: string, i: number): PtsPivot => ({
    kind,
    price,
    openTime: i,
    closeTime: i + 1,
    confirmedAt: i + 3,
  });
  const conflicts = [
    pivot("low", "5", 1),
    pivot("high", "10", 2),
    pivot("low", "6", 3),
    pivot("high", "10", 4),
  ];
  assert.equal(ptsTrend(conflicts), "neutral");
  assert.equal(ptsChannel(conflicts, "long", 7)?.widthNumerator !== undefined, true);
  assert.equal(ptsChannel([pivot("low", "6", 1), pivot("low", "5", 2)], "long", 10), null);
});
test("ATR uses fourteen true ranges with previous closes and does not bridge a gap", () => {
  const bars = ptsSeries(ptsFixture(), ptsTime)["1d"].slice(-15);
  for (const b of bars) {
    b.open = "10";
    b.close = "10";
    b.high = "11";
    b.low = "9";
  }
  bars[1]!.high = "15";
  bars[1]!.low = "14";
  bars[1]!.open = "14";
  bars[1]!.close = "14";
  assert.equal(ptsAtr(bars), units("34"));
  bars[3]!.openTime += 1000;
  assert.equal(ptsAtr(bars), null);
});
test("final refresh never promotes holds, replaces anchors or increases quantity; consumed setups persist after exit", () => {
  const e = ptsEvidence(ptsTime, false, "0.40", () => "a".repeat(64));
  const a = initialPaperAccount({ ...config, agentId: "pts" }, 1, ptsTime);
  a.positionPolicy = PTS_ACCOUNT_POLICY;
  a.consumedPtsSetups = [];
  a.riskManagement = "buffered-selective-1x-v1";
  const initial = ptsProposals({ evidence: e, account: a }, config);
  const opens = initial.filter((p) => p.action.startsWith("open-"));
  assert.ok(opens.length > 0);
  const initiallyHeld = initial.find((p) => p.action === "hold")!;
  const onlyOriginal = ptsFinal(initial, { evidence: e, account: a }, config);
  assert.equal(onlyOriginal.find((p) => p.symbol === initiallyHeld.symbol)!.action, "hold");
  const late = ptsEvidence(ptsTime + 1000, false, "0.50", () => "a".repeat(64));
  assert.ok(
    ptsFinal(initial, { evidence: late, account: a }, config)
      .filter((p) => opens.some((o) => o.symbol === p.symbol))
      .every((p) => p.action === "hold"),
  );
  const selected = opens[0]!,
    frame = e.frames.find((f) => f.snapshot.market.symbol === selected.symbol)!;
  const intent = {
    kind: "open" as const,
    symbol: selected.symbol,
    side: "long" as const,
    notional: selected.notional!,
    feeReserve: "1",
    pts: selected.pts!,
  };
  const fill = simulatePerpsFill(a, intent, frame, ptsTime);
  const result = applyPaperFill(
    a,
    {
      key: "open",
      intent,
      status: "pending",
      reserved: "0",
      createdAt: ptsTime,
      finishedAt: null,
      reason: null,
      evidence: null,
    },
    fill,
    ptsTime,
  );
  const p = result.account.positions[0]!;
  const exit = {
    kind: "close" as const,
    symbol: p.symbol,
    side: p.side,
    notional: "0",
    feeReserve: "1",
    pts: { version: "0.2.0" as const, quantity: p.quantity, reason: "CONTROLLED" },
  };
  const final = applyPaperFill(
    result.account,
    {
      key: "close",
      intent: exit,
      status: "pending",
      reserved: "0",
      createdAt: ptsTime,
      finishedAt: null,
      reason: null,
      evidence: null,
    },
    simulatePerpsFill(result.account, exit, frame, ptsTime),
    ptsTime,
  ).account;
  assert.equal(
    ptsProposals({ evidence: e, account: final }, config).find(
      (proposal) => proposal.symbol === p.symbol,
    )?.reason,
    "PTS_SETUP_CONSUMED",
  );
  assert.ok(final.consumedPtsSetups!.includes(p.pts!.setup.id));
});
test("actual book sizes an admissible late entry without adding an unapproved entry cushion", () => {
  for (const short of [false, true]) {
    const e = ptsEvidence(ptsTime, short, "0.40", () => "a".repeat(64)),
      a = initialPaperAccount({ ...config, agentId: "pts" }, 1, ptsTime);
    a.positionPolicy = PTS_ACCOUNT_POLICY;
    a.consumedPtsSetups = [];
    a.riskManagement = "buffered-selective-1x-v1";
    for (const f of e.frames) {
      const setup = analyzePts(ptsFixture(f.snapshot.market.symbol, short), ptsTime).setup!;
      const price = decimal(
        (units(recoveryPrice(setup.c.price, setup.b.price, "0.49")) / units("0.01")) *
          units("0.01"),
      );
      Object.assign(f.snapshot.ticker, {
        mark: price,
        index: price,
        last: price,
        bid: price,
        ask: price,
      });
      f.book.bids[0]!.price = price;
      f.book.asks[0]!.price = price;
    }
    const p = ptsProposals({ evidence: e, account: a }, config).find((p) => p.symbol === "BTC")!;
    assert.equal(p.action, short ? "open-short" : "open-long");
    assert.ok(p.pts?.quantity);
  }
});
test("planned risk sizes on exact rational costs, floors native quantity and rejects the next increment", () => {
  for (const short of [false, true]) {
    const setup = ptsSetup(short),
      a = initialPaperAccount({ ...config, agentId: "pts" }, 1, ptsTime);
    a.positionPolicy = PTS_ACCOUNT_POLICY;
    a.cash = "100";
    const entry = recoveryPrice(setup.c.price, setup.b.price, "0.40");
    const size = ptsSize(a, setup, entry, "0.00055", "100", 4)!;
    assert.ok(size);
    assert.ok(units(size.plannedLoss) <= units("1"));
    assert.ok(
      ptsPlannedLoss(
        decimal(units(size.quantity) + units("0.0001")),
        entry,
        setup.initialStop,
        "0.00055",
      ) > units("1"),
    );
    assert.equal(ptsPlannedLoss("1", "100", "90.61", "0.00055"), units("10"));
  }
});
