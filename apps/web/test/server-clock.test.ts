import test from "node:test";
import assert from "node:assert/strict";
import { ServerClock } from "../src/lib/server-clock";

test("API time survives an incorrect browser clock and later wall-clock changes", () => {
  let wall = 1_000_000;
  let monotonic = 100;
  const clock = new ServerClock(
    () => wall,
    () => monotonic,
  );
  assert.equal(clock.synchronized, false);
  assert.equal(clock.now(), wall);

  clock.observe(1_120_000, 80);
  assert.equal(clock.synchronized, true);
  assert.equal(clock.now(), 1_120_010);
  wall -= 300_000;
  monotonic += 5000;

  assert.equal(clock.now(), 1_125_010);
});

test("unbounded latency and invalid server samples cannot replace a verified clock", () => {
  const clock = new ServerClock(
    () => 500,
    () => 100,
  );
  clock.observe(1000, 100);
  for (const sample of [NaN, Infinity, -1, 1.5]) {
    clock.observe(sample, 100);
  }
  clock.observe(100_000, -20_000);
  clock.observe(100_000, 101);

  assert.equal(clock.now(), 1000);
});
