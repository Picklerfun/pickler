import test from "node:test";
import assert from "node:assert/strict";
import { planStudioExecution, type StudioExecutionState } from "@pickler/trading/perps";
import type { StudioPerpsProposal } from "@pickler/trading/strategies";
const proposal: StudioPerpsProposal = {
  symbol: "BTC",
  action: "open-long",
  reason: "supported",
  sourceIds: ["BTC:candles"],
  brief: { entries: [], exits: [], never: [] },
};
function state(): StudioExecutionState {
  return {
    paused: false,
    fundingPending: false,
    freeEquity: "1000",
    openedMarginToday: "0",
    realizedToday: "0",
    openCount: 0,
    position: null,
    takerFee: "0.0002",
    spend: { perCallAusd: 25, perDayAusd: 100 },
    risk: { maxOpenPositions: 2, dayLossStopAusd: 20 },
    entry: { mode: "auto", meanwhile: "wait", smallAusd: 5 },
    leverage: 3,
  };
}
test("creator amount remains exact and is independent of model scores", () => {
  const input = state();
  input.spend.perCallAusd = 3.333333;
  const plan = planStudioExecution(proposal, input);
  assert.deepEqual(plan, {
    kind: "open",
    margin: "3.333333",
    notional: "9.999999",
    leverage: 3,
    side: "long",
    sizeUpMargin: null,
  });
});
test("approval and small entry retain the full remaining proposal", () => {
  const input = state();
  input.entry.mode = "approve";
  assert.deepEqual(planStudioExecution(proposal, input), {
    kind: "propose",
    margin: "25",
    leverage: 3,
    side: "long",
  });
  input.entry.meanwhile = "small";
  assert.deepEqual(planStudioExecution(proposal, input), {
    kind: "open",
    margin: "5",
    notional: "15",
    leverage: 3,
    side: "long",
    sizeUpMargin: "20",
  });
});
test("opposite signal only closes, including when openings are blocked", () => {
  const input = state();
  input.position = { id: "held", side: "short" };
  input.paused = true;
  input.fundingPending = true;
  input.freeEquity = null;
  assert.deepEqual(planStudioExecution(proposal, input), {
    kind: "close",
    positionId: "held",
    reason: "OPPOSITE_SIGNAL_CLOSE_ONLY",
  });
});
test("pending funding, unknown marks and exact fee reserve prevent new openings", () => {
  for (const [change, reason] of [
    [{ fundingPending: true }, "FUNDING_PENDING"],
    [{ freeEquity: null }, "UNKNOWN_MARKS"],
    [{ freeEquity: "25.022499" }, "NO_FREE_AUSD"],
    [{ openedMarginToday: "75.000001" }, "CAP_DAY"],
  ] as const) {
    assert.deepEqual(planStudioExecution(proposal, { ...state(), ...change }), {
      kind: "hold",
      reason,
    });
  }
  assert.equal(planStudioExecution(proposal, { ...state(), freeEquity: "25.0225" }).kind, "open");
});
