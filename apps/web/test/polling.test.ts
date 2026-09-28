import assert from "node:assert/strict";
import { test } from "node:test";
import { startPolling } from "../src/features/studio/lib/polling";

class Page extends EventTarget {
  hidden = false;
  hide(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};
/**
 * startPolling's onError takes `unknown`, which none of assert.fail's overloads accept.
 * Passing it bare only compiled while this directory sat outside the typecheck.
 */
const noFailureExpected = (error: unknown): never => assert.fail(`read failed: ${String(error)}`);

test("polls active reads every three seconds and stops after a terminal read", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = new Page();
  let calls = 0;
  const stop = startPolling(async () => (++calls < 3 ? 3000 : null), noFailureExpected, page);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 2);
  t.mock.timers.tick(3000);
  await flush();
  t.mock.timers.tick(30000);
  assert.equal(calls, 3);
  stop();
});

test("hiding or leaving aborts reads; stale completions cannot restart the loop", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = new Page();
  const signals: AbortSignal[] = [];
  const finish: ((delay: number) => void)[] = [];
  const stop = startPolling(
    (signal) => {
      signals.push(signal);
      return new Promise((resolve) => finish.push(resolve));
    },
    noFailureExpected,
    page,
  );
  page.hide(true);
  assert.equal(signals[0]!.aborted, true);
  t.mock.timers.tick(30000);
  assert.equal(signals.length, 1);
  page.hide(false);
  assert.equal(signals.length, 2);
  finish[0]!(3000);
  await flush();
  t.mock.timers.tick(30000);
  assert.equal(signals.length, 2);
  stop();
  assert.equal(signals[1]!.aborted, true);
  finish[1]!(3000);
  await flush();
  page.hide(false);
  t.mock.timers.tick(30000);
  assert.equal(signals.length, 2);
});

test("read failures surface and retry without overlapping in-flight reads", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const page = new Page();
  const errors: unknown[] = [];
  let calls = 0;
  const stop = startPolling(
    async () => {
      calls++;
      throw new Error("transport unavailable");
    },
    (error) => errors.push(error),
    page,
  );
  await flush();
  assert.equal(errors.length, 1);
  t.mock.timers.tick(3000);
  await flush();
  assert.equal(calls, 2);
  stop();
});
