import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPaperMarks,
  applyPaperObservation,
  applyPaperPositionFunding,
  finalizePaperObservation,
  finalizePaperObservationDelta,
  type PerpsPaperMovement,
  type PerpsPaperPosition,
} from "../src/perps.js";
import { breakoutAccounts, breakoutFrame, breakoutT0 } from "./hourly-breakout-fixture.js";

test("paged native funding preserves signed micro rounding, held blocks, closed-position late events and sticky revisions", () => {
  const at = breakoutT0 + 1000;
  const account = breakoutAccounts(at)[0]!.view.account;
  const frame = breakoutFrame(1, at);
  const position: PerpsPaperPosition = {
    id: "closed-original",
    market: frame.snapshot.market,
    symbol: "BTC",
    side: "long",
    quantity: "1",
    entryNotional: "100",
    entryPrice: "100",
    openedAt: at - 30000,
    entryBlock: 100,
    closedAt: at,
    exitPrice: "100",
    exitBlock: 103,
    mark: "100",
    markAt: at,
  };
  account.positions = [position];
  const history = {
    market: frame.snapshot.market,
    from: position.openedAt,
    to: at,
    complete: true,
    pages: [frame.snapshot.market.provenance],
    events: [100, 101, 103, 104].map((eventBlock) => ({
      eventBlock,
      appliesAt: at,
      rate: "0.000000001",
      index: "100",
      estimated: false,
      provenance: frame.snapshot.market.provenance,
    })),
  };
  const kernel = applyPaperPositionFunding(account, position, [], history, at);
  assert.equal(kernel.pending, false);
  assert.equal(kernel.disputed, false);
  assert.deepEqual(
    kernel.movements.map((m) => m.key),
    ["funding:closed-original:101", "funding:closed-original:103"],
  );
  assert.deepEqual(
    kernel.movements.map((m) => m.delta),
    ["-0.000001", "-0.000001"],
  );
  const short = applyPaperPositionFunding(account, { ...position, side: "short" }, [], history, at);
  assert.deepEqual(
    short.movements.map((m) => m.delta),
    ["0", "0"],
  );
  const native = applyPaperObservation(
    account,
    [],
    { frames: [frame], funding: [history] },
    "original",
    at,
  );
  assert.equal(native.account.cash, "999.999998");
  assert.deepEqual(native.movements, kernel.movements);
  const late = applyPaperPositionFunding(account, position, [kernel.movements[0]!], history, at);
  assert.deepEqual(
    late.movements.map((m) => m.key),
    ["funding:closed-original:103"],
  );
  const revised = structuredClone(history);
  revised.events[1]!.rate = "0.001";
  const discrepancy = applyPaperPositionFunding(account, position, kernel.movements, revised, at);
  assert.equal(discrepancy.disputed, true);
  const disputed = { ...account, fundingDisputed: true };
  const unchanged = finalizePaperObservation(
    disputed,
    discrepancy.movements,
    true,
    false,
    "revision",
    at,
  );
  assert.equal(unchanged.account.cash, "1000");
  assert.equal(unchanged.movements.length, 0);
  assert.equal(unchanged.account.fundingPending, true);
});

test("all paged position funding finalizes cash/day/peak once at UTC rollover with native parity", () => {
  const beforeMidnight = breakoutT0 - 60_000;
  const at = breakoutT0 + 1000;
  const account = breakoutAccounts(beforeMidnight)[0]!.view.account;
  const frame = breakoutFrame(1, at);
  account.lastValuationAt = beforeMidnight;
  account.positions = Array.from({ length: 3 }, (_, i) => ({
    id: `original:${i}`,
    market: frame.snapshot.market,
    symbol: "BTC",
    side: i % 2 ? ("short" as const) : ("long" as const),
    quantity: "1",
    entryPrice: "100",
    entryNotional: "100",
    openedAt: beforeMidnight,
    entryBlock: 100,
    closedAt: at,
    exitPrice: "100",
    exitBlock: 102,
    mark: "100",
    markAt: beforeMidnight,
  }));
  const funding = [
    {
      market: frame.snapshot.market,
      from: beforeMidnight,
      to: at,
      complete: true,
      pages: [frame.snapshot.market.provenance],
      events: [
        {
          eventBlock: 101,
          appliesAt: at,
          rate: "0.001",
          index: "100",
          estimated: false,
          provenance: frame.snapshot.market.provenance,
        },
      ],
    },
  ];
  const ordinary = applyPaperObservation(
    account,
    [],
    { frames: [frame], funding },
    "same-original",
    at,
  );
  const marked = applyPaperMarks(account, [frame], at);
  assert.equal(marked.day, account.day);
  assert.equal(marked.cash, "1000");
  const movements: PerpsPaperMovement[] = [];
  let pending = false;
  for (const position of account.positions) {
    const kernel = applyPaperPositionFunding(marked, position, [], funding[0], at);
    movements.push(...kernel.movements);
    pending ||= kernel.pending;
  }
  const staged = finalizePaperObservation(marked, movements, pending, false, "same-original", at);
  assert.deepEqual(staged, ordinary);
  assert.equal(staged.account.cash, "999.9");
  assert.equal(staged.account.day, "2027-01-04");
  assert.equal(staged.account.dayEquity, "999.9");
  assert.equal(staged.account.peakEquity, "1000");
  const bounded = finalizePaperObservationDelta(marked, "-0.1", false, false, "same-original", at);
  assert.deepEqual(bounded.account, ordinary.account);
});
