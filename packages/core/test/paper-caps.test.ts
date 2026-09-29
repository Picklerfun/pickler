import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAPER_BUDGET_AUSD,
  assertPaperDailyCap,
  paperBudgetAusd,
  simulatePaperBuy,
  utcDayStart,
  type Market,
  type OrderBook,
  type PaperConditions,
} from "../src/index.js";

const now = Date.parse("2026-09-17T12:00:00Z");
const market: Market = {
  id: "1",
  question: "Fixture",
  rules: "Fixture rules",
  active: true,
  categoryIds: ["1"],
  closesAt: new Date(now + 3600000).toISOString(),
  liquidity: 1,
  outcomes: [{ id: "2", label: "Yes" }],
};
const book: OrderBook = {
  outcomeId: "2",
  observedAt: new Date(now).toISOString(),
  bids: [],
  asks: [{ price: "0.45", size: "100" }],
};
const conditions: PaperConditions = {
  marketId: "1",
  outcomeId: "2",
  observedAt: new Date(now).toISOString(),
  minimumNotional: "1",
  tickSize: "0.01",
  feeRate: "0.05",
  feeExponent: 1,
  provenance: "https://example.com/market/1",
};

test("the paper budget is 10 AUSD, or the per-trade cap when that is lower", () => {
  assert.equal(PAPER_BUDGET_AUSD, 10);
  assert.equal(paperBudgetAusd(undefined), 10);
  assert.equal(paperBudgetAusd({ perCallAusd: 5, perDayAusd: 20 }), 5);
  assert.equal(paperBudgetAusd({ perCallAusd: 50, perDayAusd: 100 }), 10);
});

test("a fill spends the budget it is given, never more", () => {
  const five = simulatePaperBuy(market, book, conditions, "0.45", now, 5);
  assert.ok(five.fill);
  assert.ok(Number(five.fill.totalCost) <= 5);
  assert.ok(Number(five.fill.totalCost) >= 4.99);
  const ten = simulatePaperBuy(market, book, conditions, "0.45", now);
  assert.ok(Number(ten.fill!.totalCost) > 9.99);
});

test("a budget outside 0–10 is refused", () => {
  for (const budget of [0, -1, 10.01]) {
    assert.throws(() => simulatePaperBuy(market, book, conditions, "0.45", now, budget), {
      code: "PAPER_INVALID_CONDITIONS",
    });
  }
});

test("the day is the UTC day", () => {
  assert.equal(
    utcDayStart(Date.parse("2026-09-28T23:59:59.999Z")),
    Date.parse("2026-09-28T00:00:00Z"),
  );
  assert.equal(utcDayStart(Date.parse("2026-09-29T00:00:00Z")), Date.parse("2026-09-29T00:00:00Z"));
});

test("an order that would pass the day's cap is refused with its reason", () => {
  const spend = { perCallAusd: 5, perDayAusd: 20 };
  assert.doesNotThrow(() => assertPaperDailyCap(spend, 15, 5));
  assert.throws(() => assertPaperDailyCap(spend, 15.01, 5), { code: "DAILY_CAP_REACHED" });
  assert.doesNotThrow(() => assertPaperDailyCap(undefined, 1_000, 10));
});
