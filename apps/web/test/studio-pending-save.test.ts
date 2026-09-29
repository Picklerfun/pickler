import assert from "node:assert/strict";
import { test } from "node:test";
import { pendingSave, type Timers } from "../src/features/studio/lib/pending-save";

/* The deposit sheet's limits: saved a moment after the last change, and never lost by closing. */

/** A clock that only moves when the test says so. */
function clock() {
  let next = 1;
  const waiting = new Map<number, () => void>();
  const timers: Timers = {
    set: (run) => {
      const id = next++;
      waiting.set(id, run);
      return id;
    },
    clear: (id) => {
      if (id !== undefined) {
        waiting.delete(id as number);
      }
    },
  };
  return {
    timers,
    waiting: () => waiting.size,
    elapse() {
      const due = [...waiting.values()];
      waiting.clear();
      due.forEach((run) => run());
    },
  };
}

test("a change is saved once the delay has passed, not before", () => {
  const { timers, elapse } = clock();
  const saved: number[] = [];
  const save = pendingSave<number>(700, (value) => saved.push(value), timers);

  save.schedule(5);
  assert.deepEqual(saved, []);
  elapse();
  assert.deepEqual(saved, [5]);
});

test("changes inside the delay are one save, of the last value", () => {
  const { timers, elapse, waiting } = clock();
  const saved: number[] = [];
  const save = pendingSave<number>(700, (value) => saved.push(value), timers);

  save.schedule(5);
  save.schedule(6);
  save.schedule(7);
  assert.equal(waiting(), 1);
  elapse();
  assert.deepEqual(saved, [7]);
});

test("closing before the delay has passed saves what the screen was showing", () => {
  // The sheet showed the new limit the moment it was pressed. Clearing the timer on the way out
  // would leave the stored limit at the old value with nothing to say so.
  const { timers, elapse, waiting } = clock();
  const saved: number[] = [];
  const save = pendingSave<number>(700, (value) => saved.push(value), timers);

  save.schedule(9);
  save.flush();
  assert.deepEqual(saved, [9]);
  assert.equal(waiting(), 0);
  elapse();
  assert.deepEqual(saved, [9]);
});

test("closing with nothing pending saves nothing", () => {
  const { timers, elapse } = clock();
  const saved: number[] = [];
  const save = pendingSave<number>(700, (value) => saved.push(value), timers);

  save.flush();
  assert.deepEqual(saved, []);

  save.schedule(3);
  elapse();
  save.flush();
  assert.deepEqual(saved, [3]);
});

test("the delay asked for is the delay the timer is given", () => {
  const delays: number[] = [];
  const save = pendingSave<number>(700, () => {}, {
    set: (_run, delayMs) => {
      delays.push(delayMs);
      return 1;
    },
    clear: () => {},
  });
  save.schedule(1);
  assert.deepEqual(delays, [700]);
});
