import assert from "node:assert/strict";
import test from "node:test";
import type { TokenOperationDto } from "@pickler/api-schema";
import {
  startTokenConfirmation,
  tokenConfirmationPhase,
  TOKEN_CONFIRMATION_LIMITS,
  type TokenConfirmationBudget,
} from "../src/features/tokens/token-confirmation";

class Page extends EventTarget {
  hidden = false;
  hide(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const flush = async () => {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
};
const budget = (): TokenConfirmationBudget => ({ startedAt: Date.now(), reads: 0, stopped: false });
const operation: TokenOperationDto = {
  id: "10000000-0000-4000-8000-000000000001",
  action: "launch",
  version: 1,
  status: "confirming",
  activityId: "accepted-signature",
  txHash: "0x" + "a".repeat(64),
  blockHash: null,
  error: null,
  deadline: "9999999999",
  transaction: null,
};

test("automatic reads require a known broadcast; signing and uncertain sends remain explicit", () => {
  assert.equal(tokenConfirmationPhase(operation, false), "receipt");
  assert.equal(tokenConfirmationPhase({ ...operation, status: "included" }, false), "receipt");
  assert.equal(tokenConfirmationPhase({ ...operation, txHash: null }, false), null);
  for (const status of [
    "preparing",
    "awaiting_signature",
    "signing",
    "signed",
    "submitting",
    "unknown",
    "failed",
    "cancelled",
  ] as const) {
    assert.equal(tokenConfirmationPhase({ ...operation, status }, false), null);
  }
  assert.equal(tokenConfirmationPhase({ ...operation, status: "finalized" }, false), "indexing");
  assert.equal(tokenConfirmationPhase({ ...operation, status: "finalized" }, true), null);
  assert.equal(
    tokenConfirmationPhase({ ...operation, action: "buy", status: "finalized" }, false),
    null,
  );
});

test("receipt and database-only attribution reads stop at their separate finite ceilings", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  for (const phase of ["receipt", "indexing"] as const) {
    const held = budget();
    const outcomes: string[] = [];
    let calls = 0;
    const stop = startTokenConfirmation({
      phase,
      budget: held,
      page: new Page(),
      read: async () => {
        calls += 1;
        return true;
      },
      onStop: (reason) => outcomes.push(reason),
    });
    await flush();
    const limits = TOKEN_CONFIRMATION_LIMITS[phase];
    for (let i = 1; i < limits.reads; i += 1) {
      t.mock.timers.tick(limits.interval);
      await flush();
    }
    assert.equal(calls, limits.reads);
    assert.deepEqual(outcomes, ["limit"]);
    t.mock.timers.tick(120_000);
    await flush();
    assert.equal(calls, limits.reads);
    stop();
  }
});

test("a final receipt stops automatically without another click or overlapping requests", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const outcomes: string[] = [];
  let resolve!: (pending: boolean) => void;
  let calls = 0;
  const stop = startTokenConfirmation({
    phase: "receipt",
    budget: budget(),
    page: new Page(),
    read: () => {
      calls += 1;
      return calls === 1
        ? new Promise<boolean>((done) => {
            resolve = done;
          })
        : Promise.resolve(false);
    },
    onStop: (reason) => outcomes.push(reason),
  });
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(calls, 1);
  resolve(true);
  await flush();
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 2);
  assert.deepEqual(outcomes, ["complete"]);
  t.mock.timers.tick(120_000);
  assert.equal(calls, 2);
  stop();
});

test("errors stop immediately without a provider retry or erasing the saved operation", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const held = budget();
  const outcomes: string[] = [];
  let calls = 0;
  startTokenConfirmation({
    phase: "receipt",
    budget: held,
    page: new Page(),
    read: async () => {
      calls += 1;
      throw new Error("private provider response");
    },
    onStop: (reason) => outcomes.push(reason),
  });
  await flush();
  t.mock.timers.tick(120_000);
  assert.deepEqual(outcomes, ["error"]);
  assert.equal(calls, 1);
  assert.equal(held.stopped, true);
  assert.equal(operation.status, "confirming");
});

test("wall-clock timeout aborts slow reads and ignores late successful completions", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let signal!: AbortSignal;
  let resolve!: (pending: boolean) => void;
  const outcomes: string[] = [];
  startTokenConfirmation({
    phase: "receipt",
    budget: budget(),
    page: new Page(),
    read: (current) => {
      signal = current;
      return new Promise<boolean>((done) => {
        resolve = done;
      });
    },
    onStop: (reason) => outcomes.push(reason),
  });
  t.mock.timers.tick(60_000);
  assert.equal(signal.aborted, true);
  assert.deepEqual(outcomes, ["limit"]);
  resolve(false);
  await flush();
  assert.deepEqual(outcomes, ["limit"]);
});

test("hidden pages and navigation abort reads; resumed sections retain the consumed budget", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const page = new Page();
  const held = budget();
  const signals: AbortSignal[] = [];
  const finish: ((pending: boolean) => void)[] = [];
  const stop = startTokenConfirmation({
    phase: "receipt",
    budget: held,
    page,
    read: (signal) => {
      signals.push(signal);
      return new Promise<boolean>((done) => finish.push(done));
    },
    onStop: () => assert.fail("navigation must not report an old outcome"),
  });
  page.hide(true);
  assert.equal(signals[0]!.aborted, true);
  t.mock.timers.tick(5000);
  assert.equal(signals.length, 1);
  page.hide(false);
  assert.equal(signals.length, 2);
  finish[0]!(false);
  await flush();
  assert.equal(held.stopped, false);
  stop();
  assert.equal(signals[1]!.aborted, true);
  finish[1]!(false);
  await flush();
  assert.equal(held.reads, 2);
  let resumed = 0;
  const resume = startTokenConfirmation({
    phase: "receipt",
    budget: held,
    page,
    read: async () => {
      resumed += 1;
      return false;
    },
    onStop: (reason) => assert.equal(reason, "complete"),
  });
  await flush();
  assert.equal(resumed, 1);
  assert.equal(held.reads, 3);
  resume();
});
