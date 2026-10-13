import assert from "node:assert/strict";
import test from "node:test";
import { startPtsLoopDiagnostic } from "../src/pts-study/event-loop-diagnostic.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("passive loop evidence measures an overdue timer before it fires and freezes at stop", async () => {
  const diagnostic = startPtsLoopDiagnostic(10);
  try {
    const until = performance.now() + 50;
    while (performance.now() < until) {
      /* Controlled synchronous host delay; no financial clock is changed. */
    }
    const pending = diagnostic.snapshot();
    assert.equal(pending.samples.length, 0);
    assert.ok(pending.current.elapsedMs >= 50);
    assert.ok(pending.current.timerLatenessMs >= 40);
    assert.ok(pending.current.cpuUserMs + pending.current.cpuSystemMs > 0);
    assert.ok(pending.current.rssBytes > 0);
    await wait(20);

    const snapshot = diagnostic.snapshot();
    assert.ok(snapshot.samples.length > 0);
    assert.ok(snapshot.largest!.timerLatenessMs >= 40);
    snapshot.largest!.timerLatenessMs = -1;
    snapshot.samples[0]!.rssBytes = -1;
    assert.ok(diagnostic.snapshot().largest!.timerLatenessMs >= 40);
    assert.ok(diagnostic.snapshot().samples[0]!.rssBytes > 0);
    diagnostic.stop();
    const stopped = diagnostic.snapshot();
    await wait(25);
    diagnostic.stop();
    assert.deepEqual(diagnostic.snapshot(), stopped);
  } finally {
    diagnostic.stop();
  }
});

test("loop diagnostic bounds retained samples and declares truncation", async () => {
  const diagnostic = startPtsLoopDiagnostic(10);
  try {
    for (let i = 0; i < 70; i++) {
      await wait(11);
    }
    const snapshot = diagnostic.snapshot();
    assert.equal(snapshot.limit, 64);
    assert.equal(snapshot.samples.length, 64);
    assert.ok(snapshot.discarded >= 6);
    assert.equal(snapshot.truncated, true);
    assert.ok(snapshot.samples.every((value) => value.version === 1 && value.timerLatenessMs >= 0));
  } finally {
    diagnostic.stop();
  }
});

test("invalid diagnostic intervals are rejected independently of runtime deadlines", () => {
  for (const interval of [0, 9, 10.5, NaN, Infinity]) {
    assert.throws(() => startPtsLoopDiagnostic(interval));
  }
  const diagnostic = startPtsLoopDiagnostic();
  assert.equal(diagnostic.snapshot().intervalMs, 1000);
  diagnostic.stop();
});
