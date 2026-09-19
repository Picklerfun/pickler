import { test } from "node:test";
import assert from "node:assert/strict";
import {
  simulatePaperBuy,
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
  asks: [
    { price: "0.40", size: "10" },
    { price: "0.45", size: "100" },
  ],
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
test("paper buy consumes multiple levels and estimates fees inside the fixed virtual budget", () => {
  const result = simulatePaperBuy(market, book, conditions, "0.45", now);
  assert.ok(result.fill);
  assert.equal(result.fill.levels.length, 2);
  assert.equal(result.fill.levels[0]!.quantity, "10.00000000");
  assert.equal(result.fill.levels[0]!.fee, "0.12000000");
  assert.ok(Number(result.fill.fees) > 0.12);
  assert.ok(Number(result.fill.totalCost) <= 10);
  assert.ok(Number(result.fill.totalCost) >= 9.99999);
});
test("full budget or no position, never partial fills", () => {
  assert.equal(simulatePaperBuy(market, book, conditions, "0.40", now).fill, null);
  assert.equal(
    simulatePaperBuy(market, { ...book, asks: [] }, conditions, "0.45", now).reason,
    "INSUFFICIENT_DEPTH_AT_LIMIT",
  );
  assert.equal(
    simulatePaperBuy(market, book, { ...conditions, minimumNotional: "20" }, "0.45", now).reason,
    "BELOW_MINIMUM_ORDER",
  );
});
test("reject stale or future observations, invalid ticks, mismatched outcomes and fee curves", () => {
  assert.throws(() => simulatePaperBuy(market, book, conditions, "0.45", now + 30001), {
    code: "PAPER_STALE_QUOTE",
  });
  assert.throws(() => simulatePaperBuy(market, book, conditions, "0.45", now - 1), {
    code: "PAPER_STALE_QUOTE",
  });
  assert.throws(() => simulatePaperBuy(market, book, conditions, "0.451", now), {
    code: "PAPER_INVALID_CONDITIONS",
  });
  assert.throws(() =>
    simulatePaperBuy(market, { ...book, outcomeId: "3" }, conditions, "0.45", now),
  );
  assert.throws(() =>
    simulatePaperBuy(market, book, { ...conditions, feeRate: "NaN" }, "0.45", now),
  );
});
