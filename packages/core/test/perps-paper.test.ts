import test from "node:test";
import assert from "node:assert/strict";
import {
  initialPaperAccount,
  paperRisk,
  paperCash,
  paperUnits,
  paperDecimal,
  applyPaperFill,
  DEFAULT_CONFIG,
  effectivePlugins,
  assertConfig,
  type PerpsPaperPosition,
  type PerpsPaperAttempt,
} from "../src/index.js";
const now = 1800000000000;
const scope = { tenantId: "t", agentId: "a", sessionId: "s", network: "mainnet" as const };
const intent = {
  kind: "open" as const,
  symbol: "BTC" as const,
  side: "long" as const,
  notional: "100",
  feeReserve: "1",
};
function position(side: "long" | "short" = "long"): PerpsPaperPosition {
  return {
    id: "p",
    symbol: "BTC",
    side,
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: now,
    entryBlock: 1,
    mark: "100",
    markAt: now,
    closedAt: null,
    exitPrice: null,
    exitBlock: null,
  };
}
test("paper is opt-in and cash rounding cannot over-credit or undercharge", () => {
  assert.equal(effectivePlugins(DEFAULT_CONFIG).enabled.includes("perps-paper"), false);
  assert.equal(paperCash("0.0000009"), "0");
  assert.equal(paperCash("-0.0000001"), "-0.000001");
  assert.equal(
    paperDecimal(paperUnits("1000000000000000000.000000000000000001")),
    "1000000000000000000.000000000000000001",
  );
  assert.throws(() => paperUnits("NaN"));
  assertConfig({ ...DEFAULT_CONFIG, perpsPaper: { version: 1, policy: "conservative-1x-v1" } });
});
test("margin and reservations reduce availability without becoming cash expenses", () => {
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [position()];
  const pending: PerpsPaperAttempt = {
    key: "x",
    intent: { ...intent, symbol: "ETH" },
    status: "pending",
    reserved: "101",
    createdAt: now,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const r = paperRisk(a, [pending], now);
  assert.equal(r.cash, "1000");
  assert.equal(r.margin, "100");
  assert.equal(r.reserved, "101");
  assert.equal(r.equity, "1000");
  assert.equal(r.available, "799");
});
test("stale marks block opening but do not prevent a full reducing close", () => {
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [{ ...position(), markAt: now - 30001 }];
  assert.equal(paperRisk(a, [], now, { ...intent, symbol: "ETH" }).allowed, false);
  assert.equal(paperRisk(a, [], now, { ...intent, kind: "close", notional: "0" }).allowed, true);
});
test("daily, session, duration and side-specific stops request closes without synthetic fills", () => {
  for (const side of ["long", "short"] as const) {
    const a = initialPaperAccount(scope, 1, now);
    a.positions = [{ ...position(side), mark: side === "long" ? "98" : "102" }];
    assert.deepEqual(paperRisk(a, [], now).closeSymbols, ["BTC"]);
  }
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [position()];
  a.cash = "950";
  const r = paperRisk(a, [], now, { ...intent, symbol: "ETH" });
  assert.equal(r.allowed, false);
  assert.ok(r.reasons.includes("DAILY_LOSS"));
  assert.ok(r.reasons.includes("SESSION_DRAWDOWN"));
  a.cash = "1000";
  a.positions[0]!.openedAt = now - 4 * 3600000;
  assert.deepEqual(paperRisk(a, [], now).closeSymbols, ["BTC"]);
});
test("full closes settle side-specific P&L and retain insolvency instead of liquidation", () => {
  const a = initialPaperAccount(scope, 1, now);
  a.positions = [position("short")];
  const attempt: PerpsPaperAttempt = {
    key: "close",
    intent: { ...intent, kind: "close", side: "short", notional: "0", feeReserve: "2" },
    status: "pending",
    reserved: "0",
    createdAt: now,
    finishedAt: null,
    reason: null,
    evidence: null,
  };
  const result = applyPaperFill(
    a,
    attempt,
    {
      quantity: "1",
      price: "1200",
      notional: "1200",
      fee: "1",
      block: 2,
      timestamp: now,
      evidence: {},
    },
    now,
  );
  assert.equal(result.account.cash, "-101");
  assert.equal(result.account.blocked, true);
  assert.equal(a.positions[0]!.closedAt, null);
  assert.equal(result.movements.find((m) => m.kind === "realized-pnl")!.delta, "-1100");
  assert.throws(() =>
    applyPaperFill(
      a,
      attempt,
      {
        quantity: "0.5",
        price: "100",
        notional: "50",
        fee: "0",
        block: 2,
        timestamp: now,
        evidence: {},
      },
      now,
    ),
  );
});
