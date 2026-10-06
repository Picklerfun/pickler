import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { proveScreen, finiteMotionFinished, settleMotion } from "./lib/readiness.mjs";

test("client-mounted proof waits for the intended selector instead of measuring an absent screen", async () => {
  let mounted = false;
  const page = {
    locator(selector) {
      assert.equal(selector, "#intended-screen");
      return {
        first() {
          return {
            async waitFor({ state, timeout }) {
              assert.equal(state, "attached");
              assert.equal(timeout, 10000);
              await Promise.resolve();
              mounted = true;
            },
          };
        },
      };
    },
  };
  assert.equal(mounted, false);
  assert.equal(await proveScreen(page, "#intended-screen"), null);
  assert.equal(mounted, true);
});

test("missing or wrong screens remain unverified after the bounded proof wait", async () => {
  const page = {
    locator() {
      return {
        first: () => ({
          waitFor: async () => {
            throw new Error("timeout");
          },
        }),
      };
    },
  };
  assert.equal(
    await proveScreen(page, "#intended-screen", 75),
    "nothing matches #intended-screen after 75ms",
  );
});

function motion(states) {
  return runInNewContext(`(${finiteMotionFinished.toString()})()`, {
    document: {
      getAnimations: () =>
        states.map(([playState, iterations]) => ({
          playState,
          effect: { getComputedTiming: () => ({ iterations }) },
        })),
    },
  });
}

test("finite entry animation and transition must finish; looping decoration does not block", () => {
  assert.equal(motion([["running", 1]]), false);
  assert.equal(motion([["paused", 1]]), false);
  assert.equal(
    motion([
      ["running", Infinity],
      ["running", 1],
    ]),
    false,
  );
  assert.equal(
    motion([
      ["running", Infinity],
      ["finished", 1],
    ]),
    true,
  );
  assert.equal(motion([["idle", 1]]), true);
  assert.equal(motion([]), true);
});

test("motion timeout is reported rather than swallowed or measured as a pass", async () => {
  const page = {
    waitForFunction: async () => {
      throw new Error("timeout");
    },
  };
  assert.equal(await settleMotion(page, 75), "finite motion still active after 75ms");
});
