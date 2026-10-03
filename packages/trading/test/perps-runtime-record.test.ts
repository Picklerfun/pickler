import test from "node:test";
import assert from "node:assert/strict";
import { recordStats, realizedSince, type RecordInput } from "@pickler/trading/perps";

const at = (day: number, hour: number, minute = 0) => Date.UTC(2026, 9, day, hour, minute);
const now = at(3, 14, 20);

function input(overrides: Partial<RecordInput> = {}): RecordInput {
  return {
    movements: [
      { kind: "initial", delta: "100", at: at(2, 22) },
      { kind: "realized-pnl", delta: "5", at: at(2, 23) },
      { kind: "fee", delta: "-0.5", at: at(2, 23) },
      { kind: "realized-pnl", delta: "10", at: at(3, 11, 30) },
      { kind: "fee", delta: "-1", at: at(3, 11, 30) },
      { kind: "funding", delta: "-0.5", at: at(3, 12) },
      { kind: "realized-pnl", delta: "-15", at: at(3, 13, 15) },
      { kind: "fee", delta: "-1", at: at(3, 13, 15) },
    ],
    closed: [
      { closedAt: at(2, 23), pnl: 4.5 },
      { closedAt: at(3, 11, 30), pnl: 9 },
      { closedAt: at(3, 13, 15), pnl: -16 },
    ],
    openPnl: 2,
    checks: 17,
    entries: 3,
    now,
    ...overrides,
  };
}

test("record stats from the ledger", () => {
  const stats = recordStats(input());

  assert.equal(stats.realizedAusd, -3);
  assert.equal(stats.realizedTodayAusd, -7.5);
  assert.equal(stats.feesAndFundingAusd, -3);
  assert.equal(stats.openPnlAusd, 2);
  assert.equal(stats.cashAusd, 97);
  assert.equal(stats.equityAusd, 99);
  assert.equal(stats.closedCount, 3);
  assert.equal(stats.wins, 2);
  assert.equal(stats.hitRate, 2 / 3);
  assert.equal(stats.checks, 17);
  assert.equal(stats.entries, 3);
});

test("max drawdown is measured on equity after each instant, peak to trough", () => {
  const stats = recordStats(input());

  assert.equal(stats.maxDrawdownAusd, 16.5);
  assert.equal(stats.maxDrawdownPct, 16.5 / 113.5);
});

test("the equity series has a point per hour, per close and now", () => {
  const { series } = recordStats(input());

  assert.equal(series.length, 20);
  assert.deepEqual(series[0], { at: at(2, 22), equity: 100 });
  assert.deepEqual(series.at(-1), { at: now, equity: 99 });
  assert.deepEqual(
    series.find((point) => point.at === at(3, 11, 30)),
    { at: at(3, 11, 30), equity: 113.5 },
  );
  assert.deepEqual(
    series.find((point) => point.at === at(3, 13, 15)),
    { at: at(3, 13, 15), equity: 97 },
  );
  assert.deepEqual(
    series.find((point) => point.at === at(3, 12)),
    { at: at(3, 12), equity: 113 },
  );
  assert.equal(series.filter((point) => point.at === at(2, 23)).length, 1);
  for (let i = 1; i < series.length; i++) {
    assert.ok(series[i]!.at > series[i - 1]!.at);
  }
});

test("the series window keeps only the last hours asked for", () => {
  const { series, maxDrawdownAusd } = recordStats(input({ hours: 3 }));

  assert.deepEqual(
    series.map((point) => point.at),
    [at(3, 11, 30), at(3, 12), at(3, 13), at(3, 13, 15), at(3, 14), now],
  );
  assert.equal(maxDrawdownAusd, 16.5);
});

test("an unknown open P&L leaves equity unknown and the last point at cash", () => {
  const stats = recordStats(input({ openPnl: null }));

  assert.equal(stats.openPnlAusd, null);
  assert.equal(stats.equityAusd, null);
  assert.deepEqual(stats.series.at(-1), { at: now, equity: 97 });
});

test("an empty ledger has no hit rate and no drawdown", () => {
  const stats = recordStats(
    input({ movements: [], closed: [], openPnl: null, checks: 0, entries: 0 }),
  );

  assert.equal(stats.realizedAusd, 0);
  assert.equal(stats.hitRate, null);
  assert.equal(stats.maxDrawdownAusd, 0);
  assert.equal(stats.maxDrawdownPct, null);
  assert.deepEqual(stats.series, []);
});

test("a flat close is not a win", () => {
  const stats = recordStats(input({ closed: [{ closedAt: at(3, 11), pnl: 0 }] }));

  assert.equal(stats.hitRate, 0);
});

test("realizedSince sums every non-initial movement from a time", () => {
  const { movements } = input();

  assert.equal(realizedSince(movements, at(3, 0)), -7.5);
  assert.equal(realizedSince(movements, 0), -3);
  assert.equal(realizedSince(movements, at(4, 0)), 0);
});
