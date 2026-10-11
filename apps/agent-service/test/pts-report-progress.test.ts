import test from "node:test";
import assert from "node:assert/strict";
import { createPtsReportTrigger, type PtsReportProgress } from "../src/pts-study/report-trigger.js";
import { createReportQueue } from "../src/perps-study/report-queue.js";

test("an attempted unavailable slot requests a report without a completed round", () => {
  let requested = 0;
  const progress = { lastRoundSlot: 37, lastAttemptedSlot: 37, processState: "active" };
  const trigger = createPtsReportTrigger(progress, () => requested++);

  // Recorded slot 38 was unavailable; round 37 remained the latest completed round.
  const unavailable = { ...progress, lastAttemptedSlot: 38 };
  assert.equal(trigger.update(unavailable), true);
  assert.equal(requested, 1);
  assert.deepEqual(progress, {
    lastRoundSlot: 37,
    lastAttemptedSlot: 37,
    processState: "active",
  });
  assert.equal(trigger.update(unavailable), false);
  assert.equal(requested, 1);

  assert.equal(trigger.update({ ...unavailable, lastRoundSlot: 39, lastAttemptedSlot: 39 }), true);
  assert.equal(requested, 2);
});

test("historical missing attempt cursors remain readable and a first omitted slot is published", () => {
  let requested = 0;
  const trigger = createPtsReportTrigger(
    { lastRoundSlot: -1, processState: "active" },
    () => requested++,
  );

  assert.equal(
    trigger.update({ lastRoundSlot: -1, lastAttemptedSlot: -1, processState: "active" }),
    false,
  );
  assert.equal(
    trigger.update({ lastRoundSlot: -1, lastAttemptedSlot: undefined, processState: "active" }),
    false,
  );
  assert.equal(
    trigger.update({ lastRoundSlot: -1, lastAttemptedSlot: 0, processState: "active" }),
    true,
  );
  assert.equal(requested, 1);
});

test("closing and terminal states publish without another decision; unchanged observations do not", () => {
  let requested = 0;
  const progress = { lastRoundSlot: 37, lastAttemptedSlot: 38, processState: "active" };
  const trigger = createPtsReportTrigger(progress, () => requested++);

  for (let minute = 0; minute < 5; minute++) {
    assert.equal(trigger.update({ ...progress }), false);
  }
  assert.equal(requested, 0);

  for (const processState of ["closing", "finished", "interrupted"]) {
    assert.equal(trigger.update({ ...progress, processState }), true);
  }
  assert.equal(requested, 3);
});

test("fixed-end report requests are preserved even when progress is unchanged", () => {
  let requested = 0;
  const progress = { lastRoundSlot: 37, lastAttemptedSlot: 38, processState: "closing" };
  const trigger = createPtsReportTrigger(progress, () => requested++);

  assert.equal(trigger.update(progress, true), true);
  assert.equal(requested, 1);
});

test("a slow report coalesces omission and closing updates without overlap or delaying admission", async () => {
  let release!: () => void;
  let started!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  let latest: PtsReportProgress = {
    lastRoundSlot: 37,
    lastAttemptedSlot: 37,
    processState: "active",
  };
  let active = 0;
  let maximumActive = 0;
  let generations = 0;
  const published: PtsReportProgress[] = [];
  const failures: unknown[] = [];
  const queue = createReportQueue(
    async () => {
      const captured = { ...latest };
      active++;
      maximumActive = Math.max(maximumActive, active);
      generations++;
      if (generations === 1) {
        started();
        await blocked;
      }
      published.push(captured);
      active--;
    },
    (error) => failures.push(error),
  );
  const trigger = createPtsReportTrigger(latest, queue.request);

  latest = { ...latest, lastAttemptedSlot: 38 };
  assert.equal(trigger.update(latest), true);
  await entered;

  latest = { ...latest, lastAttemptedSlot: 39 };
  assert.equal(trigger.update(latest), true);
  latest = { ...latest, processState: "closing" };
  assert.equal(trigger.update(latest), true);
  assert.equal(trigger.update(latest), false);
  assert.equal(published.length, 0);
  assert.equal(active, 1);

  release();
  await queue.flush();

  assert.equal(maximumActive, 1);
  assert.equal(generations, 2);
  assert.equal(active, 0);
  assert.deepEqual(failures, []);
  assert.deepEqual(published, [
    { lastRoundSlot: 37, lastAttemptedSlot: 38, processState: "active" },
    { lastRoundSlot: 37, lastAttemptedSlot: 39, processState: "closing" },
  ]);
});

test("an unavailable-slot report failure retains its specific failure and does not retry", async () => {
  const failure = new Error("controlled report failure");
  const failures: unknown[] = [];
  let generations = 0;
  const queue = createReportQueue(
    async () => {
      generations++;
      throw failure;
    },
    (error) => failures.push(error),
  );
  const progress = { lastRoundSlot: 37, lastAttemptedSlot: 37, processState: "active" };
  const trigger = createPtsReportTrigger(progress, queue.request);

  assert.equal(trigger.update({ ...progress, lastAttemptedSlot: 38 }), true);
  await assert.rejects(queue.flush(), (error) => error === failure);
  assert.equal(trigger.update({ ...progress, lastAttemptedSlot: 39 }), true);
  await assert.rejects(queue.flush(), (error) => error === failure);
  assert.equal(generations, 1);
  assert.deepEqual(failures, [failure]);
});
