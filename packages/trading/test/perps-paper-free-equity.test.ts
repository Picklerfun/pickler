import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_PAPER_SESSION,
  applyPaperSizeUp,
  initialPaperAccount,
  productFreeEquity,
  type PerpsPaperFill,
} from "@pickler/trading/perps";

const NOW = 1_800_000_000_000;
const scope = {
  tenantId: "t",
  agentId: "a",
  sessionId: PRODUCT_PAPER_SESSION,
  network: "testnet" as const,
};

function account() {
  const a = initialPaperAccount(scope, 1, NOW, "100");
  a.positions.push({
    id: "p1",
    symbol: "BTC",
    side: "long",
    quantity: "0.01",
    entryPrice: "60000",
    entryNotional: "600",
    openedAt: NOW,
    entryBlock: 1,
    mark: null,
    markAt: null,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
    leverage: 10,
    margin: "60",
  });
  return a;
}

test("free equity counts an open loss at trusted marks and is unknown without a mark", () => {
  const a = account();

  assert.equal(productFreeEquity(a, [], {}), null);
  assert.equal(productFreeEquity(a, [], { BTC: "60000" }), "40");
  assert.equal(productFreeEquity(a, [], { BTC: "57000" }), "10");
  assert.equal(productFreeEquity(a, [], { BTC: "66000" }), "40");
});

test("a size-up averages the entry, adds margin at the leverage and keeps the exits", () => {
  const a = account();
  const fill: PerpsPaperFill = {
    quantity: "0.01",
    price: "62000",
    notional: "620",
    fee: "0.124",
    block: 2,
    timestamp: NOW,
    evidence: null,
  };

  const { account: after, movements } = applyPaperSizeUp(a, "p1", "sizeup:x", fill, NOW + 1);
  const p = after.positions[0]!;

  assert.equal(p.quantity, "0.02");
  assert.equal(p.entryNotional, "1220");
  assert.equal(p.entryPrice, "61000");
  assert.equal(p.margin, "122");
  assert.deepEqual(p.sizeUps, [{ at: NOW + 1, margin: "62" }]);
  assert.deepEqual(
    movements.map((m) => [m.key, m.delta]),
    [["sizeup:x:fee", "-0.124"]],
  );
  assert.throws(() => applyPaperSizeUp({ ...a, positions: [] }, "p1", "k", fill, NOW), {
    code: "POSITION_CLOSED",
  });
});
