import test from "node:test";
import assert from "node:assert/strict";
import { BreakoutOperationMemory } from "../src/features/hourly-breakout/operation-memory.js";
import { breakoutDigest } from "./hourly-breakout-fixture.js";

test("operation memory remains bounded and never rearms evicted original identities", () => {
  const memory = new BreakoutOperationMemory(breakoutDigest);
  const population = 100_000;

  for (let index = 0; index < population; index++) {
    memory.remember("operation", `original:${index}`);
  }

  assert.deepEqual(memory.size, {
    tombstoneBytes: 8 * 1024 * 1024,
    exactIdentities: 128,
  });
  assert.equal(memory.lookup("operation", "original:0"), "POSSIBLY_OLDER");
  assert.equal(memory.lookup("operation", `original:${population - 1}`), "RECENT_EXACT");
  for (let index = 0; index < population; index++) {
    assert.notEqual(memory.lookup("operation", `original:${index}`), "NEW");
  }
});

test("terminal attempt eviction cannot authorize a second effect", () => {
  const memory = new BreakoutOperationMemory(breakoutDigest, { recentLimit: 2 });
  memory.remember("terminal-attempt", "original-fill");
  memory.remember("operation", "later-one");
  memory.remember("operation", "later-two");

  assert.equal(memory.lookup("terminal-attempt", "original-fill"), "POSSIBLY_OLDER");
  assert.equal(memory.lookup("operation", "original-fill"), "NEW");
  assert.equal(memory.lookup("terminal-attempt", "never-attempted"), "NEW");
  assert.equal(memory.size.exactIdentities, 2);
});

test("tombstone saturation denies new work rather than manufacturing proof of novelty", () => {
  const memory = new BreakoutOperationMemory(breakoutDigest, { bytes: 1, recentLimit: 1 });
  for (let index = 0; index < 100; index++) {
    memory.remember("operation", `remembered:${index}`);
  }

  assert.equal(memory.lookup("operation", "never-seen-but-collides"), "POSSIBLY_OLDER");
  assert.notEqual(memory.lookup("operation", "remembered:0"), "NEW");
  assert.deepEqual(memory.size, { tombstoneBytes: 1, exactIdentities: 1 });
});

test("malformed digest or unbounded memory configuration fails closed", () => {
  const memory = new BreakoutOperationMemory(() => "invalid");
  assert.throws(() => memory.lookup("operation", "original"), { code: "INVALID_INPUT" });
  assert.throws(() => memory.remember("operation", "original"), { code: "INVALID_INPUT" });
  assert.throws(() => new BreakoutOperationMemory(breakoutDigest, { recentLimit: 129 }), {
    code: "INVALID_INPUT",
  });
  assert.throws(() => new BreakoutOperationMemory(breakoutDigest, { bytes: 8 * 1024 * 1024 + 1 }), {
    code: "INVALID_INPUT",
  });
});
