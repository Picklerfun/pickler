import test from "node:test";
import assert from "node:assert/strict";
import { perplExecutionFixture } from "../src/features/studio/perpl-execution/fixture";
import {
  accountObserved,
  groupCycles,
  perplStatus,
  sessionFeedback,
} from "../src/features/studio/perpl-execution/presentation";

test("unknown reads and missing authorization never claim a ready or flat account", () => {
  const ready = perplExecutionFixture("ready");
  assert.equal(perplStatus(null).label, "Reading account");
  assert.equal(perplStatus(ready).label, "Ready to trade");
  assert.equal(perplStatus(ready, "network unavailable").label, "Check connection");
  assert.equal(accountObserved({ ...ready, observedAt: null }), false);
  assert.equal(perplStatus({ ...ready, observedAt: null }).label, "Reading account");
  assert.equal(accountObserved({ ...ready, setupRequired: true }), false);
  assert.equal(perplStatus({ ...ready, setupRequired: true }).label, "Connect account");
  assert.equal(perplStatus({ ...ready, available: false }).label, "Trading unavailable");
});

test("an accepted opening remains pending; a confirmed fill and an unknown submission differ", () => {
  const active = perplExecutionFixture("active");
  const order = active.orders[0]!;
  assert.equal(sessionFeedback(active, true).state, "working");
  assert.equal(
    sessionFeedback({ ...active, orders: [{ ...order, status: "accepted" }] }, false).state,
    "waiting",
  );
  assert.equal(sessionFeedback(active, false).label, "Position confirmed");
  const unknown = sessionFeedback({ ...active, orders: [{ ...order, status: "unknown" }] }, false);
  assert.equal(unknown.state, "unknown");
  assert.match(unknown.hint!, /not be repeated/);
  assert.equal(sessionFeedback(perplExecutionFixture("closed"), false).label, "Start trading");
});

test("cycle pairing cannot cross sessions or markets and retains incomplete execution evidence", () => {
  const [close, open] = perplExecutionFixture("closed").orders;
  assert.ok(open && close);
  const next = {
    ...open,
    id: "next",
    requestId: 3,
    createdAt: new Date(Date.parse(close.createdAt) + 1000).toISOString(),
  };
  const foreign = { ...close, id: "foreign", sessionId: "other" };
  const otherMarket = { ...close, id: "eth", symbol: "ETH" };
  const input = [next, foreign, close, otherMarket, open];
  const original = [...input];
  const groups = groupCycles(input);
  assert.deepEqual(input, original);
  assert.equal(groups.length, 4);
  assert.deepEqual(
    groups.find((group) => group.id === open.id)?.orders.map((order) => order.action),
    ["open_long", "close_long"],
  );
  assert.equal(
    groups.reduce((count, group) => count + group.orders.length, 0),
    input.length,
  );
  assert.equal(groups.find((group) => group.id === next.id)?.orders.length, 1);
});

test("admissions and frozen session status take precedence over readiness", () => {
  const state = perplExecutionFixture("active");
  assert.equal(perplStatus({ ...state, admissionsEnabled: false }).label, "Entries paused");
  assert.ok(state.session);
  assert.equal(
    perplStatus({ ...state, session: { ...state.session, status: "frozen" } }).label,
    "Review required",
  );
});
